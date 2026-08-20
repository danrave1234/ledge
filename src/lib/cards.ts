import type { Component } from "svelte";
import type { MsgCard } from "./types";
import { allPluginCards } from "./plugins/registry";

/* ==========================================================================
   Interactive result cards.

   A tool can attach a card to the message it produced, so a reply can end in
   BUTTONS rather than a paragraph asking the user to type their choice back.
   Clicking one calls into `native` directly — no model round-trip — which makes
   the action instant, free, and impossible to hallucinate into the wrong target.

   Two rules:
     - A renderer displays `data` through normal Svelte templating. Card data
       carries remote text (track titles, playlist names from a music service),
       so `{@html}` here would be the same injection hole `renderMd` exists to
       close for model output.
     - An unknown card type renders nothing. Cards persist with the conversation,
       so a build that has dropped a plugin will read cards it no longer knows.
   ========================================================================== */

// Built once from the plugin registry. Includes cards from INACTIVE plugins on
// purpose: a card stored in an old conversation should still draw after its
// plugin is switched off — gating governs what new cards can be created, not
// whether history remains readable.
const REGISTRY = allPluginCards();

/** The renderer for a card, or undefined when this build has none. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function cardComponent(type: string): Component<any> | undefined {
  return REGISTRY[type];
}

/** Cards this build can actually draw. Filtering here keeps the "does anything
    render?" test in one place instead of in every consumer. */
export function renderableCards(cards: MsgCard[] | undefined): MsgCard[] {
  return (cards ?? []).filter((c) => !!c && !!cardComponent(c.type));
}
