import type { Component } from "svelte";
import type { PluginModule } from "./types";
import type { LedgeTool } from "../tools";
import type { Settings, TurnConsent } from "../types";
import { webSearchPlugin } from "./web-search";
import { screenContextPlugin } from "./screen-context";
import { musicPlugin } from "./music";
import { computerControlPlugin } from "./computer-control";
import { appLauncherPlugin } from "./app-launcher";
import { folderFinderPlugin } from "./folder-finder";

/* ==========================================================================
   The one place that knows every plugin.

   Adding a plugin means writing its module and listing it here — nothing else
   in the app keeps a parallel list. Before this existed, tools lived in a
   hardcoded array in `tools.ts`, cards in a hardcoded map in `cards.ts`, and
   prompt text for a capability had to be written into `prompt.ts` by hand; a
   new plugin meant editing all three and remembering the gating in each.

   Not every catalog entry needs a module: `job-analyzer` contributes only a UI
   suggestion, so it has none. The catalog in `lib/plugins.ts` is what Settings
   renders; this is what the running app executes.
   ========================================================================== */

export const PLUGIN_MODULES: PluginModule[] = [
  webSearchPlugin,
  screenContextPlugin,
  musicPlugin,
  computerControlPlugin,
  appLauncherPlugin,
  folderFinderPlugin,
];

/** Every tool contributed by any plugin, in registry order.
 *
 *  Deliberately unfiltered: `tools.ts` applies the gating, so this stays the
 *  complete set and a label lookup still works for a tool that has since become
 *  unavailable. */
export function allPluginTools(): LedgeTool[] {
  return PLUGIN_MODULES.flatMap((p) => p.tools ?? []);
}

/** Card renderers from every plugin, keyed by card type.
 *
 *  Built from the full set rather than the active one: a conversation can hold
 *  a card produced while a plugin was on, and it should still render after the
 *  plugin is switched off. Gating decides what NEW cards can be created. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function allPluginCards(): Record<string, Component<any>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: Record<string, Component<any>> = {};
  for (const p of PLUGIN_MODULES) {
    for (const [type, component] of Object.entries(p.cards ?? {})) {
      out[type] = component;
    }
  }
  return out;
}

/** Settings panels for plugins the user has installed.
 *
 *  Keyed off INSTALLED rather than active, so a plugin that is switched off can
 *  still be configured — you often need to set a plugin up before turning it on,
 *  and hiding its settings the moment it is disabled is a dead end. */
export function pluginSettingsPanels(
  installed: (id: string) => boolean,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Array<{ id: string; panel: Component<any> }> {
  return PLUGIN_MODULES.filter((p) => p.settingsPanel && installed(p.id)).map((p) => ({
    id: p.id,
    // Non-null: filtered on it directly above.
    panel: p.settingsPanel!,
  }));
}

/** System-prompt blocks contributed by the plugins active right now.
 *  Each module does its own active check, so an inactive plugin says nothing. */
export function pluginContexts(s: Settings, consent: TurnConsent): string[] {
  return PLUGIN_MODULES.map((p) => p.context?.(s, consent))
    .map((t) => t?.trim())
    .filter((t): t is string => !!t);
}
