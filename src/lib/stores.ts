import { writable, get } from "svelte/store";
import type { Settings, Msg, Conversation, Persona } from "./types";
import { BUILTIN_PERSONAS } from "./personas";
import { isTauri } from "./native";

const hasWindow = typeof window !== "undefined";

const K_SETTINGS = "perch.settings";
const K_PERSONAS = "perch.personas";
const K_CONV = "perch.conversations";

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/* ---------- durable persistence backend ----------
   In the desktop app, data lives in the OS app-data folder (survives a
   WebView2 cache clear). In the browser preview it falls back to localStorage. */
async function readRaw(key: string): Promise<string | null> {
  try {
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      return (await invoke<string | null>("store_read", { key })) ?? null;
    }
    if (hasWindow) return localStorage.getItem(key);
  } catch (e) {
    console.error("readRaw failed", key, e);
  }
  return null;
}

async function writeRaw(key: string, value: string): Promise<boolean> {
  try {
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("store_write", { key, value });
      return true;
    }
    if (hasWindow) {
      localStorage.setItem(key, value);
      return true;
    }
  } catch (e) {
    console.error("writeRaw failed", key, e);
  }
  return false;
}

// True unless a migration write failed — the launch cache-clear checks this so
// it can never wipe localStorage data that didn't make it into the durable store.
let migrationOk = true;
export function cacheClearSafe(): boolean {
  return migrationOk;
}

// Prefer durable store; migrate any legacy localStorage value from older builds.
async function loadWithMigration(key: string): Promise<string | null> {
  const durable = await readRaw(key);
  if (durable != null) return durable;
  if (isTauri() && hasWindow) {
    try {
      const legacy = localStorage.getItem(key);
      if (legacy != null) {
        const ok = await writeRaw(key, legacy);
        if (!ok) migrationOk = false;
        return legacy;
      }
    } catch {
      migrationOk = false;
    }
  }
  return null;
}

