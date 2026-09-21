# Changelog

All notable changes are documented here. Perch follows Semantic Versioning once
it reaches its first stable release.

## 0.1.3 - 2026-09-21

- Added the built-in Folder finder plugin. Ask Perch to find a folder or file
  ("where is my downloads?", "open Project Files folder") and it searches known
  user folders, shows the path on an approval card (with alternatives when the
  name is ambiguous), and opens it only after you press Open. Rust re-checks the
  approved path against allowed roots. `find_path` can return addresses without
  opening. Works with text-only providers for clear folder/file phrasing.
- Redesigned the Folder finder approval card with folder/file icons, copy-to-clipboard,
  monospaced path display, kind badges, and improved success/cancelled states.

## 0.1.2 - 2026-09-08

- Added the built-in App launcher plugin. Ask Perch to open an installed app
  ("open Spotify") and it matches the request against Start Menu shortcuts plus a
  fixed set of Windows apps, shows the exact entry on an approval card (with
  alternatives when the name is ambiguous), and opens it only after you press
  Open. Rust re-checks the approved entry against a fresh index, so the model can
  never name an arbitrary path. Works with text-only providers for a bare
  "open <app>" request.
- Fixed computer-control approval cards using an undefined `--muted` color and
  hand-rolled buttons; they now use the shared button primitives and design
  tokens, and the plugin's Settings description covers everything it does.
- Added a minimize/expand control to the persistent music bar.
- Made the Screen toggle capture only when a prompt is sent, use the latest view,
  and allow screen-only prompts without typed text.
- Improved web search with live DuckDuckGo results and limited prompt context to
  the three most relevant sources.
- Made pinning fully manual and independent from opening, focus, and generation;
  an unpinned widget clicked outside during generation collapses when output ends.
- Made Codex CLI responses fill progressively instead of appearing all at once.

## 0.1.1 - 2026-08-21

- Added the optional Computer control plugin for approval-gated text insertion
  into the last focused Windows app. Perch previews the exact target and text;
  insertion itself never submits, sends, or uploads anything.
- Added approval-gated browser navigation. Perch previews the exact HTTP(S)
  address, revalidates the previously focused supported browser, and navigates
  only after the user presses Open.
- Added approval-gated visual action plans for clicks, text, common navigation keys,
  and scrolling. Plans are bounded, shown step-by-step, and tied to the exact last
  focused window; sensitive and arbitrary keyboard actions remain unavailable.
- Kept the widget expanded while its chat input or another control has focus,
  with normal auto-hide resuming after both pointer and focus leave.
- Made independent tool calls execute concurrently while preserving model-visible
  result order, and required supported action requests to create their approval UI.
- Improved native failure diagnostics and made storage reads distinguish missing
  files from permission, corruption, and other filesystem errors.
- Made Web, Screen, and Music consent strictly per-message.
- Added show-before-send screen previews and local image redaction.
- Moved conversation images into bounded app-data assets.
- Migrated OpenAI streaming to the Responses API and request-scoped cancellation.
- Added CSP hardening, accessibility semantics, dependency automation, E2E checks,
  signed GitHub release/update automation, and project governance documents.
