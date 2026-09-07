import type { PluginModule } from "../types";
import OpenAppCard from "./OpenAppCard.svelte";
import { PLUGIN_ID, appLauncherTools } from "./tools";
import { pluginActive } from "../../plugins";

export const appLauncherPlugin: PluginModule = {
  id: PLUGIN_ID,
  tools: appLauncherTools,
  cards: {
    app_launch: OpenAppCard,
  },
  context(s) {
    return pluginActive(s, PLUGIN_ID)
      ? "Opening apps is approval-based. When the user asks to open, launch, start, or run an installed application, you MUST call `open_app` with the name they used; never merely say you opened it or describe how to open it yourself. `open_app` only creates a card the user must approve, so never claim the app is open. If it reports no match, call `list_installed_apps` to find the real name or tell the user it is not installed. Web addresses are browser navigation, not apps."
      : null;
  },
};
