import { afterEach, describe, expect, it, vi } from "vitest";
import { ProgressiveStream } from "./progressive-stream";

afterEach(() => vi.useRealTimers());

describe("ProgressiveStream", () => {
  it("reveals a large provider batch progressively and preserves its text", async () => {
    vi.useFakeTimers();
    const parts: string[] = [];
    const stream = new ProgressiveStream((text) => parts.push(text));
    const response =
      "A streamed response that should not appear as one instantaneous block. 🎉";

    stream.append(response);
    expect(parts.length).toBe(1);
    expect(parts.join("").length).toBeLessThan(response.length);

    const finished = stream.finish();
    await vi.runAllTimersAsync();
    await finished;

    expect(parts.length).toBeGreaterThan(2);
    expect(parts.join("")).toBe(response);
  });

  it("finishes even a large batch within the bounded display window", async () => {
    vi.useFakeTimers();
    const parts: string[] = [];
    const stream = new ProgressiveStream((text) => parts.push(text));
    const response = "A".repeat(20_000);
    let settled = false;

    stream.append(response);
    const finished = stream.finish().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(550);
    await finished;

    expect(settled).toBe(true);
    expect(parts.join("")).toBe(response);
  });

  it("discards unrevealed text when cancelled", async () => {
    vi.useFakeTimers();
    const parts: string[] = [];
    const stream = new ProgressiveStream((text) => parts.push(text));

    stream.append("This batch should stop after its first visible piece.");
    stream.cancel();
    await vi.runAllTimersAsync();

    expect(parts.length).toBe(1);
    expect(parts.join("")).not.toContain("visible piece");
  });
});
