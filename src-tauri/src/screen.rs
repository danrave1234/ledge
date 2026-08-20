use base64::Engine;
use std::io::Cursor;
use xcap::Monitor;
use xcap::image::{DynamicImage, ImageFormat, RgbaImage};

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

/// Capture the screen AND OCR it to text, so text-only providers (Codex) can
/// answer "what's on my screen" and vision providers get both image and text.
#[tauri::command]
pub fn capture_context(display: Option<usize>) -> Result<ScreenContext, String> {
    let mon = pick(display)?;
    let img = mon.capture_image().map_err(|e| e.to_string())?;
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
    for px in bgra.chunks_exact_mut(4) {
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
