import { afterEach, describe, expect, it, vi } from "vitest";
import { exportText } from "./native";

describe("exportText browser fallback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("downloads text without requiring native APIs", async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const createObjectURL = vi.fn(() => "blob:export");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    await expect(exportText("history.json", "contents", "json")).resolves.toBe(true);
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:export");
  });
});
