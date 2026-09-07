use base64::Engine;
use std::collections::BTreeSet;
use std::io::Cursor;
use xcap::image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
use xcap::{Monitor, Window};

#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CaptureMode {
    Display,
    ActiveWindow,
}

#[derive(Clone, Copy, Debug)]
struct WindowBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PixelRect {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

impl PixelRect {
    fn new(x: u32, y: u32, width: u32, height: u32) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    fn from_ocr(x: f32, y: f32, width: f32, height: f32) -> Option<Self> {
        if ![x, y, width, height].into_iter().all(f32::is_finite) || width <= 0.0 || height <= 0.0 {
            return None;
        }
        let left = x.max(0.0).floor() as u32;
        let top = y.max(0.0).floor() as u32;
        let right = (x + width).max(0.0).ceil() as u32;
        let bottom = (y + height).max(0.0).ceil() as u32;
        Some(Self::new(
            left,
            top,
            right.saturating_sub(left),
            bottom.saturating_sub(top),
        ))
    }
}

#[derive(Clone, Debug)]
struct OcrWordData {
    text: String,
    bounds: PixelRect,
}

impl OcrWordData {
    fn new(text: impl Into<String>, bounds: PixelRect) -> Self {
        Self {
            text: text.into(),
            bounds,
        }
    }
}

struct OcrScan {
    text: String,
    lines: Vec<Vec<OcrWordData>>,
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
    pub redacted: bool,
}

fn context(mut img: RgbaImage, auto_redact: bool) -> Result<ScreenContext, String> {
    let (width, height) = (img.width(), img.height());
    let scan = match ocr_rgba(&img) {
        Ok(scan) => scan,
        Err(error) if auto_redact => {
            return Err(format!(
                "Automatic redaction could not scan this capture: {error}"
            ));
        }
        Err(_) => None,
    };
    let regions = if auto_redact {
        scan.as_ref().map(sensitive_regions).unwrap_or_default()
    } else {
        Vec::new()
    };
    let redacted = !regions.is_empty();
    if redacted {
        redact_regions(&mut img, &regions);
    }
    let data_url = to_png_data_url(&img)?;
    let text = if redacted {
        String::new()
    } else {
        scan.map(|result| result.text).unwrap_or_default()
    };
    Ok(ScreenContext {
        data_url,
        width,
        height,
        text,
        redacted,
    })
}

fn trimmed_token(value: &str) -> &str {
    value.trim_matches(|c: char| matches!(c, ',' | '.' | ';' | ':' | '<' | '>' | '"' | '\''))
}

fn is_email(value: &str) -> bool {
    let value = trimmed_token(value);
    let mut parts = value.split('@');
    let Some(local) = parts.next() else {
        return false;
    };
    let Some(domain) = parts.next() else {
        return false;
    };
    !local.is_empty()
        && parts.next().is_none()
        && domain.split('.').filter(|part| !part.is_empty()).count() >= 2
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '@' | '.' | '_' | '-' | '+'))
}

fn digits(value: &str) -> Vec<u32> {
    value.chars().filter_map(|c| c.to_digit(10)).collect()
}

fn is_payment_card(value: &str) -> bool {
    let digits = digits(value);
    if !(13..=19).contains(&digits.len())
        || value
            .chars()
            .any(|c| !c.is_ascii_digit() && !matches!(c, ' ' | '-'))
    {
        return false;
    }
    let sum: u32 = digits
        .iter()
        .rev()
        .enumerate()
        .map(|(index, digit)| {
            if index % 2 == 1 {
                let doubled = digit * 2;
                if doubled > 9 { doubled - 9 } else { doubled }
            } else {
                *digit
            }
        })
        .sum();
    sum.is_multiple_of(10)
}

fn is_phone(value: &str) -> bool {
    let count = digits(value).len();
    (10..=15).contains(&count)
        && value
            .chars()
            .any(|c| matches!(c, '+' | '(' | ')' | ' ' | '-'))
        && value
            .chars()
            .all(|c| c.is_ascii_digit() || matches!(c, '+' | '(' | ')' | ' ' | '-' | '.'))
}

