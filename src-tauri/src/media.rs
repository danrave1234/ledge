//! System media transport controls (SMTC).
//!
//! Windows keeps a registry of every app currently playing media — Spotify, a
//! YouTube Music tab, VLC, anything that registers a media session. This module
//! reads that registry and drives it, which is what lets Perch answer "what song
//! is this" and act on "pause" for a player it knows nothing about.
//!
//! Two rules govern everything here:
//!
//! 1. **Never block the caller's thread.** `IAsyncOperation::get()` blocks, and
//!    blocking a WinRT STA thread deadlocks. Every WinRT call runs on a thread we
//!    own — a `spawn_blocking` worker for commands, the watcher thread for events.
//! 2. **Never panic.** Release builds are `panic = "abort"`, so one bad unwrap in
//!    a media callback takes the whole widget down. Everything returns `Result` or
//!    `Option`; a missing field degrades to empty, never to a crash.

use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Clone, Default, serde::Serialize)]
pub struct MediaSession {
    /// Raw AUMID, e.g. "Spotify.exe" or "com.squirrel.YouTubeMusic.YouTubeMusic".
    /// Used to target a specific player in `media_control`.
    pub app_id: String,
    /// Friendly name for the UI, derived from `app_id`.
    pub app_name: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    /// Cover art as a PNG/JPEG data URL. Absent when the player exposes none.
    pub art: Option<String>,
    /// "playing" | "paused" | "stopped" | "closed" | "changing" | "unknown"
    pub status: String,
    pub position_ms: i64,
    pub duration_ms: i64,
    pub can_play: bool,
    pub can_pause: bool,
    pub can_next: bool,
    pub can_previous: bool,
    pub can_seek: bool,
    /// True for the session Windows considers foremost — the one a bare
    /// "pause" should act on.
    pub is_current: bool,
}

/// Map an AUMID to something worth showing a person.
///
/// Pure and total: an unknown id falls back to a tidied version of itself rather
/// than an empty string, so a player we have never seen still renders sensibly.
pub fn friendly_app_name(app_id: &str) -> String {
    let lower = app_id.to_ascii_lowercase();
    let known: &[(&str, &str)] = &[
        ("spotify", "Spotify"),
        ("youtubemusic", "YouTube Music"),
        ("youtube music", "YouTube Music"),
        ("msedge", "Microsoft Edge"),
        ("chrome", "Google Chrome"),
        ("firefox", "Firefox"),
        ("308046b0af4a39cb", "Firefox"),
        ("brave", "Brave"),
        ("opera", "Opera"),
        ("zen", "Zen Browser"),
        ("vlc", "VLC"),
        ("foobar2000", "foobar2000"),
        ("musicbee", "MusicBee"),
        ("itunes", "iTunes"),
        ("applemusic", "Apple Music"),
        ("apple music", "Apple Music"),
        ("tidal", "TIDAL"),
        ("deezer", "Deezer"),
        ("soundcloud", "SoundCloud"),
        ("winamp", "Winamp"),
        ("aimp", "AIMP"),
        ("zune", "Groove Music"),
        ("microsoft.zunemusic", "Groove Music"),
        ("microsoft.media.player", "Media Player"),
        ("mpv", "mpv"),
        ("potplayer", "PotPlayer"),
    ];
    for (needle, name) in known {
        if lower.contains(needle) {
            return (*name).to_string();
        }
    }

    // Unknown app: strip the .exe and any packaged-app prefix, then title-case
    // the last meaningful segment. "com.squirrel.Foo.Foo" -> "Foo".
    let trimmed = app_id.trim();
    let without_exe = trimmed.strip_suffix(".exe").unwrap_or(trimmed);
    let last = without_exe
        .rsplit(['.', '!', '\\', '/'])
        .find(|s| !s.is_empty())
        .unwrap_or(without_exe);
    if last.is_empty() {
        return "Unknown player".to_string();
    }
    let mut chars = last.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
        None => "Unknown player".to_string(),
    }
}

