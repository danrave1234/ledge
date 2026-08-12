import type { Provider } from "./types";
import { mockProvider } from "./mock";
import { openaiProvider } from "./openai";
import { codexProvider } from "./codex";

export const providers: Provider[] = [mockProvider, openaiProvider, codexProvider];

export function getProvider(id: string): Provider {
  return providers.find((p) => p.id === id) ?? mockProvider;
}

export type { Provider, ModelInfo, StreamOpts } from "./types";