fn is_api_secret(value: &str) -> bool {
    let value = trimmed_token(value);
    let lower = value.to_ascii_lowercase();
    let known_prefix = [
        "sk-",
        "pk_live_",
        "rk_live_",
        "ghp_",
        "github_pat_",
        "xoxb-",
        "xoxp-",
        "bearer_",
    ]
    .iter()
    .any(|prefix| lower.starts_with(prefix));
    let generic_secret = value.len() >= 24
        && !value.chars().any(char::is_whitespace)
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '=' | '/' | '+'))
        && value.chars().any(|c| c.is_ascii_lowercase())
        && value.chars().any(|c| c.is_ascii_uppercase())
        && value.chars().any(|c| c.is_ascii_digit());
    (known_prefix && value.len() >= 12) || generic_secret
}

fn is_sensitive_token(value: &str) -> bool {
    is_email(value) || is_payment_card(value) || is_phone(value) || is_api_secret(value)
}

fn is_password_label(value: &str) -> bool {
    matches!(
        value
            .trim_matches(|c: char| !c.is_ascii_alphanumeric())
            .to_ascii_lowercase()
            .as_str(),
        "password" | "passwd" | "pwd" | "passcode" | "pin"
    )
}

fn is_credential_label(value: &str) -> bool {
    is_password_label(value)
        || matches!(
            value
                .trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '_')
                .to_ascii_lowercase()
                .as_str(),
            "token" | "secret" | "apikey" | "api_key" | "access_token" | "authorization"
        )
}

fn next_value_index(words: &[OcrWordData], start: usize) -> Option<usize> {
    (start..words.len()).find(|index| words[*index].text.chars().any(|c| c.is_alphanumeric()))
}

fn sensitive_word_indexes(words: &[OcrWordData]) -> Vec<usize> {
    let mut indexes = BTreeSet::new();
    for (index, word) in words.iter().enumerate() {
        if is_sensitive_token(&word.text) {
            indexes.insert(index);
        }
        if is_credential_label(&word.text)
            && let Some(value_index) = next_value_index(words, index + 1)
        {
            indexes.insert(value_index);
        }
        if word.text.eq_ignore_ascii_case("api")
            && words
                .get(index + 1)
                .is_some_and(|next| trimmed_token(&next.text).eq_ignore_ascii_case("key"))
            && let Some(value_index) = next_value_index(words, index + 2)
        {
            indexes.insert(value_index);
        }
    }
    for start in 0..words.len() {
        for end in (start + 2)..=(start + 4).min(words.len()) {
            let combined = words[start..end]
                .iter()
                .map(|word| word.text.as_str())
                .collect::<Vec<_>>()
                .join(" ");
            if is_payment_card(&combined) || is_phone(&combined) {
                indexes.extend(start..end);
            }
        }
    }
    indexes.into_iter().collect()
}

fn sensitive_regions(scan: &OcrScan) -> Vec<PixelRect> {
    scan.lines
        .iter()
        .flat_map(|line| {
            sensitive_word_indexes(line)
                .into_iter()
                .map(|index| line[index].bounds)
        })
        .collect()
}

fn redact_regions(img: &mut RgbaImage, regions: &[PixelRect]) {
    for region in regions {
        let left = region.x.saturating_sub(2).min(img.width());
        let top = region.y.saturating_sub(2).min(img.height());
        let right = region
            .x
            .saturating_add(region.width)
            .saturating_add(2)
            .min(img.width());
        let bottom = region
            .y
            .saturating_add(region.height)
            .saturating_add(2)
            .min(img.height());
        for y in top..bottom {
            for x in left..right {
                img.put_pixel(x, y, Rgba([0, 0, 0, 255]));
            }
        }
    }
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
    auto_redact: Option<bool>,
) -> Result<ScreenContext, String> {
    let img = match mode.unwrap_or(CaptureMode::Display) {
        CaptureMode::Display => pick(display)?.capture_image().map_err(|e| e.to_string())?,
        CaptureMode::ActiveWindow => capture_active_window()?,
    };
    context(img, auto_redact.unwrap_or(false))
}

