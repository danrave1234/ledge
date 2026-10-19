/** Motion presets for Svelte transitions.
 *
 *  Mirrors the CSS duration/easing tokens in `tokens.css` (--dur-fast / --dur /
 *  --dur-slow / --dur-enter, --ease) so a JS transition and a CSS transition on
 *  the same element never disagree. Components import these instead of typing
 *  raw numbers.
 *
 *  Every preset is a FUNCTION so it can honour `prefers-reduced-motion` at the
 *  moment the transition runs: the global CSS rule in tokens.css only reaches
 *  CSS transitions/animations, never Svelte's JS-driven ones. With reduced
 *  motion on, presets keep their opacity change but drop movement and run
 *  near-instantly. */

import { cubicOut, backOut } from "svelte/easing";

const DUR_FAST = 120;
export const DUR = 160;
export const DUR_SLOW = 220;
const DUR_ENTER = 260;

export const EASE = cubicOut;

/** True when the OS asks for less motion. Safe outside a browser. */
export function reduceMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Duration that collapses to ~0 under reduced motion. */
function d(ms: number): number {
  return reduceMotion() ? 1 : ms;
}
/** Distance that collapses to 0 under reduced motion. */
function px(n: number): number {
  return reduceMotion() ? 0 : n;
}

export type Edge = "top" | "left" | "right";

/** View/overlay crossfade. */
export const fadeIn = () => ({ duration: d(DUR_FAST) });
/** Overlay entrance (onboarding, empty state). */
export const fadeOverlay = () => ({ duration: d(DUR) });
/** Message / list-item entrance. */
export const flyIn = () => ({ y: px(8), duration: d(DUR_SLOW), easing: EASE });
/** Staggered list entrance — `i` is the item's position. */
export const stagger = (i: number, step = 40) => ({
  y: px(8),
  duration: d(DUR_SLOW),
  delay: reduceMotion() ? 0 : Math.min(i, 8) * step,
  easing: EASE,
});
/** Menu / popover pop: a small scale with a hint of overshoot. */
export const popIn = () => ({
  duration: d(DUR),
  start: reduceMotion() ? 1 : 0.94,
  opacity: 0,
  easing: backOut,
});
/** The panel sliding out of the screen edge it is docked to. */
export function panelIn(edge: Edge) {
  const dist = px(10);
  return {
    // `0 - dist`, not `-dist`: under reduced motion dist is 0 and -0 is a
    // distinct value that leaks into the transform string.
    x: edge === "left" ? 0 - dist : edge === "right" ? dist : 0,
    y: edge === "top" ? 0 - dist : 0,
    opacity: 0,
    duration: d(DUR_ENTER),
    easing: EASE,
  };
}
/** Moving between views: forward slides in from the right, back from the left. */
export const viewIn = (dir: 1 | -1 = 1) => ({
  x: px(14 * dir),
  duration: d(DUR_SLOW),
  easing: EASE,
});
/** A strip appearing/disappearing in the layout (the now-playing dock, composer
    banners), where neighbours move out of the way rather than be overlapped. */
export const slideIn = () => ({ duration: d(DUR), easing: EASE });
/** Toast rising from the bottom edge. */
export const toastIn = () => ({ y: px(12), duration: d(DUR_SLOW), easing: backOut });
/** How long the panel's exit animation runs before the window shrinks. */
export const PANEL_EXIT_MS = DUR_FAST;
