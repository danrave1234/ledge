import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storeWrite = vi.fn();

vi.mock("../native", () => ({
  isTauri: () => true,
  storeRead: vi.fn(async () => null),
  storeWrite: (...args: unknown[]) => storeWrite(...args),
}));

const { flushWrites, queueWrite } = await import("./persistence");

beforeEach(() => {
  vi.useFakeTimers();
  storeWrite.mockReset();
});

afterEach(async () => {
  await flushWrites().catch(() => {});
  vi.useRealTimers();
});

describe("persistence queue", () => {
  it("serializes a newer value behind an in-flight write", async () => {
    const release: Array<() => void> = [];
    storeWrite.mockImplementation(
      () => new Promise<void>((resolve) => release.push(resolve)),
    );

    queueWrite("perch.test", "old");
    await vi.advanceTimersByTimeAsync(250);
    expect(storeWrite).toHaveBeenCalledWith("perch.test", "old");

    queueWrite("perch.test", "new");
    const flushed = flushWrites();
    expect(storeWrite).toHaveBeenCalledTimes(1);

    release.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(storeWrite).toHaveBeenLastCalledWith("perch.test", "new");
    release.shift()?.();
    await flushed;
  });
});
