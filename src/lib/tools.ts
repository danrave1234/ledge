import type { ToolSpec } from "./providers/types";
import type { ApprovedScreen, MsgCard, Settings, TurnConsent } from "./types";
import type { WebResult } from "./native";
import { allPluginTools } from "./plugins/registry";

/* ==========================================================================
   The tool contract and the runner.

   Tools themselves live with the plugin that contributes them (see
   `plugins/registry.ts`). This module owns only the shape they implement and
   the code that executes one — so adding a capability never means editing a
   list here.
   ========================================================================== */

/** What a tool hands back after running. */
export interface ToolOutcome {
  /** Text returned to the model. Already wrapped in untrusted markers — a tool
      result is data the model analyses, never instructions it follows. */
  content: string;
  /** Newly cited sources, appended to the turn's numbered list. */
  sources?: WebResult[];
  /** Image to show the model as a following user turn (vision). */
  image?: string;
  /** Marks the reply as having used the screen / the web, for the UI badges. */
  usedScreen?: boolean;
  usedWeb?: boolean;
  /** Interactive UI attached to the reply — a picker, a now-playing card. See
      lib/cards.ts. The model still gets `content`; the card is for the user. */
  card?: MsgCard;
}

/** State shared by every tool call within one turn. */
export interface ToolRunContext {
  settings: Settings;
  consent: TurnConsent;
  /** Exact capture approved in the composer. Screen tools must never recapture. */
  approvedScreen?: ApprovedScreen;
  /** Sources gathered so far this turn; citation number is index + 1, so this
      stays correct across several searches in a single answer. */
  sources: WebResult[];
}

export interface LedgeTool {
  spec: ToolSpec;
  /** Plugin that contributes this tool; the host gates on it. */
  pluginId: string;
  /** Shown while the tool runs, so a multi-round turn isn't silent. Present
      tense, no ellipsis — the UI adds its own. */
  runningLabel: string;
  /** How the system prompt describes this ability, as a verb phrase completing
   *  "you can …" — e.g. "search the live web".
   *
   *  The prompt's capability claim is assembled from the tools actually offered
   *  this turn, so a tool that omits this is invisible to the model's sense of
   *  what it can do, and it will hedge or refuse rather than call it. */
  capability?: string;
  /** True when the plugin is active AND the user has consented for this turn. */
  available(s: Settings, consent: TurnConsent): boolean;
  run(args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolOutcome>;
}

/** Tools on offer for this turn, after plugin and consent gating. */
export function availableTools(s: Settings, consent: TurnConsent): LedgeTool[] {
  return allPluginTools().filter((t) => t.available(s, consent));
}

export function toolSpecs(s: Settings, consent: TurnConsent): ToolSpec[] {
  return availableTools(s, consent).map((t) => t.spec);
}

/** The verb phrases for what the model can genuinely do this turn. Feeds the
    capability claim in the system prompt (see lib/prompt.ts). */
export function toolCapabilities(s: Settings, consent: TurnConsent): string[] {
  return availableTools(s, consent)
    .map((t) => t.capability)
    .filter((c): c is string => !!c);
}

/** What to show the user while `name` runs. Falls back to something honest
 *  rather than blank, so an unknown tool still explains the pause. */
export function toolLabel(name: string): string {
  return allPluginTools().find((t) => t.spec.name === name)?.runningLabel ?? "Working";
}

/** Run one call. Never throws: every failure comes back as text the model can
 *  read and react to, because a thrown error would kill the whole reply. */
export async function runTool(
  name: string,
  rawArgs: string,
  ctx: ToolRunContext,
): Promise<ToolOutcome> {
  const tool = availableTools(ctx.settings, ctx.consent).find(
    (t) => t.spec.name === name,
  );
  if (!tool) {
    return { content: `Error: no tool named "${name}" is available. Answer without it.` };
  }

  let args: Record<string, unknown> = {};
  if (rawArgs?.trim()) {
    try {
      const parsed: unknown = JSON.parse(rawArgs);
      if (parsed && typeof parsed === "object") args = parsed as Record<string, unknown>;
    } catch {
      return {
        content: `Error: arguments for "${name}" were not valid JSON. Call it again with a valid JSON object.`,
      };
    }
  }

  try {
    return await tool.run(args, ctx);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      content: `Error running "${name}": ${msg}. Answer without it, or try once more.`,
    };
  }
}
