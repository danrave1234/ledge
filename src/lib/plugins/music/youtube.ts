import {
  mediaSessions,
  openExternal,
  youtubeSearch,
  type MediaSession,
} from "../../native";
import type { MusicItem } from "./spotify";

/* ==========================================================================
   YouTube Music.

   There is no supported way to control YouTube Music playback, so this layer is
   deliberately modest: resolve a phrase to a URL, open it, then CHECK whether
   anything actually started by asking Windows. It never assumes.
   ========================================================================== */

/** How long to wait for a browser tab to register a media session. Opening a
    page, loading it, and starting audio is slow — a couple of seconds is not
    enough, and giving up early reports failure on a success. */
const CONFIRM_TIMEOUT_MS = 12_000;
const CONFIRM_INTERVAL_MS = 1_000;

/** True when a session looks like YouTube Music.
 *
 *  Matched on the app id AND the browser, because YouTube Music in a tab
 *  reports the BROWSER as the app — there is no "YouTube Music" process to look
 *  for unless the desktop wrapper is installed. */
export function isYoutubeSession(s: MediaSession): boolean {
  const id = (s.app_id || "").toLowerCase();
  return (
    id.includes("youtube") ||
    id.includes("chrome") ||
    id.includes("msedge") ||
    id.includes("firefox") ||
    id.includes("brave") ||
    id.includes("opera")
  );
}

/** Wait for playback to actually begin, and report what started.
 *
 *  This is the honesty check. Browsers block autoplay in general; YouTube Music
 *  usually gets through on media engagement, but "usually" is not "did". Only a
 *  real session returned here justifies telling the user something is playing. */
export async function confirmPlaying(
  timeoutMs = CONFIRM_TIMEOUT_MS,
  intervalMs = CONFIRM_INTERVAL_MS,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<MediaSession | null> {
  const deadline = now() + timeoutMs;
  for (;;) {
    const sessions = await mediaSessions(false).catch(() => []);
    const hit = sessions.find(
      (s) => isYoutubeSession(s) && s.status === "playing" && (s.title || s.artist),
    );
    if (hit) return hit;
    if (now() + intervalMs > deadline) return null;
    await sleep(intervalMs);
  }
}

/** The fallback destination when we can't resolve a specific track: YouTube
    Music's own search. One definition, used by every fallback path. */
export function searchUrl(query: string): string {
  return `https://music.youtube.com/search?q=${encodeURIComponent(query)}`;
}

export interface YoutubeOutcome {
  /** What we opened. */
  url: string;
  /** The session Windows reports, once something is genuinely playing. */
  playing: MediaSession | null;
  /** True when we could only open a search page, not a specific item. */
  searchOnly: boolean;
  /** Alternatives to offer as buttons, when a key let us resolve several. */
  alternatives: MusicItem[];
}

/** Convert a backend YouTube result into the shape the picker renders. */
function toItem(r: {
  url: string;
  title: string;
  subtitle: string;
  art?: string | null;
  kind: string;
}): MusicItem {
  return {
    uri: r.url,
    title: r.title,
    subtitle: r.subtitle || (r.kind === "playlist" ? "Playlist" : "YouTube Music"),
    art: r.art ?? undefined,
    kind: r.kind === "playlist" ? "playlist" : "track",
    source: "youtube",
  };
}

/** Open a YouTube Music URL and wait to see whether it started. */
export async function openAndConfirm(
  url: string,
  confirm: () => Promise<MediaSession | null> = () => confirmPlaying(),
): Promise<MediaSession | null> {
  await openExternal(url);
  return await confirm();
}

/**
 * Play the best YouTube Music match for a phrase.
 *
 * With an API key this resolves to a specific video or playlist and offers the
 * runners-up as buttons. Without one it opens a search — worth doing, but the
 * caller must say that is what happened rather than claiming playback.
 */
export async function playQuery(
  query: string,
  kind: "video" | "playlist" = "video",
  hasKey = true,
  /** Injectable so tests don't sit through the real confirmation window. */
  confirm: () => Promise<MediaSession | null> = () => confirmPlaying(),
): Promise<YoutubeOutcome> {
  if (!hasKey) {
    const url = searchUrl(query);
    await openExternal(url);
    return { url, playing: null, searchOnly: true, alternatives: [] };
  }

  const results = await youtubeSearch(query, kind, 6);
  if (!results.length) {
    const url = searchUrl(query);
    await openExternal(url);
    return { url, playing: null, searchOnly: true, alternatives: [] };
  }

  const items = results.map(toItem);
  const playing = await openAndConfirm(items[0].uri, confirm);
  return {
    url: items[0].uri,
    playing,
    searchOnly: false,
    // The rest, so a wrong top hit is one tap from being corrected instead of
    // another round-trip through the model.
    alternatives: items.slice(1),
  };
}
