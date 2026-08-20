import { describe, it, expect } from "vitest";
import { migratePluginState, storageKey, type PluginStateSpec } from "./plugin-state";

interface Demo {
  schemaVersion?: number;
  service: string;
  volume: number;
  devices: string[];
}

const spec: PluginStateSpec<Demo> = {
  id: "demo",
  schema: 3,
  defaults: { schemaVersion: 3, service: "spotify", volume: 50, devices: [] },
  migrations: [
    {
      to: 2,
      describe: "volume added",
      apply(draft) {
        if (typeof draft.volume !== "number") draft.volume = 50;
      },
    },
    {
      to: 3,
      describe: "service renamed from provider",
      apply(draft, stored) {
        // Presence checked against `stored`, not the merged draft.
        if (typeof stored.provider === "string") draft.service = stored.provider;
        delete draft.provider;
      },
    },
  ],
};

describe("plugin state storage", () => {
  it("namespaces each plugin into its own file", () => {
    // Core settings must never be a dumping ground for plugin config, and one
    // plugin must not be able to clobber another's keys.
    expect(storageKey("music")).toBe("perch.plugin.music");
    expect(storageKey("music")).not.toBe(storageKey("web-search"));
  });
});

describe("migratePluginState", () => {
  it("returns defaults for missing or nonsense data", () => {
    for (const bad of [null, undefined, "nope", 42, []]) {
      expect(migratePluginState(spec, bad)).toEqual(spec.defaults);
    }
  });

  it("runs every migration a pre-versioning blob has missed", () => {
    const out = migratePluginState(spec, { provider: "tidal" });
    expect(out.service).toBe("tidal");
    expect(out.volume).toBe(50);
    expect(out.schemaVersion).toBe(3);
  });

  it("reads the version from the STORED blob, not the merged draft", () => {
    // The trap that bit the core settings migrations: merging defaults first
    // gives every old blob the current version, so nothing ever migrates.
    const out = migratePluginState(spec, { provider: "deezer", service: "spotify" });
    expect(out.service).toBe("deezer");
  });

  it("leaves an already-current blob alone", () => {
    const current = { schemaVersion: 3, service: "tidal", volume: 20, devices: ["a"] };
    expect(migratePluginState(spec, current)).toEqual(current);
  });

  it("never downgrades a blob written by a newer build", () => {
    const future = { schemaVersion: 99, service: "x", volume: 1, devices: [] };
    expect(migratePluginState(spec, future).schemaVersion).toBe(99);
  });

  it("keeps unknown fields from a newer build rather than dropping them", () => {
    // A downgrade must not destroy data the newer build still expects on the
    // way back up.
    const out = migratePluginState(spec, {
      schemaVersion: 99,
      service: "x",
      volume: 1,
      devices: [],
      futureField: "keep me",
    }) as Demo & { futureField?: string };
    expect(out.futureField).toBe("keep me");
  });

  it("fills in fields the stored blob never had", () => {
    const out = migratePluginState(spec, { schemaVersion: 3 });
    expect(out.service).toBe("spotify");
    expect(out.devices).toEqual([]);
  });

  it("works for a plugin with no migrations at all", () => {
    const simple: PluginStateSpec<{ on: boolean }> = {
      id: "simple",
      schema: 1,
      defaults: { on: false },
    };
    expect(migratePluginState(simple, { on: true })).toEqual({
      on: true,
      schemaVersion: 1,
    });
  });
});
