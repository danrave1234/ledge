import { writable } from "svelte/store";
import type { Memory, Settings } from "../types";
import { getProvider } from "../providers";
import { openaiProvider } from "../providers/openai";
import { uid } from "./persistence";

export const CURRENT_SCHEMA = 11;

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: CURRENT_SCHEMA,
  lastVersion: "",
  safetyId: uid(),
  placement: "top",
  handle: "bar",
  providerId: openaiProvider.id,
  model: openaiProvider.defaultModel,
  effort: "",
  personaId: "default",
  theme: "system",
  hoverOpen: true,
  hoverOpenDelay: 0.5,
  autostart: false,
  hotkey: "CommandOrControl+Shift+Space",
  musicConfirmed: false,
  // On by default: the widget's whole point is being reachable without leaving
  // what you're doing, and games are exactly when alt-tabbing hurts most.
  gameMode: true,
  clearCacheOnLaunch: true,
  // Empty by default on both counts: core plugins are implicitly installed
  // (see plugins.ts `isCorePlugin`) and every plugin is enabled unless it has an
  // explicit `false` here, so listing defaults would just be a second source of
  // truth that can drift.
  plugins: {},
  installedPlugins: [],
  customModels: [],
  modelByProvider: {},
  fetchedModels: [],
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

/** Record the user's model choice for a provider and switch to it.
 *  Every model pick goes through here so the choice is remembered per provider
 *  — a provider can never be paired with another provider's model ID, and
 *  switching away and back restores what the user actually chose. */
export function selectModel(providerId: string, model: string) {
  settings.update((s) => ({
    ...s,
    providerId,
    model,
    modelByProvider: { ...s.modelByProvider, [providerId]: model },
  }));
}

/** Switch provider, restoring the model the user last used with it (falling
    back to that provider's default the first time). */
export function setProvider(id: string) {
  settings.update((s) => {
    const model = s.modelByProvider?.[id] || getProvider(id).defaultModel;
    return {
      ...s,
      providerId: id,
      model,
      modelByProvider: { ...s.modelByProvider, [id]: model },
    };
  });
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
  settings.update((s) => {
    const plugins = { ...s.plugins };
    delete plugins[id];
    return {
      ...s,
      plugins,
      installedPlugins: (s.installedPlugins ?? []).filter((x) => x !== id),
    };
  });
}

/* ---------- models: live-fetched (OpenAI) + user custom ---------- */

/** Cache the live model list in settings, so it survives a restart. It used to
    be an in-memory store: after a relaunch the picker silently fell back to the
    static list, and a model fetched from the API was no longer listed. */
export function setFetchedModels(ids: string[]) {
  updateSettings({ fetchedModels: ids });
}

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
/** Put a deleted memory back at its old position (undo). */
export function restoreMemory(memory: Memory, index: number) {
  settings.update((s) => {
    const list = (s.memories ?? []).filter((m) => m.id !== memory.id);
    list.splice(Math.min(index, list.length), 0, memory);
    return { ...s, memories: list };
  });
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