/// True when `app` selects `app_id`. Matching is loose on purpose: the model (or
/// the user) says "spotify", not "Spotify.exe".
pub fn app_matches(app_id: &str, app: &str) -> bool {
    let a = app_id.to_ascii_lowercase();
    let want = app.trim().to_ascii_lowercase();
    if want.is_empty() {
        return true;
    }
    a.contains(&want)
        || friendly_app_name(app_id)
            .to_ascii_lowercase()
            .contains(&want)
}

/// The transport actions a caller may ask for. Parsed from a string rather than
/// taken as an enum so an unknown action is a readable error the model can fix,
/// not a deserialization failure.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Action {
    Play,
    Pause,
    Toggle,
    Next,
    Previous,
    Stop,
    Seek,
}

pub fn parse_action(s: &str) -> Result<Action, String> {
    match s.trim().to_ascii_lowercase().as_str() {
        "play" | "resume" => Ok(Action::Play),
        "pause" => Ok(Action::Pause),
        "toggle" | "playpause" | "play_pause" => Ok(Action::Toggle),
        "next" | "skip" | "forward" => Ok(Action::Next),
        "previous" | "prev" | "back" => Ok(Action::Previous),
        "stop" => Ok(Action::Stop),
        "seek" => Ok(Action::Seek),
        other => Err(format!(
            "unknown action \"{other}\"; expected play, pause, toggle, next, previous, stop, or seek"
        )),
    }
}

/* ---------------------------------------------------------------------------
Windows implementation
--------------------------------------------------------------------------- */

#[cfg(windows)]
mod imp {
    use super::{Action, MediaSession, app_matches, friendly_app_name};
    use base64::Engine;
    use windows::Foundation::TimeSpan;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Storage::Streams::{DataReader, IRandomAccessStreamReference};

    /// 100ns ticks per millisecond — WinRT `TimeSpan` unit.
    const TICKS_PER_MS: i64 = 10_000;

