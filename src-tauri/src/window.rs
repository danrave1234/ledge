use tauri::{Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

fn target_monitor(win: &WebviewWindow) -> Option<Monitor> {
    if let Ok(Some(m)) = win.current_monitor() {
        return Some(m);
    }
    if let Ok(Some(m)) = win.primary_monitor() {
        return Some(m);
    }
    win.available_monitors()
        .ok()
        .and_then(|v| v.into_iter().next())
}

/// Pick the monitor the widget should dock to. When the user has chosen a
/// specific display we honor that index; otherwise fall back to the monitor the
/// window is on (or primary). Explicit selection is what makes docking — and the
/// hover strip — land on the right screen in multi-monitor setups.
fn pick_monitor(win: &WebviewWindow, display: Option<usize>) -> Option<Monitor> {
    if let Some(i) = display {
        if let Ok(mons) = win.available_monitors() {
            if let Some(m) = mons.into_iter().nth(i) {
                return Some(m);
            }
        }
    }
    target_monitor(win)
}

#[derive(serde::Serialize)]
pub struct MonitorInfo {
    pub index: usize,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub primary: bool,
}

/// Enumerate connected displays so the user can choose where the widget lives.
#[tauri::command]
pub fn list_monitors(window: WebviewWindow) -> Result<Vec<MonitorInfo>, String> {
    let primary_name = window
        .primary_monitor()
        .ok()
        .flatten()
        .and_then(|m| m.name().cloned());
    let mons = window.available_monitors().map_err(|e| e.to_string())?;
    Ok(mons
        .into_iter()
        .enumerate()
        .map(|(i, m)| {
            let pos = *m.position();
            let size = *m.size();
            let name = m.name().cloned();
            MonitorInfo {
                index: i,
                primary: name.is_some() && name == primary_name,
                name: name.unwrap_or_else(|| format!("Display {}", i + 1)),
                width: size.width,
                height: size.height,
                x: pos.x,
                y: pos.y,
            }
        })
        .collect())
}

/// Position + size the widget window against a screen edge.
/// `placement` is one of "top" | "left" | "right".
/// When `expanded` is false the window shrinks to the small textless handle.
#[tauri::command]
pub fn dock_window(
    window: WebviewWindow,
    placement: String,
    expanded: bool,
    display: Option<usize>,
) -> Result<(), String> {
    let mon = pick_monitor(&window, display).ok_or("no monitor available")?;
    let scale = mon.scale_factor();
    let mpos = *mon.position();
    let msize = *mon.size();

    // Logical sizes, converted to physical for precise multi-DPI placement.
    let (w_l, h_l): (f64, f64) = if expanded {
        match placement.as_str() {
            "left" | "right" => (400.0, ((msize.height as f64) / scale - 24.0).min(680.0)),
            _ => (640.0, 460.0),
        }
    } else {
        // Collapsed: a wide, thin hover strip. The visible handle is small, but the
        // window must be big enough to actually catch the pointer — a 76x22 target
        // was easy to miss, which is why hover-open felt broken.
        match placement.as_str() {
            "left" | "right" => (14.0, 180.0),
            _ => (180.0, 14.0),
        }
    };
    let pw = (w_l * scale).round() as u32;
    let ph = (h_l * scale).round() as u32;

    let (x, y): (i32, i32) = match placement.as_str() {
        "left" => {
            let y = if expanded {
                mpos.y + (12.0 * scale) as i32
            } else {
                mpos.y + (msize.height as i32 - ph as i32) / 2
            };
            (mpos.x, y)
        }
        "right" => {
            let x = mpos.x + msize.width as i32 - pw as i32;
            let y = if expanded {
                mpos.y + (12.0 * scale) as i32
            } else {
                mpos.y + (msize.height as i32 - ph as i32) / 2
            };
            (x, y)
        }
        _ => {
            let x = mpos.x + (msize.width as i32 - pw as i32) / 2;
            (x, mpos.y)
        }
    };

    window
        .set_size(PhysicalSize::new(pw, ph))
        .map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    let _ = window.show();
    if expanded {
        let _ = window.set_focus();
    }
    Ok(())
}

#[tauri::command]
pub fn show_panel(window: WebviewWindow) -> Result<(), String> {
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn hide_panel(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

/// Clear the WebView2 cache (HTTP cache, cookies, transient storage) to keep
/// Perch light. Durable memory (history, personas, settings) lives in the
/// app-data store, not here, so it is preserved across a cache clear.
#[tauri::command]
pub fn clear_cache(window: WebviewWindow) -> Result<(), String> {
    window
        .clear_all_browsing_data()
        .map_err(|e| e.to_string())
}

/// Exclude (or re-include) the widget from screen capture WITHOUT hiding it, so
/// screen-context screenshots and screen recordings don't include the panel — and
/// no hide/show flicker. Windows 10 2004+.
#[cfg(windows)]
#[tauri::command]
pub fn set_capture_exclusion(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
    };
    if let Ok(hwnd) = window.hwnd() {
        let affinity = if enabled { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE };
        unsafe {
            SetWindowDisplayAffinity(hwnd, affinity).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(not(windows))]
#[tauri::command]
pub fn set_capture_exclusion(_window: WebviewWindow, _enabled: bool) -> Result<(), String> {
    Ok(())
}

/// Game mode: keep the widget overlaid on top of games. Re-asserts
/// always-on-top and stays off the taskbar. This overlays borderless /
/// windowed-fullscreen games (the common case); exclusive-fullscreen
/// games bypass the desktop compositor and need deeper integration.
#[tauri::command]
pub fn set_game_mode(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    // The widget is always-on-top by design. Game mode additionally re-asserts a
    // NON-activating topmost position so it stays above borderless / windowed-
    // fullscreen games without stealing their input focus. Exclusive-fullscreen
    // games (e.g. Valorant) bypass the desktop compositor and can't be overlaid by
    // any normal window — set those to "Windowed Fullscreen" to use this.
    window.set_always_on_top(true).map_err(|e| e.to_string())?;
    let _ = window.set_skip_taskbar(true);
    #[cfg(windows)]
    if enabled {
        use windows::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        };
        if let Ok(hwnd) = window.hwnd() {
            unsafe {
                let _ = SetWindowPos(
                    hwnd,
                    Some(HWND_TOPMOST),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
            }
        }
    }
    Ok(())
}
