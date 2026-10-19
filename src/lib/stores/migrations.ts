import type { Settings } from "../types";
import { EFFORTS } from "../types";
import { providers } from "../providers";
import { DEFAULT_SETTINGS, CURRENT_SCHEMA } from "./settings";

/* ==========================================================================
   Settings migrations.

   Ledge auto-updates, so a build always has to be able to read a store written
   by an OLDER build. Rules:
     - Never change the meaning of an existing field in place; add a migration.
     - Every migration is idempotent and only moves the store UP one version.
     - Bump CURRENT_SCHEMA in settings.ts and append a step here in the same
       commit. A store from the future (newer app, then a downgrade) is left
       alone apart from the shape guards below.
   ========================================================================== */

type Draft = Record<string, unknown>;

interface Migration {
  /** Schema version this step produces. */
  to: number;
  describe: string;
  /** `s` is the draft (defaults merged with the stored value) — mutate this.
   *  `stored` is the RAW stored object: use it for any "did the user actually
   *  have this field?" test, because the defaults merge gives every new field a
   *  value and makes a missing field look present. */
  apply(s: Draft, stored: Draft): void;
}

const MIGRATIONS: Migration[] = [
  {
    to: 2,
    describe: "personalization fields (about/style/memories) added",
    apply(s) {
      if (typeof s.about !== "string") s.about = "";
      if (typeof s.style !== "string") s.style = "";
      if (!Array.isArray(s.memories)) s.memories = [];
    },
  },
  {
    to: 3,
    describe: "idle handle default moved to the thin bar",
    apply(s) {
      if (s.handle === "spark" || s.handle === "pill") s.handle = "bar";
    },
  },
  {
    to: 4,
    describe: "plugins moved to install-to-enable; only explicit opt-outs stored",
    apply(s) {
      if (!Array.isArray(s.installedPlugins)) s.installedPlugins = [];
      // `plugins` is now an opt-OUT map: a missing entry means enabled, so the
      // old all-true entries were a second source of truth. Keep only `false`.
      if (s.plugins && typeof s.plugins === "object") {
        s.plugins = Object.fromEntries(
          Object.entries(s.plugins as Record<string, unknown>).filter(
            ([, v]) => v === false,
          ),
        );
      } else {
        s.plugins = {};
      }
    },
  },
  {
    to: 5,
    describe: "Custom CSS setting removed",
    apply(s) {
      // Retired: arbitrary user CSS could restyle (or hide) security-relevant UI
      // and broke silently whenever a token or class name changed. The accent
      // picker covers the reason people actually used it.
      delete s.customCss;
    },
  },
  {
    to: 6,
    describe: "remember the chosen model per provider; persist the fetched list",
    apply(s, stored) {
      // Seed the per-provider memory from the selection in effect, so an
      // existing user's current model survives the upgrade. Checked against
      // `stored`: the draft always has the `{}` default merged in.
      const had = stored.modelByProvider;
      if (!had || typeof had !== "object") {
        s.modelByProvider =
          typeof s.providerId === "string" && typeof s.model === "string" && s.model
            ? { [s.providerId]: s.model }
            : {};
      }
      if (!Array.isArray(stored.fetchedModels)) s.fetchedModels = [];
    },
  },
  {
    to: 7,
    describe: "game mode on by default",
    apply(s) {
      // One-time adoption of the new default. `gameMode` is a plain boolean
      // with no "never set" state, so an existing store can't be told apart
      // from a deliberate opt-out — this enables it once, and turning it back
      // off sticks (later runs are already at schema 7).
      s.gameMode = true;
    },
  },
  {
    to: 8,
    describe: "music plugin consent flags added",
    apply(s) {
      // Both default to false and stay false: consent to let Ledge drive a
      // media player has to be given deliberately, never inherited from an
      // upgrade. The plugin itself is install-to-enable, so an existing user
      // sees nothing until they install it.
      if (typeof s.music !== "boolean") s.music = false;
      if (typeof s.musicConfirmed !== "boolean") s.musicConfirmed = false;
    },
  },
  {
    to: 9,
    describe: "per-turn consent removed from persistent settings",
    apply(s) {
      delete s.webSearch;
      delete s.screenContext;
      delete s.music;
    },
  },
  {
    to: 10,
    describe: "privacy-preserving API safety identifier added",
    apply(s) {
      if (typeof s.safetyId !== "string" || !s.safetyId) {
        s.safetyId = DEFAULT_SETTINGS.safetyId;
      }
    },
  },
  {
    to: 11,
    describe: "configurable hover-open delay added",
    apply(s) {
      s.hoverOpenDelay = DEFAULT_SETTINGS.hoverOpenDelay;
    },
  },
];

