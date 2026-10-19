import type { Provider, StreamOpts } from "./types";
import { isTauri, codexAvailable, codexLoggedIn, streamOverChannel } from "../native";
import { CODEX_FALLBACK_MODELS as MODELS } from "./models";

// Fallback list only — see the note in openai.ts. "codex-default" lets the CLI
// pick whatever model the user's Codex config already uses.
// Bridge to the official Codex CLI (uses the user's `codex login` / Sign in with
// ChatGPT). Codex `exec` takes a single prompt, so the conversation is flattened.
export const codexProvider: Provider = {
  id: "codex",
  label: "Codex CLI",
  defaultModel: MODELS[0].id,
  async listModels() {
    return MODELS;
  },
  async isAuthed() {
    return isTauri() && (await codexAvailable()) && (await codexLoggedIn());
  },
  // `codex exec` takes one prompt and returns one answer — there is no protocol
  // for handing a tool call back mid-turn. Ledge pre-fetches context for this
  // provider instead (see controller.ts).
  supportsTools: false,
  async stream(opts: StreamOpts) {
    if (!isTauri()) {
      throw new Error("The Codex bridge requires the desktop app.");
    }
    if (!(await codexAvailable())) {
      throw new Error(
        "Codex CLI not found. Install it (npm i -g @openai/codex) and run `codex login`, then reopen Ledge.",
      );
    }
    if (!(await codexLoggedIn())) {
      // Be specific about WHAT is not signed in: being signed into ChatGPT in a
      // browser, or into the Codex IDE extension, is a separate session from the
      // CLI's — so "but I am logged in" is a reasonable thing to think here.
      throw new Error(
        "The Codex CLI itself isn't signed in (`codex login status` reports Not logged in). " +
          "Being signed into ChatGPT in your browser or IDE is a separate session. " +
          "Run `codex login` in a terminal, or use Sign in with Codex in Settings → Account.",
      );
    }

    const prompt =
      (opts.system ? opts.system + "\n\n" : "") +
      opts.messages
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n\n");

    await streamOverChannel(
      "codex_exec",
      { prompt, model: opts.model ?? "", effort: opts.effort ?? "" },
      opts,
    );
  },
};
