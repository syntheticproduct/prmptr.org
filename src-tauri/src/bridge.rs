//! Bridge — Windows ↔ WSL Claude Code config sync inspector.
//!
//! Read-only v1: detects both `~/.claude/` trees (WSL home + the Windows
//! user's home reached via `/mnt/c/Users/<user>/`), then for each canonical
//! "share target" reports its sync state on each side. Reconcile (symlink
//! creation) is intentionally NOT exposed yet — symlinks across the WSL
//! boundary are destructive enough to deserve a separate UX pass.

use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};

/// One file/dir we know about — the canonical things Claude Code users
/// commonly want to share between Windows-side and WSL-side installs.
#[derive(Debug, Clone, Copy)]
struct ShareTarget {
    /// Display label shown in the UI.
    label: &'static str,
    /// Path relative to `~/.claude/` (no leading slash).
    rel: &'static str,
    /// Conceptual category from the original pitch.
    category: TargetCategory,
    /// True if this target is a directory; false for a single file.
    is_dir: bool,
    /// One-line note shown under the label.
    note: &'static str,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
enum TargetCategory {
    Agents,
    Memory,
    Settings,
    Mcp,
}

const SHARE_TARGETS: &[ShareTarget] = &[
    ShareTarget {
        label: "settings.json",
        rel: "settings.json",
        category: TargetCategory::Settings,
        is_dir: false,
        note: "Global Claude Code settings.",
    },
    ShareTarget {
        label: "settings.local.json",
        rel: "settings.local.json",
        category: TargetCategory::Settings,
        is_dir: false,
        note: "Per-machine overrides.",
    },
    ShareTarget {
        label: "commands/",
        rel: "commands",
        category: TargetCategory::Agents,
        is_dir: true,
        note: "User-defined slash commands & subagents.",
    },
    ShareTarget {
        label: "CLAUDE.md",
        rel: "CLAUDE.md",
        category: TargetCategory::Memory,
        is_dir: false,
        note: "User-global memory / instructions.",
    },
    ShareTarget {
        label: "mcp-needs-auth-cache.json",
        rel: "mcp-needs-auth-cache.json",
        category: TargetCategory::Mcp,
        is_dir: false,
        note: "MCP server auth cache.",
    },
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatus {
    /// WSL-side `.claude/` directory. None if `$HOME` cannot be resolved.
    wsl_root: Option<String>,
    /// Windows-side `.claude/` directory, auto-detected via `/mnt/c/Users`.
    /// None on non-WSL hosts or when no candidate exists.
    windows_root: Option<String>,
    /// Whether this binary is running under WSL.
    is_wsl: bool,
    /// One row per [`ShareTarget`].
    targets: Vec<TargetStatus>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetStatus {
    label: String,
    rel: String,
    category: TargetCategory,
    is_dir: bool,
    note: String,
    wsl: SideState,
    windows: SideState,
    /// One-word verdict comparing the two sides — `in-sync`, `drift`,
    /// `wsl-only`, `windows-only`, `both-missing`, `unknown`.
    verdict: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SideState {
    /// Absolute path on this side. None if the side root is unknown.
    path: Option<String>,
    kind: SideKind,
    /// SHA-256 hex of the file contents (files only, ≤ 1 MiB). Used as
    /// the cheap drift signal for the verdict.
    hash: Option<String>,
    /// Symlink target if `kind == "symlink"`.
    symlink_target: Option<String>,
    /// File size in bytes (files only).
    size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
enum SideKind {
    Missing,
    File,
    Dir,
    Symlink,
    /// Path exists but is something else (socket, fifo, device).
    Other,
    /// Could not stat — reported as `Other` with a hash of `None`.
    Unknown,
}

#[tauri::command]
pub fn bridge_status() -> Result<BridgeStatus, String> {
    let wsl_root = wsl_claude_root();
    let windows_root = if is_wsl() {
        windows_claude_root(Path::new("/mnt/c"))
    } else {
        None
    };

    let targets = SHARE_TARGETS
        .iter()
        .map(|t| build_target_status(t, wsl_root.as_deref(), windows_root.as_deref()))
        .collect();

    Ok(BridgeStatus {
        wsl_root: wsl_root.map(|p| p.display().to_string()),
        windows_root: windows_root.map(|p| p.display().to_string()),
        is_wsl: is_wsl(),
        targets,
    })
}

#[tauri::command]
pub fn open_bridge_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    const WINDOW_LABEL: &str = "bridge";
    if let Some(existing) = app.get_webview_window(WINDOW_LABEL) {
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(debug_assertions)]
    let url = {
        #[allow(clippy::expect_used)]
        let parsed = "http://localhost:3000/bridge"
            .parse()
            .expect("dev URL parse");
        tauri::WebviewUrl::External(parsed)
    };
    #[cfg(not(debug_assertions))]
    let url = tauri::WebviewUrl::App("bridge.html".into());

    tauri::WebviewWindowBuilder::new(&app, WINDOW_LABEL, url)
        .title("Bridge · prmptr.org")
        .inner_size(1100.0, 750.0)
        .min_inner_size(720.0, 480.0)
        .resizable(true)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// `$HOME/.claude/` if `$HOME` resolves and the directory is at least
/// reachable as a path (existence is reported per-target, not here).
fn wsl_claude_root() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".claude"))
}

/// First `/mnt/c/Users/<user>/.claude/` directory that exists. Skips the
/// usual Windows pseudo-users. Returns None if no candidate is present.
fn windows_claude_root(mnt_c: &Path) -> Option<PathBuf> {
    let users_dir = mnt_c.join("Users");
    let entries = std::fs::read_dir(&users_dir).ok()?;
    for entry in entries.flatten() {
        let name = match entry.file_name().into_string() {
            Ok(s) => s,
            Err(_) => continue,
        };
        let lower = name.to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "public" | "default" | "default user" | "all users"
        ) {
            continue;
        }
        let candidate = entry.path().join(".claude");
        if candidate.is_dir() {
            return Some(candidate);
        }
    }
    None
}

fn build_target_status(
    t: &ShareTarget,
    wsl_root: Option<&Path>,
    win_root: Option<&Path>,
) -> TargetStatus {
    let wsl = side_state(wsl_root.map(|r| r.join(t.rel)).as_deref(), t.is_dir);
    let windows = side_state(win_root.map(|r| r.join(t.rel)).as_deref(), t.is_dir);

    let verdict = compare(&wsl, &windows);

    TargetStatus {
        label: t.label.to_string(),
        rel: t.rel.to_string(),
        category: t.category,
        is_dir: t.is_dir,
        note: t.note.to_string(),
        wsl,
        windows,
        verdict,
    }
}

fn side_state(path: Option<&Path>, is_dir: bool) -> SideState {
    let Some(p) = path else {
        return SideState {
            path: None,
            kind: SideKind::Unknown,
            hash: None,
            symlink_target: None,
            size_bytes: None,
        };
    };
    let display = p.display().to_string();

    // symlink_metadata reports the link itself, not the target.
    let meta = match std::fs::symlink_metadata(p) {
        Ok(m) => m,
        Err(_) => {
            return SideState {
                path: Some(display),
                kind: SideKind::Missing,
                hash: None,
                symlink_target: None,
                size_bytes: None,
            };
        }
    };
    let ft = meta.file_type();

    if ft.is_symlink() {
        let target = std::fs::read_link(p).ok().map(|t| t.display().to_string());
        return SideState {
            path: Some(display),
            kind: SideKind::Symlink,
            hash: None,
            symlink_target: target,
            size_bytes: None,
        };
    }
    if ft.is_dir() {
        return SideState {
            path: Some(display),
            kind: SideKind::Dir,
            hash: None,
            symlink_target: None,
            size_bytes: None,
        };
    }
    if ft.is_file() {
        let size = meta.len();
        // Hash files up to 1 MiB. Bigger config files are unusual; we'd
        // rather skip the hash than spend seconds on a 200 MB session log.
        let hash = if !is_dir && size <= 1024 * 1024 {
            std::fs::read(p).ok().map(|bytes| {
                let mut h = Sha256::new();
                h.update(&bytes);
                format!("{:x}", h.finalize())
            })
        } else {
            None
        };
        return SideState {
            path: Some(display),
            kind: SideKind::File,
            hash,
            symlink_target: None,
            size_bytes: Some(size),
        };
    }
    SideState {
        path: Some(display),
        kind: SideKind::Other,
        hash: None,
        symlink_target: None,
        size_bytes: None,
    }
}

/// Roll up the two side states into a single verdict for the UI.
fn compare(a: &SideState, b: &SideState) -> &'static str {
    use SideKind::*;
    match (a.kind, b.kind) {
        (Missing, Missing) => "both-missing",
        (Missing, _) => "windows-only",
        (_, Missing) => "wsl-only",
        (Symlink, _) | (_, Symlink) => {
            // A symlink whose target points at the OTHER side's path is the
            // happy "in-sync" case. We don't try to canonicalize across
            // /mnt/c boundaries here — string equality is good enough as a
            // first-pass hint.
            if symlink_points_at(a, &b.path) || symlink_points_at(b, &a.path) {
                "in-sync"
            } else {
                "drift"
            }
        }
        (File, File) => match (&a.hash, &b.hash) {
            (Some(x), Some(y)) if x == y => "in-sync",
            (Some(_), Some(_)) => "drift",
            _ => "unknown",
        },
        (Dir, Dir) => "unknown", // Per-file dir compare is a v2 concern.
        _ => "drift",
    }
}

