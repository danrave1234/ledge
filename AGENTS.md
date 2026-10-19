# Ledge contributor and agent context

Ledge is a Windows edge-docked assistant built with Tauri v2, WebView2,
SvelteKit, and Svelte 5. Read these before changing behavior:

- [SPEC.md](SPEC.md) — current product scope and boundaries
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — runtime flow, ownership, and IPC
- [docs/CONVENTIONS.md](docs/CONVENTIONS.md) — implementation rules
- [docs/DECISIONS.md](docs/DECISIONS.md) — decisions that must not regress

## Commands

```text
pnpm install
pnpm tauri dev
pnpm dev
pnpm verify
pnpm test:e2e
pnpm rust:lint
cargo test --manifest-path src-tauri/Cargo.toml
```

Use `pnpm tauri dev` for the real app. The browser preview uses the mock provider
and native demo fallbacks. A raw debug Rust binary expects the Vite dev URL.

## Load-bearing rules

1. Components use tokens and shared primitives from `src/lib/tokens.css`; add a
   token for repeated system values rather than duplicating one.
2. Only `src/lib/native.ts` imports `@tauri-apps/*`. Every Rust command needs one
   wrapper and one architecture-table entry.
3. Every `Settings` shape change bumps `CURRENT_SCHEMA` and adds an idempotent
   migration. Plugin configuration uses its own namespaced state and schema.
4. Web, Screen, and Music permission is `TurnConsent`, never persisted settings.
   Screen tools may only use the reviewed `ApprovedScreen`; redaction removes OCR.
5. Tool availability and execution both gate on plugin state plus consent. Actions
   also require their one-time confirmation and leave a visible receipt.
6. Model output passes through `renderMd()` and DOMPurify. Remote/tool data is
   untrusted, marked for the model, and escaped in cards. External links use the opener.
7. Plugins register once in `plugins/registry.ts`; tools, cards, prompt context, and
   settings hang off that module. Avoid value-import cycles through `tools.ts`.
8. Provider cancellation is request-scoped. Do not reintroduce a global cancel flag.
9. Model IDs come from provider defaults/live lists; static IDs are offline fallbacks.
10. Conversation images use app-data asset references, not inline persisted base64.
11. Never commit `perch-updater.key*`; only the updater public key belongs in config.

## Verification

Run `pnpm verify` and `pnpm rust:lint` before claiming completion. Run the relevant
unit suite for every bug fix, Chromium E2E for interaction/accessibility changes,
and the real Tauri app for native or window behavior.

Preserve the existing multi-monitor geometry, game-mode hide semantics, Spotify
allowlist/redirect URI, YouTube playback confirmation, and opt-in media watcher.