/** Shape guards applied after every migration: a field the UI renders as an
    enum must never hold a value the UI does not know, or the control silently
    breaks (blank segmented button, dead dropdown). */
function coerce(s: Draft): void {
  if (!EFFORTS.includes(s.effort as Settings["effort"])) {
    s.effort = DEFAULT_SETTINGS.effort;
  }
  if (!["top", "left", "right"].includes(s.placement as string)) {
    s.placement = DEFAULT_SETTINGS.placement;
  }
  if (!["bar", "spark", "pulse"].includes(s.handle as string)) {
    s.handle = DEFAULT_SETTINGS.handle;
  }
  if (!["system", "light", "dark"].includes(s.theme as string)) {
    s.theme = DEFAULT_SETTINGS.theme;
  }
  if (!Array.isArray(s.installedPlugins)) s.installedPlugins = [];
  if (!Array.isArray(s.customModels)) s.customModels = [];
  if (!Array.isArray(s.memories)) s.memories = [];
  else {
    s.memories = (s.memories as unknown[]).filter(
      (m): m is Settings["memories"][number] =>
        !!m && typeof m === "object" && typeof (m as Draft).text === "string",
    );
  }
  if (!s.plugins || typeof s.plugins !== "object") s.plugins = {};
  if (!s.modelByProvider || typeof s.modelByProvider !== "object") {
    s.modelByProvider = {};
  }
  if (!Array.isArray(s.fetchedModels)) s.fetchedModels = [];
  if (typeof s.model !== "string" || !s.model) s.model = DEFAULT_SETTINGS.model;
  if (typeof s.providerId !== "string" || !s.providerId) {
    s.providerId = DEFAULT_SETTINGS.providerId;
  }
  if (typeof s.safetyId !== "string" || !s.safetyId) {
    s.safetyId = DEFAULT_SETTINGS.safetyId;
  }
  if (
    typeof s.hoverOpenDelay !== "number" ||
    !Number.isFinite(s.hoverOpenDelay) ||
    s.hoverOpenDelay < 0 ||
    s.hoverOpenDelay > 3
  ) {
    s.hoverOpenDelay = DEFAULT_SETTINGS.hoverOpenDelay;
  }
}

/** Bring a parsed settings object from any older build up to the current shape.
    Returns settings that are always safe to `settings.set()`. */
export function migrateSettings(parsed: unknown): Settings {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...DEFAULT_SETTINGS };
  }
  // Read the version from the STORED object, not from the merged draft: the
  // defaults carry the current version, so merging first would make every
  // pre-versioning store look current and skip its migrations entirely.
  const stored = parsed as Draft;
  const from = typeof stored.schemaVersion === "number" ? stored.schemaVersion : 1;
  const draft: Draft = { ...DEFAULT_SETTINGS, ...stored };

  for (const m of MIGRATIONS) {
    if (from < m.to) m.apply(draft, stored);
  }

  // Drop a selection pointing at a provider this build doesn't register — the
  // dev-only mock in the packaged app, or any provider that was removed.
  // Keyed off the live registry rather than a hardcoded "mock" check, so the
  // mock still works in the browser preview, where it IS registered.
  if (!providers.some((p) => p.id === draft.providerId)) {
    draft.providerId = DEFAULT_SETTINGS.providerId;
    draft.model =
      (draft.modelByProvider as Record<string, string> | undefined)?.[
        DEFAULT_SETTINGS.providerId
      ] || DEFAULT_SETTINGS.model;
  }

  coerce(draft);
  draft.schemaVersion = Math.max(from, CURRENT_SCHEMA);
  return draft as unknown as Settings;
}
