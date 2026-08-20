import { describe, it, expect, vi } from "vitest";
import { runTurn, MAX_TOOL_ROUNDS } from "./agent";
import type { Provider, StreamOpts, ToolCall, ToolSpec } from "./providers/types";
import type { ToolOutcome, ToolRunContext } from "./tools";
import { DEFAULT_SETTINGS } from "./stores/settings";

const SPEC: ToolSpec = {
  name: "web_search",
  description: "search",
  parameters: { type: "object", properties: {} },
};

/** One scripted round: what the model streams, and what it asks for. */
interface Round {
  text?: string;
  calls?: ToolCall[];
}

/** A provider that replays a script and records what it was sent. Lets the loop
    be driven deterministically with no network. */
function scriptedProvider(rounds: Round[]) {
  const seen: StreamOpts[] = [];
  let i = 0;
  const provider: Provider = {
    id: "fake",
    label: "Fake",
    defaultModel: "m",
    supportsTools: true,
    async listModels() {
      return [];
    },
    async isAuthed() {
      return true;
    },
    async stream(opts: StreamOpts) {
      seen.push({ ...opts, messages: structuredClone(opts.messages) });
      const round = rounds[i++] ?? {};
      if (round.text) opts.onDelta(round.text);
      if (round.calls?.length) opts.onToolCalls?.(round.calls);
    },
  };
  return { provider, seen };
}

function call(name: string, args = "{}", id = "c1"): ToolCall {
  return { id, name, arguments: args };
}

function baseReq(provider: Provider, extra: Partial<Parameters<typeof runTurn>[0]> = {}) {
  const ctx: ToolRunContext = {
    settings: DEFAULT_SETTINGS,
    consent: { web: true, screen: true, music: true },
    sources: [],
  };
  return {
    provider,
    model: "m",
    system: "sys",
    messages: [{ role: "user" as const, content: "hi" }],
    tools: [SPEC],
    signal: new AbortController().signal,
    ctx,
    ...extra,
  };
}

const noop = { onDelta: () => {} };

