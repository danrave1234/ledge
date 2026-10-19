//! Approval-gated application launching.
//!
//! The model never names a path. It asks for an app by name; the frontend
//! matches that against the index returned by `app_list`, shows the exact entry
//! on an approval card, and only then calls `app_launch`. Rust rebuilds the
//! index and refuses anything that is not in it, so an approved card can never
//! be turned into "run this arbitrary file".

use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// Start Menu trees deeper than this are vendor clutter, not apps.
const MAX_SCAN_DEPTH: usize = 4;
/// A cap so a machine with thousands of shortcuts still answers quickly and
/// the model never receives an unbounded list.
const MAX_APPS: usize = 600;

#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AppKind {
    /// A Start Menu `.lnk` file; `path` is the shortcut itself.
    Shortcut,
    /// A built-in Windows app; `path` is an executable name or URI scheme
    /// taken from `SYSTEM_APPS`, never from the caller.
    System,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
pub struct LaunchableApp {
    pub name: String,
    pub path: String,
    pub kind: AppKind,
}

/// Apps that ship with Windows but have no Start Menu shortcut (Store-packaged
/// or System32). Display name → launch target that `ShellExecuteW` accepts.
const SYSTEM_APPS: &[(&str, &str)] = &[
    ("Settings", "ms-settings:"),
    ("Calculator", "calculator:"),
    ("File Explorer", "explorer.exe"),
    ("Notepad", "notepad.exe"),
    ("Paint", "mspaint.exe"),
    ("Snipping Tool", "ms-screenclip:"),
    ("Microsoft Store", "ms-windows-store:"),
    ("Task Manager", "taskmgr.exe"),
];

/// Shortcut names that are not applications the user would ask to "open".
const SKIPPED_NAME_WORDS: &[&str] = &[
    "uninstall",
    "readme",
    "read me",
    "release notes",
    "documentation",
    "help",
    "manual",
    "license",
    "website",
    "web site",
    "homepage",
    "home page",
    "support",
    "changelog",
    "what's new",
];

fn system_apps() -> impl Iterator<Item = LaunchableApp> {
    SYSTEM_APPS.iter().map(|(name, path)| LaunchableApp {
        name: (*name).into(),
        path: (*path).into(),
        kind: AppKind::System,
    })
}

/// Lowercase, single-spaced comparison key. Used both to skip duplicate
/// shortcuts (per-user + all-users copies of the same app) and to validate
/// an approved entry against a fresh index.
pub(crate) fn name_key(name: &str) -> String {
    name.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

pub(crate) fn is_app_shortcut(file_name: &str) -> bool {
    let lower = file_name.to_lowercase();
    if !lower.ends_with(".lnk") {
        return false;
    }
    let stem = &lower[..lower.len() - ".lnk".len()];
    !stem.trim().is_empty() && !SKIPPED_NAME_WORDS.iter().any(|w| stem.contains(w))
}

pub(crate) fn display_name(file_name: &str) -> String {
    let stem = file_name
        .rsplit_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(file_name);
    stem.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn collect_shortcuts(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth > MAX_SCAN_DEPTH || out.len() >= MAX_APPS {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_shortcuts(&path, depth + 1, out);
        } else if path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(is_app_shortcut)
        {
            out.push(path);
        }
        if out.len() >= MAX_APPS {
            return;
        }
    }
}

fn start_menu_roots() -> Vec<PathBuf> {
    ["APPDATA", "PROGRAMDATA"]
        .iter()
        .filter_map(std::env::var_os)
        .map(|base| PathBuf::from(base).join(r"Microsoft\Windows\Start Menu\Programs"))
        .collect()
}

/// Deduplicate by display name, keeping first occurrence, and sort for a
/// stable list. Pure so it can be tested without a Start Menu.
pub(crate) fn build_index(shortcuts: Vec<PathBuf>) -> Vec<LaunchableApp> {
    let mut seen = HashSet::new();
    let mut apps: Vec<LaunchableApp> = system_apps()
        .filter(|app| seen.insert(name_key(&app.name)))
        .collect();
    for path in shortcuts {
        let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let name = display_name(file_name);
        if !seen.insert(name_key(&name)) {
            continue;
        }
        apps.push(LaunchableApp {
            name,
            path: path.to_string_lossy().into_owned(),
            kind: AppKind::Shortcut,
        });
        if apps.len() >= MAX_APPS {
            break;
        }
    }
    apps.sort_by_key(|app| name_key(&app.name));
    apps
}

fn scan() -> Vec<LaunchableApp> {
    let mut shortcuts = Vec::new();
    for root in start_menu_roots() {
        collect_shortcuts(&root, 0, &mut shortcuts);
    }
    build_index(shortcuts)
}

/// The approved entry must still exist in a fresh index with the same name,
/// path, and kind. Anything else — a renamed shortcut, an edited card payload,
/// a path outside the Start Menu — is refused.
pub(crate) fn validate_against_index<'a>(
    app: &LaunchableApp,
    index: &'a [LaunchableApp],
) -> Result<&'a LaunchableApp, String> {
    index
        .iter()
        .find(|candidate| {
            candidate.kind == app.kind
                && name_key(&candidate.name) == name_key(&app.name)
                && candidate.path.eq_ignore_ascii_case(&app.path)
        })
        .ok_or_else(|| {
            format!(
                "“{}” is no longer available to open. Ask Ledge to find it again.",
                app.name
            )
        })
}

