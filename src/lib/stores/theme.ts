import type { Settings } from "../types";
import { hasWindow } from "./persistence";

export function applyTheme(mode: Settings["theme"]) {
  if (!hasWindow) return;
  const root = document.documentElement;
  if (mode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
}

export function applyCustomCss(css: string) {
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

export function applyAccent(color: string) {
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
