import { spotifyRequest, openExternal } from "../../native";
import { clientId } from "./state";

/* ==========================================================================
   Typed Spotify client.

   Shapes the raw API into the small set of things the music tools need. Every
   call routes through the Rust proxy, so no token is ever present on this side.
   ========================================================================== */

/** One thing the user could play. Uniform across tracks, albums and playlists
    so the picker card renders them all the same way. */
export interface MusicItem {
  /** A Spotify URI, or — for YouTube — the music.youtube.com URL to open. */
  uri: string;
  title: string;
  subtitle: string;
  art?: string;
  kind: "track" | "album" | "playlist" | "artist";
  /** Which service plays this. Absent means Spotify, so cards stored before
      YouTube support existed still work. */
  source?: "spotify" | "youtube";
}

interface SpotifyDevice {
  id: string | null;
  name: string;
  type: string;
  is_active: boolean;
}

async function api<T>(
  method: "GET" | "PUT" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const raw = await spotifyRequest(method, path, body, clientId());
  if (!raw.trim()) return undefined as T; // 204, which playback endpoints return
  return JSON.parse(raw) as T;
}

function q(s: string): string {
  return encodeURIComponent(s);
}

/* ---------- reading ---------- */

interface Image {
  url: string;
}
interface Artistish {
  name: string;
}

function smallestArt(images?: Image[]): string | undefined {
  // The last image is the smallest in Spotify's ordering. Cards are ~40px, so
  // pulling the 640px original would be wasteful on every row.
  return images?.length ? images[images.length - 1].url : undefined;
}

export async function search(
  query: string,
  kinds: Array<MusicItem["kind"]> = ["track", "album", "playlist"],
  limit = 6,
): Promise<MusicItem[]> {
  const types = kinds.join(",");
  const data = await api<{
    tracks?: { items: Array<Record<string, unknown>> };
    albums?: { items: Array<Record<string, unknown>> };
    playlists?: { items: Array<Record<string, unknown>> };
  }>("GET", `/v1/search?q=${q(query)}&type=${q(types)}&limit=${limit}`);

  const out: MusicItem[] = [];
  // Interleave by kind rather than concatenating, so a search that matches a
  // playlist and a track doesn't bury one kind below six of the other.
  const groups = [
    (data?.tracks?.items ?? []).map((t) => toItem(t, "track")),
    (data?.playlists?.items ?? []).map((t) => toItem(t, "playlist")),
    (data?.albums?.items ?? []).map((t) => toItem(t, "album")),
  ];
  for (let i = 0; i < limit; i++) {
    for (const g of groups) if (g[i]) out.push(g[i]!);
  }
  // Spotify sometimes returns null entries in these arrays; drop anything
  // without a URI rather than rendering a button that cannot play.
  return out.filter((i) => !!i?.uri).slice(0, limit);
}

function toItem(raw: Record<string, unknown>, kind: MusicItem["kind"]): MusicItem {
  const r = raw as {
    uri?: string;
    name?: string;
    images?: Image[];
    artists?: Artistish[];
    album?: { images?: Image[]; name?: string };
    owner?: { display_name?: string };
    total_tracks?: number;
    tracks?: { total?: number };
  };
  const artists = (r.artists ?? [])
    .map((a) => a.name)
    .filter(Boolean)
    .join(", ");
  const subtitle =
    kind === "track"
      ? artists || r.album?.name || "Track"
      : kind === "album"
        ? artists || "Album"
        : `Playlist${r.owner?.display_name ? ` · ${r.owner.display_name}` : ""}${
            r.tracks?.total ? ` · ${r.tracks.total} tracks` : ""
          }`;
  return {
    uri: r.uri ?? "",
    title: r.name ?? "Untitled",
    subtitle,
    art: smallestArt(r.images ?? r.album?.images),
    kind,
  };
}

export async function playlists(limit = 50): Promise<MusicItem[]> {
  const data = await api<{ items?: Array<Record<string, unknown>> }>(
    "GET",
    `/v1/me/playlists?limit=${limit}`,
  );
  return (data?.items ?? []).map((p) => toItem(p, "playlist")).filter((i) => !!i.uri);
}

async function devices(): Promise<SpotifyDevice[]> {
  const data = await api<{ devices?: SpotifyDevice[] }>("GET", "/v1/me/player/devices");
  return data?.devices ?? [];
}

/* ---------- playing ---------- */

/** Spotify refuses playback when no device is "active", which is the single
 *  most common failure in practice — it happens whenever the desktop app has
 *  been idle or was never opened this session.
 *
 *  The ladder: an already-active device is used as-is; an idle-but-known device
 *  is woken by transferring to it; with nothing at all we launch the desktop
 *  client and wait for it to register. Only after all three does this give up,
 *  and then with an instruction the user can actually follow. */
async function ensureDevice(): Promise<string | undefined> {
  let list = await devices();
  const active = list.find((d) => d.is_active && d.id);
  if (active?.id) return active.id;

  const idle = list.find((d) => d.id);
  if (idle?.id) {
    // `play: false` so transferring doesn't start the previous track before we
    // send the thing the user actually asked for.
    await api("PUT", "/v1/me/player", { device_ids: [idle.id], play: false });
    return idle.id;
  }

  // Nothing registered: the desktop client isn't running. Launching it via the
  // protocol handler is the only way to get a device without the user going to
  // find the app themselves.
  await openExternal("spotify:");
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    list = await devices();
    const found = list.find((d) => d.id);
    if (found?.id) {
      await api("PUT", "/v1/me/player", { device_ids: [found.id], play: false });
      return found.id;
    }
  }
  throw new Error(
    "No Spotify device is available. Open the Spotify app and play something once, then try again.",
  );
}

/** Start playback of a URI. Albums and playlists are contexts; tracks are a
    one-item list — Spotify treats the two differently and rejects the wrong one. */
export async function play(uri: string): Promise<void> {
  const device = await ensureDevice();
  const body = uri.includes(":track:") ? { uris: [uri] } : { context_uri: uri };
  const suffix = device ? `?device_id=${q(device)}` : "";
  await api("PUT", `/v1/me/player/play${suffix}`, body);
}

export async function queue(uri: string): Promise<void> {
  const device = await ensureDevice();
  const suffix = device ? `&device_id=${q(device)}` : "";
  await api("POST", `/v1/me/player/queue?uri=${q(uri)}${suffix}`);
}

/** Find the best match for a phrase and play it. What "play some jazz" means. */
export async function playQuery(
  query: string,
  kinds?: Array<MusicItem["kind"]>,
): Promise<MusicItem> {
  const results = await search(query, kinds, 6);
  if (!results.length) throw new Error(`Spotify had no results for "${query}".`);
  await play(results[0].uri);
  return results[0];
}
