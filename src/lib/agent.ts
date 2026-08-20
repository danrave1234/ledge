import type { Provider, WireMsg, ToolSpec, ToolCall } from "./providers/types";
import type { Effort, MsgCard } from "./types";
import type { WebResult } from "./native";
import {
  runTool as defaultRunTool,
  type ToolRunContext,
  type ToolOutcome,
} from "./tools";

/** How many times the model may call tools before it must answer. Each round is
 *  a full round-trip, so this caps latency and cost as much as it guards against
 *  a runaway loop. */
export const MAX_TOOL_ROUNDS = 4;

export interface TurnRequest {
  provider: Provider;
  model: string;
  system: string;
  /** Starting transcript. Copied, not mutated — the caller keeps its own. */
  messages: WireMsg[];
  /** Tools on offer. Already gated on plugin + consent by the caller. */
  tools: ToolSpec[];
  effort?: Effort;
  safetyIdentifier?: string;
  signal: AbortSignal;
  /** Shared tool state: settings plus the sources accumulated this turn. */
  ctx: ToolRunContext;
  /** Provider hints for the pre-fetch (non-tool) path. */
  screen?: boolean;
  web?: boolean;
  image?: string;
  maxRounds?: number;
  /** Injectable so the loop can be tested without touching the network or the
      screen. Defaults to the real registry. */
  runTool?: (name: string, args: string, ctx: ToolRunContext) => Promise<ToolOutcome>;
}

export interface TurnEvents {
  /** Streamed text, in order, across every round. */
  onDelta(text: string): void;
  /** A tool is about to run — for the "searching…" affordance. */
  onToolStart?(name: string): void;
  /** All of a round's tools finished; what they produced so far. */
  onRoundEnd?(state: TurnState): void;
}

/** What the tools have produced so far this turn. */
interface TurnState {
  sources: WebResult[];
  /** Screenshots captured this turn, oldest first. */
  images: string[];
  /** Interactive cards attached by tools this turn, in the order they ran. */
  cards: MsgCard[];
  usedScreen: boolean;
  usedWeb: boolean;
}

export interface TurnResult extends TurnState {
  /** Everything the model streamed, across all rounds. */
  text: string;
  /** Tool rounds actually executed. 0 means it answered straight away. */
  rounds: number;
  /** True if the loop stopped because it hit the round cap. */
  cappedOut: boolean;
}

/** Run one turn to completion: stream, run any tools the model asks for, feed
 *  the results back, repeat until it answers.
 *
 *  Deliberately free of stores and UI — everything it touches arrives as an
 *  argument and everything it reports goes out through `events`. That is what
 *  makes the loop testable; it used to live inline in `send()`, where it wasn't.
 *
 *  Never throws for a tool failure (the runner turns those into text the model
 *  can read). A provider/network failure does throw, and is the caller's to
 *  render. */
export async function runTurn(req: TurnRequest, events: TurnEvents): Promise<TurnResult> {
  const runTool = req.runTool ?? defaultRunTool;
  const maxRounds = req.maxRounds ?? MAX_TOOL_ROUNDS;
  const wire: WireMsg[] = [...req.messages];

  const state: TurnState = {
    sources: [...req.ctx.sources],
    images: [],
    cards: [],
    usedScreen: false,
    usedWeb: false,
  };
  let text = "";
  let rounds = 0;
  let cappedOut = false;

  for (let round = 0; ; round++) {
    let calls: ToolCall[] = [];
    let roundText = "";
    // Withhold tools on the final round so a model that keeps reaching for them
    // still has to produce an answer.
    const offering = round < maxRounds ? req.tools : [];

    await req.provider.stream({
      model: req.model,
      system: req.system,
      messages: wire,
      screen: req.screen,
      web: req.web,
      image: req.image,
      effort: req.effort,
      safetyIdentifier: req.safetyIdentifier,
      tools: offering,
      signal: req.signal,
      onToolCalls: (c) => {
        calls = c;
      },
      onDelta: (d) => {
        roundText += d;
        text += d;
        events.onDelta(d);
      },
    });

    if (!calls.length || req.signal.aborted) break;
    if (!offering.length) {
      // It asked for tools on a round where none were offered. Nothing can be
      // run, and looping again would just repeat that — stop here with whatever
      // text there is.
      cappedOut = true;
      break;
    }
    rounds++;

    // Hand the calls back verbatim: the API requires the assistant turn that
    // requested them to immediately precede their results.
    wire.push({ role: "assistant", content: roundText, toolCalls: calls });

    const outcomes = await Promise.all(
      calls.map((call) => {
        events.onToolStart?.(call.name);
        return runTool(call.name, call.arguments, req.ctx);
      }),
    );

    const fresh: string[] = [];
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const out = outcomes[i];
      wire.push({ role: "tool", toolCallId: call.id, content: out.content });
      if (out.sources?.length) {
        req.ctx.sources.push(...out.sources);
        state.sources.push(...out.sources);
      }
      if (out.image) {
        fresh.push(out.image);
        state.images.push(out.image);
      }
      if (out.card) state.cards.push(out.card);
      state.usedScreen ||= !!out.usedScreen;
      state.usedWeb ||= !!out.usedWeb;
    }

    events.onRoundEnd?.({
      ...state,
      sources: [...state.sources],
      images: [...state.images],
      cards: [...state.cards],
    });

    // Vision: a tool result must be a plain string, so a captured image rides
    // along as a following user turn.
    for (const img of fresh) {
      wire.push({
        role: "user",
        content: "Screen capture taken for the request above.",
        image: img,
      });
    }
  }

  return { ...state, text, rounds, cappedOut };
}
