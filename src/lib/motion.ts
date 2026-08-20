/** Motion constants for Svelte transitions.
 *
 *  Mirrors the CSS duration tokens in `tokens.css` (--dur-fast / --dur /
 *  --dur-slow) so a JS transition and a CSS transition on the same element
 *  never disagree. Components import these instead of typing raw numbers.
 *
 *  CSS handles `prefers-reduced-motion` globally; Svelte transitions are short
 *  enough that the fade/fly distances below stay comfortable either way. */

import { cubicOut } from "svelte/easing";

const DUR_FAST = 120;
export const DUR = 160;
export const DUR_SLOW = 220;

export const EASE = cubicOut;

/** View/overlay crossfade. */
export const fadeIn = { duration: DUR_FAST };
/** Panel + overlay entrance. */
export const fadeOverlay = { duration: DUR };
/** Message / list-item entrance. */
export const flyIn = { y: 10, duration: DUR_SLOW, easing: EASE };
/** Menu pop. */
export const scaleIn = { duration: DUR_FAST, start: 0.95, opacity: 0 };
/** A strip appearing/disappearing in the layout (the now-playing dock), where
    the neighbours have to move out of the way rather than be overlapped. */
export const slideIn = { duration: DUR, easing: EASE };
