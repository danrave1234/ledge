import { isTauri, storeRead, storeWrite } from "../native";

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
/** Strip a UTF-8 BOM — an external editor (or any tool that writes UTF-8 with
    signature) can add one, and JSON.parse throws on it, silently wiping data. */
function stripBom(s: string | null): string | null {
  return s && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export async function readRaw(key: string): Promise<string | null> {
  try {
    if (isTauri()) {
      return stripBom(await storeRead(key)) ?? null;
    }
    if (hasWindow) return stripBom(localStorage.getItem(key));
  } catch (e) {
    console.error("readRaw failed", key, e);
  }
  return null;
}

async function writeRaw(key: string, value: string): Promise<boolean> {
  try {
    if (isTauri()) {
      await storeWrite(key, value);
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

/* ---------- write queue ----------
   Stores are written on every change, and a change can be one keystroke in a
   textarea or one streamed token landing in a conversation. Writing straight
   through means a full JSON serialize + IPC + disk write per keystroke, so
   writes are coalesced per key and flushed on a short delay.

   Correctness rule: nothing may be lost. `flushWrites()` is called before the
   window goes away, and every queued value is the LATEST for its key, so a
   flush always persists current state rather than a backlog. */
const WRITE_DEBOUNCE_MS = 250;

const pendingValues = new Map<string, string>();
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const inFlight = new Map<string, Promise<void>>();

function clearTimer(key: string): void {
  const timer = pendingTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    pendingTimers.delete(key);
  }
}

/** Drain one key serially. A newer value arriving during an IPC write is picked
 * up by the loop and can never be overwritten by an older completion. */
function drainKey(key: string): Promise<void> {
  clearTimer(key);
  const running = inFlight.get(key);
  if (running) return running;

  const work = (async () => {
    while (pendingValues.has(key)) {
      const value = pendingValues.get(key)!;
      pendingValues.delete(key);
      if (!(await writeRaw(key, value))) {
        if (!pendingValues.has(key)) pendingValues.set(key, value);
        throw new Error(`Could not persist ${key}`);
      }
    }
  })().finally(() => {
    inFlight.delete(key);
    if (pendingValues.has(key) && !pendingTimers.has(key)) {
      pendingTimers.set(
        key,
        setTimeout(() => void drainKey(key).catch(console.error), WRITE_DEBOUNCE_MS),
      );
    }
  });
  inFlight.set(key, work);
  return work;
}

/** Queue a durable write, coalescing rapid changes to the same key. */
export function queueWrite(key: string, value: string): void {
  pendingValues.set(key, value);
  if (pendingTimers.has(key)) return;
  pendingTimers.set(
    key,
    setTimeout(() => void drainKey(key).catch(console.error), WRITE_DEBOUNCE_MS),
  );
}

/** Persist everything still queued. Safe to call at any time. */
export async function flushWrites(): Promise<void> {
  for (;;) {
    const keys = new Set([...pendingValues.keys(), ...inFlight.keys()]);
    if (!keys.size) return;
    await Promise.all([...keys].map(drainKey));
  }
}

/** Drop queued writes for data the user explicitly deleted. An already-running
 * write is awaited so the following delete is guaranteed to win. */
export async function discardWrites(key: string): Promise<void> {
  clearTimer(key);
  pendingValues.delete(key);
  await inFlight.get(key);
  clearTimer(key);
  pendingValues.delete(key);
}

if (hasWindow) {
  // The widget is long-lived and usually closed by quitting from the tray, so
  // catch every teardown signal the WebView actually delivers.
  window.addEventListener("pagehide", () => void flushWrites().catch(console.error));
  window.addEventListener("beforeunload", () => void flushWrites().catch(console.error));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushWrites().catch(console.error);
  });
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
