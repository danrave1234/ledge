import { describe, expect, it } from "vitest";
import { hotkeyFromEvent, hotkeyLabel } from "./hotkey";

const key = (
  code: string,
  mods: Partial<Record<"ctrlKey" | "shiftKey" | "altKey" | "metaKey", boolean>> = {},
  k = code,
) => ({
  key: k,
  code,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

describe("hotkeyFromEvent", () => {
  it("records a modifier combination as a Tauri accelerator", () => {
    expect(hotkeyFromEvent(key("Space", { ctrlKey: true, shiftKey: true }))).toEqual({
      kind: "ok",
      accelerator: "CommandOrControl+Shift+Space",
    });
    expect(hotkeyFromEvent(key("KeyK", { altKey: true }))).toEqual({
      kind: "ok",
      accelerator: "Alt+K",
    });
    expect(hotkeyFromEvent(key("Digit3", { metaKey: true }))).toEqual({
      kind: "ok",
      accelerator: "Super+3",
    });
  });

  it("keeps waiting while only modifiers are held", () => {
    expect(hotkeyFromEvent(key("ControlLeft", { ctrlKey: true }, "Control"))).toEqual({
      kind: "pending",
    });
    expect(hotkeyFromEvent(key("ShiftLeft", { shiftKey: true }, "Shift"))).toEqual({
      kind: "pending",
    });
  });

  it("rejects bare keys and Shift-only combos that would hijack typing", () => {
    expect(hotkeyFromEvent(key("KeyA")).kind).toBe("invalid");
    expect(hotkeyFromEvent(key("KeyA", { shiftKey: true })).kind).toBe("invalid");
  });

  it("allows bare function keys", () => {
    expect(hotkeyFromEvent(key("F9"))).toEqual({ kind: "ok", accelerator: "F9" });
  });

  it("rejects keys an accelerator cannot express", () => {
    expect(hotkeyFromEvent(key("IntlRo", { ctrlKey: true })).kind).toBe("invalid");
  });
});

describe("hotkeyLabel", () => {
  it("renders friendly key names", () => {
    expect(hotkeyLabel("CommandOrControl+Shift+Space")).toEqual([
      "Ctrl",
      "Shift",
      "Space",
    ]);
    expect(hotkeyLabel("Super+K")).toEqual(["Win", "K"]);
    expect(hotkeyLabel("")).toEqual([]);
  });
});
