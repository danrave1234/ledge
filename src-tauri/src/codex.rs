use crate::provider::{ChatEvent, RequestGuard};
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::Channel;

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

/// Run a single non-interactive Codex task and stream its stdout back as deltas.
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
        let effort_cfg = format!("model_reasoning_effort=\"{}\"", effort);
        let workdir = working_root();

        let mut args: Vec<&str> = vec![
            "exec",
            // Codex refuses to run outside a Git repository. Perch's working
            // directory is wherever the app was launched from, so without this
            // every message failed with a bare "exited with an error".
            "--skip-git-repo-check",
            // Never emit ANSI escapes: this stdout is rendered as markdown.
            "--color",
            "never",
            // A chat widget's turns are not sessions worth persisting.
            "--ephemeral",
            "--cd",
            workdir.as_str(),
        ];
        if use_model {
            args.push("--model");
            args.push(model.as_str());
        }
        if !effort.is_empty() {
            args.push("-c");
            args.push(effort_cfg.as_str());
        }
        // "-" makes Codex read the prompt from stdin. Passing it as an argument
        // instead put the whole system prompt on a cmd.exe command line, which
        // is capped at 8191 characters — screen-context OCR text alone can blow
        // past that, and the invocation fails before the model ever sees it.
        args.push("-");

        let mut child = codex_command(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;

        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            let _ = stdin.write_all(prompt.as_bytes());
            // Dropping closes the pipe, which is how Codex knows the prompt ended.
        }

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

        let mut cancelled = false;
        if let Some(out) = child.stdout.take() {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                // Stop must end a Codex generation too, not just an OpenAI one:
                // kill the CLI so it stops working (and spending) in the
                // background instead of running to completion unseen.
                if request.cancelled() {
                    cancelled = true;
                    let _ = child.kill();
                    break;
                }
                let _ = ev.send(ChatEvent::Delta {
                    delta: format!("{line}\n"),
                });
            }
        }
        let status = child.wait().map_err(|e| e.to_string())?;
        let errors = stderr_handle.join().unwrap_or_default();
        Ok::<(bool, String), String>((cancelled || status.success(), errors))
    })
    .await;

    match result {
        Ok(Ok((true, _))) => {
            let _ = on_event.send(ChatEvent::Done);
        }
        Ok(Ok((false, errors))) => {
            // Say WHAT went wrong. Swallowing stderr turned every failure into
            // the same unactionable "exited with an error".
            let detail: String = errors.trim().chars().take(400).collect();
            let _ = on_event.send(ChatEvent::Error {
                message: if detail.is_empty() {
                    "Codex CLI exited with an error (no output).".into()
                } else {
                    format!("Codex CLI failed: {detail}")
                },
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
