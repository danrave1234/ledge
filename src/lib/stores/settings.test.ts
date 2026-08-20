import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import { settings, DEFAULT_SETTINGS, selectModel, setProvider } from "./settings";

beforeEach(() => settings.set({ ...DEFAULT_SETTINGS, modelByProvider: {} }));

describe("model selection", () => {
  it("records the pick against its provider", () => {
    selectModel("openai", "gpt-4o");
    const s = get(settings);
    expect(s.providerId).toBe("openai");
    expect(s.model).toBe("gpt-4o");
    expect(s.modelByProvider.openai).toBe("gpt-4o");
  });

  it("restores the last model used with a provider when switching back", () => {
    // The actual complaint: pick a model, switch provider, come back, and the
    // choice was replaced by the provider default.
    selectModel("openai", "gpt-4o");
    setProvider("codex");
    expect(get(settings).model).not.toBe("gpt-4o");

    setProvider("openai");
    expect(get(settings).model).toBe("gpt-4o");
  });

  it("falls back to the provider default the first time", () => {
    setProvider("codex");
    const s = get(settings);
    expect(s.providerId).toBe("codex");
    expect(s.model).toBeTruthy();
    expect(s.modelByProvider.codex).toBe(s.model);
  });

  it("keeps each provider's choice independent", () => {
    selectModel("openai", "gpt-4o");
    selectModel("codex", "codex-default");
    expect(get(settings).modelByProvider).toEqual({
      openai: "gpt-4o",
      codex: "codex-default",
    });
  });

  it("never pairs a provider with another provider's model", () => {
    selectModel("openai", "gpt-4o");
    setProvider("codex");
    const s = get(settings);
    expect(s.modelByProvider[s.providerId]).toBe(s.model);
  });
});
