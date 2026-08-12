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

/// Position + size the widget window against a screen edge.
/// `placement` is one of "top" | "left" | "right".
/// When `expanded` is false the window shrinks to the small textless handle.
#[tauri::command]
pub fn dock_window(window: WebviewWindow, placement: String, expanded: bool) -> Result<(), String> {
    let mon = target_monitor(&window).ok_or("no monitor available")?;
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
        match placement.as_str() {
            "left" | "right" => (22.0, 76.0),
            _ => (76.0, 22.0),
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
