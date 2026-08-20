use base64::Engine;
use std::io::Cursor;
use xcap::image::{DynamicImage, ImageFormat, RgbaImage};
use xcap::{Monitor, Window};

#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CaptureMode {
    Display,
    ActiveWindow,
}

#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CropRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Copy, Debug)]
struct WindowBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

const WINDOW_EDGE_TOLERANCE: i64 = 32;

fn window_bounds_score(target: WindowBounds, candidate: WindowBounds) -> Option<i64> {
    let target_edges = [
        target.x as i64,
        target.y as i64,
        target.x as i64 + target.width as i64,
        target.y as i64 + target.height as i64,
    ];
    let candidate_edges = [
        candidate.x as i64,
        candidate.y as i64,
        candidate.x as i64 + candidate.width as i64,
        candidate.y as i64 + candidate.height as i64,
    ];
    let deltas = target_edges
        .into_iter()
        .zip(candidate_edges)
        .map(|(target, candidate)| (target - candidate).abs());
    deltas
        .clone()
        .all(|delta| delta <= WINDOW_EDGE_TOLERANCE)
        .then(|| deltas.sum())
}

/// Pick the monitor to capture: the display the widget is docked to when the
/// user chose one, else the primary. Mirrors `window::pick_monitor`, so Perch
/// captures the screen it is actually sitting on.
fn pick(display: Option<usize>) -> Result<Monitor, String> {
    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    if let Some(i) = display {
        if let Some(m) = monitors.into_iter().nth(i) {
            return Ok(m);
        }
        // Fall through on a stale index (monitor unplugged).
        return pick(None);
    }
    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    let idx = monitors
        .iter()
        .position(|m| m.is_primary().unwrap_or(false));
    match idx {
        Some(i) => monitors
            .into_iter()
            .nth(i)
            .ok_or_else(|| "no monitor found".into()),
        None => monitors
            .into_iter()
            .next()
            .ok_or_else(|| "no monitor found".into()),
    }
}

fn to_png_data_url(img: &RgbaImage) -> Result<String, String> {
    let mut png: Vec<u8> = Vec::new();
    DynamicImage::ImageRgba8(img.clone())
        .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&png)
    ))
}

#[derive(serde::Serialize)]
pub struct ScreenContext {
    pub data_url: String,
    pub width: u32,
    pub height: u32,
    pub text: String,
}

fn context(img: RgbaImage) -> Result<ScreenContext, String> {
    let (width, height) = (img.width(), img.height());
    let data_url = to_png_data_url(&img)?;
    let text = ocr_rgba(img).unwrap_or_default();
    Ok(ScreenContext {
        data_url,
        width,
        height,
        text,
    })
}

