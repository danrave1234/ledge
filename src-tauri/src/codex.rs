use crate::provider::{ChatEvent, RequestGuard};
use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::Channel;

fn write_request(stdin: &mut impl Write, value: Value) -> Result<(), String> {
    serde_json::to_writer(&mut *stdin, &value).map_err(|e| e.to_string())?;
    stdin.write_all(b"\n").map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())
}

fn response_result(message: &Value, id: u64) -> Option<&Value> {
    (message.get("id").and_then(Value::as_u64) == Some(id)).then(|| message.get("result"))?
}

fn agent_delta(message: &Value) -> Option<&str> {
    (message.get("method")?.as_str()? == "item/agentMessage/delta")
        .then(|| message.pointer("/params/delta")?.as_str())?
}

#[cfg(windows)]
fn terminate(child: &mut std::process::Child) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let mut command = Command::new("taskkill");
    command
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW);
    let _ = command.status();
}

#[cfg(not(windows))]
fn terminate(child: &mut std::process::Child) {
    let _ = child.kill();
}

fn turn_finished(message: &Value, turn_id: &str) -> Option<Result<(), String>> {
    let method = message.get("method")?.as_str()?;
    if !matches!(method, "turn/completed" | "turn/failed")
        || message.pointer("/params/turn/id")?.as_str()? != turn_id
    {
        return None;
    }
    if method == "turn/completed"
        && message
            .pointer("/params/turn/status")
            .and_then(Value::as_str)
            != Some("failed")
    {
        return Some(Ok(()));
    }
    let error = message
        .pointer("/params/turn/error/message")
        .and_then(Value::as_str)
        .unwrap_or("Codex could not complete this response.");
    Some(Err(error.to_string()))
}

/// Working root for `codex exec`. Perch inherits whatever directory it was
/// launched from — Program Files, or a game's folder via autostart — which is
/// not somewhere the agent should be rooted. The user's home is stable and
/// always exists.
fn working_root() -> String {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string())
}

