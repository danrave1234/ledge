use base64::Engine;
use std::io::Cursor;
use xcap::image::{DynamicImage, ImageFormat};
use xcap::Monitor;

#[derive(serde::Serialize)]
pub struct Shot {
    pub data_url: String,
    pub width: u32,
    pub height: u32,
}

/// Capture the primary monitor and return it as a base64 PNG data URL.
/// Used by the screen-context plugin; every call is user-initiated.
#[tauri::command]
pub fn capture_screen() -> Result<Shot, String> {
    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    // Prefer the primary display; xcap's enumeration order is not guaranteed.
    let primary_idx = monitors.iter().position(|m| m.is_primary().unwrap_or(false));
    let mon = match primary_idx {
        Some(i) => monitors.into_iter().nth(i).ok_or("no monitor found")?,
        None => monitors.into_iter().next().ok_or("no monitor found")?,
    };
    let img = mon.capture_image().map_err(|e| e.to_string())?;
    let width = img.width();
    let height = img.height();

    let mut png: Vec<u8> = Vec::new();
    DynamicImage::ImageRgba8(img)
        .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .map_err(|e| e.to_string())?;

    let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
    Ok(Shot {
        data_url: format!("data:image/png;base64,{}", b64),
        width,
        height,
    })
}
