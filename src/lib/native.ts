import type { Attachment, Placement } from "./types";
import type { StreamOpts, ToolCall } from "./providers/types";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Invoke a Tauri command. Throws if not running in the desktop app. */
async function cmd<T = void>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<T>(name, args);
}

/** Invoke a command, returning `fallback` after reporting recoverable errors.
    Also returns `fallback` in the browser preview (no Tauri runtime). */
async function tryCmd<T>(
  name: string,
  fallback: T,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauri()) return fallback;
  try {
    return await cmd<T>(name, args);
  } catch (error) {
    console.warn(`Native command ${name} failed; using fallback.`, error);
    return fallback;
  }
}

/** Durable store primitives. Keeping them here preserves the single native
 * boundary used by browser preview and tests. */
export async function storeRead(key: string): Promise<string | null> {
  return tryCmd<string | null>("store_read", null, { key });
}

export async function storeWrite(key: string, value: string): Promise<void> {
  if (!isTauri()) throw new Error("Durable storage requires the desktop app.");
  await cmd("store_write", { key, value });
}

export async function storeDelete(key: string): Promise<void> {
  await tryCmd("store_delete", undefined, { key });
}

export async function assetStore(
  id: string,
  kind: Attachment["kind"],
  content: string,
): Promise<boolean> {
  if (!isTauri()) return false;
  await cmd("asset_store", { id, kind, content });
  return true;
}

export async function assetRead(
  id: string,
): Promise<{ kind: Attachment["kind"]; content: string } | null> {
  return tryCmd("asset_read", null, { id });
}

export async function assetDelete(id: string): Promise<void> {
  await tryCmd("asset_delete", undefined, { id });
}

export interface ExtractedDocument {
  kind: "document";
  name: string;
  mime: string;
  size: number;
  text: string;
}

/** Validate and normalize a document locally. Raw bytes never leave Perch. */
export async function extractDocument(
  name: string,
  bytes: Uint8Array,
): Promise<ExtractedDocument> {
  if (!isTauri()) throw new Error("Document extraction requires the desktop app.");
  return await cmd("extract_document", { name, bytes: Array.from(bytes) });
}

/** Ask the user where to save exported text. Browser preview downloads it. */
export async function exportText(
  suggestedName: string,
  contents: string,
  extension: "md" | "json",
): Promise<boolean> {
  if (isTauri()) {
    const [{ save }, { writeTextFile }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/plugin-fs"),
    ]);
    const path = await save({
      defaultPath: suggestedName,
      filters: [
        {
          name: extension === "md" ? "Markdown" : "JSON",
          extensions: [extension],
        },
      ],
    });
    if (!path) return false;
    await writeTextFile(path, contents);
    return true;
  }

  if (typeof document === "undefined") return false;
  const url = URL.createObjectURL(
    new Blob([contents], { type: "text/plain;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = suggestedName;
  link.click();
  URL.revokeObjectURL(url);
  return true;
}

type ChatEvent =
  | { type: "delta"; delta: string }
  | { type: "toolCalls"; calls: ToolCall[] }
  | { type: "done" }
  | { type: "error"; message: string };

/** Shared Channel transport for native streaming providers. */
export async function streamOverChannel(
  command: string,
  args: Record<string, unknown>,
  opts: StreamOpts,
  wrapRequest = false,
): Promise<void> {
  const { Channel } = await import("@tauri-apps/api/core");
  const channel = new Channel<ChatEvent>();
  const requestId = crypto.randomUUID();

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const abort = () => {
      void tryCmd("cancel_stream", undefined, { requestId });
      done();
    };
    const done = () => {
      if (settled) return;
      settled = true;
      opts.signal?.removeEventListener("abort", abort);
      resolve();
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      opts.signal?.removeEventListener("abort", abort);
      reject(new Error(message));
    };
    channel.onmessage = (msg) => {
      if (opts.signal?.aborted) return done();
      if (msg.type === "delta") opts.onDelta(msg.delta);
      else if (msg.type === "toolCalls") opts.onToolCalls?.(msg.calls);
      else if (msg.type === "done") done();
      else if (msg.type === "error") fail(msg.message);
    };
    opts.signal?.addEventListener("abort", abort, { once: true });
    const payload = wrapRequest
      ? { request: { ...args, requestId }, onEvent: channel }
      : { ...args, requestId, onEvent: channel };
    cmd(command, payload).catch((e) => fail(String(e)));
  });
}

