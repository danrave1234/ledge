import { pluginActive } from "../../plugins";
import type { ToolOutcome } from "../../tools";
import type { Settings } from "../../types";
import { PLUGIN_ID, prepareAppLaunch } from "./tools";

/** A whole message that is only "open <something>". Anything longer or with a
 *  web address is left to the model (or to browser navigation) so an ordinary
 *  sentence containing the word "open" never turns into a launch card. */
const OPEN_REQUEST =
  /^\s*(?:(?:please|can you|could you|hey)\s+)*(?:open|launch|start|run)\s+(?:up\s+)?(?:the\s+|my\s+)?(.+?)(?:\s+(?:app|application|program|for me|please|now))*\s*[.!]?\s*$/i;
/** Enough for "visual studio code" and not a request that needs reasoning. */
const MAX_REQUEST_WORDS = 6;

export function appLaunchQuery(text: string): string | null {
  if (text.split(/\s+/).filter(Boolean).length > MAX_REQUEST_WORDS + 2) return null;
  if (/[/\\:]|\.\w{2,}(?:\s|$)|\bhttps?\b/i.test(text)) return null;
  const match = text.match(OPEN_REQUEST);
  if (!match) return null;
  const query = match[1].trim();
  return query && query.split(/\s+/).length <= MAX_REQUEST_WORDS ? query : null;
}

/** Text-only providers cannot call tools; recognize the one unambiguous
 *  request and route it through the same approval card. Returns null when
 *  nothing matched so the normal turn proceeds. */
export async function prepareAppLaunchFallback(
  text: string,
  settings: Settings,
): Promise<ToolOutcome | null> {
  if (!pluginActive(settings, PLUGIN_ID)) return null;
  const query = appLaunchQuery(text);
  if (!query) return null;
  const outcome = await prepareAppLaunch(query);
  // No card means nothing matched; let the model answer instead of surfacing
  // a tool-style error for what may not even have been an app request.
  return outcome.card ? outcome : null;
}
