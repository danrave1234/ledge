//! Spotify Web API: PKCE sign-in and an authenticated request proxy.
//!
//! Design rules, in order of importance:
//!
//! 1. **No client secret.** A desktop app cannot keep one — anybody can read it
//!    out of the binary. PKCE exists for exactly this case, and the client ID is
//!    public by design. The user supplies their own ID (see the plugin's
//!    settings), because Ledge has no Spotify app of its own to ship.
//! 2. **Tokens never reach the WebView.** The refresh token lives in the Windows
//!    Credential Manager and the access token stays in this process; the
//!    frontend calls `spotify_request` and never sees either. A token in
//!    JavaScript is a token one `{@html}` bug away from being exfiltrated.
//! 3. **The frontend cannot call arbitrary endpoints.** `spotify_request` takes
//!    a path, checked against an allowlist of the prefixes this feature needs.
//!    Without it the proxy would be a general-purpose "do anything to the user's
//!    Spotify account" primitive reachable from any code in the page.
//! 4. **Zero new crates.** SHA-256 and secure randomness come from WinRT, which
//!    is already a dependency. Installer size is part of the product.

use crate::http::quick_client;
use crate::secrets::{self, SPOTIFY_REFRESH_TOKEN};
use base64::Engine;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

/// Loopback port for the OAuth redirect.
///
/// Fixed, not ephemeral: Spotify matches the redirect URI EXACTLY against the
/// one registered in the developer dashboard, so it cannot vary per run. If the
/// port is busy, sign-in fails with a message saying so rather than silently
/// listening somewhere Spotify will never redirect to.
pub const REDIRECT_PORT: u16 = 7331;

pub fn redirect_uri() -> String {
    format!("http://127.0.0.1:{REDIRECT_PORT}/callback")
}

/// Everything the music feature needs, and nothing else.
///
/// `/me/player/*` covers reading and controlling playback, `/me/playlists` and
/// `/search` cover finding something to play. Notably absent: anything that
/// modifies the user's library or follows/unfollows.
const ALLOWED_PATHS: &[&str] = &[
    "/v1/search",
    "/v1/me/player",
    "/v1/me/playlists",
    "/v1/me/top/",
    "/v1/playlists/",
    "/v1/albums/",
    "/v1/artists/",
    "/v1/tracks/",
];

const SCOPES: &str = "user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative user-library-read user-top-read";

/// True when `path` is one this app is allowed to call.
///
/// Deliberately strict about shape: the path must start with `/v1/`, must not
/// contain `..` or a scheme, and must match a listed prefix. Pure, so the rule
/// is testable without a network or a token.
pub fn path_allowed(path: &str) -> bool {
    if !path.starts_with("/v1/") || path.contains("..") || path.contains("://") {
        return false;
    }
    // Compare against the path only; a query string is fine and expected.
    let base = path.split('?').next().unwrap_or(path);
    ALLOWED_PATHS
        .iter()
        .any(|p| base == p.trim_end_matches('/') || base.starts_with(p))
}

/* ---------------------------------------------------------------------------
PKCE
--------------------------------------------------------------------------- */

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// WinRT hands bytes back through its own `Array<u8>`, not a `Vec`.
#[cfg(windows)]
fn buffer_bytes(buf: &windows::Storage::Streams::IBuffer) -> Result<Vec<u8>, String> {
    use windows::Security::Cryptography::CryptographicBuffer;
    let mut arr = windows::core::Array::<u8>::new();
    CryptographicBuffer::CopyToByteArray(buf, &mut arr).map_err(|e| e.to_string())?;
    Ok(arr.to_vec())
}

#[cfg(windows)]
fn random_bytes(n: u32) -> Result<Vec<u8>, String> {
    use windows::Security::Cryptography::CryptographicBuffer;
    let buf = CryptographicBuffer::GenerateRandom(n).map_err(|e| e.to_string())?;
    buffer_bytes(&buf)
}

