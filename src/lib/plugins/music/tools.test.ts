import { describe, it, expect } from "vitest";
import { canRead, canControl, musicTools } from "./tools";
import { DEFAULT_SETTINGS } from "../../stores/settings";
import type { Settings, TurnConsent } from "../../types";

const yes: TurnConsent = { web: false, screen: false, music: true };
const no: TurnConsent = { web: false, screen: false, music: false };

/** Settings with the music plugin installed and enabled, and nothing else. */
function withMusic(patch: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    installedPlugins: ["music"],
    plugins: {},
    ...patch,
  };
}

describe("music tool gating", () => {
  it("allows reading what's playing with just the plugin installed", () => {
    // Looking at what is already playing is not an intrusion, so it needs no
    // per-turn consent — otherwise "what song is this" would fail by default.
    expect(canRead(withMusic())).toBe(true);
  });

  it("refuses everything when the plugin is not installed", () => {
    const off = { ...DEFAULT_SETTINGS, installedPlugins: [], plugins: {} };
    expect(canRead(off)).toBe(false);
    expect(canControl({ ...off, musicConfirmed: true }, yes)).toBe(false);
  });

  it("refuses everything when the plugin is installed but disabled", () => {
    const disabled = withMusic({
      plugins: { music: false },
      musicConfirmed: true,
    });
    expect(canRead(disabled)).toBe(false);
    expect(canControl(disabled, yes)).toBe(false);
  });

  it("requires BOTH the toggle and the one-time confirmation to control", () => {
    // Either half alone must not be enough: the toggle is per-turn consent and
    // the confirmation is the "yes, you may touch my music apps" agreement.
    expect(canControl(withMusic({ musicConfirmed: false }), yes)).toBe(false);
    expect(canControl(withMusic({ musicConfirmed: true }), no)).toBe(false);
    expect(canControl(withMusic({ musicConfirmed: true }), yes)).toBe(true);
  });

  it("does not offer control by default even with the plugin installed", () => {
    expect(canControl(withMusic(), no)).toBe(false);
  });
});

describe("music tool specs", () => {
  it("declares the plugin that gates each tool", () => {
    for (const t of musicTools) expect(t.pluginId).toBe("music");
  });

  it("gives every tool a running label and a described schema", () => {
    for (const t of musicTools) {
      expect(t.runningLabel).toBeTruthy();
      expect(t.spec.name).toMatch(/^music_/);
      // The description is the only thing telling the model when to reach for
      // the tool, so an empty one is a silent behavioural bug.
      expect(t.spec.description.length).toBeGreaterThan(40);
      expect(t.spec.parameters.type).toBe("object");
    }
  });

  it("constrains the control action to the transport verbs the backend accepts", () => {
    const control = musicTools.find((t) => t.spec.name === "music_control");
    expect(control).toBeDefined();
    const props = control!.spec.parameters.properties as Record<
      string,
      { enum?: string[] }
    >;
    const action = props?.action;
    // A free-form string here means the model can invent an action and only
    // find out it was wrong after a round-trip.
    expect(action?.enum).toEqual([
      "play",
      "pause",
      "toggle",
      "next",
      "previous",
      "stop",
      "seek",
    ]);
  });

  it("tells the model that control cannot start a specific track", () => {
    // SMTC drives what is already loaded. Without this the model confidently
    // accepts "play my Discover Weekly" and then silently does nothing.
    const control = musicTools.find((t) => t.spec.name === "music_control");
    expect(control!.spec.description).toMatch(/cannot start/i);
  });
});