#[tauri::command]
pub fn app_list() -> Vec<LaunchableApp> {
    scan()
}

#[cfg(windows)]
fn shell_open(target: &str) -> Result<(), String> {
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    use windows::core::{HSTRING, PCWSTR};

    /// `ShellExecuteW` returns a pseudo-HINSTANCE; values up to 32 are error codes.
    const SHELL_EXECUTE_MIN_SUCCESS: isize = 32;

    let verb = HSTRING::from("open");
    let file = HSTRING::from(target);
    let result = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(verb.as_ptr()),
            PCWSTR(file.as_ptr()),
            None,
            None,
            SW_SHOWNORMAL,
        )
    };
    if (result.0 as isize) <= SHELL_EXECUTE_MIN_SUCCESS {
        return Err("Windows could not open the approved app.".into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn shell_open(_: &str) -> Result<(), String> {
    Err("Opening apps is only available on Windows.".into())
}

#[tauri::command]
pub fn app_launch(app: LaunchableApp) -> Result<(), String> {
    let index = scan();
    let approved = validate_against_index(&app, &index)?;
    if approved.kind == AppKind::Shortcut && !Path::new(&approved.path).is_file() {
        return Err(format!(
            "The shortcut for “{}” has been removed.",
            approved.name
        ));
    }
    shell_open(&approved.path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_application_shortcuts_and_skips_vendor_clutter() {
        assert!(is_app_shortcut("Visual Studio Code.lnk"));
        assert!(is_app_shortcut("Spotify.LNK"));
        assert!(!is_app_shortcut("Uninstall Spotify.lnk"));
        assert!(!is_app_shortcut("Spotify Website.lnk"));
        assert!(!is_app_shortcut("Release Notes.lnk"));
        assert!(!is_app_shortcut("desktop.ini"));
        assert!(!is_app_shortcut("Setup.exe"));
        assert!(!is_app_shortcut(".lnk"));
    }

    #[test]
    fn display_name_drops_extension_and_extra_spaces() {
        assert_eq!(
            display_name("Visual  Studio Code.lnk"),
            "Visual Studio Code"
        );
        assert_eq!(
            display_name("Node.js command prompt.lnk"),
            "Node.js command prompt"
        );
    }

    #[test]
    fn index_dedupes_by_name_and_includes_system_apps() {
        let index = build_index(vec![
            PathBuf::from(r"C:\Users\me\Start Menu\Programs\Spotify.lnk"),
            PathBuf::from(r"C:\ProgramData\Start Menu\Programs\spotify.lnk"),
            PathBuf::from(r"C:\ProgramData\Start Menu\Programs\Notepad.lnk"),
        ]);
        let spotify: Vec<_> = index.iter().filter(|a| a.name == "Spotify").collect();
        assert_eq!(spotify.len(), 1);
        assert!(spotify[0].path.starts_with(r"C:\Users\me"));
        assert_eq!(spotify[0].kind, AppKind::Shortcut);
        // The built-in Notepad wins over a stray shortcut with the same name.
        let notepad: Vec<_> = index.iter().filter(|a| a.name == "Notepad").collect();
        assert_eq!(notepad.len(), 1);
        assert_eq!(notepad[0].kind, AppKind::System);
        assert!(index.iter().any(|a| a.path == "ms-settings:"));
        let keys: Vec<_> = index.iter().map(|a| name_key(&a.name)).collect();
        let mut sorted = keys.clone();
        sorted.sort();
        assert_eq!(keys, sorted);
    }

    #[test]
    fn launch_requires_an_exact_indexed_entry() {
        let index = build_index(vec![PathBuf::from(r"C:\Menu\Spotify.lnk")]);
        let ok = LaunchableApp {
            name: "spotify".into(),
            path: r"c:\menu\spotify.lnk".into(),
            kind: AppKind::Shortcut,
        };
        assert!(validate_against_index(&ok, &index).is_ok());

        let outside = LaunchableApp {
            name: "Spotify".into(),
            path: r"C:\Evil\payload.exe".into(),
            kind: AppKind::Shortcut,
        };
        assert!(validate_against_index(&outside, &index).is_err());

        let forged_system = LaunchableApp {
            name: "Settings".into(),
            path: "cmd.exe".into(),
            kind: AppKind::System,
        };
        assert!(validate_against_index(&forged_system, &index).is_err());

        let kind_swap = LaunchableApp {
            name: "Spotify".into(),
            path: r"C:\Menu\Spotify.lnk".into(),
            kind: AppKind::System,
        };
        assert!(validate_against_index(&kind_swap, &index).is_err());
    }
}
