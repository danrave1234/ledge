import type { Effort } from "../types";

export interface ModelInfo {
  id: string;
  label: string;
}

/** A tool the model may call, in JSON-Schema form. Plugins contribute these;
    see lib/tools.ts. Provider-agnostic on purpose — each provider maps it to
    whatever its own function-calling wire format is. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** One tool invocation the model asked for. `arguments` is the raw JSON string
    the model produced — parsing is the runner's job, so malformed arguments
    become a tool error the model can retry rather than a broken stream. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface WireMsg {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Set on an assistant turn that requested tools. */
  toolCalls?: ToolCall[];
  /** Set on a `tool` turn: which call this is the result of. */
  toolCallId?: string;
  /** Data URL attached to this turn, for vision. Used by the screen tool to
      hand the model the actual image alongside its OCR text. */
  image?: string;
}

export interface StreamOpts {
  model: string;
  system: string;
  messages: WireMsg[];
  onDelta: (t: string) => void;
  signal?: AbortSignal;
  screen?: boolean;
  web?: boolean;
  image?: string;
  effort?: Effort;
  /** Stable random per-install identifier for provider abuse monitoring. */
  safetyIdentifier?: string;
  /** Tools to offer this turn. Ignored by providers with `supportsTools: false`. */
  tools?: ToolSpec[];
  /** Called once if the model requested tools instead of (or as well as)
      answering. The caller runs them and streams again with the results. */
  onToolCalls?: (calls: ToolCall[]) => void;
}

export interface Provider {
  id: string;
  label: string;
  /** Model selected when the user switches to this provider. Single source of
      truth — nothing else should hardcode a model ID. */
  defaultModel: string;
  /** Fallback list, shown until (or unless) live model IDs are fetched. */
  listModels(): Promise<ModelInfo[]>;
  /** Whether the credential this provider needs is present. The model picker
      only lists a provider's models when this is true, so the user never picks
      a model that cannot answer. */
  isAuthed(): Promise<boolean>;
  /** Whether this provider can run the tool loop. False for backends we drive
      as a black box (the Codex CLI takes one prompt and answers), which fall
      back to pre-fetching context instead. */
  supportsTools: boolean;
  stream(opts: StreamOpts): Promise<void>;
}
