use keyring::Entry;

const SERVICE: &str = "com.perch.assistant";
const USER: &str = "openai_api_key";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, USER).map_err(|e| e.to_string())
}

pub fn get_api_key() -> Option<String> {
    let e = entry().ok()?;
    match e.get_password() {
        Ok(k) if !k.is_empty() => Some(k),
        _ => None,
    }
}

#[tauri::command]
pub fn set_api_key(key: String) -> Result<(), String> {
    let e = entry()?;
    if key.trim().is_empty() {
        match e.delete_credential() {
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(x) => Err(x.to_string()),
        }
    } else {
        e.set_password(key.trim()).map_err(|x| x.to_string())
    }
}

#[tauri::command]
pub fn has_api_key() -> bool {
    get_api_key().is_some()
}

#[tauri::command]
pub fn clear_api_key() -> Result<(), String> {
    let e = entry()?;
    match e.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(x) => Err(x.to_string()),
    }
}