describe("runTurn", () => {
  it("answers without tools when the model doesn't ask", async () => {
    const { provider, seen } = scriptedProvider([{ text: "just an answer" }]);
    const r = await runTurn(baseReq(provider), noop);
    expect(r.text).toBe("just an answer");
    expect(r.rounds).toBe(0);
    expect(seen).toHaveLength(1);
  });

  it("runs a tool and streams again with the result", async () => {
    const { provider, seen } = scriptedProvider([
      { calls: [call("web_search", '{"query":"x"}')] },
      { text: "grounded answer" },
    ]);
    const runTool = vi.fn(async (): Promise<ToolOutcome> => ({
      content: "RESULT",
      usedWeb: true,
    }));

    const r = await runTurn(baseReq(provider, { runTool }), noop);

    expect(runTool).toHaveBeenCalledOnce();
    expect(r.rounds).toBe(1);
    expect(r.text).toBe("grounded answer");
    expect(r.usedWeb).toBe(true);

    // The second request must carry the assistant tool_call turn AND its result,
    // in that order — the API rejects a tool message without its request.
    const second = seen[1].messages;
    const asst = second.find((m) => m.role === "assistant");
    const tool = second.find((m) => m.role === "tool");
    expect(asst?.toolCalls?.[0].name).toBe("web_search");
    expect(tool?.content).toBe("RESULT");
    expect(second.indexOf(asst!)).toBeLessThan(second.indexOf(tool!));
  });

  it("concatenates text streamed across rounds", async () => {
    const { provider } = scriptedProvider([
      { text: "Looking… ", calls: [call("web_search")] },
      { text: "done." },
    ]);
    const r = await runTurn(
      baseReq(provider, { runTool: async () => ({ content: "R" }) }),
      noop,
    );
    expect(r.text).toBe("Looking… done.");
  });

  it("stops offering tools on the final round so it must answer", async () => {
    // A model that asks for a tool every single time would otherwise never
    // produce an answer.
    const rounds: Round[] = Array.from({ length: MAX_TOOL_ROUNDS + 2 }, () => ({
      calls: [call("web_search")],
    }));
    const { provider, seen } = scriptedProvider(rounds);

    const r = await runTurn(
      baseReq(provider, { runTool: async () => ({ content: "R" }) }),
      noop,
    );

    expect(r.rounds).toBe(MAX_TOOL_ROUNDS);
    expect(r.cappedOut).toBe(true);
    // Every round up to the cap offers tools; the last one offers none.
    expect(seen).toHaveLength(MAX_TOOL_ROUNDS + 1);
    expect(seen.at(-1)!.tools).toEqual([]);
    expect(seen[0].tools).toEqual([SPEC]);
  });

  it("respects a lower round cap", async () => {
    const { provider } = scriptedProvider([
      { calls: [call("web_search")] },
      { calls: [call("web_search")] },
      { text: "never reached" },
    ]);
    const r = await runTurn(
      baseReq(provider, { maxRounds: 1, runTool: async () => ({ content: "R" }) }),
      noop,
    );
    expect(r.rounds).toBe(1);
  });

  it("accumulates sources across rounds for stable citation numbers", async () => {
    const { provider } = scriptedProvider([
      { calls: [call("web_search", "{}", "a")] },
      { calls: [call("web_search", "{}", "b")] },
      { text: "answer" },
    ]);
    let n = 0;
    const req = baseReq(provider, {
      runTool: async () => ({
        content: "R",
        sources: [{ title: `S${++n}`, url: `https://s${n}.test`, snippet: "" }],
      }),
    });
    const r = await runTurn(req, noop);
    expect(r.sources.map((s) => s.title)).toEqual(["S1", "S2"]);
    // The shared context is what the tool runner numbers against.
    expect(req.ctx.sources).toHaveLength(2);
  });

  it("attaches a captured screenshot as a following user turn", async () => {
    // Tool results must be plain strings, so an image can't ride inside one.
    const { provider, seen } = scriptedProvider([
      { calls: [call("read_screen")] },
      { text: "I can see it" },
    ]);
    const r = await runTurn(
      baseReq(provider, {
        runTool: async () => ({ content: "TEXT", image: "data:image/png;base64,A" }),
      }),
      noop,
    );
    const imageTurn = seen[1].messages.find((m) => m.image);
    expect(imageTurn?.role).toBe("user");
    expect(imageTurn?.image).toBe("data:image/png;base64,A");
    expect(r.images).toEqual(["data:image/png;base64,A"]);
  });

  it("runs every call in a parallel batch, in order", async () => {
    const { provider } = scriptedProvider([
      { calls: [call("web_search", "{}", "a"), call("read_screen", "{}", "b")] },
      { text: "answer" },
    ]);
    const started: string[] = [];
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const turn = runTurn(
      baseReq(provider, {
        runTool: async (name) => {
          started.push(name);
          if (name === "web_search") await firstBlocked;
          return { content: "R" };
        },
      }),
      noop,
    );
    await vi.waitFor(() => expect(started).toEqual(["web_search", "read_screen"]));
    releaseFirst();
    await turn;
  });

  it("reports each tool starting so the UI can say what it's doing", async () => {
    const { provider } = scriptedProvider([
      { calls: [call("web_search")] },
      { text: "answer" },
    ]);
    const started: string[] = [];
    await runTurn(baseReq(provider, { runTool: async () => ({ content: "R" }) }), {
      onDelta: () => {},
      onToolStart: (n) => started.push(n),
    });
    expect(started).toEqual(["web_search"]);
  });

  it("stops after the current stream when aborted mid-turn", async () => {
    const ac = new AbortController();
    const { provider, seen } = scriptedProvider([
      { calls: [call("web_search")] },
      { text: "should not run" },
    ]);
    ac.abort();
    const r = await runTurn(
      baseReq(provider, {
        signal: ac.signal,
        runTool: async () => ({ content: "R" }),
      }),
      noop,
    );
    expect(seen).toHaveLength(1);
    expect(r.rounds).toBe(0);
  });

  it("keeps going when a tool fails, because failures come back as text", async () => {
    const { provider } = scriptedProvider([
      { calls: [call("web_search")] },
      { text: "answered anyway" },
    ]);
    const r = await runTurn(
      baseReq(provider, { runTool: async () => ({ content: "Error: it broke" }) }),
      noop,
    );
    expect(r.text).toBe("answered anyway");
    expect(r.rounds).toBe(1);
  });

  it("lets a provider error propagate for the caller to render", async () => {
    const provider: Provider = {
      id: "boom",
      label: "Boom",
      defaultModel: "m",
      supportsTools: true,
      listModels: async () => [],
      isAuthed: async () => true,
      stream: async () => {
        throw new Error("network down");
      },
    };
    await expect(runTurn(baseReq(provider), noop)).rejects.toThrow("network down");
  });

  it("does not mutate the caller's transcript", async () => {
    const { provider } = scriptedProvider([
      { calls: [call("web_search")] },
      { text: "answer" },
    ]);
    const messages = [{ role: "user" as const, content: "hi" }];
    await runTurn(
      baseReq(provider, { messages, runTool: async () => ({ content: "R" }) }),
      noop,
    );
    expect(messages).toEqual([{ role: "user", content: "hi" }]);
  });
});
