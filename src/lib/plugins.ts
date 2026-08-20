export interface PerchPlugin {
  id: string;
  name: string;
  description: string;
  icon: string; // Icon.svelte name
}

// First-party plugins. The plugin host keeps the core small — each capability
// here can be toggled off, and third-party plugins can register the same shape.
export const BUILTIN_PLUGINS: PerchPlugin[] = [
  {
    id: "web-search",
    name: "Web search",
    description:
      "Pull live results from the web (DuckDuckGo) and fold them into the answer when the Web toggle is on.",
    icon: "web",
  },
  {
    id: "screen-context",
    name: "Screen context",
    description:
      "Let Perch see your screen when you ask — opt-in per message via the Screen toggle.",
    icon: "screen",
  },
  {
    id: "music",
    name: "Music",
    description:
      "See what you're listening to and control playback — Spotify, YouTube Music, a browser tab, any player. Controlling playback needs the Music toggle on.",
    icon: "music",
  },
  {
    id: "job-analyzer",
    name: "Job analyzer",
    description:
      "Surface the “Is this job applicable?” quick action for assessing a posting against your background.",
    icon: "user",
  },
  {
    id: "computer-control",
    name: "Computer control",
    description:
      "Let Perch prepare text for the field you were using, then insert it only after you approve the exact target and text.",
    icon: "screen",
  },
];

export function pluginEnabled(
  plugins: Record<string, boolean> | undefined,
  id: string,
): boolean {
  // Default to enabled unless explicitly turned off.
  return plugins?.[id] !== false;
}

// Core plugins ship with the app and are installed by default (still toggleable,
// but not removable). Everything else uses the install-to-enable model.
const CORE_PLUGINS = ["web-search", "screen-context"];
export function isCorePlugin(id: string): boolean {
  return CORE_PLUGINS.includes(id);
}

export function pluginInstalled(installed: string[] | undefined, id: string): boolean {
  return isCorePlugin(id) || (installed ?? []).includes(id);
}

// A plugin's capability/UI only counts when it's installed AND enabled.
export function pluginActive(
  s: { installedPlugins?: string[]; plugins?: Record<string, boolean> },
  id: string,
): boolean {
  return pluginInstalled(s.installedPlugins, id) && pluginEnabled(s.plugins, id);
}
