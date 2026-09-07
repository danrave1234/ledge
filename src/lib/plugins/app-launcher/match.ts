import type { LaunchableApp } from "../../native";

/* ==========================================================================
   Pure matching of a spoken app name against the installed index.

   Kept free of native imports so the ranking can be unit-tested with a fixed
   list. The tool decides what to do with the ranking (one confident match →
   a single approval card; several → let the user pick).
   ========================================================================== */

/** How many alternatives to surface when the request is ambiguous. */
export const MAX_ALTERNATIVES = 5;

/** A top score at or above this, with a clear gap, is treated as the intended
 *  app; anything weaker asks the user to choose. */
const CONFIDENT_SCORE = 80;
/** The runner-up must trail by at least this much for the top hit to be
 *  auto-selected — "Visual Studio" vs "Visual Studio Code" should not guess. */
const CONFIDENT_GAP = 10;

/** Words users add that never appear in a shortcut's name. */
const FILLER = /\b(?:app|application|program|please|for me|now)\b/gi;
/** A verb the model may pass through verbatim ("open spotify"). */
const LEADING_VERB = /^\s*(?:(?:open|launch|start|run)\s+)?(?:(?:up|the|my)\s+)*/i;

export function normalizeQuery(text: string): string {
  return text
    .replace(LEADING_VERB, "")
    .replace(FILLER, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#.]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#.]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** 0 = no match. Higher is better; ties broken by shorter name. */
export function scoreApp(query: string, name: string): number {
  const q = normalizeQuery(query);
  const n = normalizeName(name);
  if (!q || !n) return 0;
  if (n === q) return 100;
  const words = n.split(" ");
  if (n.startsWith(q)) return 85;
  if (words.some((w) => w.startsWith(q))) return 75;
  const qWords = q.split(" ");
  if (qWords.every((qw) => words.some((w) => w.startsWith(qw)))) return 70;
  if (n.includes(q)) return 60;
  if (abbreviates(qWords, words)) return 55;
  return 0;
}

/** Each query word must either start a name word or be the initials of a run of
 *  consecutive name words, in order: "vs code" → Visual Studio Code, "gc" →
 *  Google Chrome. Single letters never count as initials on their own. */
function abbreviates(qWords: string[], words: string[]): boolean {
  let i = 0;
  for (const qw of qWords) {
    if (i >= words.length) return false;
    if (words[i].startsWith(qw)) {
      i += 1;
      continue;
    }
    let k = 0;
    while (k < qw.length && i + k < words.length && words[i + k].startsWith(qw[k]))
      k += 1;
    if (k !== qw.length || k < 2) return false;
    i += k;
  }
  return true;
}

export interface RankedApp {
  app: LaunchableApp;
  score: number;
}

export function rankApps(query: string, apps: LaunchableApp[]): RankedApp[] {
  return apps
    .map((app) => ({ app, score: scoreApp(query, app.name) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.app.name.length - b.app.name.length)
    .slice(0, MAX_ALTERNATIVES);
}

export interface AppMatch {
  /** The app to show for approval. */
  app: LaunchableApp;
  /** Other plausible apps, offered on the card when the pick was not certain. */
  alternatives: LaunchableApp[];
  confident: boolean;
}

export function matchApp(query: string, apps: LaunchableApp[]): AppMatch | null {
  const ranked = rankApps(query, apps);
  if (!ranked.length) return null;
  const [top, next] = ranked;
  const confident =
    top.score >= CONFIDENT_SCORE && (!next || top.score - next.score >= CONFIDENT_GAP);
  return {
    app: top.app,
    alternatives: confident ? [] : ranked.slice(1).map((r) => r.app),
    confident,
  };
}
