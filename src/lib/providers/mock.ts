import type { Provider, ModelInfo, StreamOpts } from "./types";

const MODELS: ModelInfo[] = [
  { id: "mock-fast", label: "Perch Mock · fast" },
  { id: "mock-smart", label: "Perch Mock · smart" },
];

function composeReply(opts: StreamOpts): string {
  const last =
    [...opts.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const parts: string[] = [];

  if (opts.web) parts.push("_Searched the web for a moment…_\n\n");

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
  } else if (
    /\b(code|function|script|example|snippet|regex|component)\b/i.test(last)
  ) {
    parts.push(
      "Here's a quick example:\n\n```ts\nfunction greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n\nconsole.log(greet(\"world\"));\n```\n\nThat logs a greeting. Hit **Expand** on the block to open it in the canvas.",
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
  requiresAuth: false,
  async listModels() {
    return MODELS;
  },
  async isAuthed() {
    return true;
  },
  async stream(opts: StreamOpts) {
    const text = composeReply(opts);
    const tokens = text.split(/(\s+)/);
    for (const tk of tokens) {
      if (opts.signal?.aborted) return;
      opts.onDelta(tk);
      await new Promise((r) => setTimeout(r, 14 + Math.random() * 34));
    }
  },
};
