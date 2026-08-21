import { describe, expect, it } from "vitest";
import { migratePluginState } from "../../stores/plugin-state";
import { screenContextStateSpec } from "./state";

describe("Screen Context plugin state", () => {
  it("defaults review off and automatic redaction on", () => {
    expect(migratePluginState(screenContextStateSpec, null)).toEqual({
      schemaVersion: 2,
      reviewBeforeSend: false,
      autoRedact: true,
    });
  });

  it("migrates an enabled review preference with automatic redaction on", () => {
    expect(
      migratePluginState(screenContextStateSpec, {
        schemaVersion: 1,
        reviewBeforeSend: true,
      }),
    ).toEqual({ schemaVersion: 2, reviewBeforeSend: true, autoRedact: true });
  });

  it("preserves an explicitly disabled automatic redaction preference", () => {
    expect(
      migratePluginState(screenContextStateSpec, {
        schemaVersion: 2,
        reviewBeforeSend: false,
        autoRedact: false,
      }),
    ).toEqual({ schemaVersion: 2, reviewBeforeSend: false, autoRedact: false });
  });
});
