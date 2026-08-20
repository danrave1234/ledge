import type { PerchTool } from "../../tools";
import type { Settings, TurnConsent } from "../../types";
import { pluginActive } from "../../plugins";
import { youtubeHasKey } from "../../native";
import * as youtube from "./youtube";

/* ==========================================================================
   YouTube Music tool.

   The weakest of the three layers, and it says so. YouTube has no playback API,
   so this opens a URL and then asks Windows whether anything actually started.
   Nothing here claims success it has not observed.
   ========================================================================== */

/** Whether a Data API key is configured. Cached because `available()` cannot
    await; refreshed alongside the Spotify check when the panel mounts. */
let hasKey = false;

export async function refreshYoutubeKey(): Promise<boolean> {
  hasKey = await youtubeHasKey();
  return hasKey;
}

export function youtubeKeyPresent(): boolean {
  return hasKey;
}

/** Same consent chain as every other action tool. No account needed — opening a
    URL is not an authenticated operation — but starting audio still is an act. */
function canUseYoutube(s: Settings, consent: TurnConsent): boolean {
  return pluginActive(s, "music") && consent.music && !!s.musicConfirmed;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

const youtubeTool: PerchTool = {
  pluginId: "music",
  runningLabel: "Opening YouTube Music",
  capability: "open something on YouTube Music in the user's browser",
  spec: {
    name: "music_play_youtube",
    description:
      "Play something on YouTube Music by opening it in the user's browser. Use it when the user asks specifically for YouTube Music, or when they want something Spotify does not have. Prefer Spotify (music_play) when it is connected, because it starts playback reliably; YouTube is opened in a browser tab and may need one click to start. Never say the track is playing unless the result says it was confirmed.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What to play — a song, artist, album, or mood.",
        },
        kind: {
          type: "string",
          enum: ["video", "playlist"],
          description:
            "Look for a single track ('video', the default) or a playlist/mix.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  available: canUseYoutube,
  async run(args) {
    const query = str(args.query);
    if (!query) return { content: "Error: `query` is required." };
    const kind = str(args.kind) === "playlist" ? "playlist" : "video";

    try {
      const out = await youtube.playQuery(query, kind, hasKey);

      if (out.searchOnly) {
        // No key, or nothing matched. Opening a search is genuinely useful, but
        // it is NOT playback and must not be reported as such.
        return {
          content:
            `Opened a YouTube Music search for "${query}" in the browser. Nothing is playing yet — ` +
            `the user has to pick a result themselves. Say exactly that in one line.` +
            (hasKey
              ? ""
              : " You could add that setting a YouTube API key in Settings → Plugins → Music would let you start a specific track directly."),
        };
      }

      if (out.playing) {
        const track =
          [out.playing.title, out.playing.artist].filter(Boolean).join(" — ") || query;
        return {
          content: `Confirmed playing on YouTube Music: ${track}. Say so in one line.`,
          card: { type: "now_playing", data: { app_id: out.playing.app_id } },
        };
      }

      // Opened, but Windows never saw a session start. Browsers block autoplay,
      // and reporting success here is the exact failure this check exists for.
      return {
        content:
          `Opened ${out.url} in the browser, but playback did not start — the browser most likely blocked autoplay. ` +
          `Tell the user it is open and needs one click to play. Do NOT say it is playing.`,
        card: out.alternatives.length
          ? {
              type: "music_picker",
              data: { items: out.alternatives, prompt: "Other matches" },
            }
          : undefined,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: `Could not open YouTube Music: ${msg}. Tell the user — do not claim anything played.`,
      };
    }
  },
};

export const youtubeTools: PerchTool[] = [youtubeTool];
