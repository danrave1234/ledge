import { pluginActive } from "../../plugins";
import type { ToolOutcome } from "../../tools";
import type { ApprovedScreen, Settings, TurnConsent } from "../../types";
import { browserNavigationUrl, prepareBrowserNavigationTool } from "./tools";

/** Translate the small set of unambiguous actions supported by text-only
 * providers into the same approval flow used by structured tool calls. */
export async function prepareComputerControlFallback(
  text: string,
  settings: Settings,
  consent: TurnConsent,
  approvedScreen?: ApprovedScreen,
): Promise<ToolOutcome | null> {
  if (!pluginActive(settings, "computer-control")) return null;

  const url = browserNavigationUrl(text);
  if (!url) return null;

  return prepareBrowserNavigationTool.run(
    { url },
    { settings, consent, approvedScreen, sources: [] },
  );
}
