import type { ModelInfo } from "./types";

/** Small offline fallback only. Live OpenAI IDs come from the Models API. */
export const OPENAI_FALLBACK_MODELS: ModelInfo[] = [
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
];

export const CODEX_FALLBACK_MODELS: ModelInfo[] = [
  { id: "codex-default", label: "Codex default" },
  ...OPENAI_FALLBACK_MODELS,
];
