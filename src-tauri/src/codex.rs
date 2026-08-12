use crate::provider::ChatEvent;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use tauri::ipc::Channel;

// On Windows the Codex CLI is usually an npm shim (codex.cmd), which
// Command::new("codex") won't resolve — go through cmd.exe.
#[cfg(windows)]
fn codex_command(args: &[&str]) -> Command {
    let mut c = Command::new("cmd");
    c.arg("/C").arg("codex").args(args);
    c
}

#[cfg(not(windows))]
fn codex_command(args: &[&str]) -> Command {
    let mut c = Command::new("codex");
    c.args(args);
    c
}

#[tauri::command]
pub fn codex_available() -> bool {
    codex_command(&["--version"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Launch `codex login` (Sign in with ChatGPT). Opens the browser sign-in flow.
/// Returns false if the Codex CLI isn't installed, so the UI can guide install.
#[tauri::command]
pub fn codex_login() -> Result<bool, String> {
    if !codex_available() {
        return Ok(false);
    }
    codex_command(&["login"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(true)
}

/// Run a single non-interactive Codex task and stream its stdout back as deltas.
/// Uses the user's own `codex login` (Sign in with ChatGPT), so this rides their
/// Codex subscription through OpenAI's official tool rather than reusing tokens.
#[tauri::command]
pub async fn codex_exec(
    prompt: String,
    model: String,
    on_event: Channel<ChatEvent>,
) -> Result<(), String> {
    let ev = on_event.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let use_model = !model.is_empty() && model != "codex-default";
        let args: Vec<&str> = if use_model {
            vec!["exec", "--model", model.as_str(), prompt.as_str()]
        } else {
            vec!["exec", prompt.as_str()]
        };
        let mut child = codex_command(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| e.to_string())?;

        if let Some(out) = child.stdout.take() {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                let _ = ev.send(ChatEvent::Delta {
                    delta: format!("{line}\n"),
                });
            }
        }
        let status = child.wait().map_err(|e| e.to_string())?;
        Ok::<bool, String>(status.success())
    })
    .await;

    match result {
        Ok(Ok(true)) => {
            let _ = on_event.send(ChatEvent::Done);
        }
        Ok(Ok(false)) => {
            let _ = on_event.send(ChatEvent::Error {
                message: "Codex CLI exited with an error.".into(),
            });
        }
        Ok(Err(e)) => {
            let _ = on_event.send(ChatEvent::Error {
                message: format!("Couldn't run Codex CLI: {e}"),
            });
        }
        Err(e) => {
            let _ = on_event.send(ChatEvent::Error {
                message: e.to_string(),
            });
        }
    }
    Ok(())
}
