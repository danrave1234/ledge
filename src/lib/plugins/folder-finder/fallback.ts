import { pluginActive } from "../../plugins";
import type { ToolOutcome } from "../../tools";
import type { Settings } from "../../types";
import { PLUGIN_ID, preparePathOpen } from "./tools";

/** Phrases that clearly mean a folder/file lookup, not an app launch.
 *  Bare "open X" is left to the app launcher so the two fallbacks do not fight. */
const PATH_REQUEST =
  /^\s*(?:(?:please|can you|could you|hey)\s+)*(?:(?:find|locate|search(?:\s+for)?|show(?:\s+me)?|where\s+(?:is|'s))\s+(?:the\s+|my\s+)?(.+?)(?:\s+(?:folder|file|directory|for me|please|now))*|(?:open)\s+(?:the\s+|my\s+)?(.+?)\s+(?:folder|file|directory)(?:\s+(?:for me|please|now))?)\s*[.!]?\s*$/i;
/** Enough for "visual studio code project folder" and not a request that needs reasoning. */
const MAX_REQUEST_WORDS = 6;

/** Known Windows folders that a bare "where is downloads" should still catch. */
const KNOWN_FOLDERS =
  /^(?:(?:my\s+)?(?:desktop|documents|downloads|pictures|photos|videos|music)|home|user profile)$/i;
/** Steam-related phrases: "steam", "steam games", "steam library", "steam dota", etc. */
const STEAM_HINT = /\b(?:steam|epic|gog|xbox|origin)\b/i;

export function pathQuery(text: string): string | null {
  if (text.split(/\s+/).filter(Boolean).length > MAX_REQUEST_WORDS + 3) return null;
  // Skip URLs and absolute paths — those are not folder-finder name queries.
  if (/[/\\:]|\bhttps?\b/i.test(text)) return null;
  const match = text.match(PATH_REQUEST);
  if (!match) return null;
  const query = (match[1] ?? match[2] ?? "").trim();
  if (!query || query.split(/\s+/).length > MAX_REQUEST_WORDS) return null;
  // Also catch "find the steam dota folder" — PATH_REQUEST may strip "folder"
  // but the query should still contain the game name.
  // If the query looks like a Steam game query, keep it.
  if (STEAM_HINT.test(query)) return query;
  return query;
}

/** Text-only providers cannot call tools; recognize the one unambiguous
 *  request and route it through the same approval card. Returns null when
 *  nothing matched so the normal turn proceeds. */
export async function preparePathOpenFallback(
  text: string,
  settings: Settings,
): Promise<ToolOutcome | null> {
  if (!pluginActive(settings, PLUGIN_ID)) return null;
  let query = pathQuery(text);
  // Also accept a bare known-folder name with a locator verb already checked
  // by pathQuery; pathQuery covers "where is downloads" via the first branch.
  if (!query) {
    // Extra: "open my downloads" without the word folder, only for known aliases.
    const bare = text
      .trim()
      .match(
        /^\s*(?:(?:please|can you|could you|hey)\s+)*(?:open|find|locate|show(?:\s+me)?|where\s+(?:is|'s))\s+(?:the\s+|my\s+)?(.+?)\s*[.!]?\s*$/i,
      );
    const candidate = bare?.[1]?.trim();
    if (candidate && KNOWN_FOLDERS.test(candidate)) query = candidate;
  }
  if (!query) return null;
  const outcome = await preparePathOpen(query);
  // No card means nothing matched; let the model answer instead of surfacing
  // a tool-style error for what may not even have been a path request.
  return outcome.card ? outcome : null;
}
