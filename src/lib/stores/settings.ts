import { writable } from "svelte/store";
import type { Settings } from "../types";
import { uid } from "./persistence";

export const CURRENT_SCHEMA = 3;

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: CURRENT_SCHEMA,
  placement: "top",
  handle: "bar",
  providerId: "openai",
  model: "gpt-5.6-sol",
  effort: "",
  personaId: "default",
  theme: "system",
  hoverOpen: true,
  autostart: false,
  hotkey: "CommandOrControl+Shift+Space",
  webSearch: false,
  screenContext: false,
  gameMode: false,
  clearCacheOnLaunch: true,
  plugins: { "web-search": true, "screen-context": true, "job-analyzer": true },
  installedPlugins: ["job-analyzer"],
  customModels: [],
  customCss: "",
  accent: "",
  onboarded: false,
  about: "",
  style: "",
  memories: [],
};

export const settings = writable<Settings>({ ...DEFAULT_SETTINGS });

export function updateSettings(patch: Partial<Settings>) {
  settings.update((s) => ({ ...s, ...patch }));
}

/* ---------- plugins (install-to-enable) ---------- */
export function togglePlugin(id: string) {
  settings.update((s) => {
    const enabled = s.plugins?.[id] !== false;
    return { ...s, plugins: { ...s.plugins, [id]: !enabled } };
  });
}

export function installPlugin(id: string) {
  settings.update((s) => {
    const installed = s.installedPlugins ?? [];
    if (installed.includes(id)) return s;
    return {
      ...s,
      installedPlugins: [...installed, id],
      plugins: { ...s.plugins, [id]: true },
    };
  });
}

export function uninstallPlugin(id: string) {
  settings.update((s) => ({
    ...s,
    installedPlugins: (s.installedPlugins ?? []).filter((x) => x !== id),
  }));
}

/* ---------- models: live-fetched (OpenAI) + user custom ---------- */
export const fetchedModels = writable<string[]>([]);
export function addCustomModel(id: string) {
  const t = id.trim();
  if (!t) return;
  settings.update((s) => {
    const list = s.customModels ?? [];
    return list.includes(t) ? s : { ...s, customModels: [...list, t] };
  });
}
export function removeCustomModel(id: string) {
  settings.update((s) => ({
    ...s,
    customModels: (s.customModels ?? []).filter((m) => m !== id),
  }));
}

/* ---------- personalization (ChatGPT-style memory + instructions) ---------- */
export function addMemory(text: string) {
  const t = text.trim();
  if (!t) return;
  settings.update((s) => ({
    ...s,
    memories: [...(s.memories ?? []), { id: uid(), text: t, enabled: true }],
  }));
}
export function importMemories(block: string): number {
  const lines = block
    .split(/\r?\n+/)
    .map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter(Boolean);
  if (!lines.length) return 0;
  settings.update((s) => ({
    ...s,
    memories: [
      ...(s.memories ?? []),
      ...lines.map((text) => ({ id: uid(), text, enabled: true })),
    ],
  }));
  return lines.length;
}
export function toggleMemory(id: string) {
  settings.update((s) => ({
    ...s,
    memories: (s.memories ?? []).map((m) =>
      m.id === id ? { ...m, enabled: !m.enabled } : m,
    ),
  }));
}
export function deleteMemory(id: string) {
  settings.update((s) => ({
    ...s,
    memories: (s.memories ?? []).filter((m) => m.id !== id),
  }));
}

export function completeOnboarding() {
  settings.update((s) => ({ ...s, onboarded: true }));
}
export function reopenLogin() {
  settings.update((s) => ({ ...s, onboarded: false }));
}