#[cfg(windows)]
fn sha256(data: &str) -> Result<Vec<u8>, String> {
    use windows::Security::Cryptography::Core::HashAlgorithmProvider;
    use windows::Security::Cryptography::{BinaryStringEncoding, CryptographicBuffer};
    use windows::core::HSTRING;

    let provider = HashAlgorithmProvider::OpenAlgorithm(&HSTRING::from("SHA256"))
        .map_err(|e| e.to_string())?;
    let input = CryptographicBuffer::ConvertStringToBinary(
        &HSTRING::from(data),
        BinaryStringEncoding::Utf8,
    )
    .map_err(|e| e.to_string())?;
    let hashed = provider.HashData(&input).map_err(|e| e.to_string())?;
    buffer_bytes(&hashed)
}

#[cfg(not(windows))]
fn random_bytes(_n: u32) -> Result<Vec<u8>, String> {
    Err("Spotify sign-in is only available on Windows".into())
}

#[cfg(not(windows))]
fn sha256(_data: &str) -> Result<Vec<u8>, String> {
    Err("Spotify sign-in is only available on Windows".into())
}

/// A PKCE verifier: 64 URL-safe characters, well inside the spec's 43–128.
fn make_verifier() -> Result<String, String> {
    Ok(b64url(&random_bytes(48)?))
}

fn challenge_for(verifier: &str) -> Result<String, String> {
    Ok(b64url(&sha256(verifier)?))
}

/* ---------------------------------------------------------------------------
The loopback callback
--------------------------------------------------------------------------- */

/// Pull the query parameters out of an HTTP request line.
///
/// Hand-rolled rather than pulling in a web framework for one request. Only the
/// request line matters — the headers and body are irrelevant for a redirect.
/// Pure and testable.
pub fn parse_callback(request: &str) -> Result<Vec<(String, String)>, String> {
    let line = request.lines().next().unwrap_or("");
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    if method != "GET" {
        return Err(format!("unexpected {method} request on the callback port"));
    }
    let query = match target.split_once('?') {
        Some((_, q)) => q,
        None => return Ok(Vec::new()),
    };
    Ok(query
        .split('&')
        .filter(|p| !p.is_empty())
        .map(|pair| {
            let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
            (percent_decode(k), percent_decode(v))
        })
        .collect())
}

/// Minimal percent-decoding, including `+` as space. Spotify sends us an
/// authorization code and possibly an error description; both can be encoded.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
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
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn done_page(message: &str) -> String {
    // Kept deliberately plain: it renders in the user's browser, not in Ledge.
    let body = format!(
        "<!doctype html><meta charset=utf-8><title>Ledge</title>\
         <body style=\"font:15px system-ui;padding:48px;text-align:center\">\
         <h2>{message}</h2><p>You can close this tab and go back to Ledge.</p>"
    );
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    )
}

/// Wait for Spotify to redirect back, and return the query parameters.
///
/// Non-blocking accept in a poll loop rather than a blocking one: a blocking
/// `accept()` cannot be cancelled, so a user who closes the browser instead of
/// signing in would leak a thread parked forever.
fn await_callback(timeout: Duration) -> Result<Vec<(String, String)>, String> {
    let listener = TcpListener::bind(("127.0.0.1", REDIRECT_PORT)).map_err(|e| {
        format!(
            "could not listen on 127.0.0.1:{REDIRECT_PORT} for the Spotify redirect ({e}). \
             Close whatever is using that port and try again."
        )
    })?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;

    let deadline = Instant::now() + timeout;
    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .map_err(|e| e.to_string())?;
                let mut buf = [0u8; 8192];
                let n = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]).into_owned();
                let params = parse_callback(&request);
                let ok = params
                    .as_ref()
                    .map(|p| p.iter().any(|(k, _)| k == "code"))
                    .unwrap_or(false);
                let _ = stream.write_all(
                    done_page(if ok {
                        "Spotify connected."
                    } else {
                        "Spotify sign-in failed."
                    })
                    .as_bytes(),
                );
                let _ = stream.flush();
                return params;
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err("timed out waiting for Spotify sign-in".into());
                }
                std::thread::sleep(Duration::from_millis(150));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

