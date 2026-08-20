import { get, readonly, writable } from "svelte/store";
import {
  K_SETTINGS,
  K_PERSONAS,
  K_CONV,
  loadWithMigration,
  queueWrite,
} from "./persistence";
import { settings } from "./settings";
import { migrateSettings } from "./migrations";
import { customPersonas } from "./personas";
import { conversations } from "./conversations";
import { applyTheme, applyAccent, removeLegacyCustomCss } from "./theme";
import { loadPluginStates } from "./plugin-state";
import { conversationsForStorage, hydrateConversationAssets } from "../assets";

let hydrated = false;
let hydrating = false;
const hydrationState = writable(false);

/** True only after durable state has replaced the in-memory defaults. Native
    side effects must wait for this so defaults are never applied at launch. */
export const hydrationReady = readonly(hydrationState);

/** Load a JSON value from durable storage. Returns undefined on missing or
    corrupt data so the caller keeps its defaults instead of crashing. */
async function loadJson<T>(key: string): Promise<T | undefined> {
  const raw = await loadWithMigration(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    console.error("corrupt store, keeping defaults:", key, e);
    return undefined;
  }
}

export async function hydrate(): Promise<void> {
  if (hydrated || hydrating) return;
  hydrating = true;
  try {
    await load();
  } finally {
    // Always release the latch — a failed hydrate must not wedge the app into a
    // state where no later attempt can run.
    hydrating = false;
  }
}

async function load(): Promise<void> {
  const stored = await loadJson<unknown>(K_SETTINGS);
  if (stored !== undefined) settings.set(migrateSettings(stored));

  const personas = await loadJson<unknown>(K_PERSONAS);
  if (Array.isArray(personas)) customPersonas.set(personas);

  const convs = await loadJson<unknown>(K_CONV);
  if (Array.isArray(convs)) {
    conversations.set(await hydrateConversationAssets(convs));
  }

  // Plugins own their own files, so this is independent of the core stores
  // above and a failure in one can't lose the others.
  await loadPluginStates();

  const s = get(settings);
  applyTheme(s.theme);
  applyAccent(s.accent);
  removeLegacyCustomCss();
  hydrated = true;
  hydrationState.set(true);

  // Persist from here on. Subscribing after `hydrated` is set means the initial
  // call of each subscriber can't write defaults back over the loaded data.
  // Writes are queued (coalesced + flushed on teardown) so a keystroke or a
  // streamed token doesn't cost a full serialize + disk write each.
  settings.subscribe((v) => {
    applyTheme(v.theme);
    applyAccent(v.accent);
    if (hydrated) queueWrite(K_SETTINGS, JSON.stringify(v));
  });
  customPersonas.subscribe((v) => {
    if (hydrated) queueWrite(K_PERSONAS, JSON.stringify(v));
  });
  conversations.subscribe((v) => {
    if (hydrated) queueWrite(K_CONV, JSON.stringify(conversationsForStorage(v)));
  });
}
