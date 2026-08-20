import type { Provider, ModelInfo, StreamOpts } from "./types";

const MODELS: ModelInfo[] = [
  { id: "mock-fast", label: "Perch Mock · fast" },
  { id: "mock-smart", label: "Perch Mock · smart" },
];

function composeReply(opts: StreamOpts): string {
  const last = [...opts.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const parts: string[] = [];

  // Mirror how a real model answers with web results: cite inline with the
  // bracketed numbers of the sources it was given, so the citation UI is
  // exercisable in the browser preview. Sources arrive in the system prompt on
  // the pre-fetch path and in tool results on the tool path — count both, or
  // the preview claims it found nothing while showing a source list.
  const cited = (
    [opts.system, ...opts.messages.filter((m) => m.role === "tool").map((m) => m.content)]
      .join("\n")
      .match(/^\[(\d+)\]/gm) ?? []
  ).length;
  if (opts.web) {
    parts.push(
      cited
        ? `Here's what the web says [1]${cited > 1 ? ", with a second source agreeing [2]" : ""}.\n\n`
        : "_Searched the web, but found nothing usable._\n\n",
    );
  }

  if (/\b(job|apply|applicable|resume|résumé|cv|role|position)\b/i.test(last)) {
    parts.push(
      `Looking at ${
        opts.screen
          ? "**the posting on your screen** and your résumé"
          : "what you've shared"
      }, this is a **strong match** — you line up on 6 of 8 core requirements:\n\n` +
        "- ✅ React + TypeScript (3+ yrs asked, you have it)\n" +
        "- ✅ REST / API integration\n" +
        "- ✅ Component-driven UI work\n" +
        "- ⚠️ Kubernetes — light exposure, worth a line in your cover letter\n" +
        "- ⚠️ Team lead experience — you can frame your mentoring here\n\n" +
        "**My call: apply.** The gaps are learnable and the core stack is right in your wheelhouse. Want me to draft a tailored cover letter?",
    );
  } else if (/\b(code|function|script|example|snippet|regex|component)\b/i.test(last)) {
    parts.push(
      'Here\'s a quick example:\n\n```ts\nfunction greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n\nconsole.log(greet("world"));\n```\n\nThat logs a greeting. Hit **Expand** on the block to open it in the canvas.',
    );
  } else if (last.trim().length === 0) {
    parts.push(
      "I'm your Perch assistant. Ask me anything — I can look at what's on your screen, search the web, and switch models. Try _\"Is this job applicable to me?\"_",
    );
  } else {
    parts.push(
      `Here's a quick take on **"${last.slice(0, 80)}"**:\n\n` +
        "This is the offline **mock** provider, so I'm returning a canned response to prove streaming, markdown, and the UI all work. " +
        (opts.screen ? "Screen context was **on** for this message. " : "") +
        "Connect a live model in Settings to get real answers.",
    );
  }
  return parts.join("");
}

export const mockProvider: Provider = {
  id: "mock",
  label: "Mock (offline demo)",
  defaultModel: MODELS[0].id,
  async listModels() {
    return MODELS;
  },
  async isAuthed() {
    return true; // offline demo — nothing to authenticate
  },
  // The mock drives the real tool loop so it can be exercised in the browser
  // preview, with no API key and no cost.
  supportsTools: true,
  async stream(opts: StreamOpts) {
    // First pass with a search tool available: ask for it, the way a real model
    // would. Second pass (tool results present) answers normally.
    const canSearch = opts.tools?.some((t) => t.name === "web_search");
    const alreadyRan = opts.messages.some((m) => m.role === "tool");
    if (canSearch && !alreadyRan && opts.onToolCalls) {
      const last = [...opts.messages].reverse().find((m) => m.role === "user");
      opts.onToolCalls([
        {
          id: "mock-call-1",
          name: "web_search",
          arguments: JSON.stringify({ query: last?.content ?? "" }),
        },
      ]);
      return;
    }

    const text = composeReply(opts);
    const tokens = text.split(/(\s+)/);
    for (const tk of tokens) {
      if (opts.signal?.aborted) return;
      opts.onDelta(tk);
      await new Promise((r) => setTimeout(r, 14 + Math.random() * 34));
    }
  },
};
