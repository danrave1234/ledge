use futures_util::StreamExt;
use serde::Serialize;
use std::collections::HashSet;
use std::sync::{LazyLock, Mutex};
use tauri::ipc::Channel;

// Cancellation is request-scoped. Foreground chat, compaction, and title work
// may overlap; stopping one must never cancel or reset another.
static CANCELLED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

const RESPONSES_URL: &str = "https://api.openai.com/v1/responses";
const MODELS_URL: &str = "https://api.openai.com/v1/models";
const NO_KEY: &str = "No API key set. Add one in Settings → Account.";
/// Safety cap on a single SSE line, so a malformed stream can't grow the buffer
/// without bound.
const MAX_LINE: usize = 1 << 20; // 1 MB

/// Stop whatever generation is in flight, for every provider.
#[tauri::command]
pub fn cancel_stream(request_id: String) {
    if let Ok(mut cancelled) = CANCELLED.lock() {
        cancelled.insert(request_id);
    }
}

pub struct RequestGuard(String);

impl RequestGuard {
    pub fn new(request_id: String) -> Self {
        if let Ok(mut cancelled) = CANCELLED.lock() {
            cancelled.remove(&request_id);
        }
        Self(request_id)
    }

    pub fn cancelled(&self) -> bool {
        CANCELLED
            .lock()
            .is_ok_and(|cancelled| cancelled.contains(&self.0))
    }
}

impl Drop for RequestGuard {
    fn drop(&mut self) {
        if let Ok(mut cancelled) = CANCELLED.lock() {
            cancelled.remove(&self.0);
        }
    }
}

/// A fully reassembled tool call, ready for the frontend to execute.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct ToolCallOut {
    pub id: String,
    pub name: String,
    /// Raw JSON string, exactly as the model produced it. Parsed frontend-side
    /// so a malformed argument object is a tool error, not a stream error.
    pub arguments: String,
}

#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChatEvent {
    Delta {
        delta: String,
    },
    /// The model wants tools run. Emitted once, just before `Done`.
    ToolCalls {
        calls: Vec<ToolCallOut>,
    },
    Done,
    Error {
        message: String,
    },
}

/// One streamed piece of a tool call. OpenAI sends the id and name once, then
/// the JSON arguments a few characters at a time, all keyed by `index`.
#[derive(Debug, PartialEq, Clone)]
pub struct ToolFragment {
    pub index: usize,
    pub id: Option<String>,
    pub name: Option<String>,
    pub args: String,
}

/// What one complete SSE line means. Pure so it can be unit-tested without a
/// live stream — this parser sees every token the user ever reads.
#[derive(Debug, PartialEq)]
pub enum Sse {
    /// Text to append to the reply.
    Delta(String),
    /// Tool-call fragments to accumulate.
    Tools(Vec<ToolFragment>),
    /// Upstream signalled `[DONE]`.
    Done,
    Error(String),
    /// Keep-alive, comment, empty delta, or anything unrecognized.
    Ignore,
}

