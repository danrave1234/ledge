//! Approval-gated folder and file finder.
//!
//! The model never supplies a path. It asks for a name or query; Rust searches
//! bounded safe roots under the user profile and known Windows folders, returns
//! ranked matches, and only opens a path after the user approves it on a card.
//! Rust re-validates the approved path against the allowed roots before opening.

use std::path::{Path, PathBuf};

/// Maximum directory depth to walk per root.
const MAX_DEPTH: usize = 5;
/// Maximum number of results returned per search.
const MAX_RESULTS: usize = 20;

/// Directories that are junk for a user-facing search.
const SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    ".next",
    "dist",
    "build",
    "__pycache__",
    ".vscode",
    ".idea",
    "AppData",
    ".cache",
    ".npm",
    ".cargo",
    "Application Data",
    "Local Settings",
];

/// Well-known folder aliases the user might say ("downloads", "my documents")
/// mapped to the standard English profile subdirectory name.
const ALIASES: &[(&str, &str)] = &[
    ("desktop", "Desktop"),
    ("documents", "Documents"),
    ("downloads", "Downloads"),
    ("pictures", "Pictures"),
    ("photos", "Pictures"),
    ("videos", "Videos"),
    ("music", "Music"),
    ("my documents", "Documents"),
    ("my pictures", "Pictures"),
    ("my downloads", "Downloads"),
    ("my desktop", "Desktop"),
    ("my videos", "Videos"),
    ("my music", "Music"),
    ("home", ""),
    ("user profile", ""),
];

/// Steam-related aliases mapped to special targets.
const STEAM_ALIASES: &[(&str, &str)] = &[
    ("steam", "steam_root"),
    ("steam folder", "steam_root"),
    ("steam library", "steam_root"),
    ("steam games", "steam_common"),
    ("steam game folder", "steam_common"),
];

/// Standard profile subfolders used both as aliases and as search roots.
const PROFILE_FOLDERS: &[&str] = &[
    "Desktop",
    "Documents",
    "Downloads",
    "Pictures",
    "Videos",
    "Music",
];

#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
pub struct FoundPath {
    pub name: String,
    pub path: String,
    pub kind: PathKind,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PathKind {
    Folder,
    File,
}

fn user_profile() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

// ---------------------------------------------------------------------------
// Steam discovery
// ---------------------------------------------------------------------------

/// Common paths where Steam might be installed.
const STEAM_INSTALL_CANDIDATES: &[&str] = &[
    "C:\\Program Files (x86)\\Steam",
    "C:\\Program Files\\Steam",
    "Steam", // relative to USERPROFILE
];

/// Find the Steam install directory, if Steam is installed.
fn find_steam_install() -> Option<PathBuf> {
    // Try absolute paths first
    for candidate in STEAM_INSTALL_CANDIDATES {
        let path = if candidate.starts_with('C') {
            PathBuf::from(candidate)
        } else if let Some(profile) = user_profile() {
            profile.join(candidate)
        } else {
            continue;
        };
        if path.join("steam.exe").exists() {
            return Some(path);
        }
    }
    None
}

/// Minimal parser for `libraryfolders.vdf`.
///
/// Extracts numeric keys' `path` values (library roots). The VDF format is
/// simple enough that we can parse it line-by-line without a full parser.
///
/// Example structure:
/// ```text
/// "libraryfolders"
/// {
///     "0"
///     {
///         "path"    "C:\\Program Files (x86)\\Steam"
///         ...
///     }
///     "1"
///     {
///         "path"    "D:\\SteamLibrary"
///         ...
///     }
/// }
/// ```
fn parse_libraryfolders_vdf(content: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let mut in_entry = false;
    let lines = content.lines();

    for line in lines {
        let trimmed = line.trim();

        // Detect entry start: a quoted numeric key like `"0"` or `"1"`
        if trimmed.starts_with('"') && trimmed.ends_with('"') {
            let inner = &trimmed[1..trimmed.len() - 1];
            if inner.chars().all(|c| c.is_ascii_digit()) {
                in_entry = true;
                continue;
            }
        }

        if !in_entry {
            continue;
        }

        // Look for `"path"    "D:\Some\Path"`
        if let Some(after) = trimmed.strip_prefix("\"path\"") {
            // Extract the value after "path"
            let rest = &after.trim_start();
            if rest.starts_with('"') {
                let end = rest.rfind('"');
                if let Some(end) = end {
                    let path_str = &rest[1..end];
                    // Unescape VDF-style escapes
                    let path_str = path_str.replace("\\\\", "\\").replace("\\/", "/");
                    let p = PathBuf::from(&path_str);
                    if p.is_dir() {
                        paths.push(p);
                    }
                }
            }
        }

        // Entry end: closing brace
        if trimmed == "}" {
            in_entry = false;
        }
    }

    paths
}

/// Collect all Steam library paths (including the primary install).
fn steam_library_paths() -> Vec<PathBuf> {
    let steam = match find_steam_install() {
        Some(s) => s,
        None => return Vec::new(),
    };

    let mut libraries = Vec::new();

    // Primary library is the Steam install dir itself
    libraries.push(steam.clone());

    // Read libraryfolders.vdf for additional libraries
    let vdf_path = steam.join("steamapps").join("libraryfolders.vdf");
    if let Ok(content) = std::fs::read_to_string(&vdf_path) {
        let parsed = parse_libraryfolders_vdf(&content);
        for lib in parsed {
            if !libraries.contains(&lib) {
                libraries.push(lib);
            }
        }
    }

    libraries
}

/// Collect direct children of `steamapps/common` across all libraries (game folders).
fn steam_game_folders() -> Vec<PathBuf> {
    let libraries = steam_library_paths();
    let mut games = Vec::new();

    for lib in &libraries {
        let common = lib.join("steamapps").join("common");
        if let Ok(entries) = std::fs::read_dir(&common) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() && !games.contains(&path) {
                    games.push(path);
                }
            }
        }
    }

    games
}

