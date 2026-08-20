import type { PluginModule } from "../types";
import InsertTextCard from "./InsertTextCard.svelte";
import { computerControlTools } from "./tools";

export const computerControlPlugin: PluginModule = {
  id: "computer-control",
  tools: computerControlTools,
  cards: { computer_insert_text: InsertTextCard },
  context(s) {
    return s.installedPlugins?.includes("computer-control") &&
      s.plugins?.["computer-control"] !== false
      ? "Computer control is approval-based. When the user asks you to write, fill, type, or insert text into another app, you MUST call `prepare_text_insertion` with the complete text so the preview card actually exists; never merely print the text and refer to a card. The user must press Insert on that card. Never claim it was inserted merely because you created a preview."
      : null;
  },
};
