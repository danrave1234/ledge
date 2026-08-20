use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Manager};

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;
#[cfg(windows)]
use windows::Win32::Storage::FileSystem::{
    MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
};
#[cfg(windows)]
use windows::core::PCWSTR;

static WRITE_SEQ: AtomicU64 = AtomicU64::new(0);
const MAX_ASSET_BYTES: usize = 12 * 1024 * 1024;

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

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> Result<(), String> {
    let source_wide: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination_wide: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();

    // `std::fs::rename` cannot replace an existing file on Windows. MoveFileExW
    // keeps replacement atomic and asks the OS to flush the move before return.
    unsafe {
        MoveFileExW(
            PCWSTR(source_wide.as_ptr()),
            PCWSTR(destination_wide.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
        .map_err(|error| error.to_string())
    }
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(source, destination).map_err(|error| error.to_string())
}

fn atomic_write(path: &Path, value: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "storage path has no parent directory".to_string())?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "storage path has an invalid filename".to_string())?;
    let seq = WRITE_SEQ.fetch_add(1, Ordering::Relaxed);
    let temporary = parent.join(format!("{file_name}.tmp.{seq}"));

    let write_result = (|| -> Result<(), String> {
        let mut file = fs::File::create(&temporary).map_err(|error| error.to_string())?;
        file.write_all(value).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);
        replace_file(&temporary, path)
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result
}

fn read_optional_text(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

/// Durable per-key storage in the OS app-data folder — survives WebView2
/// cache clears (unlike localStorage), so conversation history, personas,
/// and settings are never lost when the cache is wiped.
#[tauri::command]
pub fn store_read(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let path = store_dir(&app)?.join(format!("{}.json", sanitize(&key)));
    read_optional_text(&path)
}

#[tauri::command]
pub fn store_write(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let dir = store_dir(&app)?;
    let name = sanitize(&key);
    let path = dir.join(format!("{}.json", name));
    atomic_write(&path, value.as_bytes())
}

#[tauri::command]
pub fn store_delete(app: AppHandle, key: String) -> Result<(), String> {
    let path = store_dir(&app)?.join(format!("{}.json", sanitize(&key)));
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

fn asset_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("assets");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub fn asset_store(app: AppHandle, id: String, data_url: String) -> Result<(), String> {
    if id.is_empty() || sanitize(&id) != id {
        return Err("invalid asset id".into());
    }
    if !data_url.starts_with("data:image/") || !data_url.contains(";base64,") {
        return Err("only base64 image data URLs can be stored".into());
    }
    if data_url.len() > MAX_ASSET_BYTES {
        return Err("image is too large (12 MB maximum)".into());
    }
    atomic_write(
        &asset_dir(&app)?.join(format!("{id}.asset")),
        data_url.as_bytes(),
    )
}

#[tauri::command]
pub fn asset_read(app: AppHandle, id: String) -> Result<Option<String>, String> {
    if id.is_empty() || sanitize(&id) != id {
        return Err("invalid asset id".into());
    }
    match fs::read_to_string(asset_dir(&app)?.join(format!("{id}.asset"))) {
        Ok(value) => Ok(Some(value)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn asset_delete(app: AppHandle, id: String) -> Result<(), String> {
    if id.is_empty() || sanitize(&id) != id {
        return Err("invalid asset id".into());
    }
    match fs::remove_file(asset_dir(&app)?.join(format!("{id}.asset"))) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::{read_optional_text, sanitize};
    use std::fs;

    #[test]
    fn keeps_ordinary_store_keys_readable() {
        assert_eq!(sanitize("perch.settings"), "perch.settings");
        assert_eq!(sanitize("perch-conversations_1"), "perch-conversations_1");
    }

    #[test]
    fn neutralizes_path_traversal() {
        // A key becomes a filename inside the app-data store dir, so the
        // property that matters is that the resolved path stays a direct child
        // of that dir. (`.` survives sanitizing — "perch.settings" needs it —
        // but with every separator stripped, ".." is just an ordinary filename.)
        for key in [
            "../../evil",
            r"..\..\evil",
            "/etc/passwd",
            r"C:\Windows\x",
            "..",
            "",
        ] {
            let name = sanitize(key);
            assert!(!name.contains('/'), "{name}");
            assert!(!name.contains('\\'), "{name}");
            let path = std::path::Path::new("root").join(format!("{name}.json"));
            assert_eq!(path.parent(), Some(std::path::Path::new("root")), "{key}");
        }
    }

    #[test]
    fn strips_characters_windows_rejects_in_filenames() {
        for c in [':', '*', '?', '"', '<', '>', '|'] {
            assert_eq!(sanitize(&format!("a{c}b")), "a_b");
        }
    }

    #[test]
    fn is_stable_for_the_same_key() {
        assert_eq!(sanitize("a/b"), sanitize(r"a\b"));
    }

    #[test]
    fn optional_read_only_swallows_missing_files() {
        let path =
            std::env::temp_dir().join(format!("perch-missing-store-test-{}", std::process::id()));
        assert_eq!(read_optional_text(&path).unwrap(), None);
    }

    #[test]
    fn optional_read_reports_invalid_store_contents() {
        let path =
            std::env::temp_dir().join(format!("perch-invalid-store-test-{}", std::process::id()));
        fs::write(&path, [0xff, 0xfe]).unwrap();
        let result = read_optional_text(&path);
        fs::remove_file(path).unwrap();
        assert!(result.is_err());
    }
}
