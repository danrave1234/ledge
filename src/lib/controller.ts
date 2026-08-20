import { get } from "svelte/store";
import {
  ui,
  settings,
  messages,
  activeId,
  uid,
  saveActive,
  setConversationTitle,
  setConversationSummary,
  activeSummary,
  getPersona,
  type View,
  type UiState,
} from "./stores";
import { getProvider, type Provider } from "./providers";
import type { WireMsg } from "./providers/types";
import { planContext, summaryPrompt, SUMMARY_SYSTEM } from "./context";
import { selectMemories } from "./memory";
import { dock, webSearch, type WebResult } from "./native";
import { toolSpecs, toolLabel, toolCapabilities, type ToolRunContext } from "./tools";
import { pluginContexts } from "./plugins/registry";
import { runTurn } from "./agent";
import { pluginActive } from "./plugins";
import { buildSystemPrompt } from "./prompt";
import type { ApprovedScreen, Msg, Settings, TurnConsent } from "./types";
import { persistImage } from "./assets";

let abort: AbortController | null = null;

/** Single place that talks to the native docker, so placement AND the chosen
    display are always applied together (multi-monitor correctness). */
async function applyDock(expanded: boolean) {
  const s = get(settings);
  await dock(s.placement, expanded, s.display);
}

/** Resize the window with nothing rendered, then reveal the new content. The
    blank gap is deliberate: the window is transparent, so it reads as a clean
    swap instead of the panel and handle both painting at the wrong size. */
async function resizeTo(expanded: boolean, patch: Partial<UiState> = {}) {
  ui.update((u) => ({ ...u, ...patch, expanded, resizing: true }));
  try {
    await applyDock(expanded);
  } finally {
    ui.update((u) => ({ ...u, resizing: false }));
  }
}

export async function redock() {
  await resizeTo(get(ui).expanded);
}

export async function expand() {
  await resizeTo(true);
}

/** Open pinned, resuming wherever the user was. Pass a view to force one.
 *  It used to default to "chat", so collapsing while reading Settings and
 *  re-opening dumped you back at the chat. */
export async function openPinned(view?: View) {
  await resizeTo(true, view ? { pinned: true, view } : { pinned: true });
}

export async function collapse(force = false) {
  const u = get(ui);
  if (!force && (u.pinned || u.generating)) return;
  await resizeTo(false, { pinned: false });
}

export async function toggle() {
  if (get(ui).expanded) await collapse(true);
  else await openPinned();
}

export function setView(view: View) {
  ui.update((u) => ({ ...u, view, expanded: true }));
}

/** Ask the model to fold older turns into the conversation's running notes.
 *  Best-effort: if it fails, the turns are simply sent verbatim next time. */
async function summarize(
  s: Settings,
  provider: Provider,
  previous: string | undefined,
  older: Msg[],
): Promise<string> {
  let notes = "";
  await provider.stream({
    model: s.model,
    system: SUMMARY_SYSTEM,
    messages: [{ role: "user", content: summaryPrompt(previous, older) }],
    screen: false,
    web: false,
    effort: "",
    safetyIdentifier: s.safetyId,
    signal: new AbortController().signal,
    onDelta: (d) => {
      notes += d;
    },
  });
  return notes.trim();
}

/** Build the transcript to send: everything already summarised is dropped, the
 *  rest is budgeted, and anything over budget is folded into the notes. */
async function buildHistory(
  s: Settings,
  provider: Provider,
  pendingReplyId: string,
): Promise<{ history: WireMsg[]; summary?: string }> {
  // The empty assistant placeholder isn't context.
  const all = get(messages).filter((m) => m.id !== pendingReplyId);
  const { summary: stored, summarizedThrough } = activeSummary();

  const covered = summarizedThrough
    ? all.findIndex((m) => m.id === summarizedThrough)
    : -1;
  const pending = covered >= 0 ? all.slice(covered + 1) : all;

  const { keep, compact } = planContext(pending);
  let summary = stored;

  if (compact.length) {
    try {
      summary = await summarize(s, provider, stored, compact);
      const id = get(activeId);
      if (id && summary) setConversationSummary(id, summary, compact.at(-1)!.id);
    } catch (e) {
      // Compaction is an optimisation, never a failure path.
      console.error("context compaction failed", e);
      return { history: toWire(pending), summary: stored };
    }
  }

  return { history: toWire(keep), summary };
}

