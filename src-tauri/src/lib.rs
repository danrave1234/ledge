mod app_launcher;
mod codex;
mod computer_control;
mod document;
mod folder_finder;
mod http;
mod media;
mod provider;
mod screen;
mod secrets;
mod spotify;
mod store;
mod web;
mod window;
mod youtube;

use tauri::{
    Emitter, Manager,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
};
use tauri_plugin_autostart::MacosLauncher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered FIRST. Only one Perch may run: a second launch
        // (autostart + a manual start, say) would otherwise dock a second
        // handle on the same edge. Instead, focus the existing widget.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let _ = app.emit("perch://open", ());
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            window::dock_window,
            window::list_monitors,
            window::set_game_mode,
            window::quit_app,
            window::clear_cache,
            window::set_capture_exclusion,
            provider::openai_stream,
            provider::cancel_stream,
            provider::openai_list_models,
            codex::codex_available,
            codex::codex_exec,
            codex::codex_login,
            codex::codex_logged_in,
            codex::codex_logout,
            web::web_search,
            media::media_sessions,
            media::media_control,
            media::media_watch,
            spotify::spotify_connect,
            spotify::spotify_connected,
            spotify::spotify_disconnect,
            spotify::spotify_request,
            screen::capture_context,
            computer_control::computer_target,
            computer_control::computer_insert_text,
            computer_control::computer_navigate_browser,
            computer_control::computer_run_actions,
            app_launcher::app_list,
            app_launcher::app_launch,
            folder_finder::search_paths_cmd,
            folder_finder::open_found_path,
            secrets::set_api_key,
            secrets::has_api_key,
            secrets::clear_api_key,
            secrets::set_youtube_key,
            youtube::youtube_search,
            youtube::youtube_has_key,
            store::store_read,
            store::store_write,
            store::store_delete,
            store::asset_store,
            store::asset_read,
            store::asset_delete,
            document::extract_document,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                computer_control::track_external_focus(&window);
            }
            let open_i = MenuItemBuilder::with_id("open", "Open Perch").build(app)?;
            let settings_i = MenuItemBuilder::with_id("settings", "Settings").build(app)?;
            let quit_i = MenuItemBuilder::with_id("quit", "Quit Perch").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&open_i, &settings_i, &quit_i])
                .build()?;

            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("Perch")
                .menu(&menu);
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            let _tray = tray
                .on_menu_event(|app, event| match event.id().as_ref() {
                    // Don't exit here: the frontend may still hold queued
                    // writes (a setting changed moments ago). Ask it to flush
                    // and call `quit_app`; the watchdog exits anyway if the
                    // WebView is wedged, so Quit can never hang.
                    "quit" => {
                        let _ = app.emit("perch://quit", ());
                        let handle = app.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_millis(1500));
                            handle.exit(0);
                        });
                    }
                    "open" => {
                        let _ = app.emit("perch://open", ());
                    }
                    "settings" => {
                        let _ = app.emit("perch://settings", ());
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
