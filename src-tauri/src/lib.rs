// Tests use unwrap/expect/panic/eprintln liberally — that's idiomatic for
// `cargo test`, where a panic IS the failure. The same lints stay warn in
// production code.
#![cfg_attr(
    test,
    allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::print_stderr,
        clippy::print_stdout,
    )
)]

mod bridge;
mod claude_sessions;
mod clipboard;
mod cowork;
mod file;
mod global_settings;
mod path_safety;
mod reveal;
mod text_scale;
mod worktrees;

use std::path::PathBuf;
use std::sync::Mutex;

use bridge::{bridge_action, bridge_status};
use claude_sessions::{
    archive_sessions, delete_claude_session, list_claude_sessions, list_claude_sessions_global,
    read_claude_session_tail, unarchive_sessions,
};
use clipboard::clipboard_image_to_path;
use cowork::{
    delete_cowork_session, list_cowork_sessions, open_cowork_session_window, set_cowork_archived,
};
use file::{list_dir, read_prompt_file, write_prompt_file};
use global_settings::{open_global_settings_window, read_global_settings};
use reveal::reveal_in_file_manager;
use text_scale::text_scale_factor;
use worktrees::{delete_project_worktree, list_project_worktrees};

/// A one-shot holder for the file path passed on the command line.
/// The frontend consumes it once on startup via `take_initial_path`.
pub struct InitialPath(Mutex<Option<PathBuf>>);

#[tauri::command]
fn take_initial_path(state: tauri::State<'_, InitialPath>) -> Option<PathBuf> {
    // A poisoned mutex here means a prior thread panicked while holding it,
    // which would already have been fatal — fail loud rather than silently
    // returning None and dropping the user's CLI argument.
    #[allow(clippy::expect_used)]
    state.0.lock().expect("InitialPath mutex poisoned").take()
}

/// Parse argv to find the first positional argument that points at an
/// existing file. Tolerant of cargo/tauri-dev injecting unrelated flags.
fn extract_initial_path() -> Option<PathBuf> {
    let positional: Vec<PathBuf> = std::env::args()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(PathBuf::from)
        .collect();
    let found = positional.iter().find(|p| p.is_file()).cloned();
    if found.is_none() && !positional.is_empty() {
        // Track this — it almost always means the user double-clicked a
        // dead/moved file association. Useful breadcrumb in the log.
        log::warn!(
            "no readable file in positional argv: {:?}",
            positional
                .iter()
                .map(|p| p.display().to_string())
                .collect::<Vec<_>>()
        );
    }
    found
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
            open_cowork_session_window,
            delete_cowork_session,
            list_claude_sessions,
            list_claude_sessions_global,
            read_claude_session_tail,
            archive_sessions,
            unarchive_sessions,
            delete_claude_session,
            reveal_in_file_manager,
            read_global_settings,
            open_global_settings_window,
            bridge_status,
            bridge_action,
            text_scale_factor,
            list_project_worktrees,
            delete_project_worktree,
        ])
        .setup(|app| {
            // Dev: chatty stdout/stderr at info level.
            // Release: write a rolling log under the platform log dir so a
            // bug report has something to look at. We never log file
            // contents — only paths, sizes, and error kinds.
            let log_plugin = if cfg!(debug_assertions) {
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build()
            } else {
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Warn)
                    .targets([
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                            file_name: None,
                        }),
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stderr),
                    ])
                    .max_file_size(2 * 1024 * 1024)
                    .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
                    .build()
            };
            app.handle().plugin(log_plugin)?;
            log::info!(
                "prmptr {} started (rust {})",
                env!("CARGO_PKG_VERSION"),
                option_env!("RUSTC_VERSION").unwrap_or("unknown"),
            );
            Ok(())
        })
        .run(tauri::generate_context!())
        .map_or_else(
            |e| {
                // No useful recovery from "can't create main window"; emit
                // a clear log line and exit non-zero rather than panicking.
                log::error!("tauri runtime failed: {e}");
                std::process::exit(1);
            },
            |()| {},
        );
}