    /// Initialize COM for the calling thread as MTA. Safe to call repeatedly; a
    /// second call on an already-initialized thread returns an error we ignore,
    /// which is the documented behaviour and not a failure for our purposes.
    pub fn init_com() {
        use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx};
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
    }

    pub fn manager() -> Result<Manager, String> {
        init_com();
        Manager::RequestAsync()
            .map_err(|e| format!("media session manager unavailable: {e}"))?
            .get()
            .map_err(|e| format!("media session manager unavailable: {e}"))
    }

    fn status_str(s: Status) -> &'static str {
        match s {
            Status::Playing => "playing",
            Status::Paused => "paused",
            Status::Stopped => "stopped",
            Status::Closed => "closed",
            Status::Changing => "changing",
            Status::Opened => "opened",
            _ => "unknown",
        }
    }

    /// Read a thumbnail stream into a data URL.
    ///
    /// Returns None on any failure: cover art is decoration, and a player with a
    /// broken thumbnail must not stop us reporting the track.
    fn read_art(reference: &IRandomAccessStreamReference) -> Option<String> {
        let stream = reference.OpenReadAsync().ok()?.get().ok()?;
        let size = stream.Size().ok()?;
        // Guard against a nonsense size before allocating for it.
        if size == 0 || size > 8 * 1024 * 1024 {
            return None;
        }
        let reader = DataReader::CreateDataReader(&stream).ok()?;
        reader.LoadAsync(size as u32).ok()?.get().ok()?;
        let mut buf = vec![0u8; size as usize];
        reader.ReadBytes(&mut buf).ok()?;

        // Sniff the format rather than trusting ContentType, which several
        // players leave empty.
        let mime = if buf.starts_with(&[0x89, b'P', b'N', b'G']) {
            "image/png"
        } else if buf.starts_with(&[0xFF, 0xD8, 0xFF]) {
            "image/jpeg"
        } else if buf.starts_with(b"RIFF") {
            "image/webp"
        } else {
            return None;
        };
        Some(format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&buf)
        ))
    }

    fn ms(t: TimeSpan) -> i64 {
        t.Duration / TICKS_PER_MS
    }

    /// Build the serializable snapshot for one session.
    ///
    /// `with_art` is off for bulk listings: decoding cover art for every session
    /// costs several stream reads, and only the card that renders needs it.
    fn snapshot(session: &Session, is_current: bool, with_art: bool) -> MediaSession {
        let app_id = session
            .SourceAppUserModelId()
            .map(|s| s.to_string())
            .unwrap_or_default();

        let mut out = MediaSession {
            app_name: friendly_app_name(&app_id),
            app_id,
            is_current,
            status: "unknown".into(),
            ..Default::default()
        };

        if let Ok(props) = session.TryGetMediaPropertiesAsync().and_then(|op| op.get()) {
            out.title = props.Title().map(|s| s.to_string()).unwrap_or_default();
            out.artist = props.Artist().map(|s| s.to_string()).unwrap_or_default();
            out.album = props
                .AlbumTitle()
                .map(|s| s.to_string())
                .unwrap_or_default();
            // Fall back to the album artist: some players leave Artist empty on
            // podcast and mix entries.
            if out.artist.is_empty() {
                out.artist = props
                    .AlbumArtist()
                    .map(|s| s.to_string())
                    .unwrap_or_default();
            }
            if with_art {
                out.art = props.Thumbnail().ok().as_ref().and_then(read_art);
            }
        }

        if let Ok(info) = session.GetPlaybackInfo() {
            if let Ok(s) = info.PlaybackStatus() {
                out.status = status_str(s).into();
            }
            if let Ok(c) = info.Controls() {
                out.can_play = c.IsPlayEnabled().unwrap_or(false);
                out.can_pause = c.IsPauseEnabled().unwrap_or(false);
                out.can_next = c.IsNextEnabled().unwrap_or(false);
                out.can_previous = c.IsPreviousEnabled().unwrap_or(false);
                out.can_seek = c.IsPlaybackPositionEnabled().unwrap_or(false);
            }
        }

        if let Ok(t) = session.GetTimelineProperties() {
            out.position_ms = t.Position().map(ms).unwrap_or(0);
            let end = t.EndTime().map(ms).unwrap_or(0);
            let start = t.StartTime().map(ms).unwrap_or(0);
            out.duration_ms = (end - start).max(0);
        }

        out
    }

    pub fn sessions(with_art: bool) -> Result<Vec<MediaSession>, String> {
        let mgr = manager()?;
        let current_id = mgr
            .GetCurrentSession()
            .ok()
            .and_then(|s| s.SourceAppUserModelId().ok())
            .map(|s| s.to_string());

        let list = mgr
            .GetSessions()
            .map_err(|e| format!("could not list media sessions: {e}"))?;

        let mut out = Vec::new();
        for session in list {
            let id = session
                .SourceAppUserModelId()
                .map(|s| s.to_string())
                .unwrap_or_default();
            let is_current = current_id.as_deref() == Some(id.as_str());
            out.push(snapshot(&session, is_current, with_art));
        }

        // Current session first, then anything actually playing: the caller
        // usually wants one session, and this makes `[0]` the right guess.
        out.sort_by_key(|s| (!s.is_current, s.status != "playing"));
        Ok(out)
    }

    /// Find the session to act on. With no `app`, that is the session Windows
    /// considers current; failing that, whatever is actually playing.
    fn target(mgr: &Manager, app: Option<&str>) -> Result<Session, String> {
        if let Some(want) = app.map(str::trim).filter(|s| !s.is_empty()) {
            let list = mgr
                .GetSessions()
                .map_err(|e| format!("could not list media sessions: {e}"))?;
            for session in list {
                let id = session
                    .SourceAppUserModelId()
                    .map(|s| s.to_string())
                    .unwrap_or_default();
                if app_matches(&id, want) {
                    return Ok(session);
                }
            }
            return Err(format!("no media session found for \"{want}\""));
        }

        if let Ok(s) = mgr.GetCurrentSession() {
            return Ok(s);
        }
        let list = mgr
            .GetSessions()
            .map_err(|e| format!("could not list media sessions: {e}"))?;
        for session in list {
            let playing = session
                .GetPlaybackInfo()
                .and_then(|i| i.PlaybackStatus())
                .map(|s| s == Status::Playing)
                .unwrap_or(false);
            if playing {
                return Ok(session);
            }
        }
        Err("nothing is playing".into())
    }

    pub fn control(
        action: Action,
        app: Option<&str>,
        position_ms: Option<i64>,
    ) -> Result<(), String> {
        let mgr = manager()?;
        let session = target(&mgr, app)?;

        let ok = match action {
            Action::Play => session.TryPlayAsync().and_then(|op| op.get()),
            Action::Pause => session.TryPauseAsync().and_then(|op| op.get()),
            Action::Toggle => session.TryTogglePlayPauseAsync().and_then(|op| op.get()),
            Action::Next => session.TrySkipNextAsync().and_then(|op| op.get()),
            Action::Previous => session.TrySkipPreviousAsync().and_then(|op| op.get()),
            Action::Stop => session.TryStopAsync().and_then(|op| op.get()),
            Action::Seek => {
                let pos = position_ms.ok_or("seek requires position_ms")?;
                session
                    .TryChangePlaybackPositionAsync(pos.max(0) * TICKS_PER_MS)
                    .and_then(|op| op.get())
            }
        }
        .map_err(|e| format!("media control failed: {e}"))?;

        // The API reports refusal as `false`, not as an error — a player can
        // simply decline (no track loaded, ad playing, control disabled).
        if ok {
            Ok(())
        } else {
            Err("the player refused that command".into())
        }
    }
}

