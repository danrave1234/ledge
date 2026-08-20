#[cfg(windows)]
mod platform {
    use std::mem::size_of;
    use std::sync::Mutex;
    use std::time::Duration;
    use tauri::WebviewWindow;
    use windows::Win32::Foundation::{CloseHandle, HWND, RECT};
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
        QueryFullProcessImageNameW,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYEVENTF_KEYUP,
        KEYEVENTF_UNICODE, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_RIGHTDOWN,
        MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_WHEEL, MOUSEINPUT, SendInput, VIRTUAL_KEY, VK_BACK,
        VK_CONTROL, VK_DELETE, VK_DOWN, VK_END, VK_ESCAPE, VK_HOME, VK_L, VK_LEFT, VK_NEXT,
        VK_PRIOR, VK_RETURN, VK_RIGHT, VK_SPACE, VK_TAB, VK_UP,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowRect, GetWindowTextLengthW, GetWindowTextW,
        GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, SetCursorPos,
        SetForegroundWindow,
    };
    use windows::core::PWSTR;

    static LAST_EXTERNAL: Mutex<Option<isize>> = Mutex::new(None);

    #[derive(Clone, serde::Deserialize, serde::Serialize)]
    pub struct ComputerTarget {
        pub id: String,
        pub title: String,
    }

    #[derive(Clone)]
    pub(crate) struct ExternalWindowBounds {
        pub title: String,
        pub x: i32,
        pub y: i32,
        pub width: u32,
        pub height: u32,
    }

    #[derive(Clone, serde::Deserialize)]
    #[serde(tag = "kind", rename_all = "snake_case")]
    pub enum ComputerAction {
        Click { x: i32, y: i32 },
        DoubleClick { x: i32, y: i32 },
        RightClick { x: i32, y: i32 },
        Type { text: String },
        Key { key: String },
        Scroll { amount: i32 },
    }

    fn title(hwnd: HWND) -> String {
        unsafe {
            let len = GetWindowTextLengthW(hwnd);
            if len <= 0 {
                return String::new();
            }
            let mut buf = vec![0u16; len as usize + 1];
            let read = GetWindowTextW(hwnd, &mut buf);
            String::from_utf16_lossy(&buf[..read as usize])
        }
    }

    pub fn track_external_focus(window: &WebviewWindow) {
        let Ok(widget) = window.hwnd() else { return };
        let widget_id = widget.0 as isize;
        std::thread::spawn(move || {
            loop {
                let foreground = unsafe { GetForegroundWindow() };
                let id = foreground.0 as isize;
                if id != 0
                    && id != widget_id
                    && !title(foreground).is_empty()
                    && let Ok(mut last) = LAST_EXTERNAL.lock()
                {
                    *last = Some(id);
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        });
    }

    #[tauri::command]
    pub fn computer_target() -> Option<ComputerTarget> {
        let id = LAST_EXTERNAL.lock().ok().and_then(|value| *value)?;
        let hwnd = HWND(id as *mut _);
        if !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
            return None;
        }
        let title = title(hwnd);
        if title.is_empty() {
            return None;
        }
        Some(ComputerTarget {
            id: id.to_string(),
            title,
        })
    }

    pub(crate) fn external_window_bounds() -> Result<ExternalWindowBounds, String> {
        let id = LAST_EXTERNAL
            .lock()
            .map_err(|_| "Window tracker unavailable.")?
            .ok_or("Focus the window you want to capture, then try again.")?;
        let hwnd = HWND(id as *mut _);
        if !unsafe { IsWindow(Some(hwnd)) }.as_bool()
            || !unsafe { IsWindowVisible(hwnd) }.as_bool()
            || unsafe { IsIconic(hwnd) }.as_bool()
        {
            return Err("The last active window is no longer available for capture.".into());
        }
        let window_title = title(hwnd);
        if window_title.is_empty() {
            return Err("The last active window is no longer available for capture.".into());
        }
        let mut rect = RECT::default();
        unsafe { GetWindowRect(hwnd, &mut rect) }
            .map_err(|_| "Could not locate the last active window.")?;
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        if width < 1 || height < 1 {
            return Err("The last active window has no capturable area.".into());
        }
        Ok(ExternalWindowBounds {
            title: window_title,
            x: rect.left,
            y: rect.top,
            width: width as u32,
            height: height as u32,
        })
    }

    fn unicode_inputs(text: &str) -> Vec<INPUT> {
        text.encode_utf16()
            .flat_map(|unit| {
                [
                    KEYBDINPUT {
                        wVk: VIRTUAL_KEY(0),
                        wScan: unit,
                        dwFlags: KEYEVENTF_UNICODE,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                    KEYBDINPUT {
                        wVk: VIRTUAL_KEY(0),
                        wScan: unit,
                        dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                ]
                .map(|ki| INPUT {
                    r#type: INPUT_KEYBOARD,
                    Anonymous: INPUT_0 { ki },
                })
            })
            .collect()
    }

    fn key_input(key: VIRTUAL_KEY, key_up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: key,
                    wScan: 0,
                    dwFlags: if key_up {
                        KEYEVENTF_KEYUP
                    } else {
                        Default::default()
                    },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    fn send_inputs(inputs: &[INPUT]) -> Result<(), String> {
        let sent = unsafe { SendInput(inputs, size_of::<INPUT>() as i32) };
        if sent != inputs.len() as u32 {
            return Err("Windows did not accept all of the approved input.".into());
        }
        Ok(())
    }

    fn mouse_input(
        flags: windows::Win32::UI::Input::KeyboardAndMouse::MOUSE_EVENT_FLAGS,
        data: i32,
    ) -> INPUT {
        INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx: 0,
                    dy: 0,
                    mouseData: data as u32,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    fn action_key(key: &str) -> Option<VIRTUAL_KEY> {
        Some(match key {
            "backspace" => VK_BACK,
            "delete" => VK_DELETE,
            "down" => VK_DOWN,
            "end" => VK_END,
            "enter" => VK_RETURN,
            "escape" => VK_ESCAPE,
            "home" => VK_HOME,
            "left" => VK_LEFT,
            "page_down" => VK_NEXT,
            "page_up" => VK_PRIOR,
            "right" => VK_RIGHT,
            "space" => VK_SPACE,
            "tab" => VK_TAB,
            "up" => VK_UP,
            _ => return None,
        })
    }

    fn browser_executable(hwnd: HWND) -> Result<String, String> {
        let mut process_id = 0;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut process_id)) };
        if process_id == 0 {
            return Err("Could not identify the approved application.".into());
        }
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id) }
            .map_err(|_| "Could not inspect the approved application.")?;
        let mut path = vec![0u16; 32_768];
        let mut length = path.len() as u32;
        let result = unsafe {
            QueryFullProcessImageNameW(
                process,
                PROCESS_NAME_WIN32,
                PWSTR(path.as_mut_ptr()),
                &mut length,
            )
        };
        let _ = unsafe { CloseHandle(process) };
        result.map_err(|_| "Could not identify the approved application.")?;
        let path = String::from_utf16_lossy(&path[..length as usize]);
        Ok(path
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase())
    }

    fn is_supported_browser(executable: &str) -> bool {
        matches!(
            executable,
            "chrome.exe"
                | "msedge.exe"
                | "firefox.exe"
                | "brave.exe"
                | "opera.exe"
                | "opera_gx.exe"
                | "vivaldi.exe"
                | "arc.exe"
        )
    }

    fn validate_target(target: &ComputerTarget) -> Result<HWND, String> {
        let id = target
            .id
            .parse::<isize>()
            .map_err(|_| "Invalid target window.")?;
        let tracked = LAST_EXTERNAL
            .lock()
            .map_err(|_| "Target tracker unavailable.")?;
        if *tracked != Some(id) {
            return Err("The target window changed. Focus the destination and try again.".into());
        }
        drop(tracked);
        let hwnd = HWND(id as *mut _);
        if !unsafe { IsWindow(Some(hwnd)) }.as_bool() || title(hwnd) != target.title {
            return Err("The approved target is no longer available.".into());
        }
        Ok(hwnd)
    }

    fn focus_target(hwnd: HWND) -> Result<(), String> {
        if !unsafe { SetForegroundWindow(hwnd) }.as_bool() {
            return Err("Windows would not focus the approved target.".into());
        }
        std::thread::sleep(Duration::from_millis(120));
        if unsafe { GetForegroundWindow() } != hwnd {
            return Err("The approved target did not receive focus.".into());
        }
        Ok(())
    }

    #[tauri::command]
    pub fn computer_insert_text(target: ComputerTarget, text: String) -> Result<(), String> {
        if text.is_empty() || text.chars().count() > 20_000 {
            return Err("Text is empty or too long.".into());
        }
        let hwnd = validate_target(&target)?;
        focus_target(hwnd)?;
        let inputs = unicode_inputs(&text);
        send_inputs(&inputs)
    }

    #[tauri::command]
    pub fn computer_navigate_browser(target: ComputerTarget, url: String) -> Result<(), String> {
        let valid_url = url.len() <= 2_048
            && !url.chars().any(char::is_control)
            && (url.starts_with("https://") || url.starts_with("http://"));
        if !valid_url {
            return Err("Only valid HTTP or HTTPS addresses can be opened.".into());
        }
        let hwnd = validate_target(&target)?;
        let executable = browser_executable(hwnd)?;
        if !is_supported_browser(&executable) {
            return Err("The approved target is not a supported web browser.".into());
        }
        focus_target(hwnd)?;
        send_inputs(&[
            key_input(VK_CONTROL, false),
            key_input(VK_L, false),
            key_input(VK_L, true),
            key_input(VK_CONTROL, true),
        ])?;
        std::thread::sleep(Duration::from_millis(60));
        send_inputs(&unicode_inputs(&url))?;
        send_inputs(&[key_input(VK_RETURN, false), key_input(VK_RETURN, true)])
    }

    #[tauri::command]
    pub fn computer_run_actions(
        target: ComputerTarget,
        actions: Vec<ComputerAction>,
    ) -> Result<(), String> {
        if actions.is_empty() || actions.len() > 12 {
            return Err("An action plan must contain between 1 and 12 actions.".into());
        }
        let hwnd = validate_target(&target)?;
        let mut rect = RECT::default();
        unsafe { GetWindowRect(hwnd, &mut rect) }
            .map_err(|_| "Could not locate the approved target window.")?;
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        if width < 1 || height < 1 {
            return Err("The approved target window has no usable area.".into());
        }
        focus_target(hwnd)?;
        for action in actions {
            match action {
                ComputerAction::Click { x, y }
                | ComputerAction::DoubleClick { x, y }
                | ComputerAction::RightClick { x, y } => {
                    if !(0..=1000).contains(&x) || !(0..=1000).contains(&y) {
                        return Err("Click coordinates must be between 0 and 1000.".into());
                    }
                    let screen_x = rect.left + width * x / 1000;
                    let screen_y = rect.top + height * y / 1000;
                    unsafe { SetCursorPos(screen_x, screen_y) }
                        .map_err(|_| "Windows would not move the pointer.")?;
                    std::thread::sleep(Duration::from_millis(50));
                    match action {
                        ComputerAction::RightClick { .. } => send_inputs(&[
                            mouse_input(MOUSEEVENTF_RIGHTDOWN, 0),
                            mouse_input(MOUSEEVENTF_RIGHTUP, 0),
                        ])?,
                        ComputerAction::DoubleClick { .. } => send_inputs(&[
                            mouse_input(MOUSEEVENTF_LEFTDOWN, 0),
                            mouse_input(MOUSEEVENTF_LEFTUP, 0),
                            mouse_input(MOUSEEVENTF_LEFTDOWN, 0),
                            mouse_input(MOUSEEVENTF_LEFTUP, 0),
                        ])?,
                        _ => send_inputs(&[
                            mouse_input(MOUSEEVENTF_LEFTDOWN, 0),
                            mouse_input(MOUSEEVENTF_LEFTUP, 0),
                        ])?,
                    }
                }
                ComputerAction::Type { text } => {
                    if text.is_empty() || text.chars().count() > 20_000 {
                        return Err("Typed text is empty or too long.".into());
                    }
                    send_inputs(&unicode_inputs(&text))?;
                }
                ComputerAction::Key { key } => {
                    let key = action_key(&key).ok_or("That key is not allowed.")?;
                    send_inputs(&[key_input(key, false), key_input(key, true)])?;
                }
                ComputerAction::Scroll { amount } => {
                    if amount == 0 || amount.unsigned_abs() > 2400 {
                        return Err("Scroll amount is outside the allowed range.".into());
                    }
                    send_inputs(&[mouse_input(MOUSEEVENTF_WHEEL, amount)])?;
                }
            }
            std::thread::sleep(Duration::from_millis(90));
        }
        Ok(())
    }
}

#[cfg(windows)]
pub use platform::*;

#[cfg(not(windows))]
mod platform_stub {
    use tauri::WebviewWindow;
    #[derive(Clone, serde::Deserialize, serde::Serialize)]
    pub struct ComputerTarget {
        pub id: String,
        pub title: String,
    }
    pub fn track_external_focus(_: &WebviewWindow) {}
    pub(crate) fn external_window_bounds() -> Result<(), String> {
        Err("Active-window capture is only available on Windows.".into())
    }
    #[tauri::command]
    pub fn computer_target() -> Option<ComputerTarget> {
        None
    }
    #[tauri::command]
    pub fn computer_insert_text(_: ComputerTarget, _: String) -> Result<(), String> {
        Err("Computer control is only available on Windows.".into())
    }
    #[tauri::command]
    pub fn computer_navigate_browser(_: ComputerTarget, _: String) -> Result<(), String> {
        Err("Computer control is only available on Windows.".into())
    }
    #[tauri::command]
    pub fn computer_run_actions(
        _: ComputerTarget,
        _: Vec<serde_json::Value>,
    ) -> Result<(), String> {
        Err("Computer control is only available on Windows.".into())
    }
}

#[cfg(not(windows))]
pub use platform_stub::*;
