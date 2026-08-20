# Decisions

Why Perch is built this way. Each entry is a decision that is expensive to reverse
or easy to undo by accident.

## Tauri, not Electron

The widget is always running, so idle cost is the product. Tauri (Rust + the
system WebView2) gives ~27 MB idle and a ~3 MB installer; Electron would be an
order of magnitude more on both. Consequence: no Node APIs in the frontend, and
anything OS-level is a Rust command.

## Providers behind one interface

`Provider` (`listModels` / `isAuthed` / `stream` / `defaultModel`) is the only
contract the UI knows. This is what lets the app ship BYO-API-key today, ride a
Codex CLI session for personal use, and add a hosted backend later without the UI
changing.

**Constraint that must not be violated:** reusing consumer ChatGPT/Codex OAuth
tokens directly is against OpenAI's consumer terms for a product. The Codex path
shells out to the user's own official Codex CLI. Consumer auth stays out of any
shippable default.

The OpenAI adapter uses the Responses API with typed streaming events,
`reasoning.effort`, and a stable random `safety_identifier`. Chat Completions
compatibility is not a reason to maintain a second wire format.

## Model IDs are never hardcoded

OpenAI IDs churn faster than releases. The static lists in `openai.ts` / `codex.ts`
are fallbacks; the live list comes from `openai_list_models`, and the user can type
any ID (persisted in `settings.customModels`). `provider.defaultModel` is the only
answer to "which model when switching providers".

## The model picker is credential-gated

Listing a model the app cannot call means the user finds out by watching a send
fail. `providerAuth` (from `Provider.isAuthed()`) filters the list; with nothing
connected, only the Codex default is offered plus a route into the connect flow.

## Local-first storage, in app-data — not localStorage

Clearing the WebView2 cache is a supported, default-on maintenance action, and it
wipes localStorage. History, personas, and settings are atomic JSON files in the
OS app-data dir instead. localStorage remains only as the browser-preview fallback
and as a one-time migration source.

## Settings are versioned and migrated

The app auto-updates, so new code will read stores written by older builds.
`CURRENT_SCHEMA` + an ordered migration list is the contract; the alternative
(guessing at shapes inline) already produced silent data loss. See
[CONVENTIONS.md](CONVENTIONS.md) for the rules.

## Post-update cache clear

After the updater relaunches, the bundled frontend has changed but the WebView may
hold stale cached assets — the classic "updated and now it's broken" failure.
`reconcileVersion()` clears the cache exactly once per version change.

## Install-to-enable plugins

The core stays small; capabilities are opt-in. Core plugins (web-search,
screen-context) ship installed and toggleable but not removable. `plugins` is an
opt-OUT map so defaults live in one place — code, not stored data.

## Plugins register tools the model calls, not context we pre-stuff

Capabilities reach the model as function-calling **tools** (`lib/tools.ts`), and
the model decides when to use them. Web can refine queries across rounds. Screen
is different: its tool may use only the capture approved before send, so a model
round can never trigger an unseen recapture.

`Provider.supportsTools` gates it. The Codex bridge is false: `codex exec` takes
one prompt and returns one answer, with no way to hand a tool call back
mid-turn — so that provider keeps the pre-fetch path. Both paths are live and
must stay that way until Codex is driven over a protocol that supports tools.

The loop is capped at `MAX_TOOL_ROUNDS`, and the final round is offered **no**
tools, so a model that keeps reaching for them still has to produce an answer.
Tool failures come back as text the model can read — never a thrown error, which
would kill the whole reply.

## Tools are gated by consent, not just by plugin

A tool is offered only when its plugin is active AND the turn-scoped consent is
on. `TurnConsent` is never persisted and resets after submit. The model chooses
_whether to use_ a capability; it never chooses
whether it is _allowed_ one. This is what keeps the screen-context privacy rule
below intact now that the model can ask for a capture itself — with the Screen
toggle off, `read_screen` is not in the tool list at all, and `runTool` refuses
it a second time even if the model invents the name.

For the same reason the "used screen / used web" badges are set from tools that
actually ran, not from the toggles. The system prompt also forbids claiming a
search or a look at the screen that didn't happen.

## Computer control previews bounded actions; the user approves execution