#[cfg(windows)]
pub use imp::{control as control_impl, sessions as sessions_impl};

/* ---------------------------------------------------------------------------
Non-Windows stubs. Perch is Windows-only today, but the crate still has to
compile elsewhere for tooling and CI.
--------------------------------------------------------------------------- */

#[cfg(not(windows))]
pub fn sessions_impl(_with_art: bool) -> Result<Vec<MediaSession>, String> {
    Ok(Vec::new())
}

#[cfg(not(windows))]
pub fn control_impl(_a: Action, _app: Option<&str>, _pos: Option<i64>) -> Result<(), String> {
    Err("media control is only available on Windows".into())
}

/* ---------------------------------------------------------------------------
Commands
--------------------------------------------------------------------------- */

/// Every media call runs on a blocking worker: `IAsyncOperation::get()` blocks,
/// and blocking Tauri's thread would freeze the UI.
async fn offload<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("media task failed: {e}"))?
}

/// Everything currently registered with Windows as playing media.
/// `with_art` is opt-in — decoding cover art costs a stream read per session.
#[tauri::command]
pub async fn media_sessions(with_art: Option<bool>) -> Result<Vec<MediaSession>, String> {
    let art = with_art.unwrap_or(false);
    offload(move || sessions_impl(art)).await
}

/// Drive a player. `app` picks one loosely by name ("spotify"); omitted, it acts
/// on whatever Windows considers current.
#[tauri::command]
pub async fn media_control(
    action: String,
    app: Option<String>,
    position_ms: Option<i64>,
) -> Result<(), String> {
    let parsed = parse_action(&action)?;
    offload(move || control_impl(parsed, app.as_deref(), position_ms)).await
}

/* ---------------------------------------------------------------------------
Watcher
--------------------------------------------------------------------------- */

static WATCHING: AtomicBool = AtomicBool::new(false);

/// Start or stop pushing `perch://now-playing` to the frontend.
///
/// Deliberately opt-in rather than always-on: the widget is resident all day and
/// a user without the music plugin should pay nothing for it.
#[tauri::command]
pub fn media_watch(app: tauri::AppHandle, enabled: bool) {
    if !enabled {
        WATCHING.store(false, Ordering::Relaxed);
        return;
    }
    if WATCHING.swap(true, Ordering::Relaxed) {
        return; // already running
    }
    spawn_watcher(app);
}

