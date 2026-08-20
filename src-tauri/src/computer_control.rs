#[cfg(windows)]
mod platform {
    use std::mem::size_of;
    use std::sync::Mutex;
    use std::time::Duration;
    use tauri::WebviewWindow;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, SendInput,
        VIRTUAL_KEY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, IsWindow, SetForegroundWindow,
    };

    static LAST_EXTERNAL: Mutex<Option<isize>> = Mutex::new(None);

    #[derive(Clone, serde::Deserialize, serde::Serialize)]
    pub struct ComputerTarget {
        pub id: String,
        pub title: String,
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

    #[tauri::command]
    pub fn computer_insert_text(target: ComputerTarget, text: String) -> Result<(), String> {
        if text.is_empty() || text.chars().count() > 20_000 {
            return Err("Text is empty or too long.".into());
        }
        let id = target
            .id
            .parse::<isize>()
            .map_err(|_| "Invalid target window.")?;
        let tracked = LAST_EXTERNAL
            .lock()
            .map_err(|_| "Target tracker unavailable.")?;
        if *tracked != Some(id) {
            return Err("The target window changed. Focus the field and try again.".into());
        }
        drop(tracked);
        let hwnd = HWND(id as *mut _);
        if !unsafe { IsWindow(Some(hwnd)) }.as_bool() || title(hwnd) != target.title {
            return Err("The approved target is no longer available.".into());
        }
        if !unsafe { SetForegroundWindow(hwnd) }.as_bool() {
            return Err("Windows would not focus the approved target.".into());
        }
        std::thread::sleep(Duration::from_millis(120));
        if unsafe { GetForegroundWindow() } != hwnd {
            return Err("The approved target did not receive focus.".into());
        }
        let inputs = unicode_inputs(&text);
        let sent = unsafe { SendInput(&inputs, size_of::<INPUT>() as i32) };
        if sent != inputs.len() as u32 {
            return Err("Windows did not accept all of the text input.".into());
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
    #[tauri::command]
    pub fn computer_target() -> Option<ComputerTarget> {
        None
    }
    #[tauri::command]
    pub fn computer_insert_text(_: ComputerTarget, _: String) -> Result<(), String> {
        Err("Computer control is only available on Windows.".into())
    }
}

#[cfg(not(windows))]
pub use platform_stub::*;
