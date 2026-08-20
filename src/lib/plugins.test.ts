import { describe, it, expect } from "vitest";
import {
  BUILTIN_PLUGINS,
  pluginEnabled,
  pluginInstalled,
  pluginActive,
  isCorePlugin,
} from "./plugins";

describe("plugin gating", () => {
  it("treats a plugin as enabled unless explicitly turned off", () => {
    expect(pluginEnabled({}, "web-search")).toBe(true);
    expect(pluginEnabled(undefined, "web-search")).toBe(true);
    expect(pluginEnabled({ "web-search": false }, "web-search")).toBe(false);
  });

  it("counts core plugins as installed without being listed", () => {
    expect(pluginInstalled([], "web-search")).toBe(true);
    expect(pluginInstalled([], "job-analyzer")).toBe(false);
    expect(pluginInstalled(["job-analyzer"], "job-analyzer")).toBe(true);
  });

  it("requires installed AND enabled to be active", () => {
    const installed = { installedPlugins: ["job-analyzer"], plugins: {} };
    expect(pluginActive(installed, "job-analyzer")).toBe(true);
    expect(
      pluginActive({ ...installed, plugins: { "job-analyzer": false } }, "job-analyzer"),
    ).toBe(false);
    expect(pluginActive({ installedPlugins: [], plugins: {} }, "job-analyzer")).toBe(
      false,
    );
  });

  it("defaults to nothing optional installed", () => {
    const fresh = { installedPlugins: [], plugins: {} };
    const optional = BUILTIN_PLUGINS.filter((p) => !isCorePlugin(p.id));
    expect(optional.length).toBeGreaterThan(0);
    for (const p of optional) expect(pluginActive(fresh, p.id)).toBe(false);
  });

  it("every catalog entry has the fields the UI renders", () => {
    for (const p of BUILTIN_PLUGINS) {
      expect(p.id && p.name && p.description && p.icon).toBeTruthy();
    }
  });
});
