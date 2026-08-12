use futures_util::StreamExt;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::ipc::Channel;

// Single in-flight stream at a time (the UI enforces one generation). Stop()
// sets this so the backend stops consuming the upstream HTTP body (and billing).
static CANCEL: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn openai_cancel() {
    CANCEL.store(true, Ordering::Relaxed);
}

#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChatEvent {
    Delta { delta: String },
    Done,
    Error { message: String },
}

/// Parse one complete SSE line. Returns true if the stream signalled `[DONE]`.
fn handle_line(line: &[u8], on_event: &Channel<ChatEvent>) -> bool {
    let text = String::from_utf8_lossy(line);
    let text = text.trim();
    if let Some(data) = text.strip_prefix("data:") {
        let data = data.trim();
        if data == "[DONE]" {
            return true;
        }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
            if let Some(delta) = v["choices"][0]["delta"]["content"].as_str() {
                if !delta.is_empty() {
                    let _ = on_event.send(ChatEvent::Delta {
                        delta: delta.to_string(),
                    });
                }
            }
        }
    }
    false
}

/// Fetch the caller's available model IDs from OpenAI, filtered to chat/reasoning
/// families, so the model list stays current instead of hardcoded.
#[tauri::command]
pub async fn openai_list_models() -> Result<Vec<String>, String> {
    let key = crate::secrets::get_api_key().ok_or("No API key set. Add one in Settings → Account.")?;
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.openai.com/v1/models")
        .bearer_auth(key)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("OpenAI {}", resp.status()));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let mut ids: Vec<String> = v["data"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|m| m["id"].as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    ids.retain(|id| {
        (id.starts_with("gpt-")
            || id.starts_with("o1")
            || id.starts_with("o3")
            || id.starts_with("o4")
            || id.starts_with("chatgpt"))
            && !id.contains("embedding")
            && !id.contains("audio")
            && !id.contains("realtime")
            && !id.contains("image")
            && !id.contains("tts")
            && !id.contains("transcribe")
            && !id.contains("moderation")
            && !id.contains("search")
    });
    ids.sort();
    Ok(ids)
}

/// Stream a chat completion from OpenAI using the user's stored API key.
/// `messages` is the raw OpenAI messages array (supports text and vision parts).
#[tauri::command]
pub async fn openai_stream(
    model: String,
    messages: serde_json::Value,
    on_event: Channel<ChatEvent>,
) -> Result<(), String> {
    let key = match crate::secrets::get_api_key() {
        Some(k) => k,
        None => {
            let _ = on_event.send(ChatEvent::Error {
                message: "No API key set. Add one in Settings → Account.".into(),
            });
            return Ok(());
        }
    };

    CANCEL.store(false, Ordering::Relaxed);

    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": true
    });

    let client = reqwest::Client::new();
    let resp = match client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            let _ = on_event.send(ChatEvent::Error { message: e.to_string() });
            return Ok(());
        }
    };

    if !resp.status().is_success() {
        let status = resp.status();
        let txt = resp.text().await.unwrap_or_default();
        let short: String = txt.chars().take(300).collect();
        let _ = on_event.send(ChatEvent::Error {
            message: format!("OpenAI {}: {}", status, short),
        });
        return Ok(());
    }

    // Accumulate raw bytes and only decode COMPLETE lines, so a multi-byte
    // UTF-8 character split across two network chunks is never corrupted.
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    const MAX_LINE: usize = 1 << 20; // 1 MB safety cap

    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                let _ = on_event.send(ChatEvent::Error { message: e.to_string() });
                return Ok(());
            }
        };
        if CANCEL.load(Ordering::Relaxed) {
            let _ = on_event.send(ChatEvent::Done);
            return Ok(());
        }
        buf.extend_from_slice(&chunk);

        while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let mut line: Vec<u8> = buf.drain(..=pos).collect();
            line.pop(); // drop the trailing '\n'
            if handle_line(&line, &on_event) {
                let _ = on_event.send(ChatEvent::Done);
                return Ok(());
            }
        }

        if buf.len() > MAX_LINE {
            let _ = on_event.send(ChatEvent::Error {
                message: "stream line exceeded size limit".into(),
            });
            return Ok(());
        }
    }

    // Process any trailing line that wasn't newline-terminated.
    if !buf.is_empty() && handle_line(&buf, &on_event) {
        let _ = on_event.send(ChatEvent::Done);
        return Ok(());
    }

    let _ = on_event.send(ChatEvent::Done);
    Ok(())
}
