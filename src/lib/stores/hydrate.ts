import { get } from "svelte/store";
import {
  K_SETTINGS,
  K_PERSONAS,
  K_CONV,
  loadWithMigration,
  writeRaw,
} from "./persistence";
import { settings, DEFAULT_SETTINGS, CURRENT_SCHEMA } from "./settings";
import { customPersonas } from "./personas";
import { conversations } from "./conversations";
import { applyTheme, applyCustomCss, applyAccent } from "./theme";

let hydrated = false;
let hydrating = false;

export async function hydrate(): Promise<void> {
  if (hydrated || hydrating) return;
  hydrating = true;

  const s = await loadWithMigration(K_SETTINGS);
  if (s) {
    try {
      const parsed = JSON.parse(s);
      if (parsed && typeof parsed === "object") {
        const merged = { ...DEFAULT_SETTINGS, ...parsed };
        // One-time upgrades for settings written by older builds.
        if ((parsed.schemaVersion ?? 1) < 2) {
          // v1 → v2: the idle handle default became the OPPO-style pill.
          if (parsed.handle === "spark") merged.handle = "pill";
        }
        merged.schemaVersion = CURRENT_SCHEMA;
        settings.set(merged);
      }
    } catch {
      /* keep defaults */
    }
  }
  const p = await loadWithMigration(K_PERSONAS);
  if (p) {
    try {
      const parsed = JSON.parse(p);
      if (Array.isArray(parsed)) customPersonas.set(parsed);
    } catch {
      /* ignore */
    }
  }
  const c = await loadWithMigration(K_CONV);
  if (c) {
    try {
      const parsed = JSON.parse(c);
      if (Array.isArray(parsed)) conversations.set(parsed);
    } catch {
      /* ignore */
    }
  }

  applyTheme(get(settings).theme);
  applyCustomCss(get(settings).customCss);
  applyAccent(get(settings).accent);
  hydrated = true;

  settings.subscribe((v) => {
    applyTheme(v.theme);
    applyCustomCss(v.customCss);
    applyAccent(v.accent);
    if (hydrated) writeRaw(K_SETTINGS, JSON.stringify(v));
  });
  customPersonas.subscribe((v) => {
    if (hydrated) writeRaw(K_PERSONAS, JSON.stringify(v));
  });
  conversations.subscribe((v) => {
    if (hydrated) writeRaw(K_CONV, JSON.stringify(v));
  });
}