export async function dock(
  placement: Placement,
  expanded: boolean,
  display?: number,
): Promise<void> {
  if (!isTauri()) return;
  try {
    await cmd("dock_window", { placement, expanded, display });
  } catch (e) {
    console.error("dock_window failed", e);
  }
}

export interface MonitorInfo {
  index: number;
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  primary: boolean;
}

/** Connected displays, so the user can pick which one the widget docks to. */
export async function listMonitors(): Promise<MonitorInfo[]> {
  return tryCmd<MonitorInfo[]>("list_monitors", []);
}

export type TrayAction = "open" | "settings" | "quit";

/** Exit the app. Only call after pending writes are flushed. */
export async function quitApp(): Promise<void> {
  await tryCmd("quit_app", undefined);
}

export async function onTray(cb: (a: TrayAction) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const un1 = await listen("perch://open", () => cb("open"));
  const un2 = await listen("perch://settings", () => cb("settings"));
  const un3 = await listen("perch://quit", () => cb("quit"));
  return () => {
    un1();
    un2();
    un3();
  };
}

/** Apply the autostart setting and report the state the OS actually ended up in,
    so a failed registry write can't leave the toggle claiming it worked. */
export async function setAutostart(enabled: boolean): Promise<boolean | null> {
  if (!isTauri()) return null;
  try {
    const mod = await import("@tauri-apps/plugin-autostart");
    const on = await mod.isEnabled();
    if (enabled && !on) await mod.enable();
    if (!enabled && on) await mod.disable();
    return await mod.isEnabled();
  } catch (e) {
    console.error("autostart apply failed", e);
    return null;
  }
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
  if (isTauri()) await cmd("set_api_key", { key });
}

export async function hasApiKey(): Promise<boolean> {
  return tryCmd("has_api_key", false);
}

export async function clearApiKey(): Promise<void> {
  if (isTauri()) await cmd("clear_api_key");
}

export interface ScreenContext {
  data_url: string;
  width: number;
  height: number;
  text: string;
  redacted: boolean;
}

export type CaptureMode = "display" | "active-window";

export interface ComputerTarget {
  id: string;
  title: string;
}

export type ComputerAction =
  | { kind: "click" | "double_click" | "right_click"; x: number; y: number }
  | { kind: "type"; text: string }
  | { kind: "key"; key: string }
  | { kind: "scroll"; amount: number };

/** The last external window focused before the user opened Perch. */
export async function computerTarget(): Promise<ComputerTarget | null> {
  return tryCmd<ComputerTarget | null>("computer_target", null);
}

/** Insert approved Unicode text into the exact external window captured above. */
export async function computerInsertText(
  target: ComputerTarget,
  text: string,
): Promise<void> {
  if (!isTauri()) throw new Error("Text insertion requires the Windows desktop app.");
  await cmd("computer_insert_text", { target, text });
}

/** Navigate the exact approved browser window to an approved HTTP(S) URL. */
export async function computerNavigateBrowser(
  target: ComputerTarget,
  url: string,
): Promise<void> {
  if (!isTauri()) throw new Error("Browser navigation requires the Windows desktop app.");
  await cmd("computer_navigate_browser", { target, url });
}

/** Run one explicitly approved, bounded action plan in the exact captured window. */
export async function computerRunActions(
  target: ComputerTarget,
  actions: ComputerAction[],
): Promise<void> {
  if (!isTauri()) throw new Error("Computer actions require the Windows desktop app.");
  await cmd("computer_run_actions", { target, actions });
}

/** Capture + OCR a screen so text-only providers can use it too.
 *  `display` is the same monitor index the widget docks to, so what Perch
 *  captures is always the screen the user sees it on. */
