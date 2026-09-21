import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../stores/settings";
import type { ToolRunContext } from "../../tools";
import type { FoundPath } from "../../native";
import { findPathTool, openPathTool } from "./tools";
import { pathQuery, preparePathOpenFallback } from "./fallback";

const { searchPaths } = vi.hoisted(() => ({ searchPaths: vi.fn() }));
vi.mock("../../native", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../native")>()),
  searchPaths,
}));

const DOWNLOADS: FoundPath = {
  name: "Downloads",
  path: "C:\\Users\\me\\Downloads",
  kind: "folder",
};
const PROJECT: FoundPath = {
  name: "Project Files",
  path: "C:\\Users\\me\\Documents\\Project Files",
  kind: "folder",
};
const MY_PROJECT: FoundPath = {
  name: "My Project",
  path: "C:\\Users\\me\\Desktop\\My Project",
  kind: "folder",
};
const REPORT: FoundPath = {
  name: "report.pdf",
  path: "C:\\Users\\me\\Documents\\report.pdf",
  kind: "file",
};

function context(): ToolRunContext {
  return {
    settings: { ...DEFAULT_SETTINGS, installedPlugins: [], plugins: {} },
    consent: { web: false, screen: false, music: false },
    sources: [],
  };
}

beforeEach(() => {
  searchPaths.mockReset();
  searchPaths.mockResolvedValue([DOWNLOADS, PROJECT, MY_PROJECT, REPORT]);
});

describe("open_path tool", () => {
  it("is a core plugin gated only by its enablement toggle", () => {
    const ctx = context();
    expect(openPathTool.available(ctx.settings, ctx.consent)).toBe(true);
    expect(
      openPathTool.available(
        { ...ctx.settings, plugins: { "folder-finder": false } },
        ctx.consent,
      ),
    ).toBe(false);
  });

  it("creates an approval card without opening anything", async () => {
    const out = await openPathTool.run({ query: "downloads" }, context());
    expect(out.card).toEqual({
      type: "path_open",
      data: { path: DOWNLOADS, alternatives: [], query: "downloads" },
    });
    expect(out.content).toMatch(/Nothing has been opened/);
  });

  it("offers alternatives when the name is ambiguous", async () => {
    searchPaths.mockResolvedValue([
      { name: "report.pdf", path: "C:\\Users\\me\\Documents\\report.pdf", kind: "file" },
      {
        name: "report-final.pdf",
        path: "C:\\Users\\me\\Documents\\report-final.pdf",
        kind: "file",
      },
    ]);
    const out = await openPathTool.run({ query: "report" }, context());
    expect(out.card?.type).toBe("path_open");
    expect(out.card?.data).toMatchObject({
      query: "report",
    });
    expect(
      (out.card?.data as { alternatives: unknown[] }).alternatives.length,
    ).toBeGreaterThan(0);
    expect(out.content).toMatch(/several items/);
  });

  it("rejects missing, blank, or oversized names before searching", async () => {
    expect((await openPathTool.run({}, context())).content).toMatch(/required/);
    expect((await openPathTool.run({ query: "   " }, context())).content).toMatch(
      /required/,
    );
    expect((await openPathTool.run({ query: "!!!" }, context())).content).toMatch(
      /Error/,
    );
    expect(
      (await openPathTool.run({ query: "x".repeat(121) }, context())).content,
    ).toMatch(/too long/);
    expect(searchPaths).not.toHaveBeenCalled();
  });

  it("tells the model when nothing matches", async () => {
    searchPaths.mockResolvedValue([DOWNLOADS]);
    const out = await openPathTool.run({ query: "photoshop" }, context());
    expect(out.card).toBeUndefined();
    expect(out.content).toMatch(/No folder or file matches/);
  });

  it("explains the browser preview cannot search paths", async () => {
    searchPaths.mockResolvedValue([]);
    const out = await openPathTool.run({ query: "downloads" }, context());
    expect(out.card).toBeUndefined();
    expect(out.content).toMatch(/Windows desktop app/);
    expect(out.content).toMatch(/Steam game libraries/);
  });
});

describe("find_path tool", () => {
  it("returns paths wrapped as untrusted data", async () => {
    const out = await findPathTool.run({ query: "downloads" }, context());
    expect(out.content).toMatch(/<untrusted_path_list>/);
    expect(out.content).toContain("Downloads");
    expect(out.content).toContain("C:\\Users\\me\\Downloads");
    expect(out.content).toMatch(/not instructions/);
  });
});

describe("text-only fallback", () => {
  it("recognizes folder and file lookup requests", () => {
    expect(pathQuery("where is my downloads")).toBe("downloads");
    expect(pathQuery("find the Project Files folder")).toBe("Project Files");
    expect(pathQuery("open Documents folder")).toBe("Documents");
    expect(pathQuery("please locate my pictures")).toBe("pictures");
  });

  it("recognizes Steam game queries", () => {
    expect(pathQuery("find the steam dota folder")).toBe("steam dota");
    expect(pathQuery("where is steam games")).toBe("steam games");
    expect(pathQuery("open the steam library folder")).toBe("steam library");
  });

  it("leaves URLs, absolute paths, and real questions to the model", () => {
    expect(pathQuery("open example.com in my browser")).toBeNull();
    expect(pathQuery("open C:\\Users\\me\\notes.txt")).toBeNull();
    expect(pathQuery("how do I find a port on my router")).toBeNull();
    expect(
      pathQuery("find the file I attached and summarize it for me today please"),
    ).toBeNull();
    expect(pathQuery("what is downloads")).toBeNull();
    // Bare app opens stay with the app launcher.
    expect(pathQuery("open spotify")).toBeNull();
  });

  it("produces the same card as the tool, and nothing when disabled or unmatched", async () => {
    const ctx = context();
    const out = await preparePathOpenFallback("where is downloads", ctx.settings);
    expect(out?.card?.type).toBe("path_open");
    expect(out?.card?.data).toMatchObject({ path: DOWNLOADS });

    // Known-folder alias without the word "folder".
    const openKnown = await preparePathOpenFallback("open downloads", ctx.settings);
    expect(openKnown?.card?.type).toBe("path_open");

    expect(
      await preparePathOpenFallback("find photoshop folder", ctx.settings),
    ).toBeNull();
    expect(
      await preparePathOpenFallback("where is downloads", {
        ...ctx.settings,
        plugins: { "folder-finder": false },
      }),
    ).toBeNull();
  });
});
