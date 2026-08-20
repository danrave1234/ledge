import type { ModelInfo } from "./providers";

/* ==========================================================================
   Model list curation.

   `/v1/models` returns everything the account can call — dozens of entries,
   most of which are dated snapshots of the same model (`gpt-4o-2024-08-06`),
   pinned point releases (`gpt-4-0613`), or families nobody picks by hand any
   more. Sorted alphabetically that puts `gpt-3.5-…` above the models actually
   in use, and buries sol/terra/luna.

   Nothing is discarded: the noise moves to `more`, which the picker keeps
   collapsed behind a "Show all" row.
   ========================================================================== */

/** `gpt-4o-2024-08-06`, `gpt-4-0613`, `gpt-4.1-2025-04-14` — a pinned snapshot
    of a model that also exists under a clean alias. */
const DATED_SNAPSHOT = /-(?:\d{4}-\d{2}-\d{2}|\d{3,4})$/;
/** Preview/experimental channels of a model with a stable alias. */
const PREVIEW = /(?:-preview|-latest|-exp|-alpha|-beta)(?:-|$)/;
/** Families that are no longer a reasonable pick for a chat widget. */
const LEGACY = /^(?:gpt-3|davinci|babbage|curie|ada|gpt-4-32k|gpt-4-vision)/;

/** Newest and most useful first; anything unmatched sorts after these. */
const FAMILY_ORDER: RegExp[] = [
  /^gpt-5\.6-sol/,
  /^gpt-5\.6-terra/,
  /^gpt-5\.6-luna/,
  /^gpt-5/,
  /^gpt-4\.1/,
  /^gpt-4o/,
  /^gpt-4/,
  /^o[0-9]/,
  /^chatgpt/,
];

function rank(id: string): number {
  const i = FAMILY_ORDER.findIndex((re) => re.test(id));
  return i === -1 ? FAMILY_ORDER.length : i;
}

/** A base model is one you'd deliberately choose: a clean alias, current family. */
export function isBaseModel(id: string): boolean {
  return !DATED_SNAPSHOT.test(id) && !PREVIEW.test(id) && !LEGACY.test(id);
}

/** "gpt-5.6-sol" → "GPT-5.6 Sol", "gpt-4o" → "GPT-4o", "o3-mini" → "o3-mini". */
export function labelFor(id: string): string {
  const named = id.match(/^(gpt-[\d.]+)-(sol|terra|luna)$/i);
  if (named) {
    const [, family, moon] = named;
    return `${family.toUpperCase()} ${moon[0].toUpperCase()}${moon.slice(1)}`;
  }
  return id.startsWith("gpt-") ? "GPT-" + id.slice(4) : id;
}

export interface CuratedModels {
  /** Shown immediately. */
  primary: ModelInfo[];
  /** Real, selectable, but collapsed behind "Show all". */
  more: ModelInfo[];
}

/** Split a raw model-ID list into the handful worth showing and the rest. */
export function curateModels(ids: string[]): CuratedModels {
  // Normalize before de-duplicating AND keep the normalized form: the ID is
  // sent verbatim to the provider, so a padded entry must not survive.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }

  const byRankThenName = (a: string, b: string) =>
    rank(a) - rank(b) || a.localeCompare(b);

  const toInfo = (id: string): ModelInfo => ({ id, label: labelFor(id) });

  return {
    primary: unique.filter(isBaseModel).sort(byRankThenName).map(toInfo),
    more: unique
      .filter((id) => !isBaseModel(id))
      .sort(byRankThenName)
      .map(toInfo),
  };
}