/* ---------------------------------------------------------------------------
Tokens
--------------------------------------------------------------------------- */

/// Access token + when it stops being valid. In memory only: it lives ~1 hour,
/// so persisting it would buy nothing and widen where a secret can leak.
static ACCESS: LazyLock<Mutex<Option<(String, Instant)>>> = LazyLock::new(|| Mutex::new(None));
/// The client ID the user configured, handed down from the frontend on each
/// call that needs it. Cached so a refresh can happen without one.
static CLIENT_ID: LazyLock<Mutex<Option<String>>> = LazyLock::new(|| Mutex::new(None));

fn set_client_id(id: &str) {
    if let Ok(mut g) = CLIENT_ID.lock() {
        *g = Some(id.to_string());
    }
}

fn client_id() -> Result<String, String> {
    CLIENT_ID
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .ok_or_else(|| "Spotify client ID is not set. Add it in Settings → Plugins → Music.".into())
}

#[derive(serde::Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: Option<u64>,
    refresh_token: Option<String>,
}

fn store_tokens(t: TokenResponse) -> Result<(), String> {
    // Spotify only returns a new refresh token sometimes; keep the old one when
    // it doesn't, or the next launch would find nothing and force a re-login.
    if let Some(r) = t.refresh_token.as_deref() {
        secrets::set(SPOTIFY_REFRESH_TOKEN, r)?;
    }
    // Expire a minute early so a request can't set off mid-flight.
    let ttl = Duration::from_secs(t.expires_in.unwrap_or(3600).saturating_sub(60));
    if let Ok(mut g) = ACCESS.lock() {
        *g = Some((t.access_token, Instant::now() + ttl));
    }
    Ok(())
}

async fn exchange(form: &[(&str, &str)]) -> Result<TokenResponse, String> {
    let res = quick_client()
        .post("https://accounts.spotify.com/api/token")
        .form(form)
        .send()
        .await
        .map_err(|e| format!("could not reach Spotify: {e}"))?;

    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("Spotify rejected the sign-in ({status}): {body}"));
    }
    serde_json::from_str::<TokenResponse>(&body)
        .map_err(|e| format!("could not read Spotify's token response: {e}"))
}

/// A valid access token, refreshing if the cached one has expired.
async fn access_token() -> Result<String, String> {
    if let Ok(g) = ACCESS.lock()
        && let Some((tok, until)) = g.as_ref()
        && Instant::now() < *until
    {
        return Ok(tok.clone());
    }
    let refresh = secrets::get(SPOTIFY_REFRESH_TOKEN)
        .ok_or("Not connected to Spotify. Connect it in Settings → Plugins → Music.")?;
    let id = client_id()?;
    let tokens = exchange(&[
        ("grant_type", "refresh_token"),
        ("refresh_token", &refresh),
        ("client_id", &id),
    ])
    .await?;
    let token = tokens.access_token.clone();
    store_tokens(tokens)?;
    Ok(token)
}

/* ---------------------------------------------------------------------------
Commands
--------------------------------------------------------------------------- */

