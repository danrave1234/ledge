export interface NativeSettings {
  autostart: boolean;
  hotkey: string;
  gameMode: boolean;
}

export interface NativeSettingsDependencies {
  setAutostart(enabled: boolean): Promise<boolean | null>;
  registerHotkey(accelerator: string): void;
  setGameMode(enabled: boolean): Promise<void> | void;
  correctAutostart(enabled: boolean): void;
}

export interface NativeSettingsState {
  autostart: boolean | null;
  hotkey: string | null;
  gameMode: boolean | null;
  autostartRequest: number;
}

export function createNativeSettingsState(): NativeSettingsState {
  return { autostart: null, hotkey: null, gameMode: null, autostartRequest: 0 };
}

/** Apply hydrated Game mode before startup is allowed to dock/show the window.
    Recording it first prevents the reactive reconciler from issuing a duplicate
    command while this one is in flight. */
export async function initializeGameMode(
  enabled: boolean,
  state: NativeSettingsState,
  setGameMode: (enabled: boolean) => Promise<void> | void,
): Promise<void> {
  state.gameMode = enabled;
  await setGameMode(enabled);
}

/** Reconcile only hydrated values with Windows, then guard later calls so an
    unrelated settings update cannot repeat native side effects. */
export function reconcileNativeSettings(
  ready: boolean,
  settings: NativeSettings,
  state: NativeSettingsState,
  dependencies: NativeSettingsDependencies,
): void {
  if (!ready) return;

  if (settings.autostart !== state.autostart) {
    state.autostart = settings.autostart;
    const wanted = settings.autostart;
    const request = ++state.autostartRequest;
    void dependencies.setAutostart(wanted).then((actual) => {
      if (request !== state.autostartRequest) return;
      if (actual !== null && actual !== wanted) {
        state.autostart = actual;
        dependencies.correctAutostart(actual);
      }
    });
  }
  if (settings.hotkey !== state.hotkey) {
    state.hotkey = settings.hotkey;
    dependencies.registerHotkey(settings.hotkey);
  }
  if (settings.gameMode !== state.gameMode) {
    state.gameMode = settings.gameMode;
    dependencies.setGameMode(settings.gameMode);
  }
}
