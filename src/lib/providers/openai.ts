import type { Provider, StreamOpts } from "./types";
import { isTauri, hasApiKey, streamOverChannel } from "../native";
import { OPENAI_FALLBACK_MODELS as MODELS } from "./models";

// Fallback list only — the live list is fetched via `openai_list_models` and the
// user can type any model ID (see ModelMenu). Do not treat this as canonical.
function withImage(text: string, image: string): unknown {
  return {
    role: "user",
    content: [
      { type: "input_text", text },
      { type: "input_image", image_url: image },
    ],
  };
}

/** Map the provider-neutral transcript to Responses API input items. */
function buildInput(opts: StreamOpts): unknown[] {
  const out: unknown[] = [];
  opts.messages.forEach((m, i) => {
    if (m.role === "tool") {
      out.push({
        type: "function_call_output",
        call_id: m.toolCallId,
        output: m.content,
      });
      return;
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      if (m.content) out.push({ role: "assistant", content: m.content });
      for (const c of m.toolCalls) {
        out.push({
          type: "function_call",
          call_id: c.id,
          name: c.name,
          arguments: c.arguments,
        });
      }
      return;
    }
    // Per-message image (the screen tool attaches one mid-loop), else the
    // turn-level attachment, which belongs to the final user message.
    const lastUser = m.role === "user" && i === opts.messages.length - 1;
    const image = m.image ?? (lastUser ? opts.image : undefined);
    if (m.role === "user" && image) out.push(withImage(m.content, image));
    else out.push({ role: m.role, content: m.content });
  });
  return out;
}

export const openaiProvider: Provider = {
  id: "openai",
  label: "OpenAI (API key)",
  defaultModel: MODELS[0].id,
  async listModels() {
    return MODELS;
  },
  async isAuthed() {
    return await hasApiKey();
  },
  supportsTools: true,
  async stream(opts: StreamOpts) {
    if (!isTauri()) {
      throw new Error(
        "Live models require the desktop app. Switch to the Mock provider in the browser preview.",
      );
    }
    await streamOverChannel(
      "openai_stream",
      {
        model: opts.model,
        input: buildInput(opts),
        instructions: opts.system,
        effort: opts.effort ?? "",
        safetyIdentifier: opts.safetyIdentifier,
        tools: (opts.tools ?? []).map((t) => ({
          type: "function",
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      },
      opts,
      true,
    );
  },
};