function toWire(msgs: Msg[]): WireMsg[] {
  return msgs.map((m) => ({
    role: m.role as WireMsg["role"],
    content: m.content,
  }));
}

export interface SendOptions {
  attachment?: string;
  consent?: TurnConsent;
  approvedScreen?: ApprovedScreen;
}

const NO_CONSENT: TurnConsent = { web: false, screen: false, music: false };

export async function send(text: string, options: SendOptions = {}) {
  const t = text.trim();
  const attachment = options.attachment;
  const consent = options.consent ?? NO_CONSENT;
  if ((!t && !attachment && !options.approvedScreen) || get(ui).generating) return;
  const s = get(settings);
  const provider = getProvider(s.providerId);

  // Tools the model may call this turn, already gated on plugin + consent.
  // Empty for providers we drive as a black box (Codex), which instead get
  // context pre-fetched below exactly as before.
  const specs = provider.supportsTools ? toolSpecs(s, consent) : [];
  const toolMode = specs.length > 0;

  // Pre-fetch path (no tool loop): capture the screen up front, if opted in.
  const prefetchScreen =
    !provider.supportsTools && consent.screen && pluginActive(s, "screen-context");
  const screenText = prefetchScreen ? options.approvedScreen?.text : undefined;
  const image =
    attachment ?? (prefetchScreen ? options.approvedScreen?.image : undefined);
  const storedImage = await persistImage(image);

  const userMsg: Msg = {
    id: uid(),
    role: "user",
    content: t,
    ts: Date.now(),
    usedScreen: prefetchScreen && !!options.approvedScreen?.image,
    // In tool mode nothing has been used yet — the badges are set on the reply
    // once a tool actually runs, so they can never claim more than happened.
    usedWeb: false,
    ...storedImage, // reference is persisted; data URL remains runtime-only
  };
  messages.update((m) => [...m, userMsg]);
  saveActive();

  const asst: Msg = { id: uid(), role: "assistant", content: "", ts: Date.now() };
  messages.update((m) => [...m, asst]);
  ui.update((u) => ({ ...u, generating: true }));

  const mine = new AbortController();
  abort = mine;
  const persona = getPersona(s.personaId);

  // EVERYTHING from here down runs inside the try below. `generating` is already
  // true, and anything that throws before the `finally` leaves it stuck on — the
  // composer then silently swallows every later send with no way to recover
  // short of restarting. Context building and the pre-fetch search used to sit
  // outside it.
  try {
    // Context: recent turns go verbatim, older ones are represented by running
    // notes, so a long session neither costs a fortune nor overflows the window.
    const { history, summary } = await buildHistory(s, provider, asst.id);

    // Pre-fetch path only: search once, up front, for every message.
    let sources: WebResult[] = [];
    if (!toolMode && consent.web && pluginActive(s, "web-search")) {
      try {
        sources = await webSearch(t);
      } catch (e) {
        console.error("web search failed", e);
      }
      if (sources.length) {
        messages.update((m) => m.map((x) => (x.id === asst.id ? { ...x, sources } : x)));
        messages.update((m) =>
          m.map((x) => (x.id === userMsg.id ? { ...x, usedWeb: true } : x)),
        );
      }
    }

    const system = buildSystemPrompt({
      persona: persona.prompt,
      about: s.about,
      style: s.style,
      // Only the memories that relate to this message, rather than all of them
      // on every turn. The recent transcript supplies keywords for follow-ups
      // that have none of their own ("and the other one?").
      memories: selectMemories(s.memories ?? [], t, {
        context: history
          .slice(-4)
          .map((m) => m.content)
          .join(" "),
      }).map((m) => m.text),
      summary,
      // In tool mode results arrive as tool messages, so the system prompt
      // carries the citation rules but not a (yet nonexistent) source list.
      sources: toolMode ? [] : sources,
      tools: specs.map((x) => x.name),
      // Only claim what this turn's tools genuinely allow. On the pre-fetch
      // path (Codex) no tools are offered, so the claim narrows by itself.
      capabilities: toolMode ? toolCapabilities(s, consent) : [],
      pluginContext: pluginContexts(s, consent),
      screenImage: prefetchScreen && !!image,
      screenText: prefetchScreen ? screenText : undefined,
    });

    // The turn's working transcript. Tool rounds append to it; the stored
    // conversation only ever sees the user turn and the final reply.
    const wire: WireMsg[] = [...history];
    if (image) {
      const lastUser = wire.map((m) => m.role).lastIndexOf("user");
      if (lastUser >= 0) wire[lastUser] = { ...wire[lastUser], image };
    }

    const ctx: ToolRunContext = {
      settings: s,
      consent,
      approvedScreen: options.approvedScreen,
      sources: [...sources],
    };

    const turnResult = await runTurn(
      {
        provider,
        model: s.model,
        system,
        messages: wire,
        tools: specs,
        effort: s.effort,
        safetyIdentifier: s.safetyId,
        signal: mine.signal,
        ctx,
        screen: prefetchScreen,
        web: consent.web,
        image,
      },
      {
        onDelta: (d) =>
          messages.update((m) =>
            m.map((x) => (x.id === asst.id ? { ...x, content: x.content + d } : x)),
          ),
        // Say what's happening between rounds, or a turn that searches twice
        // just sits there looking frozen.
        onToolStart: (name) => ui.update((u) => ({ ...u, activity: toolLabel(name) })),
        // Reflect what actually ran: citations, badges, and the exact screenshot
        // the model saw (kept on the message so the user can review it).
        onRoundEnd: (st) => {
          ui.update((u) => ({ ...u, activity: null }));
          messages.update((m) =>
            m.map((x) =>
              x.id === asst.id
                ? {
                    ...x,
                    sources: st.sources.length ? st.sources : x.sources,
                    cards: st.cards.length ? st.cards : x.cards,
                    usedScreen: x.usedScreen || st.usedScreen,
                    usedWeb: x.usedWeb || st.usedWeb,
                    image: st.images.at(-1) ?? x.image,
                  }
                : x,
            ),
          );
        },
      },
    );
    const lastImage = turnResult.images.at(-1);
    if (lastImage) {
      const stored = await persistImage(lastImage);
      messages.update((m) => m.map((x) => (x.id === asst.id ? { ...x, ...stored } : x)));
    }
  } catch (e) {
    if (!mine.signal.aborted) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      const isAuth = /api key|codex cli|sign in|not connected|not found|connect/i.test(
        msg,
      );
      messages.update((m) =>
        m.map((x) =>
          x.id === asst.id
            ? {
                ...x,
                content: (x.content ? x.content + "\n\n" : "") + "⚠️ " + msg,
                error: true,
                action: isAuth ? "auth" : undefined,
              }
            : x,
        ),
      );
    }
  } finally {
    // Only the current generation may reset shared state — a superseded one must not.
    if (abort === mine) {
      ui.update((u) => ({ ...u, generating: false, activity: null }));
      abort = null;
    }
    saveActive();
  }

  // After the first successful exchange, name the conversation with the AI
  // (like ChatGPT). Fire-and-forget — never blocks or breaks the chat.
  const completedReply = get(messages).find((m) => m.id === asst.id);
  if (!mine.signal.aborted && !completedReply?.error) {
    const done = get(messages);
    const reply = done.find((m) => m.id === asst.id)?.content ?? "";
    if (reply.trim() && done.filter((m) => m.role === "user").length === 1) {
      void maybeGenerateTitle(s, t, reply, provider);
    }
  }
}

