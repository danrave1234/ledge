import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../native", () => ({
  mediaSessions: vi.fn(async () => []),
  openExternal: vi.fn(async () => {}),
  youtubeSearch: vi.fn(async () => []),
  youtubeHasKey: vi.fn(async () => false),
  isTauri: () => false,
}));

import { isYoutubeSession, confirmPlaying, playQuery, searchUrl } from "./youtube";
// `confirmPlaying` is re-used below to build an instant confirmation stub.
import { mediaSessions, openExternal, youtubeSearch } from "../../native";
import type { MediaSession } from "../../native";

function session(patch: Partial<MediaSession> = {}): MediaSession {
  return {
    app_id: "chrome.exe",
    app_name: "Google Chrome",
    title: "A Song",
    artist: "An Artist",
    album: "",
    status: "playing",
    position_ms: 0,
    duration_ms: 1000,
    can_play: true,
    can_pause: true,
    can_next: true,
    can_previous: true,
    can_seek: true,
    is_current: true,
    ...patch,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("searchUrl", () => {
  it("escapes characters that would break the query", () => {
    expect(searchUrl("lo-fi beats & chill")).toBe(
      "https://music.youtube.com/search?q=lo-fi%20beats%20%26%20chill",
    );
  });
});

describe("recognizing a YouTube Music session", () => {
  it("matches browsers, because a tab reports the BROWSER as the app", () => {
    // There is no "YouTube Music" process unless the desktop wrapper is
    // installed, so requiring one would never confirm a browser tab at all.
    for (const id of ["chrome.exe", "msedge.exe", "firefox.exe", "brave.exe"]) {
      expect(isYoutubeSession(session({ app_id: id }))).toBe(true);
    }
  });

  it("matches the YouTube Music desktop wrapper", () => {
    expect(
      isYoutubeSession(session({ app_id: "com.squirrel.YouTubeMusic.YouTubeMusic" })),
    ).toBe(true);
  });

  it("does not mistake Spotify for it", () => {
    expect(isYoutubeSession(session({ app_id: "Spotify.exe" }))).toBe(false);
    expect(isYoutubeSession(session({ app_id: "vlc.exe" }))).toBe(false);
  });
});

describe("confirmPlaying", () => {
  const noSleep = async () => {};
  let now = 0;
  const clock = () => now;

  beforeEach(() => (now = 0));

  it("returns the session once playback genuinely starts", async () => {
    vi.mocked(mediaSessions).mockResolvedValueOnce([session()]);
    const found = await confirmPlaying(5000, 100, clock, noSleep);
    expect(found?.title).toBe("A Song");
  });

  it("keeps waiting while the tab is still loading", async () => {
    vi.mocked(mediaSessions)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([session({ status: "paused" })])
      .mockResolvedValueOnce([session()]);
    const found = await confirmPlaying(5000, 100, clock, noSleep);
    expect(found).not.toBeNull();
    expect(mediaSessions).toHaveBeenCalledTimes(3);
  });

  it("returns null when autoplay was blocked", async () => {
    // The whole point: a browser that never starts must not be reported as
    // playing. Time advances so the loop actually reaches its deadline.
    vi.mocked(mediaSessions).mockResolvedValue([]);
    const found = await confirmPlaying(500, 100, () => (now += 200), noSleep);
    expect(found).toBeNull();
  });

  it("ignores a paused session and a session with no track", async () => {
    vi.mocked(mediaSessions).mockResolvedValue([
      session({ status: "paused" }),
      session({ title: "", artist: "" }),
    ]);
    const found = await confirmPlaying(500, 100, () => (now += 200), noSleep);
    expect(found).toBeNull();
  });

  it("ignores Spotify playing at the same time", async () => {
    // Spotify already running must not be mistaken for YouTube having started.
    vi.mocked(mediaSessions).mockResolvedValue([
      session({ app_id: "Spotify.exe", title: "Something else" }),
    ]);
    const found = await confirmPlaying(500, 100, () => (now += 200), noSleep);
    expect(found).toBeNull();
  });

  it("survives the media query failing outright", async () => {
    vi.mocked(mediaSessions).mockRejectedValue(new Error("no backend"));
    const found = await confirmPlaying(500, 100, () => (now += 200), noSleep);
    expect(found).toBeNull();
  });
});

describe("playQuery", () => {
  // The real confirmation window is 12s; tests inject an instant one.
  const noSleep = async () => {};
  let t = 0;
  const clock = () => (t += 1000);
  beforeEach(() => (t = 0));

  it("falls back to a search page when there is no API key", async () => {
    const out = await playQuery("lofi", "video", false);
    expect(out.searchOnly).toBe(true);
    expect(out.playing).toBeNull();
    expect(youtubeSearch).not.toHaveBeenCalled();
    expect(vi.mocked(openExternal).mock.calls[0][0]).toContain(
      "music.youtube.com/search?q=lofi",
    );
  });

  it("falls back to a search when the API returns nothing", async () => {
    vi.mocked(youtubeSearch).mockResolvedValueOnce([]);
    const out = await playQuery("asdfqwer", "video", true);
    expect(out.searchOnly).toBe(true);
    expect(vi.mocked(openExternal).mock.calls[0][0]).toContain("/search?q=");
  });

  it("opens the top hit and offers the rest as alternatives", async () => {
    vi.mocked(youtubeSearch).mockResolvedValueOnce([
      {
        url: "https://music.youtube.com/watch?v=1",
        title: "One",
        subtitle: "A",
        kind: "video",
      },
      {
        url: "https://music.youtube.com/watch?v=2",
        title: "Two",
        subtitle: "B",
        kind: "video",
      },
    ]);
    vi.mocked(mediaSessions).mockResolvedValue([session()]);
    const out = await playQuery("lofi", "video", true, () =>
      confirmPlaying(0, 0, clock, noSleep),
    );
    expect(out.searchOnly).toBe(false);
    expect(vi.mocked(openExternal).mock.calls[0][0]).toBe(
      "https://music.youtube.com/watch?v=1",
    );
    // A wrong top hit should be one tap from being fixed.
    expect(out.alternatives.map((a) => a.title)).toEqual(["Two"]);
    expect(out.alternatives[0].source).toBe("youtube");
  });

  it("reports playing as null when the browser never started", async () => {
    vi.mocked(youtubeSearch).mockResolvedValueOnce([
      {
        url: "https://music.youtube.com/watch?v=1",
        title: "One",
        subtitle: "A",
        kind: "video",
      },
    ]);
    vi.mocked(mediaSessions).mockResolvedValue([]);
    const out = await playQuery("lofi", "video", true, () =>
      confirmPlaying(0, 0, clock, noSleep),
    );
    expect(out.playing).toBeNull();
    expect(out.searchOnly).toBe(false);
  });
});
