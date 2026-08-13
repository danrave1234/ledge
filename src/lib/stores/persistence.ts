import { isTauri } from "../native";

export const hasWindow = typeof window !== "undefined";

export const K_SETTINGS = "perch.settings";
export const K_PERSONAS = "perch.personas";
export const K_CONV = "perch.conversations";

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/* ---------- durable persistence backend ----------
   In the desktop app, data lives in the OS app-data folder (survives a
   WebView2 cache clear). In the browser preview it falls back to localStorage. */
export async function readRaw(key: string): Promise<string | null> {
  try {
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      return (await invoke<string | null>("store_read", { key })) ?? null;
    }
    if (hasWindow) return localStorage.getItem(key);
  } catch (e) {
    console.error("readRaw failed", key, e);
  }
  return null;
}

export async function writeRaw(key: string, value: string): Promise<boolean> {
  try {
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("store_write", { key, value });
      return true;
    }
    if (hasWindow) {
      localStorage.setItem(key, value);
      return true;
    }
  } catch (e) {
    console.error("writeRaw failed", key, e);
  }
  return false;
}

// True unless a migration write failed — the launch cache-clear checks this so
// it can never wipe localStorage data that didn't make it into the durable store.
let migrationOk = true;
export function cacheClearSafe(): boolean {
  return migrationOk;
}

// Prefer durable store; migrate any legacy localStorage value from older builds.
export async function loadWithMigration(key: string): Promise<string | null> {
  const durable = await readRaw(key);
  if (durable != null) return durable;
  if (isTauri() && hasWindow) {
    try {
      const legacy = localStorage.getItem(key);
      if (legacy != null) {
        const ok = await writeRaw(key, legacy);
        if (!ok) migrationOk = false;
        return legacy;
      }
    } catch {
      migrationOk = false;
    }
  }
  return null;
}
