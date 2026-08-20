import { describe, expect, it, vi } from "vitest";
import {
  createNativeSettingsState,
  initializeGameMode,
  reconcileNativeSettings,
} from "./native-settings";

function dependencies() {
  return {
    setAutostart: vi.fn(async (enabled: boolean) => enabled),
    registerHotkey: vi.fn(),
    setGameMode: vi.fn(),
    correctAutostart: vi.fn(),
  };
}

describe("native settings reconciliation", () => {
  it("finishes initial Game mode classification before startup docks", async () => {
    const calls: string[] = [];
    const state = createNativeSettingsState();
    let finishClassification = () => {};
    const classification = new Promise<void>((resolve) => {
      finishClassification = resolve;
    });

    const initializing = initializeGameMode(true, state, async () => {
      calls.push("game-mode");
      await classification;
      calls.push("classified");
    });
    await Promise.resolve();
    expect(state.gameMode).toBe(true);
    expect(calls).toEqual(["game-mode"]);

    finishClassification();
    await initializing;
    calls.push("dock");
    expect(calls).toEqual(["game-mode", "classified", "dock"]);
  });
  it("does not apply defaults before hydration and applies persisted values first", () => {
    const deps = dependencies();
    const state = createNativeSettingsState();
    const defaults = { autostart: false, hotkey: "Default", gameMode: true };
    const persisted = { autostart: true, hotkey: "Persisted", gameMode: false };

    reconcileNativeSettings(false, defaults, state, deps);
    expect(deps.setAutostart).not.toHaveBeenCalled();
    expect(deps.registerHotkey).not.toHaveBeenCalled();
    expect(deps.setGameMode).not.toHaveBeenCalled();

    reconcileNativeSettings(true, persisted, state, deps);
    expect(deps.setAutostart).toHaveBeenCalledOnce();
    expect(deps.setAutostart).toHaveBeenCalledWith(true);
    expect(deps.registerHotkey).toHaveBeenCalledWith("Persisted");
    expect(deps.setGameMode).toHaveBeenCalledWith(false);
  });

  it("applies later changes once and ignores unrelated settings updates", () => {
    const deps = dependencies();
    const state = createNativeSettingsState();
    const initial = { autostart: true, hotkey: "First", gameMode: false };
    reconcileNativeSettings(true, initial, state, deps);

    reconcileNativeSettings(true, initial, state, deps);
    expect(deps.setAutostart).toHaveBeenCalledTimes(1);
    expect(deps.registerHotkey).toHaveBeenCalledTimes(1);
    expect(deps.setGameMode).toHaveBeenCalledTimes(1);

    reconcileNativeSettings(
      true,
      { autostart: false, hotkey: "Second", gameMode: true },
      state,
      deps,
    );
    expect(deps.setAutostart).toHaveBeenLastCalledWith(false);
    expect(deps.registerHotkey).toHaveBeenLastCalledWith("Second");
    expect(deps.setGameMode).toHaveBeenLastCalledWith(true);
  });
});
