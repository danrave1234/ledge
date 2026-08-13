mod codex;
mod provider;
mod screen;
mod secrets;
mod store;
mod web;
mod window;

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Emitter,
};
use tauri_plugin_autostart::MacosLauncher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            window::dock_window,
            window::show_panel,
            window::hide_panel,
            window::set_game_mode,
            window::clear_cache,
            window::set_capture_exclusion,
            provider::openai_stream,
            provider::openai_cancel,
            provider::openai_list_models,
            codex::codex_available,
            codex::codex_exec,
            codex::codex_login,
            codex::codex_logged_in,
            web::web_search,
            screen::capture_screen,
            secrets::set_api_key,
            secrets::has_api_key,
            secrets::clear_api_key,
            store::store_read,
            store::store_write,
        ])
        .setup(|app| {
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
                    "quit" => app.exit(0),
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
