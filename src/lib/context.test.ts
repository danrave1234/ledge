import { describe, it, expect } from "vitest";
import {
  planContext,
  estimateTokens,
  transcriptOf,
  summaryPrompt,
  DEFAULT_BUDGET,
} from "./context";
import type { Msg } from "./types";

const msg = (i: number, content: string): Msg => ({
  id: `m${i}`,
  role: i % 2 === 0 ? "user" : "assistant",
  content,
  ts: 1000 + i,
});

/** `n` messages of roughly `tokens` each. */
const convo = (n: number, tokens = 50): Msg[] =>
  Array.from({ length: n }, (_, i) => msg(i, "x".repeat(tokens * 4)));

describe("estimateTokens", () => {
  it("scales with length", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("x".repeat(400))).toBe(100);
  });
});

describe("planContext", () => {
  it("sends a short conversation whole", () => {
    const messages = convo(6);
    expect(planContext(messages)).toEqual({ keep: messages, compact: [] });
  });

  it("compacts the oldest turns once over budget", () => {
    const messages = convo(80, 100); // ~8000 tokens total
    const { keep, compact } = planContext(messages, 2000);
    expect(compact.length).toBeGreaterThan(0);
    expect(keep.length).toBeGreaterThan(0);
    // Nothing is lost or duplicated.
    expect([...compact, ...keep].map((m) => m.id)).toEqual(messages.map((m) => m.id));
  });

  it("keeps the newest messages, not the oldest", () => {
    const messages = convo(80, 100);
    const { keep } = planContext(messages, 2000);
    expect(keep.at(-1)!.id).toBe(messages.at(-1)!.id);
  });

  it("respects the budget it is given", () => {
    const { keep } = planContext(convo(80, 100), 2000);
    const used = keep.reduce((n, m) => n + estimateTokens(m.content), 0);
    // Within one message of the budget, plus the always-keep floor.
    expect(used).toBeLessThan(2000 + 100 * 7);
  });

  it("always keeps recent turns even when they alone blow the budget", () => {
    const { keep } = planContext(convo(10, 5000), 100);
    expect(keep.length).toBeGreaterThanOrEqual(6);
  });

  it("doesn't compact a handful of messages — the call isn't worth it", () => {
    const { compact } = planContext(convo(8, 500), 100);
    expect(compact.length === 0 || compact.length >= 4).toBe(true);
  });

  it("uses a sane default budget", () => {
    expect(DEFAULT_BUDGET).toBeGreaterThan(2000);
    expect(DEFAULT_BUDGET).toBeLessThanOrEqual(6000);
    expect(planContext(convo(20, 50)).compact).toHaveLength(0);
  });

  it("handles an empty conversation", () => {
    expect(planContext([])).toEqual({ keep: [], compact: [] });
  });
});

describe("transcriptOf", () => {
  it("labels speakers and drops empties", () => {
    const t = transcriptOf([msg(0, "hello"), msg(1, ""), msg(2, "again")]);
    expect(t).toContain("User: hello");
    expect(t).not.toMatch(/Assistant:\s*$/);
  });
});

describe("summaryPrompt", () => {
  it("asks for fresh notes when there are none", () => {
    const p = summaryPrompt(undefined, [msg(0, "hi")]);
    expect(p).toContain("Conversation so far");
    expect(p).not.toContain("Existing notes");
  });

  it("folds new turns into existing notes", () => {
    const p = summaryPrompt("Working on Ledge.", [msg(0, "new stuff")]);
    expect(p).toContain("Existing notes");
    expect(p).toContain("Working on Ledge.");
    expect(p).toContain("new stuff");
  });
});