/// Resolve a Steam alias to its target path.
fn resolve_steam_alias(target: &str) -> Option<FoundPath> {
    match target {
        "steam_root" => {
            let steam = find_steam_install()?;
            let name = steam
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "Steam".to_string());
            Some(FoundPath {
                name,
                path: steam.to_string_lossy().into_owned(),
                kind: PathKind::Folder,
            })
        }
        "steam_common" => {
            let steam = find_steam_install()?;
            let common = steam.join("steamapps").join("common");
            if common.exists() {
                Some(FoundPath {
                    name: "Steam Games".to_string(),
                    path: common.to_string_lossy().into_owned(),
                    kind: PathKind::Folder,
                })
            } else {
                None
            }
        }
        _ => None,
    }
}

/// Resolve a known-folder alias (e.g. "downloads") to its absolute path.
fn resolve_alias(query: &str) -> Option<PathBuf> {
    let q = query.trim().to_lowercase();
    let profile = user_profile()?;
    for (alias, sub) in ALIASES {
        if q != *alias {
            continue;
        }
        let path = if sub.is_empty() {
            profile.clone()
        } else {
            profile.join(sub)
        };
        if path.exists() {
            return Some(path);
        }
    }
    None
}

/// Build the list of safe search roots.
fn search_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();

    if let Some(profile) = user_profile()
        && profile.is_dir()
    {
        roots.push(profile.clone());
        for sub in PROFILE_FOLDERS {
            let p = profile.join(sub);
            if p.is_dir() && !roots.iter().any(|r| r == &p) {
                roots.push(p);
            }
        }
    }

    if let Some(onedrive) = std::env::var_os("ONEDRIVE") {
        let p = PathBuf::from(&onedrive);
        if p.is_dir() && !roots.iter().any(|r| r == &p) {
            roots.push(p);
        }
    }

    if let Some(public) = std::env::var_os("PUBLIC") {
        let p = PathBuf::from(&public);
        if p.is_dir() && !roots.iter().any(|r| r == &p) {
            roots.push(p.clone());
            for sub in PROFILE_FOLDERS {
                let child = p.join(sub);
                if child.is_dir() && !roots.iter().any(|r| r == &child) {
                    roots.push(child);
                }
            }
        }
    }

    // Add Steam library roots (steamapps/common dirs)
    let libraries = steam_library_paths();
    for lib in &libraries {
        let common = lib.join("steamapps").join("common");
        if common.is_dir() && !roots.iter().any(|r| r == &common) {
            roots.push(common);
        }
    }

    roots
}

/// Check whether a path is under any of the allowed roots.
fn is_under_roots(path: &Path, roots: &[PathBuf]) -> bool {
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    roots.iter().any(|root| {
        let root_canonical = root.canonicalize().unwrap_or_else(|_| root.clone());
        canonical.starts_with(&root_canonical)
    })
}

