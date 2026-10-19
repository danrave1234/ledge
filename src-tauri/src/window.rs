use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{Emitter, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

/* Widget geometry, in logical pixels. One place, so the panel, the hover strip,
and the startup size in tauri.conf.json can't drift apart. */
const PANEL_TOP_W: f64 = 640.0;
const PANEL_TOP_H: f64 = 460.0;
const PANEL_SIDE_W: f64 = 400.0;
const PANEL_SIDE_MAX_H: f64 = 680.0;
const HANDLE_LENGTH: f64 = 180.0;
const HANDLE_THICKNESS: f64 = 14.0;

/// Pick the monitor the widget should dock to: the user's chosen display if set,
/// otherwise the PRIMARY monitor. Deliberately not `current_monitor()` — that
/// depends on wherever the window happens to sit, so on multi-monitor setups the
/// widget would drift to an unpredictable screen.
fn pick_monitor(win: &WebviewWindow, display: Option<usize>) -> Option<Monitor> {
    if let Some(i) = display
        && let Ok(mons) = win.available_monitors()
        && let Some(m) = mons.into_iter().nth(i)
    {
        return Some(m);
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
    // NOTE: the collapsed TOP size below is also the window's startup size in
    // tauri.conf.json — keep the two in sync, or the widget paints at the wrong
    // size for one frame before the first dock.
    let (w_l, h_l): (f64, f64) = if expanded {
        match placement.as_str() {
            "left" | "right" => (PANEL_SIDE_W, (mh / scale - 80.0).min(PANEL_SIDE_MAX_H)),
            _ => (PANEL_TOP_W, PANEL_TOP_H),
        }
    } else {
        // Collapsed: a long, thin hover strip. The visible handle is small, but the
        // window must be big enough to actually catch the pointer — a 76x22 target
        // was easy to miss, which is why hover-open felt broken.
        match placement.as_str() {
            "left" | "right" => (HANDLE_THICKNESS, HANDLE_LENGTH),
            _ => (HANDLE_LENGTH, HANDLE_THICKNESS),
        }
    };

    // Never exceed the monitor, so the window can't be clipped (which makes the
    // content look mis-sized and off-center inside its own frame).
    let pw = (w_l * scale).round().clamp(1.0, mw) as u32;
    let ph = (h_l * scale).round().clamp(1.0, mh) as u32;

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
    // Do NOT show while game mode has us hidden. The frontend re-docks on every
    // collapse/expand — including the collapse it does in response to
    // `perch://game-focus` — so an unconditional show() here put the widget
    // straight back on top of the game and left it there.
    if !GAME_HIDDEN.load(Ordering::Relaxed) {
        let _ = window.show();
    }
    if let Some(e) = err {
        return Err(e);
    }
    if expanded && !GAME_HIDDEN.load(Ordering::Relaxed) {
        let _ = window.set_focus();
    }
    Ok(())
}

/// Exit the app. Called by the frontend once it has flushed pending writes in
/// response to `perch://quit`, so quitting from the tray can't lose a setting
/// the user changed a moment earlier.
#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// Clear the WebView2 cache (HTTP cache, cookies, transient storage) to keep
/// Ledge light. Durable memory (history, personas, settings) lives in the
/// app-data store, not here, so it is preserved across a cache clear.
#[tauri::command]
pub fn clear_cache(window: WebviewWindow) -> Result<(), String> {
    window.clear_all_browsing_data().map_err(|e| e.to_string())
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
        let affinity = if enabled {
            WDA_EXCLUDEFROMCAPTURE
        } else {
            WDA_NONE
        };
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

static GAME_MODE: AtomicBool = AtomicBool::new(false);
/// True while the watcher is suppressing the widget for a fullscreen app. Read
/// by `dock_window` so nothing else can un-hide us behind the watcher's back.
static GAME_HIDDEN: AtomicBool = AtomicBool::new(false);
/// How often the foreground window is checked. Fast enough that the widget is
/// gone before you notice, cheap enough to be free (a few win32 calls).
const GAME_POLL: Duration = Duration::from_millis(800);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ScreenRect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

/// Pure fullscreen policy. Win32 supplies physical window/monitor rectangles;
/// inclusive outer bounds intentionally accept invisible resize-border overhang.
fn is_fullscreen_rect(
    window: ScreenRect,
    monitor: ScreenRect,
    class_name: &str,
    is_ledge: bool,
) -> bool {
    if is_ledge || matches!(class_name, "Progman" | "WorkerW" | "Shell_TrayWnd") {
        return false;
    }

    window.left <= monitor.left
        && window.top <= monitor.top
        && window.right >= monitor.right
        && window.bottom >= monitor.bottom
}

/// True when the focused window covers its whole monitor and isn't ours or the
/// desktop shell — i.e. a game (or any fullscreen app) is in front.
///
/// Deliberately geometry-based rather than a list of game executables: it costs
/// nothing to maintain and catches every launcher, emulator, and title.
#[cfg(windows)]
fn foreground_is_fullscreen(self_hwnd: Option<windows::Win32::Foundation::HWND>) -> bool {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowRect,
    };

    unsafe {
        let fg = GetForegroundWindow();
        if fg.0.is_null() {
            return false;
        }
        let mut class = [0u16; 64];
        let n = GetClassNameW(fg, &mut class);
        let class = String::from_utf16_lossy(&class[..n.max(0) as usize]);

        let mut rect = RECT::default();
        if GetWindowRect(fg, &mut rect).is_err() {
            return false;
        }
        let monitor = MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return false;
        }
        let m = info.rcMonitor;
        is_fullscreen_rect(
            ScreenRect {
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
            },
            ScreenRect {
                left: m.left,
                top: m.top,
                right: m.right,
                bottom: m.bottom,
            },
            &class,
            self_hwnd.is_some_and(|h| h.0 == fg.0),
        )
    }
}

#[cfg(not(windows))]
fn foreground_is_fullscreen(_self_hwnd: Option<()>) -> bool {
    false
}

/// Game mode: stay out of the way while a game is in front.
///
/// The widget is always-on-top, which is right on the desktop and wrong in a
/// game — it sits over the HUD and takes clicks meant for the game. With game
/// mode on, Ledge hides itself whenever a fullscreen app has focus (borderless
/// or exclusive, both are covered) and reappears the moment you leave it.
///
/// The window is HIDDEN rather than moved or made click-through, so it can't be
/// seen and can't intercept input.
#[tauri::command]
pub fn set_game_mode(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    let was_on = GAME_MODE.swap(enabled, Ordering::Relaxed);
    if !enabled || was_on {
        // Turning off: the watcher observes the flag, restores the widget, exits.
        // Already on: the existing watcher stays.
        return Ok(());
    }

    // Classify synchronously before returning to the frontend. The Tauri window
    // starts hidden, and startup does not perform its first dock/show until this
    // command resolves, so a fullscreen foreground app can never see a flash.
    #[cfg(windows)]
    let in_game = foreground_is_fullscreen(window.hwnd().ok());
    #[cfg(not(windows))]
    let in_game = foreground_is_fullscreen(None);
    GAME_HIDDEN.store(in_game, Ordering::Relaxed);
    if in_game {
        let _ = window.hide();
        let _ = window.emit("perch://game-focus", true);
    }

    let win = window.clone();
    std::thread::spawn(move || {
        while GAME_MODE.load(Ordering::Relaxed) {
            #[cfg(windows)]
            let in_game = foreground_is_fullscreen(win.hwnd().ok());
            #[cfg(not(windows))]
            let in_game = foreground_is_fullscreen(None);

            let was_hidden = GAME_HIDDEN.swap(in_game, Ordering::Relaxed);
            if in_game {
                // Level-triggered, not edge-triggered: re-assert the hide every
                // tick. Something else (a re-dock, the hotkey, an OS restore)
                // can make the window visible again, and a one-shot hide would
                // leave it sitting on the game until the user alt-tabbed out.
                if win.is_visible().unwrap_or(false) {
                    let _ = win.hide();
                }
                if !was_hidden {
                    let _ = win.emit("perch://game-focus", true);
                }
            } else if was_hidden {
                let _ = win.show();
                let _ = win.emit("perch://game-focus", false);
            }
            std::thread::sleep(GAME_POLL);
        }
        // Game mode turned off while hidden — don't leave the widget invisible.
        if GAME_HIDDEN.swap(false, Ordering::Relaxed) {
            let _ = win.show();
            let _ = win.emit("perch://game-focus", false);
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{ScreenRect, is_fullscreen_rect};

    const PRIMARY: ScreenRect = ScreenRect {
        left: 0,
        top: 0,
        right: 1920,
        bottom: 1080,
    };

    fn classified(window: ScreenRect) -> bool {
        is_fullscreen_rect(window, PRIMARY, "GameWindow", false)
    }

    #[test]
    fn exact_monitor_coverage_is_fullscreen() {
        assert!(classified(PRIMARY));
    }

    #[test]
    fn resize_border_overhang_is_fullscreen() {
        assert!(classified(ScreenRect {
            left: -8,
            top: -8,
            right: 1928,
            bottom: 1088,
        }));
    }

    #[test]
    fn maximized_work_area_is_not_fullscreen() {
        assert!(!classified(ScreenRect {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1040,
        }));
    }

    #[test]
    fn partial_window_is_not_fullscreen() {
        assert!(!classified(ScreenRect {
            left: 120,
            top: 80,
            right: 1720,
            bottom: 980,
        }));
    }

    #[test]
    fn ledge_and_shell_windows_are_excluded() {
        assert!(!is_fullscreen_rect(PRIMARY, PRIMARY, "Ledge", true));
        for class_name in ["Progman", "WorkerW", "Shell_TrayWnd"] {
            assert!(!is_fullscreen_rect(PRIMARY, PRIMARY, class_name, false));
        }
    }

    #[test]
    fn fullscreen_uses_the_nearest_monitors_coordinates() {
        let secondary = ScreenRect {
            left: -2560,
            top: -320,
            right: 0,
            bottom: 1120,
        };
        assert!(is_fullscreen_rect(
            ScreenRect {
                left: -2568,
                top: -328,
                right: 8,
                bottom: 1128,
            },
            secondary,
            "GameWindow",
            false,
        ));
        assert!(!is_fullscreen_rect(PRIMARY, secondary, "GameWindow", false));
    }
}
