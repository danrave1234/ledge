import { writable, get } from "svelte/store";

/* ==========================================================================
   Toasts: brief, non-blocking confirmations at the bottom of the panel.

   The main use is UNDO. Deleting a conversation, memory, or persona used to be
   instant and permanent with no confirm — easy to do by accident on a small
   widget. Asking "are you sure?" every time is the annoying alternative; an
   undo toast is the friendly one: the item disappears immediately, and the
   irreversible part (`commit`, e.g. deleting stored images) only runs once the
   toast is gone without Undo being pressed.
   ========================================================================== */

/** How long a toast stays up. Undo toasts get longer — reaching for the button
    takes a moment. */
const TOAST_MS = 2600;
const UNDO_MS = 5000;

export interface Toast {
  id: number;
  message: string;
  tone: "neutral" | "ok" | "error";
  actionLabel?: string;
}

interface Entry extends Toast {
  timer: ReturnType<typeof setTimeout>;
  action?: () => void;
  commit?: () => void;
}

let seq = 0;
const entries = new Map<number, Entry>();
export const toasts = writable<Toast[]>([]);

function publish() {
  toasts.set(
    [...entries.values()].map(({ id, message, tone, actionLabel }) => ({
      id,
      message,
      tone,
      actionLabel,
    })),
  );
}

/** Show a toast. Only the newest few are kept; older ones finish (commit) early. */
export function toast(
  message: string,
  opts: {
    tone?: Toast["tone"];
    actionLabel?: string;
    action?: () => void;
    commit?: () => void;
    ms?: number;
  } = {},
): number {
  const id = ++seq;
  const ms = opts.ms ?? (opts.action ? UNDO_MS : TOAST_MS);
  entries.set(id, {
    id,
    message,
    tone: opts.tone ?? "neutral",
    actionLabel: opts.actionLabel,
    action: opts.action,
    commit: opts.commit,
    timer: setTimeout(() => dismissToast(id), ms),
  });
  // A stack of undo toasts is noise — keep the latest two.
  const MAX_VISIBLE = 2;
  while (entries.size > MAX_VISIBLE) dismissToast(entries.keys().next().value!);
  publish();
  return id;
}

/** Undo-style toast: `undo` reverses the change; `commit` finalises it. */
export function toastUndo(message: string, undo: () => void, commit?: () => void) {
  return toast(message, { actionLabel: "Undo", action: undo, commit });
}

/** Remove a toast. Runs its commit unless the action was taken. */
export function dismissToast(id: number, acted = false) {
  const e = entries.get(id);
  if (!e) return;
  clearTimeout(e.timer);
  entries.delete(id);
  if (acted) e.action?.();
  else e.commit?.();
  publish();
}

export function runToastAction(id: number) {
  dismissToast(id, true);
}

/** Finalise everything now (before quit), so nothing pending is lost. */
export function flushToasts() {
  for (const id of [...entries.keys()]) dismissToast(id);
}

/** Test helper. */
export function _toastIds(): number[] {
  return get(toasts).map((t) => t.id);
}
