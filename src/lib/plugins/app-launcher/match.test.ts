import { describe, expect, it } from "vitest";
import type { LaunchableApp } from "../../native";
import { matchApp, normalizeQuery, rankApps, scoreApp } from "./match";

function app(name: string, kind: LaunchableApp["kind"] = "shortcut"): LaunchableApp {
  return { name, path: kind === "system" ? `${name}:` : `C:\\Menu\\${name}.lnk`, kind };
}

const APPS: LaunchableApp[] = [
  app("Spotify"),
  app("Visual Studio Code"),
  app("Visual Studio 2022"),
  app("VLC media player"),
  app("Google Chrome"),
  app("Settings", "system"),
  app("Notepad", "system"),
  app("Notepad++"),
];

describe("app name normalization", () => {
  it("drops filler words and punctuation the model or user adds", () => {
    expect(normalizeQuery("the Spotify app, please")).toBe("spotify");
    expect(normalizeQuery("open up my Spotify")).toBe("spotify");
    expect(normalizeQuery("  Visual   Studio  Code!! ")).toBe("visual studio code");
    expect(normalizeQuery("Notepad++")).toBe("notepad++");
  });
});

describe("app scoring", () => {
  it("prefers exact, then prefix, then word, then substring matches", () => {
    expect(scoreApp("spotify", "Spotify")).toBe(100);
    expect(scoreApp("visual studio", "Visual Studio Code")).toBe(85);
    expect(scoreApp("chrome", "Google Chrome")).toBe(75);
    expect(scoreApp("vs code", "Visual Studio Code")).toBe(55);
    expect(scoreApp("gc", "Google Chrome")).toBe(55);
    expect(scoreApp("ch", "Google Chrome")).toBe(75);
    expect(scoreApp("vlc", "VLC media player")).toBe(85);
    expect(scoreApp("photoshop", "Spotify")).toBe(0);
  });

  it("does not let an empty query match everything", () => {
    expect(scoreApp("", "Spotify")).toBe(0);
    expect(scoreApp("please", "Spotify")).toBe(0);
  });
});

describe("app matching", () => {
  it("is confident about a single clear winner", () => {
    const match = matchApp("open spotify", APPS);
    expect(match?.app.name).toBe("Spotify");
    expect(match?.confident).toBe(true);
    expect(match?.alternatives).toEqual([]);
  });

  it("treats a perfect name as confident even when a longer app shares the prefix", () => {
    const match = matchApp("Notepad", APPS);
    expect(match?.app.name).toBe("Notepad");
    expect(match?.app.kind).toBe("system");
    expect(match?.confident).toBe(true);
  });

  it("offers alternatives when the request is ambiguous", () => {
    const match = matchApp("visual studio", APPS);
    expect(match?.confident).toBe(false);
    const offered = [match!.app, ...match!.alternatives].map((a) => a.name).sort();
    expect(offered).toEqual(["Visual Studio 2022", "Visual Studio Code"]);
  });

  it("returns null when nothing is installed by that name", () => {
    expect(matchApp("photoshop", APPS)).toBeNull();
    expect(matchApp("", APPS)).toBeNull();
    expect(matchApp("spotify", [])).toBeNull();
  });

  it("ranks by score then shorter name, capped", () => {
    const ranked = rankApps("v", APPS);
    expect(ranked.length).toBeLessThanOrEqual(5);
    expect(ranked[0].app.name).toBe("VLC media player");
  });
});
