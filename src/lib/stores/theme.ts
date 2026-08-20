import type { Settings } from "../types";
import { hasWindow } from "./persistence";

export function applyTheme(mode: Settings["theme"]) {
  if (!hasWindow) return;
  const root = document.documentElement;
  if (mode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
}

/** Remove the stylesheet injected by the retired Custom CSS setting. Older
    builds wrote user CSS into this element; a store from one of those builds is
    migrated, but a live element can also linger in a warm WebView. */
export function removeLegacyCustomCss() {
  if (!hasWindow) return;
  document.getElementById("perch-custom-css")?.remove();
}

const ACCENT_VARS = [
  "--accent",
  "--accent-strong",
  "--accent-text",
  "--accent-weak",
  "--accent-on",
];

function rgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "").slice(0, 6);
  const full =
    m.length === 3
      ? m
          .split("")
          .map((c) => c + c)
          .join("")
      : m;
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ];
}

function rgba([r, g, b]: [number, number, number], a: number): string {
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Perceived brightness (ITU-R BT.601), 0–255. */
function luminance([r, g, b]: [number, number, number]): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Scale a channel toward white (amount > 0) or black (amount < 0). */
function shift([r, g, b]: [number, number, number], amount: number): string {
  const f = (c: number) =>
    Math.round(amount > 0 ? c + (255 - c) * amount : c * (1 + amount));
  return `rgb(${f(r)}, ${f(g)}, ${f(b)})`;
}

/** Apply a user-chosen accent by deriving the whole accent ramp from it.
 *
 *  Every derived value matters: --accent-strong drives hover feedback (a flat
 *  copy of --accent makes buttons feel dead) and --accent-on is the text drawn
 *  ON the accent, so a light accent like amber needs dark text to stay legible. */
export function applyAccent(color: string) {
  if (!hasWindow) return;
  const root = document.documentElement;
  if (!color || !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) {
    for (const p of ACCENT_VARS) root.style.removeProperty(p);
    return;
  }
  const c = rgb(color);
  const light = luminance(c) > 150;
  root.style.setProperty("--accent", color);
  root.style.setProperty("--accent-strong", shift(c, light ? -0.14 : 0.16));
  root.style.setProperty("--accent-text", color);
  root.style.setProperty("--accent-weak", rgba(c, 0.14));
  root.style.setProperty("--accent-on", light ? "#141210" : "#fff");
}
