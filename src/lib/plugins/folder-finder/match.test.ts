import { describe, expect, it } from "vitest";
import type { FoundPath } from "../../native";
import { matchPath, normalizeQuery, rankPaths, scorePath } from "./match";

function path(name: string, kind: FoundPath["kind"] = "folder"): FoundPath {
  return {
    name,
    path: kind === "folder" ? `C:\\Users\\me\\${name}` : `C:\\Users\\me\\${name}`,
    kind,
  };
}

const PATHS: FoundPath[] = [
  path("Downloads"),
  path("Documents"),
  path("Project Files"),
  path("My Project"),
  path("report.pdf", "file"),
  path("report-final.pdf", "file"),
  path("Desktop"),
];

describe("path name normalization", () => {
  it("drops filler words and leading verbs", () => {
    expect(normalizeQuery("the Downloads folder, please")).toBe("downloads");
    expect(normalizeQuery("find my Documents")).toBe("documents");
    expect(normalizeQuery("  Project   Files!! ")).toBe("project files");
    expect(normalizeQuery("where is report.pdf")).toBe("report.pdf");
  });

  it("strips platform hints when other tokens remain", () => {
    expect(normalizeQuery("steam dota")).toBe("dota");
    expect(normalizeQuery("steam dota 2")).toBe("dota 2");
    expect(normalizeQuery("epic fortnite")).toBe("fortnite");
    expect(normalizeQuery("gog witcher")).toBe("witcher");
  });

  it("keeps platform hint when it's the only token", () => {
    expect(normalizeQuery("steam")).toBe("steam");
    expect(normalizeQuery("epic")).toBe("epic");
  });
});

describe("path scoring", () => {
  it("prefers exact, then prefix, then word, then substring matches", () => {
    expect(scorePath("downloads", "Downloads")).toBe(100);
    expect(scorePath("project", "Project Files")).toBe(85);
    expect(scorePath("files", "Project Files")).toBe(75);
    expect(scorePath("project files", "Project Files")).toBe(100);
    expect(scorePath("report", "report.pdf")).toBe(85);
    expect(scorePath("photoshop", "Downloads")).toBe(0);
  });

  it("does not let an empty query match everything", () => {
    expect(scorePath("", "Downloads")).toBe(0);
    expect(scorePath("please", "Downloads")).toBe(0);
  });
});

describe("path matching", () => {
  it("is confident about a single clear winner", () => {
    const match = matchPath("downloads", PATHS);
    expect(match?.path.name).toBe("Downloads");
    expect(match?.confident).toBe(true);
    expect(match?.alternatives).toEqual([]);
  });

  it("offers alternatives when the request is ambiguous", () => {
    const match = matchPath("report", PATHS);
    expect(match?.confident).toBe(false);
    const offered = [match!.path, ...match!.alternatives].map((p) => p.name).sort();
    expect(offered).toContain("report.pdf");
    expect(offered).toContain("report-final.pdf");
  });

  it("returns null when nothing matches", () => {
    expect(matchPath("photoshop", PATHS)).toBeNull();
    expect(matchPath("", PATHS)).toBeNull();
    expect(matchPath("downloads", [])).toBeNull();
  });

  it("ranks by score then shorter name, capped", () => {
    const ranked = rankPaths("project", PATHS);
    expect(ranked.length).toBeLessThanOrEqual(5);
    expect(ranked[0].path.name).toBe("Project Files");
  });
});
