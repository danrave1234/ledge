import type { PluginModule } from "../types";
import InsertTextCard from "./InsertTextCard.svelte";
import NavigateBrowserCard from "./NavigateBrowserCard.svelte";
import ComputerActionsCard from "./ComputerActionsCard.svelte";
import { computerControlTools } from "./tools";
import { pluginActive } from "../../plugins";

export const computerControlPlugin: PluginModule = {
  id: "computer-control",
  tools: computerControlTools,
  cards: {
    computer_insert_text: InsertTextCard,
    computer_navigate_browser: NavigateBrowserCard,
    computer_actions: ComputerActionsCard,
  },
  context(s) {
    return pluginActive(s, "computer-control")
      ? "Computer control is approval-based. You MUST call `prepare_text_insertion` for text in the already-focused field and MUST call `prepare_browser_navigation` for an exact URL. For visible buttons, links, controls, multiple fields, keyboard navigation, or scrolling, first use `read_screen` when available, then you MUST call `prepare_computer_actions` with a short bounded plan. Click coordinates are normalized to the previously focused window. Never merely print instructions or refer to a card: call the matching tool so its preview exists. The user must approve the card. Never include sending, submitting, purchasing, deleting, authentication, or passwords in a general action plan, and never claim an action happened merely because you created a preview."
      : null;
  },
};
