import type { Provider } from "./types";
import { mockProvider } from "./mock";
import { openaiProvider } from "./openai";
import { codexProvider } from "./codex";
import { isTauri } from "../native";

// Mock is a dev/browser-preview convenience only — not shipped in the app.
export const providers: Provider[] = isTauri()
  ? [openaiProvider, codexProvider]
  : [mockProvider, openaiProvider, codexProvider];

export function getProvider(id: string): Provider {
  return providers.find((p) => p.id === id) ?? providers[0] ?? mockProvider;
}

export type { Provider, ModelInfo } from "./types";
