//! Cross-platform "reveal file in OS file manager" command.
//!
//! Used by the Library tab to give Claude Code session rows an action that
//! roughly mirrors Cowork's "open in window" — there's no live process to
//! reattach to, so the next-best move is to drop the user in the file
//! manager pointed at the underlying JSONL.
//!
//! Targets covered:
//! - Native Windows: `explorer /select,<path>`.
//! - WSL (Linux binary, Windows side present): convert via `wslpath -w`
//!   and shell out to `explorer.exe /select,<windows-path>`. Works for
//!   both `/mnt/c/...` and in-WSL `/home/...` paths — the latter resolves
//!   to `\\wsl.localhost\<distro>\home\...`.
//! - macOS: `open -R <path>`.
//! - Plain Linux: `xdg-open <parent>` — there is no portable "select" verb,
//!   so we open the containing folder instead.

use std::path::PathBuf;
use std::process::Command;

#[cfg(target_os = "linux")]
fn is_wsl() -> bool {
    std::fs::read_to_string("/proc/version")
        .map(|s| s.to_lowercase().contains("microsoft"))
        .unwrap_or(false)
}

/// Convert a Linux path to its Windows-side form using `wslpath -w`. Returns
/// `None` if the conversion fails — caller falls back to a non-Windows
/// reveal strategy.
#[cfg(target_os = "linux")]
fn to_windows_path(path: &std::path::Path) -> Option<String> {
    let out = Command::new("wslpath")
        .args(["-w", &path.to_string_lossy()])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8(out.stdout).ok()?;
    let trimmed = s.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[tauri::command]
pub fn reveal_in_file_manager(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("path does not exist: {}", path));
    }

    #[cfg(target_os = "windows")]
    {
        // /select, takes a comma but no space — Explorer is picky.
        let arg = format!("/select,{}", p.display());
        Command::new("explorer")
            .arg(&arg)
            .spawn()
            .map_err(|e| format!("explorer: {}", e))?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-R", &p.to_string_lossy()])
            .spawn()
            .map_err(|e| format!("open -R: {}", e))?;
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        if is_wsl() {
            if let Some(win_path) = to_windows_path(&p) {
                let arg = format!("/select,{}", win_path);
                Command::new("explorer.exe")
                    .arg(&arg)
                    .spawn()
                    .map_err(|e| format!("explorer.exe: {}", e))?;
                return Ok(());
            }
            // wslpath unavailable — fall through to xdg-open the parent.
        }
        let parent = p.parent().unwrap_or_else(|| std::path::Path::new("."));
        Command::new("xdg-open")
            .arg(parent.as_os_str())
            .spawn()
            .map_err(|e| format!("xdg-open: {}", e))?;
        Ok(())
    }
}