fn symlink_points_at(side: &SideState, other_path: &Option<String>) -> bool {
    match (&side.symlink_target, other_path) {
        (Some(t), Some(o)) => t == o,
        _ => false,
    }
}

#[cfg(target_os = "linux")]
fn is_wsl() -> bool {
    match std::fs::read_to_string("/proc/version") {
        Ok(v) => {
            let v = v.to_ascii_lowercase();
            v.contains("microsoft") || v.contains("wsl")
        }
        Err(_) => false,
    }
}

#[cfg(not(target_os = "linux"))]
fn is_wsl() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn windows_claude_root_finds_candidate() {
        let tmp = tempfile::tempdir().unwrap();
        let users = tmp.path().join("Users");
        fs::create_dir_all(users.join("camil").join(".claude")).unwrap();
        fs::create_dir_all(users.join("Public")).unwrap(); // skipped
        let got = windows_claude_root(tmp.path()).unwrap();
        assert_eq!(got, users.join("camil").join(".claude"));
    }

    #[test]
    fn windows_claude_root_returns_none_when_no_users() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(windows_claude_root(tmp.path()).is_none());
    }

    #[test]
    fn side_state_hashes_small_file() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("settings.json");
        fs::write(&p, b"{\"a\":1}").unwrap();
        let s = side_state(Some(&p), false);
        assert!(matches!(s.kind, SideKind::File));
        assert_eq!(s.size_bytes, Some(7));
        assert!(s.hash.is_some());
    }

    #[test]
    fn compare_detects_drift_and_sync() {
        let tmp = tempfile::tempdir().unwrap();
        let a = tmp.path().join("a");
        let b = tmp.path().join("b");
        fs::write(&a, b"same").unwrap();
        fs::write(&b, b"same").unwrap();
        assert_eq!(
            compare(&side_state(Some(&a), false), &side_state(Some(&b), false)),
            "in-sync",
        );
        fs::write(&b, b"different").unwrap();
        assert_eq!(
            compare(&side_state(Some(&a), false), &side_state(Some(&b), false)),
            "drift",
        );
    }

    #[test]
    fn compare_detects_one_sided() {
        let tmp = tempfile::tempdir().unwrap();
        let a = tmp.path().join("a");
        let b = tmp.path().join("b");
        fs::write(&a, b"x").unwrap();
        // b doesn't exist
        let sa = side_state(Some(&a), false);
        let sb = side_state(Some(&b), false);
        assert_eq!(compare(&sa, &sb), "wsl-only");
        assert_eq!(compare(&sb, &sa), "windows-only");
    }
}