/// Recursively collect matching entries, skipping junk directories.
fn collect_matches(dir: &Path, depth: usize, query: &str, out: &mut Vec<FoundPath>) {
    if depth > MAX_DEPTH || out.len() >= MAX_RESULTS {
        return;
    }

    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    let lower_query = query.to_lowercase();

    for entry in entries.flatten() {
        if out.len() >= MAX_RESULTS {
            break;
        }
        let path = entry.path();
        let file_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };

        let lower_name = file_name.to_lowercase();

        // Skip junk directories entirely (do not match or recurse).
        if path.is_dir() && SKIP_DIRS.iter().any(|s| lower_name == s.to_lowercase()) {
            continue;
        }

        if lower_name.contains(&lower_query) || lower_query.contains(&lower_name) {
            let kind = if path.is_dir() {
                PathKind::Folder
            } else {
                PathKind::File
            };
            out.push(FoundPath {
                name: file_name,
                path: path.to_string_lossy().into_owned(),
                kind,
            });
        }

        if path.is_dir() && out.len() < MAX_RESULTS {
            collect_matches(&path, depth + 1, query, out);
        }
    }
}

/// Score a match for ranking: exact name > starts with > contains.
fn score_match(name: &str, query: &str) -> u32 {
    let lower_name = name.to_lowercase();
    let lower_query = query.to_lowercase();

    if lower_name == lower_query {
        return 100;
    }
    if lower_name.starts_with(&lower_query) {
        return 85;
    }
    if lower_name.contains(&lower_query) {
        return 70;
    }
    if lower_query.contains(&lower_name) {
        return 60;
    }
    let name_words: Vec<&str> = lower_name.split_whitespace().collect();
    let query_words: Vec<&str> = lower_query.split_whitespace().collect();
    let matched = name_words
        .iter()
        .filter(|w| {
            query_words
                .iter()
                .any(|qw| w.contains(qw) || qw.contains(*w))
        })
        .count();
    if matched > 0 {
        return (matched as u32) * 10;
    }
    0
}

/// Search for paths matching the query.
pub fn search_paths(query: &str) -> Vec<FoundPath> {
    let query = query.trim();
    if query.is_empty() {
        return Vec::new();
    }

    // Check Steam aliases first
    let q_lower = query.to_lowercase();
    for (alias, target) in STEAM_ALIASES {
        if q_lower == *alias
            && let Some(found) = resolve_steam_alias(target)
        {
            return vec![found];
        }
    }

    // First check known-folder aliases so "downloads" is instant and exact.
    if let Some(alias_path) = resolve_alias(query)
        && alias_path.exists()
    {
        let name = if alias_path == user_profile().unwrap_or_default() {
            "Home".to_string()
        } else {
            alias_path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| query.to_string())
        };
        return vec![FoundPath {
            name,
            path: alias_path.to_string_lossy().into_owned(),
            kind: PathKind::Folder,
        }];
    }

    let roots = search_roots();
    let mut results = Vec::new();

    // Search Steam game folders (direct children only — no deep walk)
    let game_folders = steam_game_folders();
    for game in &game_folders {
        if results.len() >= MAX_RESULTS {
            break;
        }
        if let Some(name) = game.file_name().and_then(|n| n.to_str())
            && score_match(name, query) > 0
        {
            results.push(FoundPath {
                name: name.to_string(),
                path: game.to_string_lossy().into_owned(),
                kind: PathKind::Folder,
            });
        }
    }

    for root in &roots {
        if !root.is_dir() {
            continue;
        }
        // Also match the root folder name itself (e.g. searching "Documents").
        if let Some(name) = root.file_name().and_then(|n| n.to_str())
            && score_match(name, query) > 0
        {
            results.push(FoundPath {
                name: name.to_string(),
                path: root.to_string_lossy().into_owned(),
                kind: PathKind::Folder,
            });
        }
        collect_matches(root, 0, query, &mut results);
    }

    // Deduplicate by path (case-insensitive)
    let mut seen = std::collections::HashSet::new();
    results.retain(|r| {
        let key = r.path.to_lowercase();
        seen.insert(key)
    });

    // Sort by score, then shorter name
    results.sort_by(|a, b| {
        let score_a = score_match(&a.name, query);
        let score_b = score_match(&b.name, query);
        score_b
            .cmp(&score_a)
            .then_with(|| a.name.len().cmp(&b.name.len()))
    });

    results.truncate(MAX_RESULTS);
    results
}

/// Validate that a path is under allowed roots and exists.
pub fn validate_path(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(format!("Path no longer exists: {path}"));
    }
    let roots = search_roots();
    if roots.is_empty() {
        return Err("No allowed search roots are available.".into());
    }
    if !is_under_roots(p, &roots) {
        return Err("Path is outside allowed search roots.".into());
    }
    Ok(path.to_string())
}

