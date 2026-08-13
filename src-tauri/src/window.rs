use tauri::{Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

/// Pick the monitor the widget should dock to: the user's chosen display if set,
/// otherwise the PRIMARY monitor. Deliberately not `current_monitor()` — that
/// depends on wherever the window happens to sit, so on multi-monitor setups the
/// widget would drift to an unpredictable screen.
fn pick_monitor(win: &WebviewWindow, display: Option<usize>) -> Option<Monitor> {
    if let Some(i) = display {
        if let Ok(mons) = win.available_monitors() {
            if let Some(m) = mons.into_iter().nth(i) {
                return Some(m);
            }
        }
    }
    if let Ok(Some(m)) = win.primary_monitor() {
        return Some(m);
    }
    if let Ok(Some(m)) = win.current_monitor() {
        return Some(m);
    }
    win.available_monitors()
        .ok()
        .and_then(|v| v.into_iter().next())
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
    let mw = msize.width as f64;
    let mh = msize.height as f64;

    // Logical sizes, converted to physical for precise multi-DPI placement.
    let (w_l, h_l): (f64, f64) = if expanded {
        match placement.as_str() {
            "left" | "right" => (400.0, (mh / scale - 80.0).min(680.0)),
            _ => (640.0, 460.0),
        }
    } else {
        // Collapsed: a long, thin hover strip. The visible handle is small, but the
        // window must be big enough to actually catch the pointer — a 76x22 target
        // was easy to miss, which is why hover-open felt broken.
        match placement.as_str() {
            "left" | "right" => (14.0, 180.0),
            _ => (180.0, 14.0),
        }
    };

    // Never exceed the monitor, so the window can't be clipped (which makes the
    // content look mis-sized and off-center inside its own frame).
    let pw = ((w_l * scale).round() as f64).min(mw).max(1.0) as u32;
    let ph = ((h_l * scale).round() as f64).min(mh).max(1.0) as u32;

    // Center along the docked edge; hug the edge on the docked axis.
    let center_x = mpos.x + ((mw - pw as f64) / 2.0).round() as i32;
    let center_y = mpos.y + ((mh - ph as f64) / 2.0).round() as i32;
    let (x, y): (i32, i32) = match placement.as_str() {
        "left" => (mpos.x, center_y),
        "right" => (mpos.x + (mw as i32 - pw as i32), center_y),
        _ => (center_x, mpos.y),
    };

    // Position BEFORE size: moving between monitors can change the DPI, and
    // Windows rescales a window's size on a DPI change — sizing first would get
    // silently rewritten. Re-assert the position afterwards so the final rect is
    // exactly what we asked for.
    //
    // Never use `?` here: a failed move/resize must not skip show(), or the
    // widget would stay invisible forever with no way for the user to recover.
    let pos = PhysicalPosition::new(x, y);
    let mut err = None;
    if let Err(e) = window.set_position(pos) {
        err = Some(e.to_string());
    }
    if let Err(e) = window.set_size(PhysicalSize::new(pw, ph)) {
        err = Some(e.to_string());
    }
    if let Err(e) = window.set_position(pos) {
        err = Some(e.to_string());
    }
    let _ = window.show();
    if let Some(e) = err {
        return Err(e);
    }
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
