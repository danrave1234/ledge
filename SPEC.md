# Edge AI Widget — Build & Product Spec

> Working codename: **Perch** (a small assistant that perches on the edge of your screen). Name is a placeholder — TBD.
>
> Status: Draft v0.1 · Last updated 2026-08-12 · Owner: Zach

---

## 1. One-line pitch

An always-on, edge-docked AI companion for Windows that stays out of the way as a small textless handle, hover-opens into a chat panel, can optionally see your screen and search the web, remembers history, talks in your voice, and is built so every capability beyond the core is an opt-in plugin. Lightweight by design — it should never feel like a full application sitting in RAM.

---

## 2. Goals & non-goals

### Goals
- Feel *native and calm* — a quiet handle at the screen edge, smooth hover-to-open, fully themeable UI.
- Be genuinely lightweight (see performance budget, §16). Not a browser-in-a-box.
- Ship a small **core**; everything else is an opt-in **plugin**.
- Support the flagship use case: "Is this job applicable to me? Should I apply?" — with optional screen context.
- Be architected so it can grow from *personal tool* into a *sellable product* without a rewrite.
- Run on Windows startup; work across any monitor size and multi-monitor setups.

### Non-goals (for v1)
- Not a full IDE or coding agent (though the provider layer can reach coding models).
- Not a cloud service at launch — local-first. A backend is optional and comes later.
- Not cross-platform at launch — Windows first. (Tauri keeps macOS/Linux open later.)
- No account system of our own in v1 (auth is delegated to the AI provider).

---

## 3. Target users & key use cases

**Primary user:** a power PC user who lives on their desktop and wants an assistant one hover away, with context about what's on screen.

**Flagship use cases**
1. **Job applicability** — "Is this job applicable to me? Should I apply?" → reads the posting on screen + your résumé, returns a match verdict and can draft a cover letter.
2. **Explain / act on what's on screen** — summarize the page, explain an error, rewrite a paragraph.
3. **Quick ask** — a fast, model-switchable chat that's always a hover away, no window juggling.
4. **Clipboard follow-up** — "explain what I just copied."
5. **Web-aware answers** — pull live results when the question needs them.

---

## 4. Authentication & provider layer

### Decision
Build a **provider abstraction** from day one. The same app supports multiple backends behind one interface; the UI and plugins never talk to a provider directly.

```
ChatInterface  ──▶  ProviderLayer  ──▶  ┌─ ChatGPT/Codex sign-in  (FIRST)
                                        ├─ OpenAI API key (BYO)
                                        ├─ Other providers (Anthropic, etc.)
                                        └─ Hosted backend (product tier)
```

