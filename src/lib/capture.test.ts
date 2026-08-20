import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  captureContext: vi.fn(),
  cropContext: vi.fn(),
  setCaptureExclusion: vi.fn(),
}));

vi.mock("./native", () => native);

import { captureScreenshot, cropScreenshot } from "./capture";

describe("screen capture boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.setCaptureExclusion.mockResolvedValue(undefined);
  });

  it("passes the explicit mode and preserves physical dimensions", async () => {
    native.captureContext.mockResolvedValue({
      data_url: "data:image/png;base64,AA==",
      width: 1920,
      height: 1080,
      text: "  approved text  ",
    });

    await expect(captureScreenshot(2, "active-window")).resolves.toEqual({
      image: "data:image/png;base64,AA==",
      width: 1920,
      height: 1080,
      text: "approved text",
    });
    expect(native.captureContext).toHaveBeenCalledWith("active-window", 2);
    expect(native.setCaptureExclusion).toHaveBeenNthCalledWith(1, true);
    expect(native.setCaptureExclusion).toHaveBeenLastCalledWith(false);
  });

  it("surfaces stale-window errors without granting a screen image", async () => {
    native.captureContext.mockRejectedValue(new Error("The last active window changed."));
    await expect(captureScreenshot(undefined, "active-window")).resolves.toEqual({
      error: "The last active window changed.",
    });
  });

  it("returns re-OCR text from the exact cropped image", async () => {
    native.cropContext.mockResolvedValue({
      data_url: "cropped",
      width: 50,
      height: 40,
      text: "region only",
    });
    const rect = { x: 1, y: 2, width: 50, height: 40 };
    await expect(cropScreenshot("source", rect)).resolves.toEqual({
      image: "cropped",
      width: 50,
      height: 40,
      text: "region only",
    });
    expect(native.cropContext).toHaveBeenCalledWith("source", rect);
  });
});
