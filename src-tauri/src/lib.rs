mod claude_sessions;
mod clipboard;
mod cowork;
mod file;
mod global_settings;

use std::path::PathBuf;
use std::sync::Mutex;

use claude_sessions::{
    archive_sessions, list_claude_sessions, read_claude_session_tail, unarchive_sessions,
};
use clipboard::clipboard_image_to_path;
use cowork::{list_cowork_sessions, set_cowork_archived};
use file::{list_dir, read_prompt_file, write_prompt_file};
use global_settings::{open_global_settings_window, read_global_settings};

/// A one-shot holder for the file path passed on the command line.
/// The frontend consumes it once on startup via `take_initial_path`.
pub struct InitialPath(Mutex<Option<PathBuf>>);

#[tauri::command]
fn take_initial_path(state: tauri::State<'_, InitialPath>) -> Option<PathBuf> {
    state
        .0
        .lock()
        .expect("InitialPath mutex poisoned")
        .take()
}

/// Parse argv to find the first positional argument that points at an
/// existing file. Tolerant of cargo/tauri-dev injecting unrelated flags.
fn extract_initial_path() -> Option<PathBuf> {
    std::env::args()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(PathBuf::from)
        .find(|p| p.is_file())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_path = extract_initial_path();

    tauri::Builder::default()
        .manage(InitialPath(Mutex::new(initial_path)))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_prompt_file,
            write_prompt_file,
            list_dir,
            take_initial_path,
            clipboard_image_to_path,
            list_cowork_sessions,
            set_cowork_archived,
            list_claude_sessions,
            read_claude_session_tail,
            archive_sessions,
            unarchive_sessions,
            read_global_settings,
            open_global_settings_window,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
