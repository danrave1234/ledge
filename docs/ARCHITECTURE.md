# Architecture

Ledge is a static SvelteKit SPA inside a Tauri v2/WebView2 shell. `src/lib/native.ts`
is the only frontend IPC boundary; browser preview fallbacks live beside each wrapper.

## Runtime flow

```text
Composer (turn consent + approved attachments)
  -> controller (context, memory selection, prompt, receipts)
  -> agent loop (provider stream <-> gated tools, maximum four rounds)
  -> provider adapter
     -> native Channel -> Rust Responses API stream
     -> native Channel -> official Codex CLI
     -> in-process mock in browser preview
```

On send, the composer passes a non-persisted `TurnConsent`. Screen permission also
carries an `ApprovedScreen` captured and reviewed before the request. Tool discovery
and execution both re-check plugin state plus that consent. The screen tool can only
return the approved capture and cannot recapture after generation starts.

The controller budgets conversation context, compacts older turns when needed,
selects relevant memories, builds the prompt, and stores receipts from operations that
actually ran. Provider and native cancellation use a unique request id, so foreground
chat, title generation, and compaction do not cancel one another.

## Frontend ownership

| Area            | Modules                                                               |
| --------------- | --------------------------------------------------------------------- |
| UI              | `components/`, including the composer preview/redactor and canvas     |
| Orchestration   | `controller.ts`, `agent.ts`, `context.ts`, `memory.ts`, `prompt.ts`   |
| Providers       | `providers/` with shared native Channel transport in `native.ts`      |
| Plugins         | catalog in `plugins.ts`; executable registry in `plugins/registry.ts` |
| State           | domain stores in `stores/`, exposed to UI through `stores/index.ts`   |
| Storage assets  | `assets.ts` migrates inline images and strips them from JSON          |
| Native boundary | `native.ts`, the only `@tauri-apps/*` importer                        |
| Design system   | `tokens.css`, shared primitives, and `motion.ts`                      |

Startup is ordered: show the handle, hydrate and migrate stores, reconcile the app
version, then refresh provider authentication. Persistence subscriptions are attached
only after hydration, so defaults cannot overwrite existing files.

`stores/index.ts` is the public state API for components, including plugin UI. Domain
modules may be reorganized or split as they grow without forcing component-wide import
changes; non-component orchestration can still import a domain module directly when it
needs an implementation-level dependency.

## Rust ownership

| Module                | Responsibility                                                        |
| --------------------- | --------------------------------------------------------------------- |
| `window.rs`           | edge geometry, monitors, capture exclusion, game mode, cache, quit    |
| `provider.rs`         | Responses API request, SSE parser, models, request cancellation       |
| `codex.rs`            | supported Codex CLI availability/login/status/logout/exec commands    |
| `screen.rs`           | chosen-display capture and Windows OCR                                |
| `computer_control.rs` | tracked-window validation and approved keyboard/pointer actions       |
| `app_launcher.rs`     | Start Menu app index and approved, index-validated app launching      |
| `folder_finder.rs`    | Bounded known-folder + Steam library search and approved path opening |
| `web.rs`              | bounded DuckDuckGo search and parsing                                 |
| `media.rs`            | Windows media sessions, control, and opt-in watcher                   |
| `spotify.rs`          | PKCE and allowlisted Spotify API proxy                                |
| `youtube.rs`          | optional Data API search and safe Music URLs                          |
| `secrets.rs`          | named Windows Credential Manager entries                              |
| `store.rs`            | atomic JSON files, deletion, and bounded image assets                 |
| `http.rs`             | shared streaming and short-request clients                            |

## IPC surface

| Domain  | Commands/events                                                                                                                                       |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Window  | `dock_window`, `list_monitors`, `set_game_mode`, `set_capture_exclusion`, `clear_cache`, `quit_app`; `perch://open`, `settings`, `quit`, `game-focus` |
| OpenAI  | `openai_stream`, `openai_list_models`, `cancel_stream`                                                                                                |
| Codex   | `codex_available`, `codex_login`, `codex_logged_in`, `codex_logout`, `codex_exec`                                                                     |
| Context | `capture_context`, `web_search`                                                                                                                       |
| Control | `computer_target`, `computer_insert_text`, `computer_navigate_browser`, `computer_run_actions`                                                        |
| Apps    | `app_list`, `app_launch`                                                                                                                              |
| Paths   | `search_paths_cmd`, `open_found_path`                                                                                                                 |
| Media   | `media_sessions`, `media_control`, `media_watch`; `perch://now-playing`                                                                               |
| Spotify | `spotify_connect`, `spotify_connected`, `spotify_disconnect`, `spotify_request`                                                                       |
| YouTube | `youtube_search`, `youtube_has_key`, `set_youtube_key`                                                                                                |
| Secrets | `set_api_key`, `has_api_key`, `clear_api_key`                                                                                                         |
| Storage | `store_read`, `store_write`, `store_delete`, `asset_store`, `asset_read`, `asset_delete`                                                              |

## Persistence

Core keys are `perch.settings`, `perch.personas`, and `perch.conversations`. Plugin
state uses `perch.plugin.<id>`. Files live under app-data `store/`; image data lives
under app-data `assets/`. The queue retains only the newest pending value per key,
serializes writes, and awaits all in-flight work on explicit quit. Asset references
are hydrated into runtime data URLs and omitted from persisted conversation JSON.

Settings and each plugin store have independent ordered migrations. A future-version
store is never downgraded. Removing a plugin discards queued writes before deleting
its state, then clears owned credentials.

## Trust boundaries

Model Markdown passes through `renderMd()` and DOMPurify. Remote card data uses normal
Svelte escaping. Web, screen, and media text are marked as untrusted data in model
context. External links open through the system opener. The WebView uses a restrictive
CSP; OAuth/API tokens stay in Rust and Spotify paths are allowlisted.

Computer control creates approval cards containing the exact target and proposed
operation; no input occurs before the user approves. Rust revalidates the tracked
window, focuses it, verifies foreground ownership, and independently validates every
action. Text insertion emits bounded Unicode input. Browser navigation accepts only
HTTP(S), verifies a browser-process allowlist, and drives the address bar. Visual plans
contain at most 12 clicks, text steps, allowlisted navigation keys, or bounded scrolls;
click coordinates are normalized to and resolved inside the approved window. Send,
submit, purchase, delete, authentication, passwords, arbitrary shortcuts, elevated
windows, UAC, and secure desktop remain outside the boundary.

App launching follows the same shape. The model supplies only a name; the frontend
matches it against `app_list` (Start Menu `.lnk` shortcuts plus a fixed table of
built-in Windows apps) and shows the exact entry — with alternatives when the match is
not certain — on an approval card. `app_launch` rebuilds the index and refuses any
entry whose name, path, and kind are not present in it, so an edited card payload or
a path outside the Start Menu cannot be opened. Launching uses the shell `open` verb
with no arguments; Ledge never runs a command line.

Folder finding mirrors that trust model. The model supplies only a name or query;
`search_paths_cmd` walks bounded roots under the user profile and known Windows
folders (Desktop, Documents, Downloads, Pictures, Videos, Music, OneDrive, Public),
skips junk directories, and caps depth and result count. `find_path` returns matches as
untrusted path text; `open_path` attaches a `path_open` approval card. `open_found_path`
re-checks that the approved path still exists and remains under those roots before
shell-opening it. Known-folder aliases such as “downloads” resolve first without a deep
walk.
