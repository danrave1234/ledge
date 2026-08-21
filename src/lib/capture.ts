import { captureContext, setCaptureExclusion, type CaptureMode } from "./native";

export interface Screenshot {
  image?: string;
  text?: string;
  redacted?: boolean;
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
  autoRedact = false,
): Promise<Screenshot> {
  try {
    await setCaptureExclusion(true);
    await new Promise((r) => setTimeout(r, 30));
    const ctx = await captureContext(mode, display, autoRedact);
    if (!ctx) return {};
    return {
      image: ctx.data_url,
      text: ctx.redacted ? undefined : ctx.text?.trim() || undefined,
      redacted: ctx.redacted,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    await setCaptureExclusion(false);
  }
}
