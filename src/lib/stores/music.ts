import { writable } from "svelte/store";
import {
  mediaControl,
  mediaSessions,
  mediaWatch,
  onNowPlaying,
  type MediaAction,
  type MediaSession,
} from "../native";

/* ==========================================================================
   Now-playing state, fed by the Rust SMTC watcher.

   Primarily push: the backend subscribes to Windows' media events and emits
   `perch://now-playing` when something changes. A lightweight reconciliation
   read also repairs progress when a browser misses a timeline event.

   The watcher is started only while the music plugin is active — see
   `syncMusicWatch`.
   ========================================================================== */

/** Every player Windows knows about, current session first. */
export const nowPlaying = writable<MediaSession[]>([]);

/** Artwork-free reconciliation snapshots should not make an existing cover
 * disappear. The native watcher omits artwork from its inexpensive fallback
 * reads, while authoritative media events still replace it when available. */
export function mergeMediaSessions(
  previous: MediaSession[],
  incoming: MediaSession[],
): MediaSession[] {
  const artwork = new Map(previous.map((session) => [session.app_id, session.art]));
  return incoming.map((session) => ({
    ...session,
    art: session.art ?? artwork.get(session.app_id),
  }));
}

function updateNowPlaying(list: MediaSession[]): void {
  nowPlaying.update((previous) => mergeMediaSessions(previous, list));
}

let unlisten: (() => void) | null = null;
let watching = false;
let desired = false;
let transition = Promise.resolve();

/** The session a bare "pause" should act on: the current one, else whatever is
 *  actually playing, else the first we know about. */
export function primarySession(list: MediaSession[]): MediaSession | undefined {
  return (
    list.find((s) => s.is_current) ?? list.find((s) => s.status === "playing") ?? list[0]
  );
}

/** True when a session is worth showing: it has something loaded and hasn't
 *  been closed out. A stopped player with no title is just noise in the UI. */
export function isLive(s: MediaSession | undefined): s is MediaSession {
  return !!s && s.status !== "closed" && !!(s.title || s.artist);
}

export async function refreshNowPlaying(): Promise<void> {
  try {
    updateNowPlaying(await mediaSessions(true));
  } catch (e) {
    console.error("now-playing refresh failed", e);
  }
}

/** Match the backend watcher to whether the plugin is active. Idempotent, so it
    is safe to call from an effect that re-runs on every settings change. */
export async function syncMusicWatch(active: boolean): Promise<void> {
  desired = active;
  transition = transition
    .catch((e) => console.error("music watcher transition failed", e))
    .then(async () => {
      if (desired === watching) return;
      if (!desired) {
        unlisten?.();
        unlisten = null;
        watching = false;
        nowPlaying.set([]);
        await mediaWatch(false);
        return;
      }

      const stopListening = await onNowPlaying(updateNowPlaying);
      // The desired state may have changed while event registration was pending.
      if (!desired) {
        stopListening();
        return;
      }
      unlisten = stopListening;
      await mediaWatch(true);
      watching = true;
      await refreshNowPlaying();
    });
  await transition;
}

/** Drive a player from the UI. Throws on refusal so the caller can show it —
 *  a transport button that silently does nothing is worse than an error. */
export async function control(
  action: MediaAction,
  app?: string,
  positionMs?: number,
): Promise<void> {
  await mediaControl(action, app, positionMs);
  // SMTC reports the new state through the watcher, but players can take a
  // moment. Refresh so the button's own feedback isn't a frame behind.
  await refreshNowPlaying();
}
