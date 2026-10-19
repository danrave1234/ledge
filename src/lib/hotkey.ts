/** Global-hotkey recording: turn a keydown into a Tauri accelerator string.
 *
 *  The hotkey used to be a free-text field, and every keystroke re-registered
 *  a global shortcut from a half-typed string ("Comm", "CommandOr…"). Recording
 *  the combination the user actually presses removes both the typos and that
 *  churn: the setting only changes once a complete, valid combo exists. */

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "OS", "AltGraph"]);

/** Keys whose `KeyboardEvent.code` maps to an accelerator name. */
const NAMED: Record<string, string> = {
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
};

export type HotkeyResult =
  | { kind: "pending" } // only modifiers so far
  | { kind: "invalid"; reason: string }
  | { kind: "ok"; accelerator: string };

type KeyLike = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey"
>;

/** The main (non-modifier) key as an accelerator token, or null if unsupported. */
function mainKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`;
  return NAMED[code] ?? null;
}

/** Interpret a keydown while recording. Requires at least one of Ctrl/Alt/Win
 *  (Shift alone would hijack ordinary typing), except for F-keys. */
export function hotkeyFromEvent(e: KeyLike): HotkeyResult {
  if (MODIFIER_KEYS.has(e.key)) return { kind: "pending" };
  const key = mainKey(e.code);
  if (!key) return { kind: "invalid", reason: "That key can't be used in a shortcut." };
  const isFn = /^F\d+$/.test(key);
  if (!isFn && !e.ctrlKey && !e.altKey && !e.metaKey) {
    return { kind: "invalid", reason: "Hold Ctrl, Alt, or Win with another key." };
  }
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("CommandOrControl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Super");
  parts.push(key);
  return { kind: "ok", accelerator: parts.join("+") };
}

/** Human label for an accelerator: "CommandOrControl+Shift+Space" → "Ctrl + Shift + Space". */
export function hotkeyLabel(accelerator: string): string[] {
  if (!accelerator) return [];
  return accelerator
    .split("+")
    .map((p) =>
      p === "CommandOrControl" || p === "CmdOrCtrl" || p === "Control"
        ? "Ctrl"
        : p === "Super"
          ? "Win"
          : p,
    );
}