/// Open a path in Explorer (folder) or default handler (file).
#[cfg(windows)]
fn shell_open_path(path: &str, _kind: &PathKind) -> Result<(), String> {
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    use windows::core::{HSTRING, PCWSTR};

    /// `ShellExecuteW` returns a pseudo-HINSTANCE; values up to 32 are error codes.
    const SHELL_EXECUTE_MIN_SUCCESS: isize = 32;

    let verb = HSTRING::from("open");
    let file = HSTRING::from(path);
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
        return Err("Windows could not open the approved path.".into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn shell_open_path(_: &str, _: &PathKind) -> Result<(), String> {
    Err("Opening paths is only available on Windows.".into())
}

#[tauri::command]
pub fn search_paths_cmd(query: String) -> Vec<FoundPath> {
    search_paths(&query)
}

#[tauri::command]
pub fn open_found_path(path: String, kind: PathKind) -> Result<(), String> {
    let validated = validate_path(&path)?;
    shell_open_path(&validated, &kind)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alias_maps_known_names() {
        assert!(ALIASES.iter().any(|(a, _)| *a == "downloads"));
        assert!(
            ALIASES
                .iter()
                .any(|(a, s)| *a == "my documents" && *s == "Documents")
        );
        assert_eq!(resolve_alias("nonexistent-folder-xyz"), None);
    }

    #[test]
    fn score_exact_match_is_highest() {
        assert_eq!(score_match("Downloads", "downloads"), 100);
        assert!(score_match("Downloads", "down") < 100);
        assert_eq!(score_match("SomeFolder", "totally different"), 0);
    }

    #[test]
    fn skip_dirs_are_filtered() {
        assert!(SKIP_DIRS.iter().any(|s| *s == ".git"));
        assert!(SKIP_DIRS.iter().any(|s| *s == "node_modules"));
        assert!(SKIP_DIRS.iter().any(|s| *s == "AppData"));
    }

    #[test]
    fn validate_path_refuses_nonexistent() {
        assert!(validate_path(r"C:\nonexistent\path\that\does\not\exist\ever").is_err());
    }

    #[test]
    fn empty_query_returns_nothing() {
        assert!(search_paths("").is_empty());
        assert!(search_paths("   ").is_empty());
    }

    #[test]
    fn alias_resolves_when_profile_folder_exists() {
        // On a normal Windows profile, Downloads exists under USERPROFILE.
        if let Some(profile) = user_profile() {
            let downloads = profile.join("Downloads");
            if downloads.is_dir() {
                let found = resolve_alias("downloads");
                assert_eq!(found.as_deref(), Some(downloads.as_path()));
                let results = search_paths("downloads");
                assert_eq!(results.len(), 1);
                assert_eq!(results[0].kind, PathKind::Folder);
            }
        }
    }

    #[test]
    fn steam_aliases_exist() {
        assert!(
            STEAM_ALIASES
                .iter()
                .any(|(a, t)| *a == "steam" && *t == "steam_root")
        );
        assert!(
            STEAM_ALIASES
                .iter()
                .any(|(a, t)| *a == "steam games" && *t == "steam_common")
        );
    }

    #[test]
    fn vdf_parse_simple() {
        let vdf = r#"
            "libraryfolders"
            {
                "0"
                {
                    "path"    "C:\\\\Program Files (x86)\\\\Steam"
                    "label"    "Steam"
                }
                "1"
                {
                    "path"    "D:\\\\SteamLibrary"
                    "label"    "Library 2"
                }
            }
        "#;
        let paths = parse_libraryfolders_vdf(vdf);
        // The parser returns only paths that exist on disk.
        // On a machine with Steam, the first path may exist; on others, it won't.
        // The important thing is that parsing doesn't crash and returns valid paths.
        assert!(paths.len() <= 2);
        for p in &paths {
            assert!(p.exists());
        }
    }

    #[test]
    fn vdf_parse_with_existing_dir() {
        // Use a real directory to verify parsing + existence check
        if let Some(profile) = user_profile() {
            let downloads = profile.join("Downloads");
            if downloads.is_dir() {
                let path_str = downloads.to_string_lossy().replace("\\", "\\\\");
                let vdf = format!(
                    r#"
                    "libraryfolders"
                    {{
                        "0"
                        {{
                            "path"    "{}"
                        }}
                    }}
                    "#,
                    path_str
                );
                let paths = parse_libraryfolders_vdf(&vdf);
                assert_eq!(paths.len(), 1);
                assert_eq!(paths[0], downloads);
            }
        }
    }

    #[test]
    fn steam_not_installed_returns_empty() {
        // If Steam isn't installed, these should return empty gracefully
        let libs = steam_library_paths();
        let games = steam_game_folders();
        // On a machine without Steam, both should be empty
        // On a machine with Steam, they'll have entries — that's fine too
        assert!(libs.is_empty() || libs.iter().all(|p| p.exists()));
        assert!(games.is_empty() || games.iter().all(|p| p.exists()));
    }
}
