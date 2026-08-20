import { describe, it, expect } from "vitest";
import { curateModels, isBaseModel, labelFor } from "./models";

/** Shaped like a real /v1/models response: aliases mixed with snapshots. */
const RAW = [
  "gpt-4o-2024-08-06",
  "gpt-3.5-turbo-16k",
  "gpt-5.6-luna",
  "gpt-4-0613",
  "gpt-4o",
  "gpt-5.6-sol",
  "chatgpt-4o-latest",
  "o3-mini",
  "gpt-4.1",
  "gpt-5.6-terra",
  "gpt-4-turbo-preview",
];

const ids = (m: { id: string }[]) => m.map((x) => x.id);

describe("isBaseModel", () => {
  it("rejects dated snapshots", () => {
    expect(isBaseModel("gpt-4o-2024-08-06")).toBe(false);
    expect(isBaseModel("gpt-4-0613")).toBe(false);
    expect(isBaseModel("gpt-4.1-2025-04-14")).toBe(false);
  });

  it("rejects preview and legacy families", () => {
    expect(isBaseModel("gpt-4-turbo-preview")).toBe(false);
    expect(isBaseModel("chatgpt-4o-latest")).toBe(false);
    expect(isBaseModel("gpt-3.5-turbo-16k")).toBe(false);
    expect(isBaseModel("gpt-4-32k")).toBe(false);
  });

  it("keeps clean aliases", () => {
    for (const id of ["gpt-5.6-sol", "gpt-4o", "gpt-4.1", "o3-mini", "gpt-4"]) {
      expect(isBaseModel(id)).toBe(true);
    }
  });

  it("does not mistake a version for a date", () => {
    // gpt-4.1 and gpt-5.6 end in digits but are not snapshots.
    expect(isBaseModel("gpt-4.1")).toBe(true);
    expect(isBaseModel("gpt-5.6")).toBe(true);
  });
});

describe("curateModels", () => {
  it("puts sol, terra, luna first, in that order", () => {
    expect(ids(curateModels(RAW).primary).slice(0, 3)).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ]);
  });

  it("keeps the older gpt-4 line available, below the current one", () => {
    const primary = ids(curateModels(RAW).primary);
    expect(primary).toContain("gpt-4o");
    expect(primary).toContain("gpt-4.1");
    expect(primary.indexOf("gpt-5.6-sol")).toBeLessThan(primary.indexOf("gpt-4o"));
  });

  it("collapses snapshots and legacy models instead of dropping them", () => {
    const { primary, more } = curateModels(RAW);
    expect(primary.map((m) => m.id)).not.toContain("gpt-4o-2024-08-06");
    expect(ids(more)).toContain("gpt-4o-2024-08-06");
    expect(ids(more)).toContain("gpt-3.5-turbo-16k");
    // Nothing is lost.
    expect(primary.length + more.length).toBe(RAW.length);
  });

  it("de-duplicates, ignoring surrounding whitespace", () => {
    const { primary } = curateModels(["gpt-4o", "gpt-4o", " gpt-4o "]);
    expect(ids(primary)).toEqual(["gpt-4o"]);
  });

  it("stores trimmed IDs — they are sent to the provider verbatim", () => {
    expect(ids(curateModels([" gpt-4o "]).primary)).toEqual(["gpt-4o"]);
  });

  it("drops blank entries", () => {
    const { primary, more } = curateModels(["", "   ", "gpt-4o"]);
    expect(primary.length + more.length).toBe(1);
  });

  it("handles an empty list", () => {
    expect(curateModels([])).toEqual({ primary: [], more: [] });
  });
});

describe("labelFor", () => {
  it("names the moon models the way the UI shows them", () => {
    expect(labelFor("gpt-5.6-sol")).toBe("GPT-5.6 Sol");
    expect(labelFor("gpt-5.6-terra")).toBe("GPT-5.6 Terra");
    expect(labelFor("gpt-5.6-luna")).toBe("GPT-5.6 Luna");
  });

  it("uppercases the GPT prefix and leaves the rest alone", () => {
    expect(labelFor("gpt-4o")).toBe("GPT-4o");
    expect(labelFor("gpt-4.1")).toBe("GPT-4.1");
  });

  it("passes through IDs that aren't GPT-prefixed", () => {
    expect(labelFor("o3-mini")).toBe("o3-mini");
  });
});
