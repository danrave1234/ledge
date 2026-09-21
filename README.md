# Perch

A lightweight, edge-docked AI assistant widget for Windows. Perch lives as a small
textless handle at the edge of your screen, hover-opens into a chat panel, and can
see your screen, search the web, and switch models — built to feel native and stay
light (about 27 MB idle private memory in current measurements), not like a full application.

Built with **Tauri v2** (Rust core + WebView2) and **SvelteKit** (Svelte 5).

## Features

- **Edge widget** — always-on-top, borderless, textless handle; user-configurable
  placement (top / left / right), hover-to-open with a resize-settle cooldown.
- **Chat** — token streaming, markdown, and **canvas** cards for code (copy + expand
  to a full-panel view).
- **Providers** — a provider layer with a working offline **mock**, **OpenAI**
  (bring-your-own API key, Responses API streaming + vision), and a **Codex CLI bridge** (uses your
  official `codex login`). Model IDs are **editable** and can be **fetched live**
  from `/v1/models`, so they never go stale.
- **Personalization** — ChatGPT-style "About you" + response style + a memory list
  with import; shared across every provider so they behave the same.
- **Per-turn privacy** — Web, reviewed Screen, and Music authorization reset after
  each send; screen capture includes show-before-send preview and local redaction.
- **Plugins** — web-search and screen-context are built in; Music is install-to-enable
  with Windows media, Spotify, and best-effort YouTube Music support.
- **Approval-gated actions** — Computer control can insert text, navigate a browser,
  and run a previewed bounded plan of clicks, common keys, and scrolling in the last
  focused Windows app. It cannot send, submit, purchase, delete, authenticate, enter
  passwords, use arbitrary shortcuts, or control elevated apps.
- **App launcher** — "open Spotify" finds the Start Menu entry (or a built-in
  Windows app), previews the exact app with alternatives when the name is
  ambiguous, and opens it only after you approve.
- **Folder finder** — "where is my downloads?" searches known folders on your PC,
  shows the full path (and alternatives when the name is ambiguous), and opens it
  only after you approve.
- **Game mode** (on by default) — any focused fullscreen app on any monitor hides
  the entire widget globally, even if Perch is docked on another display. It comes
  back when you alt-tab away.
- **Durable memory** — atomic app-data stores, serialized quit-safe writes, and
  separate bounded image assets survive WebView2 cache clears.
- **Auto-update** — `tauri-plugin-updater` with a signed GitHub-Releases feed;
  settings are versioned and migrated forward on every update.
- **First-run onboarding**, light/dark themes + accent picker, autostart, global
  hotkey, tray. The panel stays open while one of its controls has keyboard focus.

## Develop

Requirements: Windows 10 version 1607 or newer, the WebView2 Runtime, Node 22.14+,
pnpm 11, and stable Rust with the MSVC toolchain.

```bash
pnpm install
pnpm tauri dev        # the real app
pnpm dev              # browser-only preview (mock provider) on :1420
```

### Music integrations

For a private build that lets every user click **Connect Spotify** without
entering an app ID, copy `.env.example` to `.env` and set
`PUBLIC_SPOTIFY_CLIENT_ID` to your registered Spotify PKCE client ID before
building. Each person still authorizes their own Spotify account; tokens stay
on their Windows account. Without this build-time value, Perch guides each user
through creating their own free Spotify app. YouTube Music uses the browser's
existing sign-in; its optional Data API key only improves exact-match search.

Before opening a PR:

```bash
pnpm verify           # svelte-check + prettier + eslint + vitest + build
pnpm rust:lint        # cargo fmt --check + clippy -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

> Note: a raw `cargo build` debug binary loads the dev server URL, so use
> `pnpm tauri dev` (or a release build) to run the real app.

## Documentation

- [CLAUDE.md](CLAUDE.md) — orientation for AI agents and new contributors
- [AGENTS.md](AGENTS.md) — canonical contributor and coding-agent instructions
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — modules, data flow, IPC surface
- [docs/CONVENTIONS.md](docs/CONVENTIONS.md) — the rules new code follows
- [docs/DECISIONS.md](docs/DECISIONS.md) — why things are the way they are
- [CHANGELOG.md](CHANGELOG.md) — user-visible changes in the next release
- [SPEC.md](SPEC.md) — product spec

## Build

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = (Resolve-Path .\perch-updater.key)
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
pnpm tauri build # release binary + signed NSIS/MSI installers
```

The private key is **not** in this repo — keep it secret. `createUpdaterArtifacts`
is on, so **both** variables are required: without
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` the CLI prompts for a key password and the
build hangs on stdin forever — even though this key has no password. When that
happens the installers are still written but the `.sig` files stay stale from the
previous build, which silently breaks updater verification.

### Publish a GitHub release

Keep the version identical in `package.json`, `src-tauri/Cargo.toml`, and
`src-tauri/tauri.conf.json`, then push a matching tag:

```powershell
git tag v0.1.0
git push origin v0.1.0
```

The Release workflow verifies the frontend and Rust code, builds signed Windows
NSIS/MSI installers, publishes them to GitHub Releases, and uploads `latest.json`
for in-app updates. It can also be run manually from GitHub Actions; manual runs
release the version currently declared in the three files above. The repository
must retain the `TAURI_SIGNING_PRIVATE_KEY` Actions secret. If the key has a
password, also set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

## Status

Personal project / work in progress. The Codex path requires the official
[OpenAI Codex CLI](https://github.com/openai/codex) installed (`npm i -g @openai/codex`)
and `codex login`. Perch shells out to that CLI and uses only `codex login status` /
`codex logout`; it never opens or copies the CLI's authentication files. OpenAI API
access remains bring-your-own-key and is stored in Windows Credential Manager.
