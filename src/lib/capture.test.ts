import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  captureContext: vi.fn(),
  setCaptureExclusion: vi.fn(),
}));

vi.mock("./native", () => native);

import { captureScreenshot } from "./capture";

describe("screen capture boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.setCaptureExclusion.mockResolvedValue(undefined);
  });

  it("passes automatic redaction and preserves safe OCR text", async () => {
    native.captureContext.mockResolvedValue({
      data_url: "data:image/png;base64,AA==",
      width: 1920,
      height: 1080,
      text: "  approved text  ",
      redacted: false,
    });

    await expect(captureScreenshot(2, "active-window", true)).resolves.toEqual({
      image: "data:image/png;base64,AA==",
      text: "approved text",
      redacted: false,
    });
    expect(native.captureContext).toHaveBeenCalledWith("active-window", 2, true);
    expect(native.setCaptureExclusion).toHaveBeenNthCalledWith(1, true);
    expect(native.setCaptureExclusion).toHaveBeenLastCalledWith(false);
  });

  it("invalidates OCR text when native redaction changed the image", async () => {
    native.captureContext.mockResolvedValue({
      data_url: "data:image/png;base64,REDACTED",
      width: 1920,
      height: 1080,
      text: "must not escape",
      redacted: true,
    });

    await expect(captureScreenshot(undefined, "active-window", true)).resolves.toEqual({
      image: "data:image/png;base64,REDACTED",
      text: undefined,
      redacted: true,
    });
  });

  it("surfaces stale-window errors without granting a screen image", async () => {
    native.captureContext.mockRejectedValue(new Error("The last active window changed."));
    await expect(captureScreenshot(undefined, "active-window")).resolves.toEqual({
      error: "The last active window changed.",
    });
    expect(native.setCaptureExclusion).toHaveBeenLastCalledWith(false);
  });
});
