import { writable } from "svelte/store";

/* ---------- ui state ---------- */
export type View = "chat" | "settings" | "history" | "personas" | "plugins";

export interface UiState {
  expanded: boolean;
  pinned: boolean;
  view: View;
  generating: boolean;
  /** True while the native window is being resized between handle and panel.
      Nothing is rendered during that gap — drawing either the panel or the
      handle at the wrong window size is what caused ghost bars and flicker. */
  resizing: boolean;
}
export const ui = writable<UiState>({
  expanded: false,
  pinned: false,
  view: "chat",
  generating: false,
  resizing: false,
});

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
