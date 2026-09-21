import type { PluginModule } from "../types";
import OpenPathCard from "./OpenPathCard.svelte";
import { PLUGIN_ID, folderFinderTools } from "./tools";
import { pluginActive } from "../../plugins";

export const folderFinderPlugin: PluginModule = {
  id: PLUGIN_ID,
  tools: folderFinderTools,
  cards: {
    path_open: OpenPathCard,
  },
  context(s) {
    return pluginActive(s, PLUGIN_ID)
      ? "Finding folders and files is approval-based. When the user asks to find, locate, open, or show a folder or file on their PC, you MUST call `open_path` with the name they used; never merely say you opened it or describe how to find it yourself. `open_path` only creates a card the user must approve, so never claim the path is open. If the user only wants to see the address without opening, call `find_path` instead. Do not use these tools for applications; use `open_app` for those."
      : null;
  },
};
