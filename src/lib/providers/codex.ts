import type { Provider, ModelInfo, StreamOpts } from "./types";
import { isTauri } from "../native";

const MODELS: ModelInfo[] = [
  { id: "codex-default", label: "Codex default" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
];

type ChatEvent =
  | { type: "delta"; delta: string }
  | { type: "done" }
  | { type: "error"; message: string };

// Bridge to the official Codex CLI (uses the user's `codex login` / Sign in with
// ChatGPT). Codex `exec` takes a single prompt, so the conversation is flattened.
export const codexProvider: Provider = {
  id: "codex",
  label: "Codex CLI",
  requiresAuth: true,
  async listModels() {
    return MODELS;
  },
  async isAuthed() {
    if (!isTauri()) return false;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<boolean>("codex_logged_in");
    } catch {
      return false;
    }
  },
  async stream(opts: StreamOpts) {
    if (!isTauri()) {
      throw new Error("The Codex bridge requires the desktop app.");
    }
    const { invoke, Channel } = await import("@tauri-apps/api/core");
    const available = await invoke<boolean>("codex_available").catch(() => false);
    if (!available) {
      throw new Error(
        "Codex CLI not found. Install it (npm i -g @openai/codex) and run `codex login`, then reopen Perch.",
      );
    }
    const loggedIn = await invoke<boolean>("codex_logged_in").catch(() => false);
    if (!loggedIn) {
      throw new Error(
        "Not signed in to Codex. Use the Sign in button (or run `codex login`), then try again.",
      );
    }

    const prompt =
      (opts.system ? opts.system + "\n\n" : "") +
      opts.messages
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n\n");

    const channel = new Channel<ChatEvent>();
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      const fail = (m: string) => {
        if (!settled) {
          settled = true;
          reject(new Error(m));
        }
      };
      channel.onmessage = (msg) => {
        if (opts.signal?.aborted) return done();
        if (msg.type === "delta") opts.onDelta(msg.delta);
        else if (msg.type === "done") done();
        else if (msg.type === "error") fail(msg.message);
      };
      opts.signal?.addEventListener("abort", done);
      invoke("codex_exec", {
        prompt,
        model: opts.model ?? "",
        effort: opts.effort ?? "",
        onEvent: channel,
      }).catch((e) => fail(String(e)));
    });
  },
};
