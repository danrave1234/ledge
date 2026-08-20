use serde::Serialize;

/// DuckDuckGo's HTML results endpoint. Keyless, and unlike the Instant Answer
/// API it returns organic results for ordinary questions — the IA API only
/// answers encyclopedia-style entity lookups, which is why the web toggle used
/// to appear to do nothing for most queries.
const HTML_ENDPOINT: &str = "https://html.duckduckgo.com/html/";
/// The IA API still gives a good topic abstract when it has one, so it is used
/// as a bonus first source.
const IA_ENDPOINT: &str = "https://api.duckduckgo.com/";
/// Results folded into the prompt. More than this is prompt bloat the user pays
/// for on every turn.
const MAX_RESULTS: usize = 6;
/// Snippets are truncated so one verbose result can't crowd out the others.
const MAX_SNIPPET: usize = 400;

#[derive(Serialize, Debug, PartialEq)]
pub struct SearchResult {
    pub title: String,
    pub snippet: String,
    pub url: String,
}

/* ---------- tiny HTML helpers (no parser dependency) ---------- */

fn decode_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#x27;", "'")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
}

/// Strip tags (results wrap query terms in `<b>`), collapse whitespace.
fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    decode_entities(&out)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                match u8::from_str_radix(hex, 16) {
                    Ok(b) => {
                        out.push(b);
                        i += 3;
                    }
                    Err(_) => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Results sometimes come wrapped in a DuckDuckGo redirect
/// (`//duckduckgo.com/l/?uddg=<encoded>`); unwrap to the real destination so
/// citations point at the source, not at a tracker.
fn clean_url(raw: &str) -> String {
    let raw = decode_entities(raw);
    if let Some(rest) = raw.split("uddg=").nth(1) {
        let encoded = rest.split('&').next().unwrap_or(rest);
        return percent_decode(encoded);
    }
    if let Some(stripped) = raw.strip_prefix("//") {
        return format!("https://{stripped}");
    }
    raw
}

/// Extract the value of `attr="…"` starting at `from`, and where it ended.
fn attr_after(html: &str, from: usize, attr: &str) -> Option<(String, usize)> {
    let idx = html[from..].find(attr)? + from + attr.len();
    let rest = &html[idx..];
    let end = rest.find('"')?;
    Some((rest[..end].to_string(), idx + end))
}

/// Text between the current position and the next `</a>`.
fn anchor_text(html: &str, from: usize) -> Option<String> {
    let start = html[from..].find('>')? + from + 1;
    let end = html[start..].find("</a>")? + start;
    Some(strip_tags(&html[start..end]))
}

/// Parse DuckDuckGo's HTML results page.
///
/// Deliberately hand-rolled: the markup is a flat, stable list of
/// `result__a` / `result__snippet` anchors, and a real HTML parser would add a
/// heavy dependency to a binary whose whole point is being small. Pinned by
/// tests against a saved copy of a real results page.
pub fn parse_results(html: &str, max: usize) -> Vec<SearchResult> {
    let mut out: Vec<SearchResult> = Vec::new();
    let mut pos = 0;

    while out.len() < max {
        let Some(a) = html[pos..].find("class=\"result__a\"") else {
            break;
        };
        let a = a + pos;
        let Some((href, _)) = attr_after(html, a, "href=\"") else {
            break;
        };
        let title = anchor_text(html, a).unwrap_or_default();
        // The snippet anchor follows its title anchor; stop before the next result.
        let next = html[a + 1..]
            .find("class=\"result__a\"")
            .map(|i| i + a + 1)
            .unwrap_or(html.len());
        let snippet = html[a..next]
            .find("class=\"result__snippet\"")
            .and_then(|i| anchor_text(html, a + i))
            .unwrap_or_default();

        let url = clean_url(&href);
        if !url.is_empty() && !title.is_empty() && !out.iter().any(|r| r.url == url) {
            out.push(SearchResult {
                title,
                snippet: truncate(&snippet, MAX_SNIPPET),
                url,
            });
        }
        pos = next;
    }
    out
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut t: String = s.chars().take(max).collect();
    t.push('…');
    t
}

/// Fetch the Instant Answer abstract, when there is one. Best-effort: a failure
/// here must not fail the search.
async fn instant_answer(query: &str) -> Option<SearchResult> {
    let v: serde_json::Value = crate::http::quick_client()
        .get(IA_ENDPOINT)
        .query(&[
            ("q", query),
            ("format", "json"),
            ("no_html", "1"),
            ("skip_disambig", "1"),
        ])
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;

    let abstract_text = v["AbstractText"].as_str().unwrap_or("");
    if abstract_text.is_empty() {
        return None;
    }
    Some(SearchResult {
        title: v["Heading"].as_str().unwrap_or("Overview").to_string(),
        snippet: truncate(abstract_text, MAX_SNIPPET),
        url: v["AbstractURL"].as_str().unwrap_or("").to_string(),
    })
}

/// Keyless web search. Returns ranked results with real URLs so the model can
/// cite them.
#[tauri::command]
pub async fn web_search(query: String) -> Result<Vec<SearchResult>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let html = crate::http::quick_client()
        .post(HTML_ENDPOINT)
        .form(&[("q", query)])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let mut results = parse_results(&html, MAX_RESULTS);

    // Lead with the topic abstract when DuckDuckGo has one.
    if let Some(ia) = instant_answer(query).await
        && !ia.url.is_empty()
        && !results.iter().any(|r| r.url == ia.url)
    {
        results.insert(0, ia);
        results.truncate(MAX_RESULTS);
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Trimmed from a real html.duckduckgo.com response.
    const PAGE: &str = r#"
      <div class="result results_links results_links_deep web-result ">
        <div class="links_main links_deep result__body">
          <h2 class="result__title">
            <a rel="nofollow" class="result__a" href="https://svelte.dev/blog/svelte-5-is-alive">Svelte 5 is alive</a>
          </h2>
          <a class="result__snippet" href="https://svelte.dev/blog/svelte-5-is-alive">We plan to release a new <b>version</b> <b>of</b> SvelteKit &amp; more.</a>
        </div>
      </div>
      <div class="result results_links results_links_deep web-result ">
        <div class="links_main links_deep result__body">
          <h2 class="result__title">
            <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fsveltejs%2Fsvelte%2Freleases&amp;rut=abc">Releases &#x27;sveltejs/svelte&#x27;</a>
          </h2>
          <a class="result__snippet" href="x">Release notes</a>
        </div>
      </div>
    "#;

    #[test]
    fn extracts_title_snippet_and_url() {
        let r = parse_results(PAGE, 10);
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].title, "Svelte 5 is alive");
        assert_eq!(r[0].url, "https://svelte.dev/blog/svelte-5-is-alive");
        assert_eq!(
            r[0].snippet,
            "We plan to release a new version of SvelteKit & more."
        );
    }

    #[test]
    fn unwraps_duckduckgo_redirect_urls() {
        // Citations must point at the source, not at a tracker.
        let r = parse_results(PAGE, 10);
        assert_eq!(r[1].url, "https://github.com/sveltejs/svelte/releases");
    }

    #[test]
    fn decodes_entities_in_titles() {
        let r = parse_results(PAGE, 10);
        assert_eq!(r[1].title, "Releases 'sveltejs/svelte'");
    }

    #[test]
    fn respects_the_result_cap() {
        assert_eq!(parse_results(PAGE, 1).len(), 1);
    }

    #[test]
    fn returns_nothing_for_a_page_with_no_results() {
        assert!(parse_results("<html><body>no results</body></html>", 6).is_empty());
        assert!(parse_results("", 6).is_empty());
    }

    #[test]
    fn skips_duplicate_urls() {
        let dup = PAGE.to_string() + PAGE;
        assert_eq!(parse_results(&dup, 10).len(), 2);
    }

    #[test]
    fn truncates_an_overlong_snippet() {
        let long = "x".repeat(MAX_SNIPPET + 50);
        let page = format!(
            r#"<a rel="nofollow" class="result__a" href="https://e.com">T</a>
               <a class="result__snippet" href="x">{long}</a>"#
        );
        let r = parse_results(&page, 5);
        assert_eq!(r[0].snippet.chars().count(), MAX_SNIPPET + 1); // + ellipsis
    }

    #[test]
    fn percent_decoding_handles_plus_and_escapes() {
        assert_eq!(percent_decode("a%20b+c"), "a b c");
        assert_eq!(percent_decode("100%"), "100%");
    }
}
