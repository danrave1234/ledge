//! YouTube Music, as far as it can honestly be automated.
//!
//! There is no official API for controlling YouTube Music playback. What exists:
//!
//! - The **Data API** can resolve "some lo-fi" to a specific video or playlist
//!   id, given a user-supplied key. That is what this module does.
//! - Opening `music.youtube.com/watch?v=…` in the browser usually starts
//!   playback, because YouTube has high media engagement — but it is NOT
//!   guaranteed, and nothing here may claim it worked. The caller confirms
//!   through SMTC (which DOES work for a browser tab) before reporting success.
//!
//! Without a key the feature degrades to opening a search page, which is honest
//! and still useful, rather than pretending to have played something.

use crate::http::quick_client;
use crate::secrets::{self, YOUTUBE_API_KEY};

#[derive(serde::Serialize)]
pub struct YoutubeItem {
    /// `music.youtube.com` URL that plays this item.
    pub url: String,
    pub title: String,
    pub subtitle: String,
    pub art: Option<String>,
    /// "video" or "playlist".
    pub kind: String,
}

/// Percent-encode a query parameter. Same rules as the Spotify module; kept
/// local so neither module owns the other's URL building.
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// The URL that plays a single track.
pub fn watch_url(video_id: &str) -> String {
    format!("https://music.youtube.com/watch?v={}", urlencode(video_id))
}

/// The URL that plays a playlist.
///
/// `watch?list=` rather than `playlist?list=`: the latter opens the playlist's
/// PAGE and waits for a click, which is exactly the "looks like it worked but
/// nothing is playing" failure this feature has to avoid.
pub fn playlist_url(playlist_id: &str) -> String {
    format!(
        "https://music.youtube.com/watch?list={}",
        urlencode(playlist_id)
    )
}

/* ---------- Data API ---------- */

#[derive(serde::Deserialize)]
struct SearchResponse {
    #[serde(default)]
    items: Vec<SearchItem>,
}

#[derive(serde::Deserialize)]
struct SearchItem {
    #[serde(default)]
    id: ItemId,
    #[serde(default)]
    snippet: Snippet,
}

#[derive(serde::Deserialize, Default)]
struct ItemId {
    #[serde(rename = "videoId")]
    video_id: Option<String>,
    #[serde(rename = "playlistId")]
    playlist_id: Option<String>,
}

#[derive(serde::Deserialize, Default)]
struct Snippet {
    #[serde(default)]
    title: String,
    #[serde(rename = "channelTitle", default)]
    channel_title: String,
    #[serde(default)]
    thumbnails: Thumbnails,
}

#[derive(serde::Deserialize, Default)]
struct Thumbnails {
    default: Option<Thumbnail>,
    medium: Option<Thumbnail>,
}

#[derive(serde::Deserialize)]
struct Thumbnail {
    url: String,
}

/// Turn a Data API response into playable items.
///
/// Pure, so the mapping is tested against a real response shape without a key or
/// a network. Entries with neither a video nor a playlist id are dropped —
/// the API returns channel results in mixed searches and those cannot be played.
pub fn parse_search(body: &str) -> Result<Vec<YoutubeItem>, String> {
    let parsed: SearchResponse = serde_json::from_str(body)
        .map_err(|e| format!("could not read YouTube's response: {e}"))?;

    Ok(parsed
        .items
        .into_iter()
        .filter_map(|item| {
            let (url, kind) = if let Some(v) = item.id.video_id.filter(|v| !v.is_empty()) {
                (watch_url(&v), "video")
            } else {
                let p = item.id.playlist_id.filter(|p| !p.is_empty())?;
                (playlist_url(&p), "playlist")
            };
            let art = item
                .snippet
                .thumbnails
                .medium
                .or(item.snippet.thumbnails.default)
                .map(|t| t.url);
            Some(YoutubeItem {
                url,
                // Titles arrive HTML-escaped from the Data API.
                title: unescape(&item.snippet.title),
                subtitle: unescape(&item.snippet.channel_title),
                art,
                kind: kind.to_string(),
            })
        })
        .collect())
}

