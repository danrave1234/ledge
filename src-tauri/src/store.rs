use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Manager};

static WRITE_SEQ: AtomicU64 = AtomicU64::new(0);

fn sanitize(key: &str) -> String {
    key.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn store_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("store");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Durable per-key storage in the OS app-data folder — survives WebView2
/// cache clears (unlike localStorage), so conversation history, personas,
/// and settings are never lost when the cache is wiped.
#[tauri::command]
pub fn store_read(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let path = store_dir(&app)?.join(format!("{}.json", sanitize(&key)));
    match fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub fn store_write(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let dir = store_dir(&app)?;
    let name = sanitize(&key);
    let path = dir.join(format!("{}.json", name));
    // Unique temp name per write so concurrent writes to the same key don't race
    // on a shared temp file. Atomic rename means a crash mid-write can't corrupt data.
    let seq = WRITE_SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp = dir.join(format!("{}.json.tmp.{}", name, seq));
    fs::write(&tmp, value).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })?;
    Ok(())
}
