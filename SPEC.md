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
- Built-in web search, screen context, approval-gated computer control, and an
  approval-gated app launcher over Start Menu shortcuts and built-in Windows apps;
  install-to-enable music integration for Windows media sessions, Spotify PKCE, and
  best-effort YouTube Music links.

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

### Packaged Windows measurement

CI builds the release NSIS package on `windows-latest`, launches the unpackaged release
executable three times, and measures cold start from process creation until a Win32
window handle owned by the process appears (including Perch's initially hidden handle).
On the final launch it waits five seconds, takes seven
private-memory samples at 500 ms intervals, and records their median. Installer size is
the produced NSIS executable size; every launch must remain alive and expose its handle.

`scripts/measure-performance.ps1` writes raw samples and comparisons to JSON. It gates
the medians against `scripts/performance-baseline.json` (20% cold-start, 15% memory, and
10% installer tolerances) and independently enforces the 1.5 s, 60 MB, and 10 MB absolute
targets above. CI uploads the JSON, log, and installer even when a gate fails. Reproduce
the comparison logic without building via `./scripts/test-performance-comparison.ps1`;
the test includes both a passing measurement and an intentionally regressed fixture.
The checked-in `windows-latest-x64` baseline medians are 1.2 s cold start, 40 MiB idle
private memory, and 8.5 MiB installer size; update them only from retained CI measurements.

## Product boundaries

- Perch is not a sandbox for arbitrary third-party code. “Plugin” currently means a
  first-party module registered at build time, gated by host-owned permissions.
- It is not a full coding agent or a hosted service.
- The Codex provider shells out to the user's official CLI and never reuses internal
  auth files. A distributed product should default to BYO API key or a hosted backend,
  not consumer subscription authentication.
- Screen capture supports the docked display, the last external active window, and a
  selected physical-pixel region reviewed before one-turn consent.
- The app launcher opens only entries present in a freshly built index of Start Menu
  shortcuts and a fixed table of Windows apps; it never runs paths or command lines
  supplied by the model, and Store-only apps without a shortcut are out of scope.

## Quality bar

Every settings change migrates old stores. Every native command has one frontend
wrapper. Model HTML is sanitized. Interactive controls expose keyboard focus and ARIA
state. CI runs types, formatting, lint, unit tests, build, Chromium accessibility smoke,
Rust formatting/clippy/tests, and dependency audits. Releases are signed from CI secrets.

## Next candidates

- A hosted provider path suitable for a distributed commercial build.