/// Run the PKCE sign-in: open Spotify's consent page, catch the redirect on the
/// loopback listener, and exchange the code for tokens.
///
/// Blocks until the user finishes or the timeout expires, which is why it is
/// async and the listener poll runs on a blocking worker.
#[tauri::command]
pub async fn spotify_connect(app: tauri::AppHandle, client_id: String) -> Result<(), String> {
    let id = client_id.trim().to_string();
    if id.is_empty() {
        return Err("Enter your Spotify client ID first.".into());
    }
    set_client_id(&id);

    let verifier = make_verifier()?;
    let challenge = challenge_for(&verifier)?;
    // CSRF guard: Spotify echoes this back, and a callback carrying anything
    // else did not come from the request we just made.
    let state = b64url(&random_bytes(16)?);

    let url = format!(
        "https://accounts.spotify.com/authorize?client_id={}&response_type=code&redirect_uri={}&scope={}&code_challenge_method=S256&code_challenge={}&state={}",
        urlencode(&id),
        urlencode(&redirect_uri()),
        urlencode(SCOPES),
        urlencode(&challenge),
        urlencode(&state),
    );

    // Start listening BEFORE opening the browser: a fast redirect against a
    // listener that isn't up yet is a connection refused the user sees as a
    // broken sign-in.
    let waiter =
        tauri::async_runtime::spawn_blocking(move || await_callback(Duration::from_secs(180)));

    tauri_plugin_opener::open_url(&url, None::<&str>)
        .map_err(|e| format!("could not open the browser for Spotify sign-in: {e}"))?;
    let _ = &app;

    let params = waiter
        .await
        .map_err(|e| format!("sign-in task failed: {e}"))??;

    let get = |key: &str| {
        params
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.clone())
            .unwrap_or_default()
    };

    if !get("error").is_empty() {
        return Err(format!("Spotify sign-in was declined: {}", get("error")));
    }
    if get("state") != state {
        return Err("Spotify sign-in failed a security check (state mismatch).".into());
    }
    let code = get("code");
    if code.is_empty() {
        return Err("Spotify did not return an authorization code.".into());
    }

    let redirect = redirect_uri();
    let tokens = exchange(&[
        ("grant_type", "authorization_code"),
        ("code", &code),
        ("redirect_uri", &redirect),
        ("client_id", &id),
        ("code_verifier", &verifier),
    ])
    .await?;
    store_tokens(tokens)
}

/// Percent-encode a query parameter value. Only the characters that actually
/// need it in a URL query — enough for scopes, URLs, and base64url.
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

#[tauri::command]
pub fn spotify_connected() -> bool {
    secrets::get(SPOTIFY_REFRESH_TOKEN).is_some()
}

#[tauri::command]
pub fn spotify_disconnect() -> Result<(), String> {
    if let Ok(mut g) = ACCESS.lock() {
        *g = None;
    }
    secrets::clear(SPOTIFY_REFRESH_TOKEN)
}