export async function captureContext(
  mode: CaptureMode,
  display?: number,
  autoRedact = false,
): Promise<ScreenContext | null> {
  if (!isTauri()) return null;
  return await cmd<ScreenContext>("capture_context", { mode, display, autoRedact });
}

export async function setGameMode(enabled: boolean): Promise<void> {
  if (isTauri()) await cmd("set_game_mode", { enabled });
}

/** Fires when a fullscreen app (a game) takes or loses focus while game mode is
    on. The backend hides/shows the window; this lets the UI tidy up first. */
export async function onGameFocus(cb: (inGame: boolean) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return await listen<boolean>("perch://game-focus", (e) => cb(e.payload));
}

export async function clearCache(): Promise<void> {
  if (isTauri()) await cmd("clear_cache");
}

/** Stop whatever generation is in flight (OpenAI HTTP stream or Codex CLI). */
export async function listOpenAiModels(): Promise<string[]> {
  return tryCmd<string[]>("openai_list_models", []);
}

export async function codexAvailable(): Promise<boolean> {
  return tryCmd("codex_available", false);
}

// Returns true if `codex login` was launched, false if the CLI isn't installed.
export async function codexLogin(): Promise<boolean> {
  return tryCmd("codex_login", false);
}

export async function codexLoggedIn(): Promise<boolean> {
  return tryCmd("codex_logged_in", false);
}

export async function codexLogout(): Promise<void> {
  await tryCmd("codex_logout", undefined);
}

/** `codex login` completes out-of-process (in the browser), so both entry
 *  points — onboarding and Settings → Account — poll for it the same way:
 *  check first, then wait, for up to ~90s. Resolves true once signed in. */
