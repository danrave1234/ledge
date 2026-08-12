import { get } from "svelte/store";
import {
  ui,
  settings,
  messages,
  uid,
  saveActive,
  getPersona,
  type View,
} from "./stores";
import { getProvider } from "./providers";
import {
  dock,
  captureScreen,
  hidePanel,
  cancelStream,
  webSearch,
} from "./native";
import { pluginActive } from "./plugins";
import type { Msg } from "./types";

let abort: AbortController | null = null;

export async function redock() {
  await dock(get(settings).placement, get(ui).expanded);
}

export async function expand() {
  ui.update((u) => ({ ...u, expanded: true }));
  await dock(get(settings).placement, true);
}

export async function openPinned(view: View = "chat") {
  ui.update((u) => ({ ...u, expanded: true, pinned: true, view }));
  await dock(get(settings).placement, true);
}

export async function collapse(force = false) {
  const u = get(ui);
  if (!force && (u.pinned || u.generating)) return;
  ui.update((x) => ({ ...x, expanded: false, pinned: false }));
  await dock(get(settings).placement, false);
}

export async function toggle() {
  if (get(ui).expanded) await collapse(true);
  else await openPinned();
}

export function setView(view: View) {
  ui.update((u) => ({ ...u, view, expanded: true, pinned: true }));
}

async function captureBehindPanel(): Promise<string | undefined> {
  // Hide the widget first so it doesn't occlude / appear in the screenshot,
  // then restore the expanded panel.
  try {
    await hidePanel();
    await new Promise((r) => setTimeout(r, 90));
    return (await captureScreen()).data_url;
  } catch {
    return undefined; // unavailable (e.g. browser preview)
  } finally {
    await dock(get(settings).placement, true);
  }
}

export async function send(text: string) {
  const t = text.trim();
  if (!t || get(ui).generating) return;
  const s = get(settings);

  const userMsg: Msg = {
    id: uid(),
    role: "user",
    content: t,
    ts: Date.now(),
    usedScreen: s.screenContext,
    usedWeb: s.webSearch,
  };
  messages.update((m) => [...m, userMsg]);
  saveActive();

  const history = get(messages).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const asst: Msg = { id: uid(), role: "assistant", content: "", ts: Date.now() };
  messages.update((m) => [...m, asst]);
  ui.update((u) => ({ ...u, generating: true }));

  const mine = new AbortController();
  abort = mine;
  const provider = getProvider(s.providerId);
  const persona = getPersona(s.personaId);

  const image = s.screenContext ? await captureBehindPanel() : undefined;

  // System prompt = persona + ChatGPT-style personalization, shared by every provider.
  let system = persona.prompt;
  if (s.about?.trim()) system += `\n\nAbout the user:\n${s.about.trim()}`;
  if (s.style?.trim())
    system += `\n\nHow the user wants you to respond:\n${s.style.trim()}`;
  const mems = (s.memories ?? []).filter((m) => m.enabled).map((m) => m.text);
  if (mems.length)
    system +=
      "\n\nRemembered about the user:\n" + mems.map((m) => `- ${m}`).join("\n");

  // web-search plugin: fold live results into the system prompt.
  if (s.webSearch && pluginActive(s, "web-search")) {
    const results = await webSearch(t);
    if (results.length) {
      system +=
        "\n\nLive web results for the user's latest message (use and cite when relevant):\n" +
        results
          .map((r, i) => `${i + 1}. ${r.snippet}${r.url ? " — " + r.url : ""}`)
          .join("\n");
    }
  }

  try {
    await provider.stream({
      model: s.model,
      system,
      messages: history,
      screen: s.screenContext,
      web: s.webSearch,
      image,
      signal: mine.signal,
      onDelta: (d) =>
        messages.update((m) =>
          m.map((x) => (x.id === asst.id ? { ...x, content: x.content + d } : x)),
        ),
    });
  } catch (e) {
    if (!mine.signal.aborted) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      const isAuth = /api key|codex cli|sign in|not connected|not found|connect/i.test(msg);
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
      ui.update((u) => ({ ...u, generating: false }));
      abort = null;
    }
    saveActive();
  }
}

export function stop() {
  abort?.abort();
  abort = null;
  cancelStream();
  ui.update((u) => ({ ...u, generating: false }));
}