async function maybeGenerateTitle(
  s: Settings,
  userText: string,
  reply: string,
  provider: ReturnType<typeof getProvider>,
) {
  const id = get(activeId);
  if (!id) return;
  const conv = get(messages);
  // Skip the mock provider — its output isn't a real model.
  if (s.providerId === "mock") return;
  try {
    let title = "";
    await provider.stream({
      model: s.model,
      system:
        "You generate a short conversation title. Reply with ONLY a 3-6 word title, Title Case, no quotes, no punctuation at the end, no preamble.",
      messages: [
        {
          role: "user",
          content: `User: ${userText.slice(0, 500)}\nAssistant: ${reply.slice(0, 500)}\n\nTitle:`,
        },
      ],
      screen: false,
      web: false,
      effort: "",
      safetyIdentifier: s.safetyId,
      signal: new AbortController().signal,
      onDelta: (d) => {
        title += d;
      },
    });
    const clean = title
      .replace(/^["'\s]+|["'\s.]+$/g, "")
      .split(/\r?\n/)[0]
      .slice(0, 60)
      .trim();
    // Only apply if the conversation is still the same one and un-renamed.
    if (clean && get(activeId) === id && get(messages) === conv) {
      setConversationTitle(id, clean);
      saveActive();
    }
  } catch {
    /* leave the fallback title */
  }
}

export function stop() {
  abort?.abort();
  abort = null;
  ui.update((u) => ({ ...u, generating: false }));
}
