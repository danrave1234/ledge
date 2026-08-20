import {
  captureContext,
  cropContext,
  setCaptureExclusion,
  type CaptureMode,
  type CropRect,
} from "./native";

export interface Screenshot {
  image?: string;
  text?: string;
  width?: number;
  height?: number;
  error?: string;
}

/** Grab the screen the widget is docked to, plus its OCR text.
 *
 *  The widget excludes itself from the capture rather than hiding (no flicker —
 *  see DECISIONS.md). Best-effort: in the browser preview there is no backend,
 *  and a failed capture must degrade to "no screen context", never to an error.
 *
 *  Shared by the screen tool and the pre-fetch path, so both behave identically. */
export async function captureScreenshot(
  display?: number,
  mode: CaptureMode = "display",
): Promise<Screenshot> {
  try {
    await setCaptureExclusion(true);
    await new Promise((r) => setTimeout(r, 30));
    const ctx = await captureContext(mode, display);
    if (!ctx) return {};
    return {
      image: ctx.data_url,
      text: ctx.text?.trim() || undefined,
      width: ctx.width,
      height: ctx.height,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    await setCaptureExclusion(false);
  }
}

export async function cropScreenshot(image: string, rect: CropRect): Promise<Screenshot> {
  try {
    const ctx = await cropContext(image, rect);
    return {
      image: ctx.data_url,
      text: ctx.text?.trim() || undefined,
      width: ctx.width,
      height: ctx.height,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
