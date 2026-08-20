# Perch product specification

Status: implemented personal beta · Updated 2026-08-18

## Product

Perch is a lightweight Windows assistant that rests as a textless handle on a
chosen display edge and expands into a chat panel. It is local-first, stays out
of fullscreen apps, and makes sensitive capabilities explicit at the composer.

## Current scope

- Windows 10 version 1607 or newer, WebView2 Runtime, x64-first packaging.
- Tauri v2 Rust core with a SvelteKit/Svelte 5 static SPA.
- OpenAI API-key provider over the Responses API, the official Codex CLI bridge,
  and a browser-preview mock provider.
- Streaming Markdown chat, model selection, history, personas, memory selection,
  conversation compaction, source citations, code/image canvas, themes, autostart,
  global shortcut, tray, signed updates, multi-monitor docking, and game mode.
- Built-in web search and screen context; install-to-enable music integration for
  Windows media sessions, Spotify PKCE, and best-effort YouTube Music links.

## Consent and privacy

Web, Screen, and Music authorization lasts for one send only and resets after
submission. Screen is off until the user captures it. The composer shows the exact
image before send, supports drag-to-redact, and invalidates OCR after any redaction.
The model can only receive that approved image; tools never recapture in the background.

There is no continuous screen capture. Perch excludes its own window, captures the
display it is docked to, and leaves a visible message receipt when screen or web data
was actually used. Tool output and remote content are untrusted data, never instructions.

OpenAI and YouTube keys plus Spotify refresh tokens are stored in Windows Credential
Manager. OAuth tokens never enter the WebView. Conversation images live as bounded
assets in app-data rather than embedded in conversation JSON. Removing a plugin also
removes its state and credentials after confirmation.

## Storage

Versioned settings, personas, conversations, and namespaced plugin state are atomic
JSON files in app-data. Images are separate bounded asset files. Writes are coalesced,
serialized per key, and awaited on explicit quit. Browser preview uses localStorage.

## Performance targets

| Metric               | Target                                 |
| -------------------- | -------------------------------------- |
| Idle private memory  | about 27 MB measured; stay below 60 MB |
| Installer            | below 10 MB                            |
| Cold start to handle | below 1.5 s                            |
| Hover-open motion    | 60 fps, about 200 ms or less           |

Disabled optional plugins must not start background watchers. The media watcher runs
only while Music is active.

## Product boundaries

- Perch is not a sandbox for arbitrary third-party code. “Plugin” currently means a
  first-party module registered at build time, gated by host-owned permissions.
- It is not a full coding agent or a hosted service.
- The Codex provider shells out to the user's official CLI and never reuses internal
  auth files. A distributed product should default to BYO API key or a hosted backend,
  not consumer subscription authentication.
- Screen capture currently covers the chosen display. Active-window and selected-region
  capture modes are future work; local redaction is available now.

## Quality bar

Every settings change migrates old stores. Every native command has one frontend
wrapper. Model HTML is sanitized. Interactive controls expose keyboard focus and ARIA
state. CI runs types, formatting, lint, unit tests, build, Chromium accessibility smoke,
Rust formatting/clippy/tests, and dependency audits. Releases are signed from CI secrets.

## Next candidates

- Active-window and selected-region screen capture.
- Searchable/exportable conversation history.
- File attachments beyond images.
- Measured launch, memory, and packaged-app smoke benchmarks in CI.
- A hosted provider path suitable for a distributed commercial build.