// On Windows the Codex CLI is usually an npm shim (codex.cmd), which
// Command::new("codex") won't resolve — go through cmd.exe.
#[cfg(windows)]
fn build(args: &[&str], show_console: bool) -> Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let mut c = Command::new("cmd");
    c.arg("/C").arg("codex").args(args);
    if !show_console {
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

#[cfg(not(windows))]
fn build(args: &[&str], _show_console: bool) -> Command {
    let mut c = Command::new("codex");
    c.args(args);
    c
}

/// Background invocation: no console window.
///
/// Everything Perch runs on its own initiative uses this — availability and
/// login probes, logout, and `exec` for each message. Without the flag every
/// one of them flashed a terminal on screen, and the probes repeat (the model
/// picker asks on open, and sign-in polls every couple of seconds), so they
/// blinked in and out in a loop.
fn codex_command(args: &[&str]) -> Command {
    build(args, false)
}

/// Interactive invocation: keep the console VISIBLE.
///
/// `codex login` is a sign-in flow the user is meant to watch — it prints the
/// URL and any prompt. Hiding its window would make signing in look like it did
/// nothing.
fn codex_command_interactive(args: &[&str]) -> Command {
    build(args, true)
}

/* ---------- probe cache ----------
Spawning `cmd /C codex …` costs a process launch plus Node startup —
hundreds of milliseconds. The model picker asks "is Codex usable?" every
time it opens, so an uncached probe made opening the menu visibly laggy.
Results are cached briefly and invalidated on login/logout, which keeps the
UI responsive without going stale. */
const PROBE_TTL: Duration = Duration::from_secs(20);

static AVAILABLE: LazyLock<Mutex<Option<(Instant, bool)>>> = LazyLock::new(|| Mutex::new(None));
static LOGIN_PROBE: LazyLock<Mutex<Option<(Instant, bool)>>> = LazyLock::new(|| Mutex::new(None));

fn cached(cell: &Mutex<Option<(Instant, bool)>>, probe: impl FnOnce() -> bool) -> bool {
    if let Ok(guard) = cell.lock()
        && let Some((at, value)) = *guard
        && at.elapsed() < PROBE_TTL
    {
        return value;
    }
    // Probe outside the lock: never hold it across a process spawn.
    let value = probe();
    if let Ok(mut guard) = cell.lock() {
        *guard = Some((Instant::now(), value));
    }
    value
}

/// Forget cached probes, so the UI reflects a login or logout immediately.
fn invalidate_probes() {
    for cell in [&*AVAILABLE, &*LOGIN_PROBE] {
        if let Ok(mut guard) = cell.lock() {
            *guard = None;
        }
    }
}

#[tauri::command]
pub fn codex_available() -> bool {
    cached(&AVAILABLE, || {
        codex_command(&["--version"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    })
}

/// Launch `codex login` (Sign in with ChatGPT). Opens the browser sign-in flow.
/// Returns false if the Codex CLI isn't installed, so the UI can guide install.
#[tauri::command]
pub fn codex_login() -> Result<bool, String> {
    if !codex_available() {
        return Ok(false);
    }
    // Visible, and NOT piped to null: the user needs to see the sign-in URL and
    // any prompt the CLI shows.
    codex_command_interactive(&["login"])
        .spawn()
        .map_err(|e| e.to_string())?;
    invalidate_probes();
    Ok(true)
}

/// True if the user is signed in to Codex (via ChatGPT or API key). Lets the UI
/// reflect a browser sign-in that completed out-of-process.
#[tauri::command]
pub fn codex_logged_in() -> bool {
    // Authentication storage is a CLI implementation detail. The supported
    // status command stays correct when its internal format or location changes.
    cached(&LOGIN_PROBE, || {
        codex_command(&["login", "status"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    })
}

/// Sign out through the CLI, which owns the credentials it created.
#[tauri::command]
pub fn codex_logout() -> Result<(), String> {
    let _ = codex_command(&["logout"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    invalidate_probes();
    Ok(())
}

/// Run a single non-interactive Codex task over app-server's live event stream.
/// Uses the user's own `codex login` (Sign in with ChatGPT), so this rides their
/// Codex subscription through OpenAI's official tool rather than reusing tokens.
#[tauri::command]
pub async fn codex_exec(
    prompt: String,
    model: String,
    effort: String,
    request_id: String,
    on_event: Channel<ChatEvent>,
) -> Result<(), String> {
    let request = RequestGuard::new(request_id);
    let ev = on_event.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let use_model = !model.is_empty() && model != "codex-default";
        let workdir = working_root();
        let mut child = codex_command(&["app-server", "--stdio"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;
        let mut stdin = child.stdin.take().ok_or("Codex app-server stdin is unavailable")?;
        let stdout = child.stdout.take().ok_or("Codex app-server stdout is unavailable")?;

        // Drain stderr on its own thread: reading it only after stdout would
        // deadlock if the CLI filled the stderr pipe buffer mid-run.
        let stderr = child.stderr.take();
        let stderr_handle = std::thread::spawn(move || {
            let mut buf = String::new();
            if let Some(err) = stderr {
                for line in BufReader::new(err).lines().map_while(Result::ok) {
                    buf.push_str(&line);
                    buf.push('\n');
                }
            }
            buf
        });

        write_request(
            &mut stdin,
            json!({"id": 1, "method": "initialize", "params": {
                "clientInfo": {"name": "perch", "title": "Perch", "version": env!("CARGO_PKG_VERSION")},
                "capabilities": {}
            }}),
        )?;

        let mut turn_id = None;
        let mut outcome = None;
        for line in BufReader::new(stdout).lines() {
            if request.cancelled() {
                outcome = Some(Ok(()));
                break;
            }
            let line = line.map_err(|e| e.to_string())?;
            let message: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
            if response_result(&message, 1).is_some() {
                write_request(&mut stdin, json!({"method": "initialized", "params": {}}))?;
                let mut params = json!({
                    "cwd": workdir,
                    "approvalPolicy": "never",
                    "sandbox": "read-only",
                    "ephemeral": true
                });
                if use_model {
                    params["model"] = json!(model);
                }
                if !effort.is_empty() {
                    params["modelReasoningEffort"] = json!(effort);
                }
                write_request(&mut stdin, json!({"id": 2, "method": "thread/start", "params": params}))?;
            } else if let Some(result) = response_result(&message, 2) {
                let id = result.pointer("/thread/id").and_then(Value::as_str).ok_or("Codex did not return a thread id")?;
                write_request(
                    &mut stdin,
                    json!({"id": 3, "method": "turn/start", "params": {
                        "threadId": id,
                        "input": [{"type": "text", "text": prompt}]
                    }}),
                )?;
            } else if let Some(result) = response_result(&message, 3) {
                turn_id = Some(
                    result.pointer("/turn/id").and_then(Value::as_str).ok_or("Codex did not return a turn id")?.to_string(),
                );
            } else if let Some(delta) = agent_delta(&message) {
                let _ = ev.send(ChatEvent::Delta { delta: delta.to_string() });
            }
            if let Some(id) = turn_id.as_deref()
                && let Some(finished) = turn_finished(&message, id)
            {
                outcome = Some(finished);
                break;
            }
        }
        drop(stdin);
        terminate(&mut child);
        let _ = child.wait();
        let errors = stderr_handle.join().unwrap_or_default();
        match outcome {
            Some(Ok(())) => Ok::<(), String>(()),
            Some(Err(e)) => Err(e),
            None => {
                let detail: String = errors.trim().chars().take(400).collect();
                Err(if detail.is_empty() { "Codex stream ended before completion.".into() } else { detail })
            }
        }
    })
    .await;

    match result {
        Ok(Ok(())) => {
            let _ = on_event.send(ChatEvent::Done);
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

#[cfg(test)]
mod tests {
    use super::{agent_delta, response_result, turn_finished};
    use serde_json::json;

    #[test]
    fn parses_live_delta_and_terminal_events() {
        assert_eq!(
            agent_delta(
                &json!({"method": "item/agentMessage/delta", "params": {"delta": "Hello — 世界"}})
            ),
            Some("Hello — 世界")
        );
        assert!(response_result(&json!({"id": 2, "result": {"thread": {"id": "t"}}}), 2).is_some());
        assert_eq!(
            turn_finished(
                &json!({"method": "turn/completed", "params": {"turn": {"id": "turn-1", "status": "completed"}}}),
                "turn-1"
            ),
            Some(Ok(()))
        );
        assert!(turn_finished(&json!({"method": "turn/completed", "params": {"turn": {"id": "other", "status": "completed"}}}), "turn-1").is_none());
    }
}
