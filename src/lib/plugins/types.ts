import type { Component } from "svelte";
import type { PerchTool } from "../tools";
import type { Settings, TurnConsent } from "../types";

/* ==========================================================================
   What a plugin can contribute.

   `lib/plugins.ts` is the CATALOG — the id, name, description and icon the
   Settings list renders, plus the install/enable gating. It stays free of
   imports so anything may depend on it.

   This is the other half: the code a plugin actually contributes to the
   running app. Modules are aggregated in `registry.ts`, which is the single
   place that knows every plugin; `tools.ts`, `cards.ts` and the prompt builder
   all read from there rather than keeping their own hardcoded lists.

   A module must import from `../plugins` (the catalog) and use `import type`
   for anything in `../tools` — the runtime import graph has to stay acyclic,
   because `tools.ts` reads the registry.
   ========================================================================== */

export interface PluginModule {
  /** Matches an entry in BUILTIN_PLUGINS. The catalog owns the display copy. */
  id: string;

  /** Tools this plugin offers the model. Each does its own gating in
      `available()` — the plugin being active is necessary, not sufficient. */
  tools?: PerchTool[];

  /** A block of system prompt contributed while the plugin is active.
   *
   *  Returns null to contribute nothing. Use it for standing facts or rules the
   *  model needs whenever the capability exists — NOT for data, which belongs
   *  in a tool result where it can be marked untrusted. */
  context?(s: Settings, consent: TurnConsent): string | null;

  /** Renderers for the interactive cards this plugin's tools attach, keyed by
      the card `type`. See `lib/cards.ts`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cards?: Record<string, Component<any>>;

  /** Rendered under the plugin's card in Settings → Plugins, once installed.
      For the plugin's own configuration — accounts, keys, preferences — which
      lives in its own state file, not in `Settings`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settingsPanel?: Component<any>;
}
