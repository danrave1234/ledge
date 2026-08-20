# Music plugin implementation record

Status: shipped · Archived 2026-08-18

The original phased plan is complete. Durable decisions now live in
[`../ARCHITECTURE.md`](../ARCHITECTURE.md), [`../DECISIONS.md`](../DECISIONS.md),
and the executable plugin contract.

Implemented layers:

- Windows SMTC read/control with an event-driven watcher.
- Interactive now-playing and picker cards.
- Registry-contributed tools, prompt context, cards, settings, and namespaced state.
- Spotify OAuth PKCE with an allowlisted Rust proxy.
- Best-effort YouTube Music URLs with optional Data API search and SMTC confirmation.

Constraints that remain intentional: reading now-playing state needs only an active
plugin; transport and playback actions need one-turn Music consent plus the one-time
confirmation. Spotify tokens stay native, YouTube autoplay is never assumed, playlist
URLs use `watch?list=`, and the watcher runs only while the plugin is active.
