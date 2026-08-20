import type { Msg } from "./types";

/* ==========================================================================
   Conversation context budgeting.

   The whole conversation used to be sent on every turn. That grows without
   bound: cost rises with each message, and a long session eventually exceeds
   the model's context window and starts failing outright.

   Instead the recent turns are sent verbatim, and everything older is replaced
   by a running summary — the same compaction idea coding agents use. The
   planning here is pure so it can be tested without a model; the summarising
   call lives in the controller.
   ========================================================================== */

/** Rough token estimate. ~4 characters per token is close enough for budgeting
    and costs nothing — an exact tokenizer would be a dependency and a per-model
    variable, to decide the same thing. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function messageTokens(m: Pick<Msg, "content">): number {
  return estimateTokens(m.content) + 4; // + role/framing overhead
}

export interface ContextPlan {
  /** Sent verbatim, oldest first. */
  keep: Msg[];
  /** Folded into the running summary and dropped from the transcript. */
  compact: Msg[];
}

/** Tokens of transcript to send before compaction kicks in. */
export const DEFAULT_BUDGET = 8000;
/** Always keep at least this many recent messages, budget or not — a couple of
    huge messages must never leave the model with no immediate context. */
const MIN_KEEP = 6;
/** Below this, compacting costs a model call to save almost nothing. */
const MIN_COMPACT = 4;

/** Split a transcript into what to send and what to summarise.
 *
 *  Walks from the newest backwards, keeping messages until the budget runs
 *  out. Never splits off a compaction so small it isn't worth the call. */
export function planContext(messages: Msg[], budget = DEFAULT_BUDGET): ContextPlan {
  let used = 0;
  let cut = 0; // index of the first kept message

  for (let i = messages.length - 1; i >= 0; i--) {
    used += messageTokens(messages[i]);
    const kept = messages.length - i;
    if (used > budget && kept > MIN_KEEP) {
      cut = i + 1;
      break;
    }
  }

  if (cut < MIN_COMPACT) return { keep: messages, compact: [] };
  return { keep: messages.slice(cut), compact: messages.slice(0, cut) };
}

/** Transcript for the summariser, oldest first. */
export function transcriptOf(messages: Msg[]): string {
  return messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.trim()}`)
    .filter((line) => line.length > 6)
    .join("\n\n");
}

/** Instruction used to fold older turns into the running summary. */
export const SUMMARY_SYSTEM = `You compress a conversation so it can continue without the original transcript. Capture: what the user is working on, decisions and conclusions reached, facts they stated about themselves or their setup, and anything still open or promised. Drop pleasantries and anything already resolved and irrelevant. Write terse notes, not prose, under 200 words. No preamble.`;

/** Prompt for a fresh summary, or for merging new turns into an existing one. */
export function summaryPrompt(previous: string | undefined, older: Msg[]): string {
  const transcript = transcriptOf(older);
  return previous?.trim()
    ? `Existing notes on this conversation:\n${previous.trim()}\n\nNewer turns to fold in:\n${transcript}\n\nUpdated notes:`
    : `Conversation so far:\n${transcript}\n\nNotes:`;
}