The Computer control plugin exposes separate tools for text insertion, browser
navigation, and bounded visual action plans. Every tool creates a card with the target
window and exact proposed operation; it does not act. The user must explicitly approve,
after which Rust revalidates and focuses the same tracked window before sending input.

The visual plan is limited to 12 steps and supports normalized in-window clicks,
Unicode text, common navigation keys, and bounded scrolling. It is intended for visible
forms and controls after reviewing the screen, not open-ended autonomous operation.
Send, Submit, purchase, delete, authentication, passwords, arbitrary shortcuts, and
elevated windows remain unavailable. Browser navigation stays a separate approved
action restricted to HTTP(S) and an allowlist of browser processes.

Tool definitions and this plugin context are injected on every turn, so retrieval-
augmented generation is not used for tool awareness. RAG would add stale indexed
descriptions and another trust boundary without improving knowledge of the live tools.

Independent tool calls from one model round run concurrently to reduce latency,
but their results are returned in the model's original call order. Action requests
for an available tool must invoke it; prose that pretends an approval card exists
is not an acceptable substitute.

## Screen context is privacy-gated

Opt-in per message. Capture happens before generation and the composer shows the
exact image; drag redaction is applied locally and removes OCR from the payload.
The exact image the model saw is attached to the message. The widget excludes
itself from capture via
`SetWindowDisplayAffinity` (no hide/show flicker), and capture follows the display
the widget is docked to.

## Images are assets, not conversation JSON

Inline base64 made one conversation file grow without bound. New images are
bounded app-data assets and messages persist only an `imageRef`. Hydration resolves
references and migrates legacy inline images; deleting history deletes its assets.

## Cancellation is request-scoped

Chat, compaction, and automatic title work can overlap. Every native stream has a
unique id and cancellation targets only that id. A process-wide flag allowed one
request to cancel or reset another.

## The streaming preview renders stabilized markdown, the final message doesn't

Half-typed markdown is valid markdown that means something else: `**Total` is two
literal asterisks until its closer lands, then snaps to bold. Since the house
style asks for short bold labels and code spans, that flicker fired on nearly
every line. `stabilizeStreamMd()` closes what is still open — emphasis, code
spans, incomplete links, a table with no delimiter row yet — so text renders in
its final form from the first character and simply grows.

**It is only ever applied to the streaming preview.** The finished message goes
through `renderMd()` on the source exactly as the model wrote it, so nothing here
can alter stored output; the worst a bad guess can do is look wrong for 70ms.
Anything inside a code fence is left completely alone — an asterisk in a code
sample is literal text.

## Untrusted content is marked, not trusted

Screen text and web results are data, not instructions. They are wrapped in
`<untrusted_*>` markers, and `BASE_SYSTEM` tells the model never to follow
instructions inside them. Model output is sanitized before it reaches the DOM.

## Custom CSS was removed (2026-08-13)

Users could paste arbitrary CSS that restyled the whole widget. It broke on every
token or class rename, produced unreportable "the UI is broken" states, and let
styling hide or fake security-relevant UI. The accent picker covers the real want.
Migration v5 drops the stored value; `removeLegacyCustomCss()` clears any injected
element left in a warm WebView.

## Textless handle, user-chosen placement

The collapsed handle carries no text by explicit product decision. The hover strip
is deliberately larger than the visible handle — a 76×22 target was easy to miss,
which made hover-open feel broken.

Mouse leave schedules auto-hide only when focus is also outside the widget. This
keeps chat and settings stable while the user types or operates a control, while
outside clicks, explicit collapse, and ordinary idle hover behavior remain intact.

## Game mode hides the widget — it does not overlay games

It originally meant "stay on top of games". That was backwards: an always-on-top
widget sitting over a game's HUD, eating clicks meant for the game, is exactly
what people turn game mode ON to prevent. It now means what it means everywhere
else — get out of the way.

While enabled, a watcher polls the foreground window and hides Perch whenever any
fullscreen app has focus, restoring it when you leave. This policy is global: a
focused fullscreen app on any monitor hides the entire Perch window, even when
Perch is docked on another display. Detection is **geometric** (does the focused
window cover its whole monitor?) rather than a list of game executables: nothing
to maintain, and it catches games, video players, launchers, and emulators. The
window is hidden outright rather than moved or made click-through, so it can
neither be seen nor intercept input. On by default.