pub fn parse_sse_line(line: &[u8]) -> Sse {
    let text = String::from_utf8_lossy(line);
    let Some(data) = text.trim().strip_prefix("data:") else {
        return Sse::Ignore;
    };
    let data = data.trim();
    let Ok(v) = serde_json::from_str::<serde_json::Value>(data) else {
        return Sse::Ignore;
    };
    match v["type"].as_str().unwrap_or("") {
        "response.output_text.delta" => v["delta"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map_or(Sse::Ignore, |s| Sse::Delta(s.to_string())),
        "response.output_item.added" if v["item"]["type"] == "function_call" => {
            Sse::Tools(vec![ToolFragment {
                index: v["output_index"].as_u64().unwrap_or(0) as usize,
                id: v["item"]["call_id"].as_str().map(str::to_string),
                name: v["item"]["name"].as_str().map(str::to_string),
                args: v["item"]["arguments"].as_str().unwrap_or("").to_string(),
            }])
        }
        "response.function_call_arguments.delta" => Sse::Tools(vec![ToolFragment {
            index: v["output_index"].as_u64().unwrap_or(0) as usize,
            id: None,
            name: None,
            args: v["delta"].as_str().unwrap_or("").to_string(),
        }]),
        "response.completed" => Sse::Done,
        "response.failed" | "response.incomplete" | "error" => {
            let message = v["response"]["error"]["message"]
                .as_str()
                .or_else(|| v["error"]["message"].as_str())
                .or_else(|| v["response"]["incomplete_details"]["reason"].as_str())
                .unwrap_or("OpenAI response did not complete");
            Sse::Error(message.to_string())
        }
        _ => Sse::Ignore,
    }
}

/// Reassembles streamed tool-call fragments into whole calls.
#[derive(Default, Debug)]
pub struct ToolAcc {
    calls: Vec<ToolCallOut>,
}

impl ToolAcc {
    pub fn push(&mut self, f: ToolFragment) {
        if self.calls.len() <= f.index {
            self.calls.resize(f.index + 1, ToolCallOut::default());
        }
        let slot = &mut self.calls[f.index];
        if let Some(id) = f.id {
            slot.id = id;
        }
        if let Some(name) = f.name {
            slot.name = name;
        }
        slot.arguments.push_str(&f.args);
    }

    /// Only calls that actually named a function are real; a gap in the index
    /// space would otherwise surface as a nameless call the frontend can't run.
    pub fn finish(self) -> Vec<ToolCallOut> {
        self.calls
            .into_iter()
            .filter(|c| !c.name.is_empty())
            .collect()
    }
}

/// Handle one line, emitting to the UI. Returns true if the stream is finished.
enum StreamStep {
    Continue,
    Complete,
    Failed,
}

fn handle_line(line: &[u8], on_event: &Channel<ChatEvent>, acc: &mut ToolAcc) -> StreamStep {
    match parse_sse_line(line) {
        Sse::Delta(delta) => {
            let _ = on_event.send(ChatEvent::Delta { delta });
            StreamStep::Continue
        }
        Sse::Tools(frags) => {
            for f in frags {
                acc.push(f);
            }
            StreamStep::Continue
        }
        Sse::Done => StreamStep::Complete,
        Sse::Error(message) => {
            let _ = on_event.send(ChatEvent::Error { message });
            StreamStep::Failed
        }
        Sse::Ignore => StreamStep::Continue,
    }
}

/// Close out a stream: hand over any tool calls the model asked for, then Done.
/// Always in that order, so the frontend has the calls before it stops waiting.
fn finish(on_event: &Channel<ChatEvent>, acc: ToolAcc) {
    let calls = acc.finish();
    if !calls.is_empty() {
        let _ = on_event.send(ChatEvent::ToolCalls { calls });
    }
    let _ = on_event.send(ChatEvent::Done);
}

/// Fetch the caller's available model IDs from OpenAI, filtered to chat/reasoning
/// families, so the model list stays current instead of hardcoded.
#[tauri::command]
pub async fn openai_list_models() -> Result<Vec<String>, String> {
    let key = crate::secrets::get_api_key().ok_or(NO_KEY)?;
    let resp = crate::http::quick_client()
        .get(MODELS_URL)
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

/// Stream a Responses API result using the user's stored API key.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAiRequest {
    model: String,
    input: serde_json::Value,
    instructions: String,
    effort: String,
    safety_identifier: Option<String>,
    tools: Option<serde_json::Value>,
    request_id: String,
}

#[tauri::command]
pub async fn openai_stream(
    request: OpenAiRequest,
    on_event: Channel<ChatEvent>,
) -> Result<(), String> {
    let OpenAiRequest {
        model,
        input,
        instructions,
        effort,
        safety_identifier,
        tools,
        request_id,
    } = request;
    let key = match crate::secrets::get_api_key() {
        Some(k) => k,
        None => {
            let _ = on_event.send(ChatEvent::Error {
                message: NO_KEY.into(),
            });
            return Ok(());
        }
    };

    let request = RequestGuard::new(request_id);

    let mut body = serde_json::json!({
        "model": model,
        "input": input,
        "instructions": instructions,
        "stream": true
    });
    if !effort.is_empty() {
        body["reasoning"] = serde_json::json!({ "effort": effort });
    }
    if let Some(id) = safety_identifier.filter(|id| !id.is_empty()) {
        body["safety_identifier"] = serde_json::json!(id);
    }
    // Only send `tools` when there is at least one: an empty array is rejected
    // by the API, and "no tools" must look identical to the pre-tools request.
    if let Some(t) = tools.filter(|t| t.as_array().is_some_and(|a| !a.is_empty())) {
        body["tools"] = t;
        body["tool_choice"] = serde_json::json!("auto");
    }

    let resp = match crate::http::client()
        .post(RESPONSES_URL)
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            let _ = on_event.send(ChatEvent::Error {
                message: e.to_string(),
            });
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
    let mut acc = ToolAcc::default();

    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                let _ = on_event.send(ChatEvent::Error {
                    message: e.to_string(),
                });
                return Ok(());
            }
        };
        if request.cancelled() {
            // Stop means stop: drop any half-built tool calls rather than
            // handing the frontend work the user just cancelled.
            let _ = on_event.send(ChatEvent::Done);
            return Ok(());
        }
        buf.extend_from_slice(&chunk);

        while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let mut line: Vec<u8> = buf.drain(..=pos).collect();
            line.pop(); // drop the trailing '\n'
            match handle_line(&line, &on_event, &mut acc) {
                StreamStep::Complete => {
                    finish(&on_event, acc);
                    return Ok(());
                }
                StreamStep::Failed => return Ok(()),
                StreamStep::Continue => {}
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
    if !buf.is_empty() && matches!(handle_line(&buf, &on_event, &mut acc), StreamStep::Failed) {
        return Ok(());
    }

    finish(&on_event, acc);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{Sse, ToolAcc, ToolCallOut, parse_sse_line};

    fn parse(s: &str) -> Sse {
        parse_sse_line(s.as_bytes())
    }

    /// Feed a whole SSE script through the accumulator, the way the real loop
    /// does, and return the calls the frontend would be handed.
    fn accumulate(lines: &[&str]) -> Vec<ToolCallOut> {
        let mut acc = ToolAcc::default();
        for l in lines {
            if let Sse::Tools(frags) = parse(l) {
                for f in frags {
                    acc.push(f);
                }
            }
        }
        acc.finish()
    }

    #[test]
    fn reassembles_a_tool_call_split_across_chunks() {
        // How OpenAI actually streams one: id + name once, then arguments in
        // fragments that are not individually valid JSON.
        let calls = accumulate(&[
            r#"data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"call_1","name":"web_search","arguments":""}}"#,
            r#"data: {"type":"response.function_call_arguments.delta","output_index":0,"delta":"{\"que"}"#,
            r#"data: {"type":"response.function_call_arguments.delta","output_index":0,"delta":"ry\":\"perch\"}"}"#,
        ]);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].id, "call_1");
        assert_eq!(calls[0].name, "web_search");
        assert_eq!(calls[0].arguments, r#"{"query":"perch"}"#);
    }

    #[test]
    fn keeps_parallel_tool_calls_apart_by_index() {
        let calls = accumulate(&[
            r#"data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"a","name":"web_search","arguments":"{}"}}"#,
            r#"data: {"type":"response.output_item.added","output_index":1,"item":{"type":"function_call","call_id":"b","name":"read_screen","arguments":"{}"}}"#,
        ]);
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].name, "web_search");
        assert_eq!(calls[1].name, "read_screen");
    }

    #[test]
    fn drops_index_gaps_that_never_named_a_function() {
        // A call at index 2 with nothing at 0/1 must not yield two empty calls
        // the frontend would try to run.
        let calls = accumulate(&[
            r#"data: {"type":"response.output_item.added","output_index":2,"item":{"type":"function_call","call_id":"c","name":"web_search","arguments":"{}"}}"#,
        ]);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "web_search");
    }

    #[test]
    fn a_text_only_stream_produces_no_tool_calls() {
        let calls = accumulate(&[r#"data: {"type":"response.output_text.delta","delta":"hi"}"#]);
        assert!(calls.is_empty());
    }

    #[test]
    fn extracts_a_content_delta() {
        let line = r#"data: {"type":"response.output_text.delta","delta":"Hello"}"#;
        assert_eq!(parse(line), Sse::Delta("Hello".into()));
    }

    #[test]
    fn recognizes_the_completed_event() {
        assert_eq!(parse(r#"data: {"type":"response.completed"}"#), Sse::Done);
    }

    #[test]
    fn ignores_keepalives_and_non_data_lines() {
        assert_eq!(parse(""), Sse::Ignore);
        assert_eq!(parse(": ping"), Sse::Ignore);
        assert_eq!(parse("event: message"), Sse::Ignore);
    }

    #[test]
    fn ignores_malformed_json_instead_of_failing_the_stream() {
        assert_eq!(parse("data: {not json"), Sse::Ignore);
    }

    #[test]
    fn ignores_role_only_and_empty_deltas() {
        assert_eq!(parse(r#"data: {"type":"response.created"}"#), Sse::Ignore);
        assert_eq!(
            parse(r#"data: {"type":"response.output_text.delta","delta":""}"#),
            Sse::Ignore
        );
    }

    #[test]
    fn preserves_multibyte_and_whitespace_content() {
        // Content is taken verbatim: trimming it would eat the spaces and
        // newlines that make up the reply's formatting.
        let line = r#"data: {"type":"response.output_text.delta","delta":"  héllo — 世界\n"}"#;
        assert_eq!(parse(line), Sse::Delta("  héllo — 世界\n".into()));
    }
}