#[cfg(windows)]
fn capture_active_window() -> Result<RgbaImage, String> {
    let target = crate::computer_control::external_window_bounds()?;
    let windows = Window::all().map_err(|e| e.to_string())?;
    let target_bounds = WindowBounds {
        x: target.x,
        y: target.y,
        width: target.width,
        height: target.height,
    };
    let window = windows
        .into_iter()
        .filter_map(|window| {
            if window.title().ok().as_deref() != Some(target.title.as_str()) {
                return None;
            }
            let bounds = WindowBounds {
                x: window.x().ok()?,
                y: window.y().ok()?,
                width: window.width().ok()?,
                height: window.height().ok()?,
            };
            window_bounds_score(target_bounds, bounds).map(|score| (score, window))
        })
        .min_by_key(|(score, _)| *score)
        .map(|(_, window)| window)
        .ok_or("The last active window changed before it could be captured.")?;
    if window.is_minimized().unwrap_or(true) {
        return Err("Restore the last active window before capturing it.".into());
    }
    window.capture_image().map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn capture_active_window() -> Result<RgbaImage, String> {
    Err("Active-window capture is only available on Windows.".into())
}

/// Capture the screen AND OCR it to text, so text-only providers (Codex) can
/// answer "what's on my screen" and vision providers get both image and text.
#[tauri::command]
pub fn capture_context(
    mode: Option<CaptureMode>,
    display: Option<usize>,
) -> Result<ScreenContext, String> {
    let img = match mode.unwrap_or(CaptureMode::Display) {
        CaptureMode::Display => pick(display)?.capture_image().map_err(|e| e.to_string())?,
        CaptureMode::ActiveWindow => capture_active_window()?,
    };
    context(img)
}

fn clamp_crop(rect: CropRect, image_width: u32, image_height: u32) -> Option<(u32, u32, u32, u32)> {
    if !rect.x.is_finite()
        || !rect.y.is_finite()
        || !rect.width.is_finite()
        || !rect.height.is_finite()
        || rect.width <= 0.0
        || rect.height <= 0.0
    {
        return None;
    }
    let left = rect.x.max(0.0).min(image_width as f64).floor() as u32;
    let top = rect.y.max(0.0).min(image_height as f64).floor() as u32;
    let right = (rect.x + rect.width)
        .max(0.0)
        .min(image_width as f64)
        .ceil() as u32;
    let bottom = (rect.y + rect.height)
        .max(0.0)
        .min(image_height as f64)
        .ceil() as u32;
    (right > left && bottom > top).then_some((left, top, right - left, bottom - top))
}

#[tauri::command]
pub fn crop_context(image: String, rect: CropRect) -> Result<ScreenContext, String> {
    let encoded = image
        .strip_prefix("data:image/png;base64,")
        .ok_or("Invalid screen image.")?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| "Invalid screen image.")?;
    let source = xcap::image::load_from_memory(&bytes)
        .map_err(|_| "Invalid screen image.")?
        .to_rgba8();
    let (x, y, width, height) = clamp_crop(rect, source.width(), source.height())
        .ok_or("Select a region with a usable width and height.")?;
    context(xcap::image::imageops::crop_imm(&source, x, y, width, height).to_image())
}

#[cfg(windows)]
fn ocr_rgba(img: RgbaImage) -> Option<String> {
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Security::Cryptography::CryptographicBuffer;
    use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx};

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }

    let w = img.width() as i32;
    let h = img.height() as i32;
    let mut bgra = img.into_raw();
    for px in bgra.as_chunks_mut::<4>().0 {
        px.swap(0, 2); // RGBA -> BGRA
    }
    let buffer = CryptographicBuffer::CreateFromByteArray(&bgra).ok()?;
    let bitmap =
        SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, w, h).ok()?;
    let engine = OcrEngine::TryCreateFromUserProfileLanguages().ok()?;
    let result = engine.RecognizeAsync(&bitmap).ok()?.get().ok()?;
    let text = result.Text().ok()?.to_string();
    if text.trim().is_empty() {
        None
    } else {
        Some(text)
    }
}

#[cfg(not(windows))]
fn ocr_rgba(_img: RgbaImage) -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crop_is_clamped_to_physical_image_bounds() {
        assert_eq!(
            clamp_crop(
                CropRect {
                    x: -10.0,
                    y: 20.2,
                    width: 80.4,
                    height: 100.0
                },
                60,
                80
            ),
            Some((0, 20, 60, 60))
        );
        assert_eq!(
            clamp_crop(
                CropRect {
                    x: 10.0,
                    y: 10.0,
                    width: -2.0,
                    height: 4.0
                },
                60,
                80
            ),
            None
        );
    }

    #[test]
    fn window_match_tolerates_dwm_frame_difference_but_rejects_moved_window() {
        let get_window_rect = WindowBounds {
            x: -8,
            y: -8,
            width: 2576,
            height: 1408,
        };
        let dwm_extended_frame = WindowBounds {
            x: 0,
            y: 0,
            width: 2560,
            height: 1392,
        };
        assert_eq!(
            window_bounds_score(get_window_rect, dwm_extended_frame),
            Some(32)
        );
        assert_eq!(
            window_bounds_score(
                get_window_rect,
                WindowBounds {
                    x: 100,
                    ..dwm_extended_frame
                }
            ),
            None
        );
    }
}
