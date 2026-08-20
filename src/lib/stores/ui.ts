import { writable } from "svelte/store";

/* ---------- ui state ---------- */
export type View = "chat" | "settings" | "history" | "personas";

export interface UiState {
  expanded: boolean;
  pinned: boolean;
  view: View;
  /** Which Settings section is open. Lives here, not inside SettingsView: the
      panel is destroyed while collapsed, so component-local state would reset
      every time the widget closed and you'd land back on General. */
  settingsSection: string;
  generating: boolean;
  /** What the model is doing between tokens — "Searching the web" while a tool
      runs, null otherwise. Without it a multi-round turn looks frozen for
      several seconds. Transient: never persisted with the conversation. */
  activity: string | null;
  /** True while the native window is being resized between handle and panel.
      Nothing is rendered during that gap — drawing either the panel or the
      handle at the wrong window size is what caused ghost bars and flicker. */
  resizing: boolean;
}
export const ui = writable<UiState>({
  expanded: false,
  pinned: false,
  view: "chat",
  settingsSection: "general",
  generating: false,
  activity: null,
  resizing: false,
});

export function setSettingsSection(settingsSection: string) {
  ui.update((u) => ({ ...u, settingsSection }));
}

/* ---------- canvas (expandable output / image viewer) ---------- */
export const canvas = writable<{
  open: boolean;
  lang: string;
  code: string;
  image?: string;
}>({
  open: false,
  lang: "",
  code: "",
});
export function openCanvas(lang: string, code: string) {
  canvas.set({ open: true, lang, code });
}
export function openImage(url: string) {
  canvas.set({ open: true, lang: "screen", code: "", image: url });
}
export function closeCanvas() {
  canvas.update((c) => ({ ...c, open: false }));
}

/* ---------- auto-update indicator ---------- */
export const updateAvailable = writable(false);
