import { describe, it, expect } from "vitest";
import {
  PLUGIN_MODULES,
  allPluginTools,
  allPluginCards,
  pluginContexts,
  pluginSettingsPanels,
} from "./registry";
import { BUILTIN_PLUGINS } from "../plugins";
import { DEFAULT_SETTINGS } from "../stores/settings";
import { availableTools } from "../tools";
import type { Settings, TurnConsent } from "../types";

function settingsWith(patch: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...patch };
}

const none: TurnConsent = { web: false, screen: false, music: false };
const all: TurnConsent = { web: true, screen: true, music: true };

describe("plugin registry", () => {
  it("only registers modules that exist in the catalog", () => {
    // The catalog owns the display copy; a module for an id Settings never
    // lists would contribute tools no one could turn off.
    const ids = new Set(BUILTIN_PLUGINS.map((p) => p.id));
    for (const m of PLUGIN_MODULES) expect(ids.has(m.id)).toBe(true);
  });

  it("gives every tool a pluginId matching the module that contributes it", () => {
    for (const m of PLUGIN_MODULES) {
      for (const t of m.tools ?? []) expect(t.pluginId).toBe(m.id);
    }
  });

  it("exposes no duplicate tool names", () => {
    // `runTool` resolves by name, so a collision would silently shadow one.
    const names = allPluginTools().map((t) => t.spec.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("exposes no duplicate card types", () => {
    const types = PLUGIN_MODULES.flatMap((m) => Object.keys(m.cards ?? {}));
    expect(new Set(types).size).toBe(types.length);
  });

  it("registers a renderer for every card type a tool can attach", () => {
    // A tool attaching a card no renderer knows would produce a message that
    // silently drops its own interactive half.
    expect(allPluginCards()).toHaveProperty("now_playing");
  });

  it("gives every tool a capability phrase", () => {
    // Without one the model is never told the ability exists, so it hedges or
    // refuses instead of calling the tool.
    for (const t of allPluginTools()) expect(t.capability?.trim()).toBeTruthy();
  });

  it("registers Screen Context settings for installed plugins", () => {
    expect(
      pluginSettingsPanels((id) => id === "screen-context").map((p) => p.id),
    ).toEqual(["screen-context"]);
  });

  it("does not expose stale OCR after screen redaction", async () => {
    const tool = allPluginTools().find(
      (candidate) => candidate.spec.name === "read_screen",
    );
    const outcome = await tool!.run(
      {},
      {
        settings: settingsWith(),
        consent: { ...none, screen: true },
        approvedScreen: {
          image: "data:image/png;base64,redacted",
          text: "secret OCR text",
          redacted: true,
        },
        sources: [],
      },
    );

    expect(outcome.image).toBe("data:image/png;base64,redacted");
    expect(outcome.content).not.toContain("secret OCR text");
  });
});

describe("gating through the registry", () => {
  it("offers approval-gated computer control on default settings", () => {
    // Text insertion is built in and cannot act until the user approves its
    // card. Privacy-sensitive observation tools still require turn consent.
    expect(availableTools(settingsWith(), none).map((t) => t.spec.name)).toEqual([
      "prepare_text_insertion",
      "prepare_browser_navigation",
      "prepare_computer_actions",
      "open_app",
      "list_installed_apps",
      "find_path",
      "open_path",
    ]);
  });

  it("offers a tool only once BOTH its plugin and its toggle are on", () => {
    expect(
      availableTools(settingsWith(), { ...none, web: true }).map((t) => t.spec.name),
    ).toEqual([
      "web_search",
      "prepare_text_insertion",
      "prepare_browser_navigation",
      "prepare_computer_actions",
      "open_app",
      "list_installed_apps",
      "find_path",
      "open_path",
    ]);
    expect(
      availableTools(settingsWith({ plugins: { "web-search": false } }), {
        ...none,
        web: true,
      }).map((t) => t.spec.name),
    ).toEqual([
      "prepare_text_insertion",
      "prepare_browser_navigation",
      "prepare_computer_actions",
      "open_app",
      "list_installed_apps",
      "find_path",
      "open_path",
    ]);
  });

  it("keeps music's read tool separate from its control tool", () => {
    const installed = settingsWith({ installedPlugins: ["music"] });
    expect(availableTools(installed, none).map((t) => t.spec.name)).toEqual([
      "music_now_playing",
      "prepare_text_insertion",
      "prepare_browser_navigation",
      "prepare_computer_actions",
      "open_app",
      "list_installed_apps",
      "find_path",
      "open_path",
    ]);

    // Full consent adds transport control, and YouTube — which needs no
    // account, only a browser. The SPOTIFY tools stay out: they need a
    // connected account on top of all this, and nothing has connected one here.
    const consented = settingsWith({
      installedPlugins: ["music"],
      musicConfirmed: true,
    });
    const names = availableTools(consented, all).map((t) => t.spec.name);
    expect(names).toContain("music_control");
    expect(names).toContain("music_play_youtube");
    expect(names).not.toContain("music_play");
    expect(names).not.toContain("music_search");
  });
});

describe("plugin context blocks", () => {
  it("instructs default installs to create action approval cards", () => {
    const text = pluginContexts(settingsWith(), none).join("\n");
    expect(text).toContain("MUST call `prepare_text_insertion`");
    expect(text).toContain("MUST call `prepare_browser_navigation`");
    expect(text).toContain("MUST call `prepare_computer_actions`");
    expect(text).toContain("must approve");
  });

  it("instructs the model to route app requests through the approval tool", () => {
    const text = pluginContexts(settingsWith(), none).join("\n");
    expect(text).toContain("MUST call `open_app`");
    expect(text).toContain("never claim the app is open");
  });

  it("instructs the model to route folder requests through the approval tool", () => {
    const text = pluginContexts(settingsWith(), none).join("\n");
    expect(text).toContain("MUST call `open_path`");
    expect(text).toContain("never claim the path is open");
  });

  it("removes app launcher tools and instructions independently of computer control", () => {
    const disabled = settingsWith({ plugins: { "app-launcher": false } });
    const names = availableTools(disabled, none).map((t) => t.spec.name);
    expect(names).not.toContain("open_app");
    expect(names).not.toContain("list_installed_apps");
    expect(names).toContain("prepare_text_insertion");
    expect(names).toContain("find_path");
    expect(pluginContexts(disabled, none).join("\n")).not.toContain("MUST call `open_app`");
  });

  it("removes folder finder tools and instructions independently", () => {
    const disabled = settingsWith({ plugins: { "folder-finder": false } });
    const names = availableTools(disabled, none).map((t) => t.spec.name);
    expect(names).not.toContain("find_path");
    expect(names).not.toContain("open_path");
    expect(names).toContain("open_app");
    expect(pluginContexts(disabled, none).join("\n")).not.toContain("MUST call `open_path`");
  });

  it("removes computer control tools and instructions when disabled", () => {
    const disabled = settingsWith({
      plugins: {
        "computer-control": false,
        "app-launcher": false,
        "folder-finder": false,
      },
    });
    expect(availableTools(disabled, none)).toEqual([]);
    expect(pluginContexts(disabled, none).join("\n")).not.toContain(
      "prepare_text_insertion",
    );
    expect(pluginContexts(disabled, none).join("\n")).not.toContain(
      "prepare_browser_navigation",
    );
    expect(pluginContexts(disabled, none).join("\n")).not.toContain(
      "prepare_computer_actions",
    );
  });

  it("warns the model when it has no way to start a specific track", () => {
    // The failure this guards: the model accepts "play my Discover Weekly" and
    // then does nothing, because transport control only drives an already
    // loaded track and no service is connected to start a new one.
    const text = pluginContexts(settingsWith({ installedPlugins: ["music"] }), none).join(
      "\n",
    );
    expect(text).toMatch(/Spotify is NOT connected/i);
    expect(text).toMatch(/only control what is already playing/i);
  });

  it("never promises YouTube playback started, since browsers block autoplay", () => {
    const text = pluginContexts(
      settingsWith({ installedPlugins: ["music"], musicConfirmed: true }),
      all,
    ).join("\n");
    expect(text).toMatch(/not guaranteed to start/i);
    expect(text).toMatch(
      /only say it is playing when the tool result says it was confirmed/i,
    );
  });

  it("tells the model when playback control is off, and how to enable it", () => {
    const readOnly = pluginContexts(
      settingsWith({ installedPlugins: ["music"] }),
      none,
    ).join("\n");
    expect(readOnly).toMatch(/only READ/);
    expect(readOnly).toMatch(/Music toggle/);

    const full = pluginContexts(
      settingsWith({ installedPlugins: ["music"], musicConfirmed: true }),
      all,
    ).join("\n");
    expect(full).toMatch(/play, pause, skip, and seek/i);
    expect(full).not.toMatch(/only READ/);
  });
});