### First path to wire up: **Sign in with ChatGPT / Codex**
- Uses the OAuth "Sign in with ChatGPT" flow (the same mechanism OpenAI's Codex CLI uses for Plus/Pro subscribers).
- Flow: launch system browser → user authorizes → we receive a token via loopback redirect → store it encrypted in the OS credential store → refresh as needed.
- Tokens **never** leave the device; no plaintext on disk.

> ⚠️ **Compliance caveat (must stay visible through the whole project).** Riding a consumer ChatGPT/Codex subscription is fine for *your personal* build, but productizing an app that uses consumer auth for general chat is against OpenAI's consumer terms and risks token/account revocation. The **provider layer is the mitigation**: personal builds use ChatGPT sign-in; the shippable product uses BYO API key or a hosted backend. Keep these cleanly separated by build/config — never ship consumer-auth as the product default.

### Provider interface (sketch)
```ts
interface Provider {
  id: string
  listModels(): Promise<Model[]>
  chat(req: ChatRequest, onDelta: (t: string) => void): Promise<ChatResult> // streaming
  supportsVision: boolean
  supportsTools: boolean
  auth: AuthStrategy // oauth | apiKey | backend
}
```

---

## 5. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Shell | **Tauri (Rust core + WebView2)** | ~40–90 MB idle RAM, tiny installer, native OS integration; UI still web tech |
| UI | HTML/CSS/JS (framework TBD — lean; Svelte or vanilla + Vite) | Full custom CSS/themes, smooth animation, responsive |
| Storage | SQLite (via Tauri SQL plugin) | Local, lightweight history + settings |
| Secrets | OS credential store (Windows Credential Manager) | Encrypted token storage |
| Packaging | Tauri bundler → MSI/NSIS installer | Small, signed installer; autostart hook |

**Why not Electron:** heavier RAM (150–300 MB) and ~85 MB+ installer cut directly against the "not a full app" requirement. Tauri gets the same web-UI flexibility without the weight.

**Rust surface is small:** window management, autostart, global hotkey, screen capture, and the credential store. Everything user-facing is web tech.

---

## 6. High-level architecture

```
┌─ Tauri shell (Rust) ───────────────────────────────────────┐
│  Window manager  · autostart · global hotkey · screen grab  │
│  SQLite (history/settings) · encrypted token store          │
│                                                             │
│  ┌─ Provider layer ────────────────────────────────────┐    │
│  │  ChatGPT/Codex sign-in │ API key │ backend │ others  │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─ Plugin host ───────────────────────────────────────┐    │
│  │  registers TOOLS the model can call + optional UI    │    │
│  │  web-search · screen-context · job-analyzer · …      │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  WebView2 UI  ·  edge widget  ·  chat  ·  settings  ·  themes │
└─────────────────────────────────────────────────────────────┘
```

**Core (always on):** edge widget, chat + streaming, model switch, history, personality, settings, auth/provider layer.
**Everything else:** plugins.

---

## 7. The edge widget — UX spec

### Resting state (collapsed)
- **Textless handle** docked flush to a screen edge. Candidate looks: *Spark dot* (recommended), *Pulse dot* (draws attention on new activity), *Thin bar* (most minimal).
- Placement is a **user setting**: top-center, left edge, or right edge. Per-monitor aware.
- Semi-transparent at rest; solidifies on hover. Never steals focus.

### Open behavior
- **Hover-to-open** (with a small delay to avoid accidental triggers) *and* click-to-pin. Global hotkey also summons it.
- Slides/expands from the docked edge into the chat panel with a smooth spring animation.
- **Auto-collapse** on mouse-leave unless pinned or mid-generation.

### Open panel contents
- Header: model switcher · history · settings · collapse.
- Conversation area (streaming responses).
- Quick-action chips (context-aware; e.g. "Match to résumé", "Draft cover letter").
- Input bar with per-message toggles: **Web**, **Screen**, **Attach**, **Voice** (voice = plugin).

### States to design
`collapsed · hover · opening · idle-open · generating · error · offline · needs-auth · needs-consent (screen)`

### Responsiveness & multi-monitor
- Panel width/height adapt to screen size; min/max clamps.
- Remembers which monitor + edge; handles monitor hotplug and DPI changes.

---

## 8. Chat core

- **Streaming** token-by-token rendering.
- **Model switcher** in the header, populated by the active provider's `listModels()`.
- **History**: conversations stored in SQLite, searchable, resumable; delete/export per conversation.
- **Personality** injected as the system prompt (see §12).
- Markdown rendering, code blocks with copy, basic attachments (drag a file/image in).

---

## 9. Plugin system

### Principle
Small core; capabilities are opt-in plugins that (a) register **tools the model can call** (function-calling style) and (b) optionally contribute **UI** (chips, settings panels, toggles).

### Plugin manifest (sketch)
```json
{
  "id": "job-analyzer",
  "name": "Job Analyzer",
  "version": "0.1.0",
  "permissions": ["screen-context", "storage:resume"],
  "tools": [
    { "name": "assess_job_fit", "description": "...", "schema": { } }
  ],
  "ui": { "chips": ["Match to résumé", "Draft cover letter"], "settings": true }
}
```

### Lifecycle & isolation
- Enable/disable per install; disabled plugins load nothing (protects the RAM budget).
- Each plugin declares **permissions** (screen, clipboard, web, storage scopes); the host enforces them and surfaces them to the user.
- Plugins run sandboxed; no ambient access to the token store or other plugins' data.
- Roadmap: a plugin registry so third parties (and eventually a marketplace) can ship their own.

### First-party plugins (planned)
| Plugin | Does | Notes |
|---|---|---|
| `web-search` | Live web results as a tool | Pick a search API/provider |
| `screen-context` | Screenshot + vision, consent-gated | Privacy-critical (§10) |
| `job-analyzer` | The flagship job-fit flow | Depends on `screen-context` + résumé storage |
| `clipboard` | "Explain what I copied" | Reads clipboard on demand only |
| `personas` | Personality packs + custom editor | §12 |
| `voice` | Dictation input | Opt-in |

---

## 10. Screen context & privacy

This is the most sensitive capability and a product-blocker if done carelessly.

- **Off by default.** Screen context is opt-in per install *and* per message (the Screen toggle in the input bar).
- **Show-before-send**: user sees exactly what will be captured (thumbnail/preview) before it leaves the device; option to cancel or redact regions.
- **Scope options**: full screen · active window only · selected region.
- **No always-on capture, no background screenshots.** Every capture is user-initiated.
- **Data flow**: capture → (optional local redaction) → provider vision call → discard image unless the user saves the conversation with it.
- Clear indicator in the transcript when screen context was used ("used screen context").
- Vision calls cost more and can be slower — surface that so it's a deliberate choice.

---

## 11. Web search plugin

- Exposed as a tool the model calls when a question needs fresh info.
- Returns ranked results + snippets; the model cites what it used.
- Provider TBD (evaluate cost, quality, and terms). Toggle in the input bar (**Web**).

---

## 12. Personality / persona system

- Personality = an editable **system prompt** + optional style parameters.
- Ship a few presets; let the user write a **custom persona** to match their ChatGPT mannerisms (paste their ChatGPT "custom instructions" as a starting point).
- Personas are stored locally and switchable per conversation.
- Delivered as the `personas` plugin so it stays optional and extensible.

---

## 13. Settings & theming

- Placement (top/left/right, per monitor), handle style, hover delay, hotkey.
- Startup on/off, default model, default persona.
- Plugin manager (enable/disable, permissions view).
- **Theming**: token-based themes + a **custom CSS** escape hatch for full control.

---

## 14. Data & security

- **Local-first**: history and settings in on-device SQLite.
- **Tokens/keys** in the Windows Credential Manager, never plaintext.
- Plugin permission model gates screen/clipboard/web/storage access.
- Export/delete controls for history; clear "what's stored where" in settings.

---

## 15. OS integration

- **Autostart** via Tauri autostart plugin (registry Run key), toggleable in settings.
- **Global hotkey** to summon/open the panel.
- Always-on-top, borderless, click-through where appropriate; respects fullscreen apps (auto-hide over games/video).

---

## 16. Performance budget

| Metric | Target |
|---|---|
| Idle RAM | ≤ ~90 MB (stretch: ≤ 60 MB) |
| Installer size | ≤ ~10 MB |
| Cold start to handle visible | ≤ ~1.5 s |
| Hover-open animation | 60 fps, ≤ ~200 ms |

Disabled plugins must contribute ~0 to idle RAM. Revisit budget after the vision plugin lands (vision is the heavy path).

---

## 17. Product & monetization (later)

- The provider layer is what makes a product possible: personal build uses ChatGPT sign-in; **product** uses BYO API key or a hosted backend with our billing.
- Possible models: free core + paid plugins; one-time license; or subscription for the hosted-backend tier.
- Compliance: keep consumer-auth strictly out of the shipped product default (§4 caveat).
- Licensing/telemetry/update channel: TBD.

---

## 18. Roadmap / milestones

**M1 — Skeleton**
Tauri edge window that docks + hover-opens, textless handle, top/left/right setting, autostart, global hotkey.

**M2 — Chat core**
Streaming chat, model switcher, history (SQLite), personality editor.

**M3 — Provider layer**
ChatGPT/Codex sign-in wired first; interface ready for API-key/backend.

**M4 — First plugins**
`web-search`, then `screen-context` + `job-analyzer` with the consent gate.

**M5 — Polish & package**
Themes/custom CSS, quick-action chips, installer, performance pass.

*(Later: plugin registry/marketplace, hosted-backend product tier, macOS/Linux.)*

---

## 19. Open questions / risks

- **Auth compliance** — confirm exactly which ChatGPT/Codex sign-in usage is permitted for personal use; design the product path to avoid it. *(highest risk)*
- **Web search provider** — cost/quality/terms selection.
- **UI framework** — vanilla vs Svelte vs other (bias: lean).
- **Vision cost/latency** — validate the job-analyzer flow is fast enough to feel good.
- **Handle style** — final pick between Spark dot / Pulse dot / Thin bar.
- **App name** — replace the "Perch" placeholder.

---

## 20. Decisions locked so far

- Provider layer for auth; **ChatGPT/Codex sign-in first**.
- **Tauri** stack.
- **User-configurable placement** (top/left/right), **textless handle**.
- Small core + **opt-in plugins**.
- **Local-first**, privacy-gated screen context.
