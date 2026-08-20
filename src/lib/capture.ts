import { captureContext, setCaptureExclusion } from "./native";

/** Grab the screen the widget is docked to, plus its OCR text.
 *
 *  The widget excludes itself from the capture rather than hiding (no flicker —
 *  see DECISIONS.md). Best-effort: in the browser preview there is no backend,
 *  and a failed capture must degrade to "no screen context", never to an error.
 *
 *  Shared by the screen tool and the pre-fetch path, so both behave identically. */
export async function captureScreenshot(
  display?: number,
): Promise<{ image?: string; text?: string }> {
  try {
    await setCaptureExclusion(true);
    await new Promise((r) => setTimeout(r, 30));
    const ctx = await captureContext(display);
    if (!ctx) return {};
    return { image: ctx.data_url, text: ctx.text?.trim() || undefined };
  } catch {
    return {};
  } finally {
    await setCaptureExclusion(false);
  }
}
