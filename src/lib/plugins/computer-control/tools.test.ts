import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../stores/settings";
import type { ToolRunContext } from "../../tools";
import {
  browserNavigationUrl,
  prepareBrowserNavigationTool,
  prepareComputerActionsTool,
  prepareTextInsertionTool,
} from "./tools";

const { computerTarget } = vi.hoisted(() => ({ computerTarget: vi.fn() }));
vi.mock("../../native", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../native")>()),
  computerTarget,
}));

function context(): ToolRunContext {
  return {
    settings: {
      ...DEFAULT_SETTINGS,
      installedPlugins: ["computer-control"],
      plugins: { "computer-control": true },
    },
    consent: { web: false, screen: false, music: false },
    sources: [],
  };
}

beforeEach(() => computerTarget.mockReset());

describe("computer control text insertion", () => {
  it("is built in but remains gated by its enablement toggle", () => {
    const ctx = context();
    expect(prepareTextInsertionTool.available(ctx.settings, ctx.consent)).toBe(true);
    expect(
      prepareTextInsertionTool.available(
        { ...ctx.settings, installedPlugins: [] },
        ctx.consent,
      ),
    ).toBe(true);
    expect(
      prepareTextInsertionTool.available(
        { ...ctx.settings, plugins: { "computer-control": false } },
        ctx.consent,
      ),
    ).toBe(false);
  });

  it("creates an approval card without inserting anything", async () => {
    computerTarget.mockResolvedValue({ id: "42", title: "Application form" });
    const out = await prepareTextInsertionTool.run(
      { text: "Dear hiring manager" },
      context(),
    );
    expect(out.card).toEqual({
      type: "computer_insert_text",
      data: {
        target: { id: "42", title: "Application form" },
        text: "Dear hiring manager",
      },
    });
    expect(out.content).toMatch(/NOT been inserted/);
  });

  it("rejects blank and oversized text before selecting a target", async () => {
    expect(
      (await prepareTextInsertionTool.run({ text: "  " }, context())).content,
    ).toMatch(/required/);
    expect(
      (await prepareTextInsertionTool.run({ text: "x".repeat(20_001) }, context()))
        .content,
    ).toMatch(/too long/);
    expect(computerTarget).not.toHaveBeenCalled();
  });

  it("creates an approval card for a normalized browser address", async () => {
    computerTarget.mockResolvedValue({ id: "7", title: "New tab - Google Chrome" });
    const out = await prepareBrowserNavigationTool.run(
      { url: "danravekeh.com" },
      context(),
    );
    expect(out.card).toEqual({
      type: "computer_navigate_browser",
      data: {
        target: { id: "7", title: "New tab - Google Chrome" },
        url: "https://danravekeh.com/",
      },
    });
    expect(out.content).toMatch(/NOT happened/);
  });

  it("recognizes an explicit browser navigation request for non-tool providers", () => {
    expect(browserNavigationUrl("change my browser url with danravekeh.com")).toBe(
      "https://danravekeh.com/",
    );
    expect(browserNavigationUrl("open https://example.com/docs in my browser")).toBe(
      "https://example.com/docs",
    );
  });

  it("does not treat a plain URL mention as an action", () => {
    expect(browserNavigationUrl("What is danravekeh.com?")).toBeNull();
    expect(browserNavigationUrl("open the settings page")).toBeNull();
  });

  it("rejects non-web protocols before selecting a target", async () => {
    expect(
      (await prepareBrowserNavigationTool.run({ url: "file:///secrets" }, context()))
        .content,
    ).toMatch(/HTTP or HTTPS/);
    expect(computerTarget).not.toHaveBeenCalled();
  });

  it("creates one approval card for a bounded multi-action plan", async () => {
    computerTarget.mockResolvedValue({ id: "9", title: "Application form" });
    const actions = [
      { kind: "click", x: 420, y: 610 },
      { kind: "type", text: "Dan Rave" },
      { kind: "key", key: "tab" },
      { kind: "scroll", amount: -480 },
    ];
    const out = await prepareComputerActionsTool.run(
      { summary: "Fill the visible name field and move down", actions },
      context(),
    );
    expect(out.card).toEqual({
      type: "computer_actions",
      data: {
        target: { id: "9", title: "Application form" },
        summary: "Fill the visible name field and move down",
        actions,
      },
    });
    expect(out.content).toMatch(/NOT run/);
  });

  it("rejects unsafe or malformed action plans before selecting a target", async () => {
    for (const actions of [
      [],
      [{ kind: "click", x: -1, y: 20 }],
      [{ kind: "key", key: "alt+f4" }],
      [{ kind: "type", text: "" }],
      Array.from({ length: 13 }, () => ({ kind: "key", key: "tab" })),
    ]) {
      expect(
        (await prepareComputerActionsTool.run({ summary: "Do it", actions }, context()))
          .content,
      ).toMatch(/Error/);
    }
    expect(computerTarget).not.toHaveBeenCalled();
  });
});