/// Undo the handful of entities the Data API emits in titles.
fn unescape(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

#[tauri::command]
pub fn youtube_has_key() -> bool {
    secrets::get(YOUTUBE_API_KEY).is_some()
}

/// Resolve a phrase to playable YouTube Music items.
///
/// `kind` is "video" or "playlist". Videos are restricted to the music category
/// so "play some jazz" returns songs rather than documentaries about jazz.
#[tauri::command]
pub async fn youtube_search(
    query: String,
    kind: Option<String>,
    limit: Option<u8>,
) -> Result<Vec<YoutubeItem>, String> {
    let key = secrets::get(YOUTUBE_API_KEY)
        .ok_or("No YouTube API key is set. Add one in Settings → Plugins → Music.")?;
    let q = query.trim();
    if q.is_empty() {
        return Err("query is required".into());
    }
    let kind = match kind.as_deref() {
        Some("playlist") => "playlist",
        _ => "video",
    };
    let limit = limit.unwrap_or(6).clamp(1, 10);

    let mut url = format!(
        "https://www.googleapis.com/youtube/v3/search?part=snippet&type={}&maxResults={}&q={}&key={}",
        kind,
        limit,
        urlencode(q),
        urlencode(&key)
    );
    if kind == "video" {
        // Category 10 is Music.
        url.push_str("&videoCategoryId=10");
    }

    let res = quick_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("could not reach YouTube: {e}"))?;
    let status = res.status();
    let body = res.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(match status.as_u16() {
            400 | 403 if body.contains("quota") => {
                "Your YouTube API key is out of quota for today.".into()
            }
            400 | 403 => {
                "YouTube rejected the API key. Check it in Settings → Plugins → Music.".into()
            }
            _ => format!("YouTube search failed ({status})"),
        });
    }
    parse_search(&body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_urls_that_actually_start_playback() {
        assert_eq!(
            watch_url("dQw4w9WgXcQ"),
            "https://music.youtube.com/watch?v=dQw4w9WgXcQ"
        );
        // watch?list=, NOT playlist?list= — the latter opens a page that waits
        // for a click, which reads to the user as "it didn't work".
        assert_eq!(
            playlist_url("PL123"),
            "https://music.youtube.com/watch?list=PL123"
        );
        assert!(!playlist_url("PL123").contains("/playlist?"));
    }

    #[test]
    fn escapes_ids_that_would_break_the_url() {
        assert_eq!(
            watch_url("a b&c"),
            "https://music.youtube.com/watch?v=a%20b%26c"
        );
    }

    #[test]
    fn maps_a_video_search_response() {
        let body = r#"{"items":[{"id":{"kind":"youtube#video","videoId":"abc123"},
            "snippet":{"title":"Lofi Beats","channelTitle":"Some Channel",
            "thumbnails":{"default":{"url":"https://i.ytimg.com/s.jpg"},
                          "medium":{"url":"https://i.ytimg.com/m.jpg"}}}}]}"#;
        let items = parse_search(body).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].url, "https://music.youtube.com/watch?v=abc123");
        assert_eq!(items[0].title, "Lofi Beats");
        assert_eq!(items[0].subtitle, "Some Channel");
        assert_eq!(items[0].kind, "video");
        // Prefer the medium thumbnail; the default one is 120px and looks poor.
        assert_eq!(items[0].art.as_deref(), Some("https://i.ytimg.com/m.jpg"));
    }

    #[test]
    fn maps_a_playlist_search_response() {
        let body = r#"{"items":[{"id":{"kind":"youtube#playlist","playlistId":"PLabc"},
            "snippet":{"title":"Chill Mix","channelTitle":"YouTube Music","thumbnails":{}}}]}"#;
        let items = parse_search(body).unwrap();
        assert_eq!(items[0].url, "https://music.youtube.com/watch?list=PLabc");
        assert_eq!(items[0].kind, "playlist");
        assert!(items[0].art.is_none());
    }

    #[test]
    fn drops_results_that_cannot_be_played() {
        // A mixed search returns channels, which have neither id — rendering a
        // button for one would produce a link that plays nothing.
        let body = r#"{"items":[
            {"id":{"kind":"youtube#channel","channelId":"UC1"},"snippet":{"title":"A Channel"}},
            {"id":{"videoId":""},"snippet":{"title":"Empty id"}},
            {"id":{"videoId":"ok1"},"snippet":{"title":"Real"}}]}"#;
        let items = parse_search(body).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title, "Real");
    }

    #[test]
    fn unescapes_entities_the_api_puts_in_titles() {
        let body = r#"{"items":[{"id":{"videoId":"x"},
            "snippet":{"title":"Rock &amp; Roll &#39;79 &quot;Live&quot;","channelTitle":"A &amp; B"}}]}"#;
        let items = parse_search(body).unwrap();
        assert_eq!(items[0].title, "Rock & Roll '79 \"Live\"");
        assert_eq!(items[0].subtitle, "A & B");
    }

    #[test]
    fn handles_an_empty_result_set() {
        assert_eq!(parse_search(r#"{"items":[]}"#).unwrap().len(), 0);
        assert_eq!(parse_search("{}").unwrap().len(), 0);
    }

    #[test]
    fn reports_malformed_json_rather_than_panicking() {
        assert!(parse_search("not json").is_err());
    }
}