#[cfg(windows)]
fn spawn_watcher(app: tauri::AppHandle) {
    use std::sync::mpsc;
    use std::time::Duration;
    use tauri::Emitter;
    use windows::Foundation::TypedEventHandler;

    std::thread::spawn(move || {
        imp::init_com();
        let (tx, rx) = mpsc::channel::<()>();

        let mgr = match imp::manager() {
            Ok(m) => m,
            Err(e) => {
                eprintln!("media watcher: {e}");
                WATCHING.store(false, Ordering::Relaxed);
                return;
            }
        };

        // Manager-level handlers cover "a player appeared/disappeared" and "the
        // current player changed". Both are cheap and never need re-arming.
        //
        // Handlers must do almost nothing: they run on a WinRT-owned thread, so
        // sending on a channel is the entire body. All the reading happens back
        // on this thread, where blocking is safe.
        let t = tx.clone();
        let _ = mgr.SessionsChanged(&TypedEventHandler::new(move |_, _| {
            let _ = t.send(());
            Ok(())
        }));
        let t = tx.clone();
        let _ = mgr.CurrentSessionChanged(&TypedEventHandler::new(move |_, _| {
            let _ = t.send(());
            Ok(())
        }));

        // Per-session handlers have to be re-armed whenever the session set
        // changes. Tokens are kept so old handlers are removed rather than
        // stacking up — an un-removed handler on a dead session is a leak that
        // also fires spurious updates.
        let mut armed: Vec<(
            windows::Media::Control::GlobalSystemMediaTransportControlsSession,
            i64,
            i64,
            i64,
        )> = Vec::new();

        let rearm = |armed: &mut Vec<_>, tx: &mpsc::Sender<()>| {
            for (session, a, b, c) in armed.drain(..) {
                let s: windows::Media::Control::GlobalSystemMediaTransportControlsSession = session;
                let _ = s.RemoveMediaPropertiesChanged(a);
                let _ = s.RemovePlaybackInfoChanged(b);
                let _ = s.RemoveTimelinePropertiesChanged(c);
            }
            let Ok(mgr) = imp::manager() else { return };
            let Ok(list) = mgr.GetSessions() else { return };
            for session in list {
                let t1 = tx.clone();
                let t2 = tx.clone();
                let t3 = tx.clone();
                let a = session
                    .MediaPropertiesChanged(&TypedEventHandler::new(move |_, _| {
                        let _ = t1.send(());
                        Ok(())
                    }))
                    .unwrap_or_default();
                let b = session
                    .PlaybackInfoChanged(&TypedEventHandler::new(move |_, _| {
                        let _ = t2.send(());
                        Ok(())
                    }))
                    .unwrap_or_default();
                let c = session
                    .TimelinePropertiesChanged(&TypedEventHandler::new(move |_, _| {
                        let _ = t3.send(());
                        Ok(())
                    }))
                    .unwrap_or_default();
                armed.push((session, a, b, c));
            }
        };

        rearm(&mut armed, &tx);
        let mut last: Option<String> = None;

        // Emit once up front so a panel opening into an already-playing track
        // isn't blank until the next change.
        let emit = |last: &mut Option<String>, with_art: bool| {
            let snap = imp::sessions(with_art).unwrap_or_default();
            // Only push when something actually changed. Players fire timeline
            // events continuously during playback, and re-serializing cover art
            // for each one would be a steady, pointless cost.
            let key = serde_json::to_string(&snap).unwrap_or_default();
            if last.as_deref() == Some(key.as_str()) {
                return;
            }
            *last = Some(key);
            let _ = app.emit("perch://now-playing", &snap);
        };
        emit(&mut last, true);
        let mut idle_ticks = 0_u8;

        while WATCHING.load(Ordering::Relaxed) {
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(()) => {
                    idle_ticks = 0;
                    // Debounce: a track change fires properties, playback, and
                    // timeline events in a burst. Coalesce them into one read.
                    std::thread::sleep(Duration::from_millis(200));
                    while rx.try_recv().is_ok() {}
                    rearm(&mut armed, &tx);
                    emit(&mut last, true);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    idle_ticks = idle_ticks.saturating_add(1);
                    if idle_ticks >= 4 {
                        // Some browser SMTC implementations occasionally miss
                        // timeline events. Reconcile every two seconds without
                        // decoding artwork so progress and duration recover
                        // without requiring a pause/resume cycle.
                        idle_ticks = 0;
                        emit(&mut last, false);
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }

        for (session, a, b, c) in armed.drain(..) {
            let _ = session.RemoveMediaPropertiesChanged(a);
            let _ = session.RemovePlaybackInfoChanged(b);
            let _ = session.RemoveTimelinePropertiesChanged(c);
        }
        WATCHING.store(false, Ordering::Relaxed);
    });
}

#[cfg(not(windows))]
fn spawn_watcher(_app: tauri::AppHandle) {
    WATCHING.store(false, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_apps_get_friendly_names() {
        assert_eq!(friendly_app_name("Spotify.exe"), "Spotify");
        assert_eq!(friendly_app_name("chrome.exe"), "Google Chrome");
        assert_eq!(friendly_app_name("308046B0AF4A39CB"), "Firefox");
        assert_eq!(
            friendly_app_name("com.squirrel.YouTubeMusic.YouTubeMusic"),
            "YouTube Music"
        );
    }

    #[test]
    fn unknown_apps_degrade_to_something_readable() {
        // Never empty, never the raw AUMID with its packaging noise.
        assert_eq!(friendly_app_name("weirdplayer.exe"), "Weirdplayer");
        assert_eq!(friendly_app_name("com.vendor.Thing.Thing"), "Thing");
        assert_eq!(friendly_app_name(""), "Unknown player");
    }

    #[test]
    fn app_matching_is_loose_enough_for_natural_language() {
        assert!(app_matches("Spotify.exe", "spotify"));
        assert!(app_matches("Spotify.exe", "Spotify"));
        // Matches via the friendly name, not just the raw id.
        assert!(app_matches("chrome.exe", "google chrome"));
        assert!(app_matches("308046B0AF4A39CB", "firefox"));
        assert!(!app_matches("Spotify.exe", "vlc"));
    }

    #[test]
    fn empty_app_filter_matches_everything() {
        assert!(app_matches("Spotify.exe", ""));
        assert!(app_matches("Spotify.exe", "   "));
    }

    #[test]
    fn actions_accept_the_words_people_and_models_use() {
        assert_eq!(parse_action("play").unwrap(), Action::Play);
        assert_eq!(parse_action("resume").unwrap(), Action::Play);
        assert_eq!(parse_action(" PAUSE ").unwrap(), Action::Pause);
        assert_eq!(parse_action("skip").unwrap(), Action::Next);
        assert_eq!(parse_action("prev").unwrap(), Action::Previous);
        assert_eq!(parse_action("play_pause").unwrap(), Action::Toggle);
    }

    /// Manual smoke check against whatever is really playing. Ignored by
    /// default: CI has no media session, and a live player is the only thing
    /// that can exercise the WinRT path at all.
    ///   cargo test -- --ignored --nocapture live_sessions
    #[test]
    #[ignore]
    fn live_sessions() {
        let found = sessions_impl(true).expect("SMTC should be reachable");
        println!("{} session(s)", found.len());
        for s in &found {
            println!(
                "  [{}] {} — {} · {} ({}/{}ms) art={} current={} play={} pause={} next={}",
                s.status,
                s.app_name,
                s.title,
                s.artist,
                s.position_ms,
                s.duration_ms,
                s.art.as_ref().map(|a| a.len()).unwrap_or(0),
                s.is_current,
                s.can_play,
                s.can_pause,
                s.can_next,
            );
        }
    }

    /// Manual smoke check that transport commands actually reach the player.
    ///   cargo test -- --ignored --nocapture live_toggle
    #[test]
    #[ignore]
    fn live_toggle() {
        let before = sessions_impl(false).expect("SMTC reachable");
        println!("before: {:?}", before.first().map(|s| s.status.clone()));
        control_impl(Action::Toggle, None, None).expect("toggle should be accepted");
        std::thread::sleep(std::time::Duration::from_millis(600));
        let after = sessions_impl(false).expect("SMTC reachable");
        println!("after:  {:?}", after.first().map(|s| s.status.clone()));
    }

    #[test]
    fn unknown_action_explains_itself() {
        let err = parse_action("rewind").unwrap_err();
        // The model reads this and retries, so it must name the valid options.
        assert!(err.contains("rewind"));
        assert!(err.contains("play"));
        assert!(err.contains("next"));
    }
}