/// Make an authenticated call to the Spotify Web API.
///
/// Returns the raw body so the typed shaping lives in one place on the frontend.
/// A 204 (which several playback endpoints return on success) comes back as an
/// empty string rather than a parse error.
#[tauri::command]
pub async fn spotify_request(
    method: String,
    path: String,
    body: Option<String>,
    client_id: Option<String>,
) -> Result<String, String> {
    if let Some(id) = client_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        set_client_id(id);
    }
    if !path_allowed(&path) {
        return Err(format!("path \"{path}\" is not allowed"));
    }
    let token = access_token().await?;

    let url = format!("https://api.spotify.com{path}");
    let m = reqwest::Method::from_bytes(method.to_uppercase().as_bytes())
        .map_err(|_| format!("bad method \"{method}\""))?;

    let mut req = quick_client().request(m, &url).bearer_auth(&token);
    if let Some(b) = body.filter(|b| !b.trim().is_empty()) {
        req = req.header("Content-Type", "application/json").body(b);
    } else {
        // Spotify's PUT playback endpoints 400 without a body or a length.
        req = req.header("Content-Length", "0");
    }

    let res = req
        .send()
        .await
        .map_err(|e| format!("could not reach Spotify: {e}"))?;
    let status = res.status();
    let text = res.text().await.unwrap_or_default();

    if status.is_success() {
        return Ok(text);
    }
    // Turn the failures that actually happen into something a person (and the
    // model) can act on, rather than a bare status code.
    Err(match status.as_u16() {
        401 => "Spotify session expired. Reconnect it in Settings → Plugins → Music.".into(),
        403 if text.contains("Premium") || text.contains("premium") => {
            "Spotify Premium is required to control playback from an app.".into()
        }
        403 => format!("Spotify refused that request: {text}"),
        404 => "No active Spotify device. Open Spotify and play something first, then try again."
            .into(),
        429 => "Spotify is rate-limiting us. Wait a moment and try again.".into(),
        _ => format!("Spotify request failed ({status}): {text}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_the_endpoints_the_feature_needs() {
        assert!(path_allowed("/v1/search?q=abc&type=track"));
        assert!(path_allowed("/v1/me/player"));
        assert!(path_allowed("/v1/me/player/play"));
        assert!(path_allowed("/v1/me/player/devices"));
        assert!(path_allowed("/v1/me/playlists?limit=50"));
        assert!(path_allowed("/v1/playlists/37i9dQZF1DX/tracks"));
    }

    #[test]
    fn rejects_everything_else() {
        // The proxy must not become a general "do anything to my Spotify
        // account" primitive reachable from page code.
        assert!(!path_allowed("/v1/me"));
        assert!(!path_allowed("/v1/me/following"));
        assert!(!path_allowed("/v1/me/tracks"));
        assert!(!path_allowed("/v1/users/someone/playlists"));
        assert!(!path_allowed("/"));
        assert!(!path_allowed(""));
    }

    #[test]
    fn rejects_attempts_to_escape_the_api_host() {
        assert!(!path_allowed("https://evil.example/v1/search"));
        assert!(!path_allowed("/v1/../../etc/passwd"));
        assert!(!path_allowed("/v1/search/../../me"));
        assert!(!path_allowed("//evil.example/v1/search"));
    }

    #[test]
    fn parses_the_authorization_code_out_of_the_callback() {
        let req = "GET /callback?code=AQD123&state=xyz HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        let params = parse_callback(req).unwrap();
        assert_eq!(
            params.iter().find(|(k, _)| k == "code").unwrap().1,
            "AQD123"
        );
        assert_eq!(params.iter().find(|(k, _)| k == "state").unwrap().1, "xyz");
    }

    #[test]
    fn parses_a_denied_sign_in() {
        let req = "GET /callback?error=access_denied&state=xyz HTTP/1.1\r\n\r\n";
        let params = parse_callback(req).unwrap();
        assert_eq!(
            params.iter().find(|(k, _)| k == "error").unwrap().1,
            "access_denied"
        );
    }

    #[test]
    fn decodes_percent_escapes_and_plus() {
        let req = "GET /callback?error_description=Invalid+redirect%20URI HTTP/1.1\r\n\r\n";
        let params = parse_callback(req).unwrap();
        assert_eq!(params[0].1, "Invalid redirect URI");
    }

    #[test]
    fn handles_a_callback_with_no_query_at_all() {
        let req = "GET /callback HTTP/1.1\r\n\r\n";
        assert_eq!(parse_callback(req).unwrap().len(), 0);
    }

    #[test]
    fn rejects_a_non_get_on_the_callback_port() {
        assert!(parse_callback("POST /callback HTTP/1.1\r\n\r\n").is_err());
    }

    #[test]
    fn urlencodes_the_characters_that_break_a_query() {
        assert_eq!(urlencode("a b"), "a%20b");
        assert_eq!(
            urlencode("http://127.0.0.1:7331/callback"),
            "http%3A%2F%2F127.0.0.1%3A7331%2Fcallback"
        );
        // base64url output must survive untouched, or the challenge won't match.
        assert_eq!(urlencode("aZ09-_.~"), "aZ09-_.~");
    }

    #[test]
    fn redirect_uri_matches_what_must_be_registered() {
        // If this changes, every user has to edit their Spotify dashboard entry.
        assert_eq!(redirect_uri(), "http://127.0.0.1:7331/callback");
    }

    #[cfg(windows)]
    #[test]
    fn pkce_challenge_is_a_stable_sha256_of_the_verifier() {
        // Known-answer test from RFC 7636 appendix B, so a broken hash or a
        // padded base64 is caught here rather than by Spotify rejecting it.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            challenge_for(verifier).unwrap(),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[cfg(windows)]
    #[test]
    fn verifiers_are_random_and_the_right_length() {
        let a = make_verifier().unwrap();
        let b = make_verifier().unwrap();
        assert_ne!(a, b);
        // RFC 7636 requires 43..=128 characters.
        assert!((43..=128).contains(&a.len()), "length was {}", a.len());
        assert!(
            a.chars()
                .all(|c| c.is_ascii_alphanumeric() || "-_".contains(c))
        );
    }
}
