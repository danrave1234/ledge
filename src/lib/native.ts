import type { Placement } from "./types";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function dock(placement: Placement, expanded: boolean): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    await invoke("dock_window", { placement, expanded });
  } catch (e) {
    console.error("dock_window failed", e);
  }
}

export async function showPanel(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("show_panel");
}

export async function hidePanel(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("hide_panel");
}

export type TrayAction = "open" | "settings";

export async function onTray(cb: (a: TrayAction) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const un1 = await listen("perch://open", () => cb("open"));
  const un2 = await listen("perch://settings", () => cb("settings"));
  return () => {
    un1();
    un2();
  };
}

export async function setAutostart(enabled: boolean): Promise<void> {
  if (!isTauri()) return;
  const mod = await import("@tauri-apps/plugin-autostart");
  const on = await mod.isEnabled();
  if (enabled && !on) await mod.enable();
  if (!enabled && on) await mod.disable();
}

export async function registerHotkey(
  accelerator: string,
  handler: () => void,
): Promise<void> {
  if (!isTauri() || !accelerator) return;
  const mod = await import("@tauri-apps/plugin-global-shortcut");
  try {
    await mod.unregisterAll();
    await mod.register(accelerator, (ev) => {
      if (ev.state === "Pressed") handler();
    });
  } catch (e) {
    console.error("hotkey register failed", e);
  }
}

export async function saveApiKey(key: string): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_api_key", { key });
}

export async function hasApiKey(): Promise<boolean> {
  if (!isTauri()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<boolean>("has_api_key");
}

export async function clearApiKey(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("clear_api_key");
}

export interface Shot {
  data_url: string;
  width: number;
  height: number;
}

export async function captureScreen(): Promise<Shot> {
  if (!isTauri()) throw new Error("Screen capture needs the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<Shot>("capture_screen");
}

export interface ScreenContext {
  data_url: string;
  width: number;
  height: number;
  text: string;
}

// Capture + OCR the screen so text-only providers can use it too.
export async function captureContext(): Promise<ScreenContext | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<ScreenContext>("capture_context");
  } catch {
    return null;
  }
}

export async function setGameMode(enabled: boolean): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_game_mode", { enabled });
}

export async function clearCache(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("clear_cache");
}

export async function cancelStream(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    await invoke("openai_cancel");
  } catch {
    /* ignore */
  }
}

export async function listOpenAiModels(): Promise<string[]> {
  if (!isTauri()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<string[]>("openai_list_models");
}

export async function codexAvailable(): Promise<boolean> {
  if (!isTauri()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<boolean>("codex_available");
  } catch {
    return false;
  }
}

// Returns true if `codex login` was launched, false if the CLI isn't installed.
export async function codexLogin(): Promise<boolean> {
  if (!isTauri()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<boolean>("codex_login");
  } catch {
    return false;
  }
}

export async function codexLoggedIn(): Promise<boolean> {
  if (!isTauri()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<boolean>("codex_logged_in");
  } catch {
    return false;
  }
}

export async function codexLogout(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    await invoke("codex_logout");
  } catch {
    /* ignore */
  }
}

export async function setCaptureExclusion(enabled: boolean): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    await invoke("set_capture_exclusion", { enabled });
  } catch {
    /* older Windows / unsupported */
  }
}

export async function onWindowBlur(cb: () => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    if (!focused) cb();
  });
}

export interface UpdateInfo {
  available: boolean;
  version?: string;
  notes?: string;
}

export async function checkForUpdates(): Promise<UpdateInfo> {
  if (!isTauri()) return { available: false };
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (update) return { available: true, version: update.version, notes: update.body };
  return { available: false };
}

export async function installUpdate(onProgress?: (pct: number) => void): Promise<boolean> {
  if (!isTauri()) return false;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return false;
  let downloaded = 0;
  let total = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") total = event.data.contentLength ?? 0;
    else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      if (total) onProgress?.(Math.round((downloaded / total) * 100));
    }
  });
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
  return true;
}

export interface WebResult {
  title: string;
  snippet: string;
  url: string;
}

export async function webSearch(query: string): Promise<WebResult[]> {
  if (!isTauri()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<WebResult[]>("web_search", { query });
  } catch {
    return [];
  }
}

export async function openExternal(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, "_blank");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}
