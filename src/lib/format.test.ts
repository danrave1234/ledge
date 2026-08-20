import { describe, it, expect, vi, afterEach } from "vitest";
import { relativeTime, truncate } from "./format";

afterEach(() => vi.useRealTimers());

describe("relativeTime", () => {
  const now = new Date("2026-08-13T12:00:00Z").getTime();
  const at = (msAgo: number) => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    return relativeTime(now - msAgo);
  };

  it("labels the last minute as just now", () => expect(at(30_000)).toBe("just now"));
  it("uses minutes under an hour", () => expect(at(5 * 60_000)).toBe("5m ago"));
  it("uses hours under a day", () => expect(at(3 * 3_600_000)).toBe("3h ago"));
  it("uses days beyond that", () => expect(at(50 * 3_600_000)).toBe("2d ago"));
});

describe("truncate", () => {
  it("leaves short text alone", () => expect(truncate("hello", 20)).toBe("hello"));

  it("cuts on a word boundary", () => {
    expect(truncate("the quick brown fox jumps over", 20)).toBe("the quick brown fox…");
  });

  it("hard-cuts a single long word", () => {
    expect(truncate("x".repeat(30), 10)).toBe("x".repeat(10) + "…");
  });

  it("trims surrounding whitespace", () => expect(truncate("  hi  ", 10)).toBe("hi"));
});
