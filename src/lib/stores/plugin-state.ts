import { writable, get, type Writable } from "svelte/store";
import { discardWrites, readRaw, queueWrite } from "./persistence";
import { storeDelete } from "../native";

/* ==========================================================================
   Per-plugin persisted state.

   A plugin's own configuration lives in its own file — `perch.plugin.<id>` —
   with its own schema version and its own migration list. It never touches
   `Settings` or `CURRENT_SCHEMA`.

   That separation is the point. Core settings carry a migration list every
   build has to keep reading forever; if each plugin added fields there, a
   third-party plugin could force a core schema bump, and uninstalling one would
   leave its keys behind in everyone's settings file. Here, a plugin's data is
   as removable as the plugin.

   Per-turn consent deliberately is not persisted at all. It is composer-local
   state passed into the host's tool gate for exactly one send.

   First consumer is the Spotify plugin (phase 3), which needs somewhere to keep
   a chosen default service and device that is nobody else's business.
   ========================================================================== */

interface PluginMigration {
  /** Schema version this step produces. */
  to: number;
  describe: string;
  /** `draft` is defaults merged with the stored value — mutate it. `stored` is
   *  the RAW stored object; use it for any "did the user have this field?"
   *  test, because the merge gives every new field a value and makes a missing
   *  one look present. (Same trap that bit the core settings migrations.) */
  apply(draft: Record<string, unknown>, stored: Record<string, unknown>): void;
}

export interface PluginStateSpec<T extends object> {
  /** Plugin id; determines the storage key. */
  id: string;
  /** Current schema version. Bump it in the same change as a new migration. */
  schema: number;
  defaults: T;
  migrations?: PluginMigration[];
}

export interface PluginState<T extends object> {
  /** Reactive state. Read with `$store` in components. */
  store: Writable<T>;
  /** Merge a patch and persist it. */
  update(patch: Partial<T>): void;
  /** Non-reactive snapshot, for tool code that must not subscribe. */
  snapshot(): T;
  /** Load from disk and start persisting. Called once by `hydrate()`. */
  load(): Promise<void>;
  /** Reset memory and delete the plugin's durable blob. */
  remove(): Promise<void>;
}

export function storageKey(id: string): string {
  return `perch.plugin.${id}`;
}

/** Bring a stored blob up to the current shape. Exported for testing. */
export function migratePluginState<T extends object>(
  spec: PluginStateSpec<T>,
  parsed: unknown,
): T {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...spec.defaults };
  }
  const stored = parsed as Record<string, unknown>;
  // Read the version from the STORED object, never from the merged draft: the
  // defaults carry the current version, so merging first makes every old blob
  // look current and silently skips all of its migrations.
  const from = typeof stored.schemaVersion === "number" ? stored.schemaVersion : 1;
  const draft: Record<string, unknown> = { ...spec.defaults, ...stored };

  for (const m of spec.migrations ?? []) {
    if (from < m.to) m.apply(draft, stored);
  }

  draft.schemaVersion = Math.max(from, spec.schema);
  return draft as T;
}

const registered = new Map<string, { load(): Promise<void>; remove(): Promise<void> }>();

/** Declare a plugin's persisted state. Call at module scope; `hydrate()` loads
    every registered state before the UI reads any of it. */
export function definePluginState<T extends object>(
  spec: PluginStateSpec<T>,
): PluginState<T> {
  const key = storageKey(spec.id);
  const store = writable<T>({ ...spec.defaults });
  let loaded = false;
  let suppressWrite = false;

  async function load(): Promise<void> {
    if (loaded) return;
    const raw = await readRaw(key);
    if (raw) {
      try {
        store.set(migratePluginState(spec, JSON.parse(raw)));
      } catch (e) {
        // Corrupt file: keep defaults rather than crash the whole hydrate and
        // take every other plugin down with it.
        console.error("corrupt plugin state, keeping defaults:", key, e);
      }
    }
    loaded = true;
    // Subscribe only AFTER loading, or the subscriber's initial call writes
    // defaults straight back over what was just read.
    store.subscribe((v) => {
      if (loaded && !suppressWrite) queueWrite(key, JSON.stringify(v));
    });
  }

  const state: PluginState<T> = {
    store,
    update: (patch) => store.update((v) => ({ ...v, ...patch })),
    snapshot: () => get(store),
    load,
    remove: async () => {
      suppressWrite = true;
      try {
        store.set({ ...spec.defaults });
        await discardWrites(key);
        await storeDelete(key);
      } finally {
        suppressWrite = false;
      }
    },
  };
  registered.set(spec.id, state);
  return state;
}

/** Load every declared plugin state. Called from `hydrate()`. */
export async function loadPluginStates(): Promise<void> {
  // Sequential, not parallel: these are small files and hydrate already runs
  // before first paint, so ordering is worth more than the milliseconds.
  for (const s of registered.values()) {
    try {
      await s.load();
    } catch (e) {
      console.error("plugin state load failed", e);
    }
  }
}

export async function deletePluginState(id: string): Promise<void> {
  await registered.get(id)?.remove();
}
