import type { Provider, ModelInfo, StreamOpts } from "./types";
import { isTauri } from "../native";

const MODELS: ModelInfo[] = [
  { id: "codex-default", label: "Codex default" },
  { id: "gpt-5-codex", label: "GPT-5 Codex" },
  { id: "gpt-5", label: "GPT-5" },
  { id: "o3", label: "o3 · reasoning" },
  { id: "o4-mini", label: "o4-mini · reasoning" },
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
      return await invoke<boolean>("codex_available");
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
      invoke("codex_exec", { prompt, model: opts.model ?? "", onEvent: channel }).catch(
        (e) => fail(String(e)),
      );
    });
  },
};
