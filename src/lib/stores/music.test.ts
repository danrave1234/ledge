import { describe, expect, it } from "vitest";
import type { MediaSession } from "../native";
import { mergeMediaSessions } from "./music";

function session(overrides: Partial<MediaSession> = {}): MediaSession {
  return {
    app_id: "chrome.exe",
    app_name: "Google Chrome",
    title: "Video",
    artist: "Channel",
    album: "",
    status: "playing",
    position_ms: 1_000,
    duration_ms: 10_000,
    can_play: true,
    can_pause: true,
    can_next: false,
    can_previous: false,
    can_seek: true,
    is_current: true,
    ...overrides,
  };
}

describe("mergeMediaSessions", () => {
  it("keeps artwork while applying a lightweight reconciliation update", () => {
    const previous = [session({ art: "data:image/png;base64,cover" })];
    const incoming = [session({ position_ms: 7_000, duration_ms: 20_000 })];

    expect(mergeMediaSessions(previous, incoming)).toEqual([
      session({
        art: "data:image/png;base64,cover",
        position_ms: 7_000,
        duration_ms: 20_000,
      }),
    ]);
  });

  it("accepts replacement artwork from an authoritative media event", () => {
    const previous = [session({ art: "old" })];
    const incoming = [session({ art: "new" })];

    expect(mergeMediaSessions(previous, incoming)[0]?.art).toBe("new");
  });
});