#[cfg(windows)]
fn ocr_rgba(img: &RgbaImage) -> Result<Option<OcrScan>, String> {
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Security::Cryptography::CryptographicBuffer;
    use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx};

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }

    let w = img.width() as i32;
    let h = img.height() as i32;
    let mut bgra = img.clone().into_raw();
    for px in bgra.as_chunks_mut::<4>().0 {
        px.swap(0, 2); // RGBA -> BGRA
    }
    let buffer = CryptographicBuffer::CreateFromByteArray(&bgra).map_err(|e| e.to_string())?;
    let bitmap = SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, w, h)
        .map_err(|e| e.to_string())?;
    let engine = OcrEngine::TryCreateFromUserProfileLanguages().map_err(|e| e.to_string())?;
    let result = engine
        .RecognizeAsync(&bitmap)
        .map_err(|e| e.to_string())?
        .get()
        .map_err(|e| e.to_string())?;
    let text = result.Text().map_err(|e| e.to_string())?.to_string();
    if text.trim().is_empty() {
        return Ok(None);
    }
    let line_view = result.Lines().map_err(|e| e.to_string())?;
    let mut lines = Vec::new();
    for line_index in 0..line_view.Size().map_err(|e| e.to_string())? {
        let line = line_view.GetAt(line_index).map_err(|e| e.to_string())?;
        let word_view = line.Words().map_err(|e| e.to_string())?;
        let mut words = Vec::new();
        for word_index in 0..word_view.Size().map_err(|e| e.to_string())? {
            let word = word_view.GetAt(word_index).map_err(|e| e.to_string())?;
            let rect = word.BoundingRect().map_err(|e| e.to_string())?;
            if let Some(bounds) = PixelRect::from_ocr(rect.X, rect.Y, rect.Width, rect.Height) {
                words.push(OcrWordData::new(
                    word.Text().map_err(|e| e.to_string())?.to_string(),
                    bounds,
                ));
            }
        }
        lines.push(words);
    }
    Ok(Some(OcrScan { text, lines }))
}

#[cfg(not(windows))]
fn ocr_rgba(_img: &RgbaImage) -> Result<Option<OcrScan>, String> {
    Err("OCR is only available on Windows.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_common_secrets_without_masking_normal_text() {
        assert!(is_sensitive_token("person@example.com"));
        assert!(is_sensitive_token("sk-proj-AbCdEf1234567890xyzXYZ"));
        assert!(is_sensitive_token("4111-1111-1111-1111"));
        assert!(is_sensitive_token("(415) 555-2671"));
        assert!(!is_sensitive_token("release-2026-08-21"));
        assert!(!is_sensitive_token("hello@example"));
    }

    #[test]
    fn password_labels_mark_the_following_word() {
        let words = vec![
            OcrWordData::new("Password:", PixelRect::new(0, 0, 40, 10)),
            OcrWordData::new("correct-horse", PixelRect::new(45, 0, 65, 10)),
            OcrWordData::new("Status", PixelRect::new(115, 0, 30, 10)),
        ];
        assert_eq!(sensitive_word_indexes(&words), vec![1]);
    }

    #[test]
    fn credential_labels_mark_short_tokens_that_have_no_known_prefix() {
        let words = vec![
            OcrWordData::new("API", PixelRect::new(0, 0, 20, 10)),
            OcrWordData::new("Key:", PixelRect::new(25, 0, 20, 10)),
            OcrWordData::new("abc123", PixelRect::new(50, 0, 40, 10)),
        ];
        assert_eq!(sensitive_word_indexes(&words), vec![2]);
    }

    #[test]
    fn image_redaction_is_clamped_to_pixel_bounds() {
        let mut image = RgbaImage::from_pixel(5, 4, xcap::image::Rgba([255, 255, 255, 255]));
        redact_regions(&mut image, &[PixelRect::new(4, 3, 5, 5)]);
        assert_eq!(*image.get_pixel(4, 3), xcap::image::Rgba([0, 0, 0, 255]));
        assert_eq!(
            *image.get_pixel(1, 1),
            xcap::image::Rgba([255, 255, 255, 255])
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