export async function waitForCodexLogin(
  timeoutMs = 90_000,
  intervalMs = 2_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await codexLoggedIn()) return true;
    if (Date.now() + intervalMs > deadline) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export async function setCaptureExclusion(enabled: boolean): Promise<void> {
  await tryCmd("set_capture_exclusion", undefined, { enabled });
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

export async function installUpdate(
  onProgress?: (pct: number) => void,
): Promise<boolean> {
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

/** One app currently registered with Windows as playing media. Mirrors the
    `MediaSession` struct in src-tauri/src/media.rs. */
export interface MediaSession {
  app_id: string;
  app_name: string;
  title: string;
  artist: string;
  album: string;
  art?: string | null;
  status: "playing" | "paused" | "stopped" | "closed" | "changing" | "opened" | "unknown";
  position_ms: number;
  duration_ms: number;
  can_play: boolean;
  can_pause: boolean;
  can_next: boolean;
  can_previous: boolean;
  can_seek: boolean;
  is_current: boolean;
}

export type MediaAction =
  "play" | "pause" | "toggle" | "next" | "previous" | "stop" | "seek";

/** A stand-in session so the now-playing card and transport bar can be worked on
    in the browser preview, which has no Rust backend and therefore no SMTC.
    Dev-only, exactly like the demo web results above and the mock provider. */
const DEMO_SESSION: MediaSession = {
  app_id: "Preview.exe",
  app_name: "Preview",
  title: "Demo Track",
  artist: "Preview Artist",
  album: "Browser Preview",
  art: null,
  status: "playing",
  position_ms: 62_000,
  duration_ms: 214_000,
  can_play: true,
  can_pause: true,
  can_next: true,
  can_previous: true,
  can_seek: true,
  is_current: true,
};

/** Every player Windows knows about, current session first.
 *  `withArt` costs a stream read per session — ask for it only when rendering. */
export async function mediaSessions(withArt = false): Promise<MediaSession[]> {
  if (!isTauri()) return [DEMO_SESSION];
  return tryCmd<MediaSession[]>("media_sessions", [], { withArt });
}

/** Drive a player. `app` picks one loosely by name ("spotify"); omitted, it acts
 *  on whatever Windows considers current.
 *
 *  Unlike most of native.ts this deliberately THROWS: a refused or impossible
 *  transport command has to reach the user (and the model) as an error, not be
 *  silently swallowed into a UI that claims it worked. */
export async function mediaControl(
  action: MediaAction,
  app?: string,
  positionMs?: number,
): Promise<void> {
  if (!isTauri()) throw new Error("Media control is only available in the desktop app.");
  await cmd("media_control", { action, app, positionMs });
}

/** Start/stop the backend watcher that pushes `perch://now-playing`.
 *  Opt-in: a user without the music plugin should pay nothing for it. */
export async function mediaWatch(enabled: boolean): Promise<void> {
  await tryCmd("media_watch", undefined, { enabled });
}

export async function onNowPlaying(
  cb: (sessions: MediaSession[]) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return await listen<MediaSession[]>("perch://now-playing", (e) => cb(e.payload ?? []));
}

/* ---------- Spotify ----------
   Tokens live in Rust and never reach this side; every call goes through the
   backend's allowlisted proxy. These wrappers THROW rather than returning a
   fallback: a failed sign-in or a refused playback command has to be visible. */

/** Run the PKCE sign-in. Resolves when the user finishes in their browser. */
export async function spotifyConnect(clientId: string): Promise<void> {
  if (!isTauri())
    throw new Error("Spotify sign-in is only available in the desktop app.");
  await cmd("spotify_connect", { clientId });
}

export async function spotifyConnected(): Promise<boolean> {
  return tryCmd("spotify_connected", false);
}

export async function spotifyDisconnect(): Promise<void> {
  await tryCmd("spotify_disconnect", undefined);
}

/** Call the Spotify Web API through the backend. `path` must be one the
 *  backend allows (see `path_allowed` in spotify.rs). Returns the raw body,
 *  which is empty for the 204s the playback endpoints reply with. */
export async function spotifyRequest(
  method: "GET" | "PUT" | "POST" | "DELETE",
  path: string,
  body?: unknown,
  clientId?: string,
): Promise<string> {
  if (!isTauri()) throw new Error("Spotify is only available in the desktop app.");
  return await cmd<string>("spotify_request", {
    method,
    path,
    body: body === undefined ? undefined : JSON.stringify(body),
    clientId,
  });
}

/* ---------- YouTube Music ----------
   The Data API key is optional: without it the feature can still open a search
   page, it just cannot resolve a phrase to a specific video. */

export interface YoutubeItem {
  url: string;
  title: string;
  subtitle: string;
  art?: string | null;
  kind: "video" | "playlist";
}

export async function youtubeSearch(
  query: string,
  kind: "video" | "playlist" = "video",
  limit = 6,
): Promise<YoutubeItem[]> {
  if (!isTauri()) throw new Error("YouTube search is only available in the desktop app.");
  return await cmd<YoutubeItem[]>("youtube_search", { query, kind, limit });
}

export async function youtubeHasKey(): Promise<boolean> {
  return tryCmd("youtube_has_key", false);
}

export async function setYoutubeKey(key: string): Promise<void> {
  if (isTauri()) await cmd("set_youtube_key", { key });
}

export interface WebResult {
  title: string;
  snippet: string;
  url: string;
}

/** Live web results. In the browser preview (no Rust backend) this returns a
    small demo set so the citation UI is exercisable — same dev-only convenience
    as the mock provider. */
export async function webSearch(query: string): Promise<WebResult[]> {
  if (!isTauri()) {
    return [
      {
        title: `Example result for “${query}”`,
        snippet: "Demo source shown only in the browser preview.",
        url: "https://example.com/one",
      },
      {
        title: "Second example source",
        snippet: "Another demo source, so numbering can be checked.",
        url: "https://example.org/two",
      },
    ];
  }
  return tryCmd<WebResult[]>("web_search", [], { query });
}

/** The running app's version, read from the bundle (tauri.conf.json) so the UI
    can never show a version string that drifted from what shipped. */
export async function appVersion(): Promise<string> {
  if (!isTauri()) return "dev";
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return "dev";
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
