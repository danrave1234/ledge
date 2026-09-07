import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../stores/settings";
import type { ToolRunContext } from "../../tools";
import type { LaunchableApp } from "../../native";
import { listInstalledAppsTool, openAppTool } from "./tools";
import { appLaunchQuery, prepareAppLaunchFallback } from "./fallback";

const { listApps } = vi.hoisted(() => ({ listApps: vi.fn() }));
vi.mock("../../native", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../native")>()),
  listApps,
}));

const SPOTIFY: LaunchableApp = {
  name: "Spotify",
  path: "C:\\Menu\\Spotify.lnk",
  kind: "shortcut",
};
const VS: LaunchableApp = {
  name: "Visual Studio 2022",
  path: "C:\\Menu\\Visual Studio 2022.lnk",
  kind: "shortcut",
};
const VSCODE: LaunchableApp = {
  name: "Visual Studio Code",
  path: "C:\\Menu\\Visual Studio Code.lnk",
  kind: "shortcut",
};
const SETTINGS: LaunchableApp = {
  name: "Settings",
  path: "ms-settings:",
  kind: "system",
};

function context(): ToolRunContext {
  return {
    settings: { ...DEFAULT_SETTINGS, installedPlugins: [], plugins: {} },
    consent: { web: false, screen: false, music: false },
    sources: [],
  };
}

beforeEach(() => {
  listApps.mockReset();
  listApps.mockResolvedValue([SPOTIFY, VS, VSCODE, SETTINGS]);
});

describe("open_app tool", () => {
  it("is a core plugin gated only by its enablement toggle", () => {
    const ctx = context();
    expect(openAppTool.available(ctx.settings, ctx.consent)).toBe(true);
    expect(
      openAppTool.available(
        { ...ctx.settings, plugins: { "app-launcher": false } },
        ctx.consent,
      ),
    ).toBe(false);
  });

  it("creates an approval card without opening anything", async () => {
    const out = await openAppTool.run({ app: "spotify" }, context());
    expect(out.card).toEqual({
      type: "app_launch",
      data: { app: SPOTIFY, alternatives: [], query: "spotify" },
    });
    expect(out.content).toMatch(/Nothing has been opened/);
  });

  it("offers alternatives when the name is ambiguous", async () => {
    const out = await openAppTool.run({ app: "visual studio" }, context());
    expect(out.card?.data).toMatchObject({
      app: VS,
      alternatives: [VSCODE],
    });
    expect(out.content).toMatch(/several apps/);
  });

  it("rejects missing, blank, or oversized names before listing apps", async () => {
    expect((await openAppTool.run({}, context())).content).toMatch(/required/);
    expect((await openAppTool.run({ app: "   " }, context())).content).toMatch(
      /required/,
    );
    expect((await openAppTool.run({ app: "!!!" }, context())).content).toMatch(/Error/);
    expect((await openAppTool.run({ app: "x".repeat(121) }, context())).content).toMatch(
      /too long/,
    );
    expect(listApps).not.toHaveBeenCalled();
  });

  it("tells the model not to guess when nothing matches", async () => {
    const out = await openAppTool.run({ app: "photoshop" }, context());
    expect(out.card).toBeUndefined();
    expect(out.content).toMatch(/No installed app matches/);
    expect(out.content).toMatch(/Do not guess/);
  });

  it("explains the browser preview cannot list apps", async () => {
    listApps.mockResolvedValue([]);
    const out = await openAppTool.run({ app: "spotify" }, context());
    expect(out.card).toBeUndefined();
    expect(out.content).toMatch(/Windows desktop app/);
  });
});

describe("list_installed_apps tool", () => {
  it("returns names wrapped as untrusted data", async () => {
    const out = await listInstalledAppsTool.run({}, context());
    expect(out.content).toMatch(/<untrusted_app_list>/);
    expect(out.content).toContain("Spotify");
    expect(out.content).toContain("Settings");
    expect(out.content).toMatch(/not instructions/);
  });
});

describe("text-only fallback", () => {
  it("recognizes a bare open request", () => {
    expect(appLaunchQuery("open spotify")).toBe("spotify");
    expect(appLaunchQuery("Please launch Visual Studio Code!")).toBe(
      "Visual Studio Code",
    );
    expect(appLaunchQuery("start the settings app")).toBe("settings");
    expect(appLaunchQuery("can you open notepad for me")).toBe("notepad");
  });

  it("leaves URLs, paths, and real questions to the model", () => {
    expect(appLaunchQuery("open example.com in my browser")).toBeNull();
    expect(appLaunchQuery("open C:\\Users\\me\\notes.txt")).toBeNull();
    expect(appLaunchQuery("how do I open a port on my router")).toBeNull();
    expect(
      appLaunchQuery("open the file I attached and summarize it for me today"),
    ).toBeNull();
    expect(appLaunchQuery("what is spotify")).toBeNull();
  });

  it("produces the same card as the tool, and nothing when disabled or unmatched", async () => {
    const ctx = context();
    const out = await prepareAppLaunchFallback("open spotify", ctx.settings);
    expect(out?.card?.type).toBe("app_launch");
    expect(out?.card?.data).toMatchObject({ app: SPOTIFY });

    expect(await prepareAppLaunchFallback("open photoshop", ctx.settings)).toBeNull();
    expect(
      await prepareAppLaunchFallback("open spotify", {
        ...ctx.settings,
        plugins: { "app-launcher": false },
      }),
    ).toBeNull();
  });
});