export const DEFAULT_SETTINGS: Settings = {
  placement: "top",
  handle: "spark",
  providerId: "mock",
  model: "mock-smart",
  personaId: "default",
  theme: "system",
  hoverOpen: true,
  autostart: false,
  hotkey: "Alt+Space",
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

/* ---------- stores (defaults until hydrated) ---------- */
export const settings = writable<Settings>({ ...DEFAULT_SETTINGS });
export const customPersonas = writable<Persona[]>([]);
export const conversations = writable<Conversation[]>([]);

function applyTheme(mode: Settings["theme"]) {
  if (!hasWindow) return;
  const root = document.documentElement;
  if (mode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
}

function applyCustomCss(css: string) {
  if (!hasWindow) return;
  let el = document.getElementById("perch-custom-css") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "perch-custom-css";
    document.head.appendChild(el);
  }
  el.textContent = css;
}

function hexAlpha(hex: string, a: number): string {
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function applyAccent(color: string) {
  if (!hasWindow) return;
  const root = document.documentElement;
  if (color && /^#[0-9a-fA-F]{3,8}$/.test(color)) {
    root.style.setProperty("--accent", color);
    root.style.setProperty("--accent-strong", color);
    root.style.setProperty("--accent-text", color);
    root.style.setProperty("--accent-weak", hexAlpha(color, 0.14));
  } else {
    for (const p of ["--accent", "--accent-strong", "--accent-text", "--accent-weak"]) {
      root.style.removeProperty(p);
    }
  }
}

let hydrated = false;
let hydrating = false;

export async function hydrate(): Promise<void> {
  if (hydrated || hydrating) return;
  hydrating = true;

  const s = await loadWithMigration(K_SETTINGS);
  if (s) {
    try {
      const parsed = JSON.parse(s);
      if (parsed && typeof parsed === "object")
        settings.set({ ...DEFAULT_SETTINGS, ...parsed });
    } catch {
      /* keep defaults */
    }
  }
  const p = await loadWithMigration(K_PERSONAS);
  if (p) {
    try {
      const parsed = JSON.parse(p);
      if (Array.isArray(parsed)) customPersonas.set(parsed);
    } catch {
      /* ignore */
    }
  }
  const c = await loadWithMigration(K_CONV);
  if (c) {
    try {
      const parsed = JSON.parse(c);
      if (Array.isArray(parsed)) conversations.set(parsed);
    } catch {
      /* ignore */
    }
  }

  applyTheme(get(settings).theme);
  applyCustomCss(get(settings).customCss);
  applyAccent(get(settings).accent);
  hydrated = true;

  settings.subscribe((v) => {
    applyTheme(v.theme);
    applyCustomCss(v.customCss);
    applyAccent(v.accent);
    if (hydrated) writeRaw(K_SETTINGS, JSON.stringify(v));
  });
  customPersonas.subscribe((v) => {
    if (hydrated) writeRaw(K_PERSONAS, JSON.stringify(v));
  });
  conversations.subscribe((v) => {
    if (hydrated) writeRaw(K_CONV, JSON.stringify(v));
  });
}

export function updateSettings(patch: Partial<Settings>) {
  settings.update((s) => ({ ...s, ...patch }));
}

/* ---------- ui ---------- */
export type View = "chat" | "settings" | "history" | "personas" | "plugins";

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
export interface UiState {
  expanded: boolean;
  pinned: boolean;
  view: View;
  generating: boolean;
}
export const ui = writable<UiState>({
  expanded: false,
  pinned: false,
  view: "chat",
  generating: false,
});

/* ---------- canvas (expandable output container) ---------- */
export const canvas = writable<{ open: boolean; lang: string; code: string }>({
  open: false,
  lang: "",
  code: "",
});
export function openCanvas(lang: string, code: string) {
  canvas.set({ open: true, lang, code });
}
export function closeCanvas() {
  canvas.update((c) => ({ ...c, open: false }));
}

/* ---------- auto-update indicator ---------- */
export const updateAvailable = writable(false);

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

/* ---------- conversations ---------- */
export const messages = writable<Msg[]>([]);
export const activeId = writable<string | null>(null);

export function newChat() {
  messages.set([]);
  activeId.set(null);
}

export function saveActive() {
  const msgs = get(messages);
  if (msgs.length === 0) return;
  const id = get(activeId) ?? uid();
  activeId.set(id);
  const firstUser = msgs.find((m) => m.role === "user");
  const title = (firstUser?.content ?? "New chat").slice(0, 48);
  const now = Date.now();
  conversations.update((list) => {
    const existing = list.find((c) => c.id === id);
    if (existing) {
      return list.map((c) =>
        c.id === id ? { ...c, messages: msgs, title, updatedAt: now } : c,
      );
    }
    return [
      { id, title, messages: msgs, createdAt: now, updatedAt: now },
      ...list,
    ];
  });
}

export function openConversation(id: string) {
  const conv = get(conversations).find((c) => c.id === id);
  if (!conv) return;
  messages.set([...conv.messages]);
  activeId.set(id);
}

export function deleteConversation(id: string) {
  conversations.update((list) => list.filter((c) => c.id !== id));
  if (get(activeId) === id) newChat();
}

export function clearHistory() {
  conversations.set([]);
  newChat();
}

/* ---------- personas ---------- */
export function allPersonas(): Persona[] {
  return [...BUILTIN_PERSONAS, ...get(customPersonas)];
}

export function getPersona(id: string): Persona {
  return allPersonas().find((p) => p.id === id) ?? BUILTIN_PERSONAS[0];
}

export function upsertPersona(p: Persona) {
  customPersonas.update((list) => {
    const exists = list.some((x) => x.id === p.id);
    return exists ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p];
  });
}

export function deletePersona(id: string) {
  customPersonas.update((list) => list.filter((p) => p.id !== id));
  if (get(settings).personaId === id) {
    settings.update((s) => ({ ...s, personaId: "default" }));
  }
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
