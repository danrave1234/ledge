import { describe, it, expect } from "vitest";
import { migrateSettings } from "./migrations";
import { DEFAULT_SETTINGS, CURRENT_SCHEMA } from "./settings";
import type { Settings } from "../types";

/** A store as written by the very first builds: no schemaVersion at all. */
const legacyStore = {
  placement: "top",
  handle: "pill",
  providerId: "openai",
  model: "gpt-4o",
  effort: "ultra",
  theme: "dark",
  plugins: { "web-search": true, "screen-context": true, "job-analyzer": false },
  installedPlugins: ["job-analyzer"],
  customCss: ":root { --accent: red; }",
};

describe("migrateSettings", () => {
  it("migrates a store that predates schemaVersion", () => {
    // Regression: reading the version from the merged draft (defaults first)
    // made every pre-versioning store look current and skipped all migrations.
    const s = migrateSettings(legacyStore);
    expect(s.schemaVersion).toBe(CURRENT_SCHEMA);
    expect(s.handle).toBe("bar"); // v3: retired handle style
  });

  it("keeps only explicit opt-outs in the plugin map", () => {
    const s = migrateSettings(legacyStore);
    expect(s.plugins).toEqual({ "job-analyzer": false });
  });

  it("preserves what the user installed", () => {
    expect(migrateSettings(legacyStore).installedPlugins).toEqual(["job-analyzer"]);
  });

  it("drops the retired custom CSS setting", () => {
    const s = migrateSettings(legacyStore) as unknown as Record<string, unknown>;
    expect(s.customCss).toBeUndefined();
  });

  it("seeds per-provider model memory from the model in effect", () => {
    // An existing user's current choice must survive the upgrade, not reset to
    // the provider default.
    const s = migrateSettings({ ...legacyStore, providerId: "openai", model: "gpt-4o" });
    expect(s.modelByProvider).toEqual({ openai: "gpt-4o" });
    expect(s.model).toBe("gpt-4o");
  });

  it("gives a store with no model an empty per-provider map", () => {
    const s = migrateSettings({ ...legacyStore, model: "" });
    expect(s.modelByProvider).toEqual({});
  });

  it("repairs a corrupt per-provider map and model cache", () => {
    const s = migrateSettings({
      ...legacyStore,
      schemaVersion: 6,
      modelByProvider: "nope",
      fetchedModels: 7,
    });
    expect(s.modelByProvider).toEqual({});
    expect(s.fetchedModels).toEqual([]);
  });

  it("coerces enum fields the UI can no longer render", () => {
    const s = migrateSettings({ ...legacyStore, placement: "bottom", theme: "neon" });
    expect(s.effort).toBe(DEFAULT_SETTINGS.effort);
    expect(s.placement).toBe(DEFAULT_SETTINGS.placement);
    expect(s.theme).toBe(DEFAULT_SETTINGS.theme);
  });

  it("drops a selection pointing at a provider this build doesn't register", () => {
    const s = migrateSettings({ ...legacyStore, providerId: "gone", model: "ghost-1" });
    expect(s.providerId).toBe(DEFAULT_SETTINGS.providerId);
    expect(s.model).toBe(DEFAULT_SETTINGS.model);
  });

  it("keeps a selection whose provider IS registered", () => {
    // The mock is registered in the browser preview (not in the packaged app);
    // a blanket "mock" reset used to discard the dev's choice on every reload.
    const s = migrateSettings({
      ...legacyStore,
      providerId: "mock",
      model: "mock-smart",
    });
    expect(s.providerId).toBe("mock");
    expect(s.model).toBe("mock-smart");
  });

  it("restores the remembered model when falling back to the default provider", () => {
    const s = migrateSettings({
      ...legacyStore,
      providerId: "gone",
      model: "ghost-1",
      schemaVersion: 6,
      modelByProvider: { [DEFAULT_SETTINGS.providerId]: "gpt-4o" },
    });
    expect(s.providerId).toBe(DEFAULT_SETTINGS.providerId);
    expect(s.model).toBe("gpt-4o");
  });

  it("turns game mode on when upgrading from an older store", () => {
    expect(migrateSettings({ ...legacyStore, gameMode: false }).gameMode).toBe(true);
  });

  it("leaves game mode alone once the store is already current", () => {
    // Turning it back off must stick — the one-time flip only runs on upgrade.
    const current = migrateSettings(legacyStore);
    const off = migrateSettings({ ...current, gameMode: false });
    expect(off.gameMode).toBe(false);
  });

  it("adds the default hover-open delay when upgrading", () => {
    const s = migrateSettings({ ...legacyStore, schemaVersion: 10 });
    expect(s.hoverOpenDelay).toBe(0.5);
  });

  it.each([-1, 3.1, Number.NaN, "slow"])(
    "repairs an invalid hover-open delay of %s",
    (hoverOpenDelay) => {
      const s = migrateSettings({
        ...legacyStore,
        schemaVersion: CURRENT_SCHEMA,
        hoverOpenDelay,
      });
      expect(s.hoverOpenDelay).toBe(DEFAULT_SETTINGS.hoverOpenDelay);
    },
  );

  it("preserves a valid configured hover-open delay", () => {
    const s = migrateSettings({
      ...legacyStore,
      schemaVersion: CURRENT_SCHEMA,
      hoverOpenDelay: 1.2,
    });
    expect(s.hoverOpenDelay).toBe(1.2);
  });

  it("keeps user data intact on an already-current store", () => {
    const current = migrateSettings(legacyStore);
    const again = migrateSettings(current);
    expect(again).toEqual(current); // idempotent
  });

  it("never downgrades a store written by a newer build", () => {
    const s = migrateSettings({ ...legacyStore, schemaVersion: 99 });
    expect(s.schemaVersion).toBe(99);
  });

  it.each([null, undefined, "nope", 42, []])("falls back to defaults for %s", (bad) => {
    expect(migrateSettings(bad)).toEqual(DEFAULT_SETTINGS);
  });

  it("repairs corrupt array and object fields", () => {
    const s = migrateSettings({
      ...legacyStore,
      memories: "not an array",
      customModels: null,
      plugins: 5,
    });
    expect(s.memories).toEqual([]);
    expect(s.customModels).toEqual([]);
    expect(s.plugins).toEqual({});
  });

  it("removes sticky turn consent while keeping the one-time music confirmation", () => {
    const s = migrateSettings({
      ...legacyStore,
      webSearch: true,
      screenContext: true,
      music: true,
      musicConfirmed: true,
    }) as Settings & Record<string, unknown>;
    expect(s.webSearch).toBeUndefined();
    expect(s.screenContext).toBeUndefined();
    expect(s.music).toBeUndefined();
    expect(s.musicConfirmed).toBe(true);
  });

  it("drops malformed memory entries but keeps good ones", () => {
    const s = migrateSettings({
      ...legacyStore,
      memories: [{ id: "1", text: "keeps this", enabled: true }, null, { id: "2" }, 7],
    });
    expect(s.memories).toHaveLength(1);
    expect(s.memories[0].text).toBe("keeps this");
  });
});
