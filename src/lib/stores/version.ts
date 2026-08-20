import { get, writable } from "svelte/store";
import { appVersion, clearCache, isTauri } from "../native";
import { settings, updateSettings } from "./settings";
import { cacheClearSafe } from "./persistence";

/** Set for the session when this launch is the first one after an update.
    Settings → Storage reads it to tell the user what they are now running. */
export const justUpdatedFrom = writable<string | null>(null);

/** Reconcile the running build with what the store was last written by.
 *
 *  Perch installs updates in the background and relaunches, so a launch can be
 *  the first one on a new version. Two things have to happen then:
 *    1. Settings written by the old build are migrated — handled in hydrate()
 *       via `migrateSettings`, which runs before this.
 *    2. The WebView2 cache is cleared once. The updater replaces the bundled
 *       frontend, and a stale cached asset from the previous version is the
 *       classic "app updated but the UI is broken" bug.
 *
 *  Must run AFTER hydrate() so `lastVersion` reflects the stored value.
 *  Recording the version is best-effort: if the cache clear fails we still
 *  record, so a permanently failing clear cannot re-run on every launch. */
export async function reconcileVersion(): Promise<void> {
  const version = await appVersion();
  const previous = get(settings).lastVersion ?? "";

  if (previous === version) return;

  if (previous && isTauri() && cacheClearSafe()) {
    justUpdatedFrom.set(previous);
    try {
      await clearCache();
    } catch (e) {
      console.error("post-update cache clear failed", e);
    }
  }

  updateSettings({ lastVersion: version });
}
