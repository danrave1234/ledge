import type { FoundPath } from "../../native";

/* ==========================================================================
   Pure matching of a query against found paths.

   Kept free of native imports so the ranking can be unit-tested with a fixed
   list. The tool decides what to do with the ranking.
   ========================================================================== */

/** How many alternatives to surface when the request is ambiguous. */
export const MAX_ALTERNATIVES = 5;

/** A top score at or above this, with a clear gap, is treated as the intended
 *  path; anything weaker asks the user to choose. */
const CONFIDENT_SCORE = 80;
/** The runner-up must trail by at least this much for the top hit to be
 *  auto-selected. */
const CONFIDENT_GAP = 10;

/** Words users add that never appear in a folder or file name. */
const FILLER = /\b(?:folder|file|directory|please|for me|now|the|my)\b/gi;
/** Platform/store hints that users prepend (e.g. "steam dota") — strip when
 * other tokens remain so the core name still matches. */
const PLATFORM_HINTS = /\b(?:steam|epic|gog|xbox|origin|battle\.net)\b/gi;
/** A verb the model may pass through verbatim ("find downloads"). */
const LEADING_VERB =
  /^\s*(?:(?:find|locate|search|show|where is|where's|open)\s+)?(?:(?:up|the|my)\s+)*/i;

export function normalizeQuery(text: string): string {
  let q = text
    .replace(LEADING_VERB, "")
    .replace(FILLER, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#.]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

  // Strip platform hints only when other meaningful tokens remain.
  // "steam" alone → keep it; "steam dota" → "dota"
  const withHintsRemoved = q.replace(PLATFORM_HINTS, " ").trim().replace(/\s+/g, " ");
  if (withHintsRemoved && withHintsRemoved !== q) {
    q = withHintsRemoved;
  }

  return q;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#.]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** 0 = no match. Higher is better; ties broken by shorter name. */
export function scorePath(query: string, name: string): number {
  const q = normalizeQuery(query);
  const n = normalizeName(name);
  if (!q || !n) return 0;
  if (n === q) return 100;
  if (n.startsWith(q)) return 85;
  const words = n.split(" ");
  if (words.some((w) => w.startsWith(q))) return 75;
  const qWords = q.split(" ");
  if (qWords.every((qw) => words.some((w) => w.startsWith(qw)))) return 70;
  if (n.includes(q)) return 60;
  return 0;
}

export interface RankedPath {
  path: FoundPath;
  score: number;
}

export function rankPaths(query: string, paths: FoundPath[]): RankedPath[] {
  return paths
    .map((p) => ({ path: p, score: scorePath(query, p.name) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.path.name.length - b.path.name.length)
    .slice(0, MAX_ALTERNATIVES);
}

export interface PathMatch {
  /** The path to show for approval. */
  path: FoundPath;
  /** Other plausible paths, offered on the card when the pick was not certain. */
  alternatives: FoundPath[];
  confident: boolean;
}

export function matchPath(query: string, paths: FoundPath[]): PathMatch | null {
  const ranked = rankPaths(query, paths);
  if (!ranked.length) return null;
  const [top, next] = ranked;
  const confident =
    top.score >= CONFIDENT_SCORE && (!next || top.score - next.score >= CONFIDENT_GAP);
  return {
    path: top.path,
    alternatives: confident ? [] : ranked.slice(1).map((r) => r.path),
    confident,
  };
}
