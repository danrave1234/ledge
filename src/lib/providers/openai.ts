import type { Provider, ModelInfo, StreamOpts } from "./types";
import { isTauri, hasApiKey } from "../native";

const MODELS: ModelInfo[] = [
  { id: "gpt-5", label: "GPT-5" },
  { id: "gpt-5-mini", label: "GPT-5 mini" },
  { id: "gpt-4.1", label: "GPT-4.1" },
  { id: "o3", label: "o3 · reasoning" },
  { id: "o4-mini", label: "o4-mini · reasoning" },
];

type ChatEvent =
  | { type: "delta"; delta: string }
  | { type: "done" }
  | { type: "error"; message: string };

function buildMessages(opts: StreamOpts): unknown[] {
  const out: unknown[] = [];
  if (opts.system) out.push({ role: "system", content: opts.system });
  opts.messages.forEach((m, i) => {
    const lastUser = m.role === "user" && i === opts.messages.length - 1;
    if (lastUser && opts.image) {
      out.push({
        role: "user",
        content: [
          { type: "text", text: m.content },
          { type: "image_url", image_url: { url: opts.image } },
        ],
      });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  });
  return out;
}

export const openaiProvider: Provider = {
  id: "openai",
  label: "OpenAI (API key)",
  requiresAuth: true,
  async listModels() {
    return MODELS;
  },
  async isAuthed() {
    return await hasApiKey();
  },
  async stream(opts: StreamOpts) {
    if (!isTauri()) {
      throw new Error(
        "Live models require the desktop app. Switch to the Mock provider in the browser preview.",
      );
    }
    const { invoke, Channel } = await import("@tauri-apps/api/core");
    const messages = buildMessages(opts);
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
      invoke("openai_stream", { model: opts.model, messages, onEvent: channel }).catch(
        (e) => fail(String(e)),
      );
    });
  },
};
