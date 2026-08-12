# Perch

A lightweight, edge-docked AI assistant widget for Windows. Perch lives as a small
textless handle at the edge of your screen, hover-opens into a chat panel, and can
see your screen, search the web, and switch models — built to feel native and stay
light (private memory footprint ~7 MB), not like a full application.

Built with **Tauri v2** (Rust core + WebView2) and **SvelteKit** (Svelte 5).

## Features

- **Edge widget** — always-on-top, borderless, textless handle; user-configurable
  placement (top / left / right), hover-to-open with a resize-settle cooldown.
- **Chat** — token streaming, markdown, and **canvas** cards for code (copy + expand
  to a full-panel view).
- **Providers** — a provider layer with a working offline **mock**, **OpenAI**
  (bring-your-own API key, streaming + vision), and a **Codex CLI bridge** (uses your
  official `codex login`). Model IDs are **editable** and can be **fetched live**
  from `/v1/models`, so they never go stale.
- **Personalization** — ChatGPT-style "About you" + response style + a memory list
  with import; shared across every provider so they behave the same.
- **Plugins** — small core; web-search and screen-context are built in, and an
  install-to-enable model for additional plugins.
- **Game mode** — stays overlaid on borderless / windowed-fullscreen games.
- **Durable memory** — history / personas / settings persist as atomic JSON in the
  app-data folder, so clearing the WebView2 cache never loses data.
- **Auto-update** — `tauri-plugin-updater` with a signed GitHub-Releases feed.
- **First-run onboarding**, custom themes + accent, autostart, global hotkey, tray.

## Develop

```bash
pnpm install
pnpm tauri dev
```

> Note: a raw `cargo build` debug binary loads the dev server URL, so use
> `pnpm tauri dev` (or a release build) to run the real app.

## Build

```bash
pnpm tauri build            # release binary + NSIS/MSI installers
```

Signed auto-update artifacts require the updater signing key via the
`TAURI_SIGNING_PRIVATE_KEY` environment variable (the private key is **not** in
this repo — keep it secret).

## Status

Personal project / work in progress. The Codex path requires the official
[OpenAI Codex CLI](https://github.com/openai/codex) installed (`npm i -g @openai/codex`)
and `codex login`. Reusing consumer ChatGPT/Codex auth in a distributed product is a
terms-of-service gray area — the compliant paths are BYO API key or a hosted backend.
