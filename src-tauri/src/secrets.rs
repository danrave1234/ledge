//! Credentials, kept in the Windows Credential Manager rather than on disk.
//!
//! Entries are addressed by name so several secrets can coexist — the OpenAI key
//! and Spotify's refresh token are both here. The names are internal constants,
//! never anything the frontend can invent, so a caller cannot read or overwrite
//! an arbitrary credential belonging to another application.

use keyring::Entry;

const SERVICE: &str = "com.perch.assistant";

/// The OpenAI API key. Unchanged from before this module was generalized, so an
/// existing user's stored key is still found after the upgrade.
pub const OPENAI_API_KEY: &str = "openai_api_key";
/// Spotify's OAuth refresh token. The access token is short-lived and stays in
/// memory; only this needs to survive a restart.
pub const SPOTIFY_REFRESH_TOKEN: &str = "spotify_refresh_token";
/// A YouTube Data API key. Optional — without one the YouTube path can still
/// open a search, it just can't resolve a query to a specific video. Kept here
/// rather than in plugin state because it bills against the user's quota.
pub const YOUTUBE_API_KEY: &str = "youtube_api_key";

fn entry(name: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, name).map_err(|e| e.to_string())
}

pub fn get(name: &str) -> Option<String> {
    let e = entry(name).ok()?;
    match e.get_password() {
        Ok(k) if !k.is_empty() => Some(k),
        _ => None,
    }
}

/// Store a secret, or delete it when `value` is blank. Deleting a credential
/// that was never stored is success, not an error — callers use this to clear.
pub fn set(name: &str, value: &str) -> Result<(), String> {
    let e = entry(name)?;
    if value.trim().is_empty() {
        return clear(name);
    }
    e.set_password(value.trim()).map_err(|x| x.to_string())
}

pub fn clear(name: &str) -> Result<(), String> {
    let e = entry(name)?;
    match e.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(x) => Err(x.to_string()),
    }
}

pub fn get_api_key() -> Option<String> {
    get(OPENAI_API_KEY)
}

#[tauri::command]
pub fn set_api_key(key: String) -> Result<(), String> {
    set(OPENAI_API_KEY, &key)
}

#[tauri::command]
pub fn has_api_key() -> bool {
    get_api_key().is_some()
}

#[tauri::command]
pub fn clear_api_key() -> Result<(), String> {
    clear(OPENAI_API_KEY)
}

#[tauri::command]
pub fn set_youtube_key(key: String) -> Result<(), String> {
    set(YOUTUBE_API_KEY, &key)
}
