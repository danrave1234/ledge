# Contributing

Perch targets Windows 10 version 1607 or newer with the WebView2 Runtime. Use
Node 22.14+, pnpm 11, and stable Rust.

1. Install dependencies with `pnpm install`.
2. Run the desktop app with `pnpm tauri dev`; `pnpm dev` is a mock-backed browser preview.
3. Keep native calls behind `src/lib/native.ts` and migrate every `Settings` shape change.
4. Before a pull request, run `pnpm verify`, `pnpm test:e2e`, `pnpm rust:lint`, and
   `cargo test --manifest-path src-tauri/Cargo.toml`.

See [AGENTS.md](AGENTS.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and
[docs/CONVENTIONS.md](docs/CONVENTIONS.md) for the detailed engineering contract.
