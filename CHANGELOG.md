# Changelog

All notable changes are documented here. Ledge follows Semantic Versioning once
it reaches its first stable release.

## 0.2.1 - 2026-10-19

- Security: updated rustls (0.23.46), quinn-proto (0.11.19), and lopdf (0.42,
  via pdf-extract 0.12) for RUSTSEC advisories, including a stack overflow on
  deeply nested PDFs and TLS handshake issues. Dropped the updater's unused zip
  support (Windows updates are raw signed installers), removing a vulnerable
  zip crate. Added a real-PDF extraction test.
- CI: the dependency audit job now has its token and check-run permission, so
  it reports results instead of failing on setup.

## 0.2.0 - 2026-10-19

Perch is now **Ledge**.

- New name and logo: an "L" ledge with a spark resting on it. The app,
  tray, installer, executable (`ledge.exe`), and releases all say Ledge. Your
  history, settings, and saved keys carry over untouched.
- Motion throughout: the panel slides out of the edge it is docked to and back
  in when it closes, views slide in the direction you navigate, menus and
  toasts pop, and the handle fills while the hover delay counts down. Everything
  respects Windows' "reduce motion" setting.
- Undo instead of instant, permanent deletes for conversations, memories, and
  personas.
- Keyboard: Esc stops a reply, steps back, or collapses; Ctrl+N new chat;
  Ctrl+H history; Ctrl+, settings. The global hotkey is now recorded by
  pressing it, instead of typed (which registered half-typed shortcuts).
- Composer: an unsent message survives collapsing the panel; paste or drop
  images and files; the send button lights up only when there is something to
  send; reasoning effort is a small menu instead of a seven-step cycle.
- Screen review actually reviews: with "review before send" on, Send captures
  the screen for you to check and redact first (with Undo redactions); the
  next Send sends exactly that image.
- Empty-state suggestions only appear when they can work, and switch on the
  Web or Screen context they need.
- Failed replies have a Try again button.
- Approval cards (open app, open path, insert text, browser, steps) share one
  design, and remember how you answered — a card you approved no longer shows
  its Open button again after the panel reopens.
- History is grouped by day, with hover actions, Enter to open the top result,
  and Esc to clear the search.
- Settings: proper switches, a slider for the hover delay, API-key format
  check, two-click confirm instead of a native dialog when removing a plugin,
  and a new About page with version, updates, and shortcuts.
- Fixed: the panel could collapse right after a keyboard click when the
  focused button was replaced (Send → Stop, an approval → its receipt), or at
  startup when the app reset focus.
- Fixed undefined style tokens (copied state, history search field, monospace
  paths) and hand-rolled controls that drifted from the design system.

## 0.1.3 - 2026-09-21

- Added the built-in Folder finder plugin. Ask Perch to find a folder or file
  ("where is my downloads?", "open Project Files folder") and it searches known
  user folders, shows the path on an approval card (with alternatives when the
  name is ambiguous), and opens it only after you press Open. Rust re-checks the
  approved path against allowed roots. `find_path` can return addresses without
  opening. Works with text-only providers for clear folder/file phrasing.
- Redesigned the Folder finder approval card with folder/file icons, copy-to-clipboard,
  monospaced path display, kind badges, and improved success/cancelled states.
- Extended Folder finder to search Steam game libraries. Queries like "steam dota" or
  "find the steam dota folder" now discover installed games across all Steam library
  drives. The approval card shows a Steam source badge, parent location, and an
  "Open in File Explorer" button for folders. Platform hints (steam, epic, gog) are
  stripped from queries so the core game name still matches.
- Switched release packaging to NSIS-only. GitHub releases now ship a single
  installer (plus updater signatures) instead of both NSIS and MSI, reducing
  build time and release clutter.

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
