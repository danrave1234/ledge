import type { Memory } from "./types";

/* ==========================================================================
   Memory selection.

   Every enabled memory used to be pasted into every prompt. That costs tokens
   on every turn and, worse, dilutes the request: twenty unrelated facts around
   one question make the model weight trivia it shouldn't.

   This picks the memories that relate to what was actually asked. Selection is
   lexical (token overlap), not semantic — no embeddings, no extra model call,
   nothing to keep in sync. That is the right trade for a widget: it is instant
   and free, and the cost of a mediocre pick is one wasted line in the prompt.
   ========================================================================== */

/** Words too common to signal topic overlap. */
const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "you",
  "your",
  "with",
  "that",
  "this",
  "have",
  "has",
  "was",
  "were",
  "are",
  "not",
  "but",
  "can",
  "will",
  "would",
  "should",
  "could",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "how",
  "from",
  "into",
  "about",
  "there",
  "their",
  "then",
  "than",
  "them",
  "they",
  "its",
  "it's",
  "i'm",
  "i've",
  "get",
  "got",
  "make",
  "made",
  "use",
  "used",
  "using",
  "like",
  "just",
  "any",
  "all",
  "some",
  "one",
  "two",
  "please",
  "want",
  "need",
  "know",
  "help",
]);

/** Words → comparable tokens: lowercased, de-pluralized, stopwords dropped.
 *  Short tokens survive when they carry a symbol, so "c#", "c++" and "f#" are
 *  not filtered out with the "is"/"to" noise. */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9'+.#-]*/g) ?? [])
    .map((w) => w.replace(/[.'-]+$/, ""))
    .filter((w) => (w.length >= 3 || /[#+.]/.test(w)) && !STOPWORDS.has(w))
    .map((w) =>
      // Plain words only: stripping a trailing "s" from a symbol-bearing token
      // mangles identifiers like "node.js" into "node.j".
      /^[a-z]+$/.test(w) && w.length > 4 && w.endsWith("s") && !w.endsWith("ss")
        ? w.slice(0, -1)
        : w,
    );
}

/** Match key for a token.
 *
 *  Longer words collapse to a 5-character prefix so morphological variants land
 *  together — "allergies" and "allergic" both become "aller", "configuration"
 *  and "config" both become "confi". Exact matching missed those, which is the
 *  common case when someone asks about a fact phrased differently than it was
 *  saved. */
const KEY_PREFIX = 5;
function key(token: string): string {
  return token.length > KEY_PREFIX ? token.slice(0, KEY_PREFIX) : token;
}

function keysOf(text: string): Set<string> {
  return new Set(tokenize(text).map(key));
}

export interface SelectOptions {
  /** Most memories to include. */
  max?: number;
  /** Recent conversation text — a follow-up like "and the other one?" carries
      no keywords of its own, so the surrounding turn supplies them. */
  context?: string;
}

const DEFAULT_MAX = 8;
/** Weight of a hit in the question vs. one in the surrounding conversation. */
const QUERY_WEIGHT = 2;
const CONTEXT_WEIGHT = 1;

function score(memory: string, query: Set<string>, context: Set<string>): number {
  let total = 0;
  for (const k of keysOf(memory)) {
    if (query.has(k)) total += QUERY_WEIGHT;
    else if (context.has(k)) total += CONTEXT_WEIGHT;
  }
  return total;
}

/** Choose the memories worth sending with this message.
 *
 *  Returns them in their original order: the prompt reads as a stable list
 *  rather than reshuffling every turn. */
export function selectMemories(
  memories: Memory[],
  query: string,
  opts: SelectOptions = {},
): Memory[] {
  const max = opts.max ?? DEFAULT_MAX;
  const enabled = memories.filter((m) => m.enabled && m.text.trim());

  // Below the cap there is nothing to gain by choosing — send them all.
  if (enabled.length <= max) return enabled;

  const queryTokens = keysOf(query);
  const contextTokens = keysOf(opts.context ?? "");

  const ranked = enabled
    .map((memory, index) => ({
      memory,
      index,
      score: score(memory.text, queryTokens, contextTokens),
    }))
    .sort((a, b) => b.score - a.score || b.index - a.index); // newer wins ties

  const chosen = ranked.filter((r) => r.score > 0).slice(0, max);

  // Nothing matched (or too few did): top up with the most recent, so the model
  // still has some background instead of none.
  if (chosen.length < max) {
    const taken = new Set(chosen.map((c) => c.index));
    for (let i = enabled.length - 1; i >= 0 && chosen.length < max; i--) {
      if (!taken.has(i)) chosen.push({ memory: enabled[i], index: i, score: 0 });
    }
  }

  return chosen.sort((a, b) => a.index - b.index).map((c) => c.memory);
}
