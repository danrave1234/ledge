use serde::Serialize;

#[derive(Serialize)]
pub struct SearchResult {
    pub title: String,
    pub snippet: String,
    pub url: String,
}

/// Keyless web search via DuckDuckGo's Instant Answer API. Used by the
/// web-search plugin; results are folded into the model's context.
#[tauri::command]
pub async fn web_search(query: String) -> Result<Vec<SearchResult>, String> {
    let client = reqwest::Client::new();
    let v: serde_json::Value = client
        .get("https://api.duckduckgo.com/")
        .query(&[
            ("q", query.as_str()),
            ("format", "json"),
            ("no_html", "1"),
            ("skip_disambig", "1"),
        ])
        .header("User-Agent", "Perch/0.1 (desktop assistant)")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    if let Some(abs) = v["AbstractText"].as_str() {
        if !abs.is_empty() {
            out.push(SearchResult {
                title: v["Heading"].as_str().unwrap_or("").to_string(),
                snippet: abs.to_string(),
                url: v["AbstractURL"].as_str().unwrap_or("").to_string(),
            });
        }
    }
    if let Some(topics) = v["RelatedTopics"].as_array() {
        for t in topics {
            if out.len() >= 6 {
                break;
            }
            if let Some(text) = t["Text"].as_str() {
                if !text.is_empty() {
                    out.push(SearchResult {
                        title: String::new(),
                        snippet: text.to_string(),
                        url: t["FirstURL"].as_str().unwrap_or("").to_string(),
                    });
                }
            }
        }
    }
    Ok(out)
}
