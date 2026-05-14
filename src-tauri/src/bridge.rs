//! Bridge — Windows ↔ WSL Claude Code config sync inspector.
//!
//! Read-only v1: detects both `~/.claude/` trees (WSL home + the Windows
//! user's home reached via `/mnt/c/Users/<user>/`), then for each canonical
//! "share target" reports its sync state on each side. Reconcile (symlink
//! creation) is intentionally NOT exposed yet — symlinks across the WSL
//! boundary are destructive enough to deserve a separate UX pass.

use std::fs;
use std::io::{self, ErrorKind};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
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

// ---------------------------------------------------------------------------
// Reconcile actions — v2 layer on top of the read-only inspector above.
//
// Three one-click moves a user can apply to any share target:
// - Copy Windows → WSL: overwrite the WSL side with a snapshot of the
//   Windows side. The previous WSL content is renamed aside, not deleted.
// - Copy WSL → Windows: mirror of the above.
// - Symlink WSL → Windows: replace the WSL path with a Linux symlink at
//   `target = <windows path>`. This is the canonical "share one config"
//   move — Claude Code inside WSL now reads/writes the Windows-side file.
//
// Every destructive op renames the existing destination to
// `<path>.prmptr-backup-<unix-ms>` first (via `fs::rename`, which preserves
// symlinks verbatim — no accidental deref). We never delete.

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BridgeAction {
    CopyWindowsToWsl,
    CopyWslToWindows,
    SymlinkWslToWindows,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeActionResult {
    /// Updated status for the affected share target so the UI can refresh
    /// a single row without re-running the full status scan.
    pub status: TargetStatus,
    /// If the operation renamed an existing destination aside, the new
    /// `.prmptr-backup-<ms>` path. None when the destination was missing.
    pub backup_path: Option<String>,
}

fn share_target_for(rel: &str) -> Option<&'static ShareTarget> {
    SHARE_TARGETS.iter().find(|t| t.rel == rel)
}

fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_millis()).unwrap_or(0))
        .unwrap_or(0)
}

/// Rename `path` to `<path>.prmptr-backup-<ms>` if it exists. Works for
/// files, directories, and symlinks (using `rename`, which preserves the
/// symlink without dereferencing). Returns the backup path, or None if the
/// destination did not exist.
fn backup_if_exists(path: &Path) -> io::Result<Option<PathBuf>> {
    if fs::symlink_metadata(path).is_err() {
        return Ok(None);
    }
    let backup = {
        let mut name = path.as_os_str().to_owned();
        name.push(format!(".prmptr-backup-{}", now_unix_ms()));
        PathBuf::from(name)
    };
    fs::rename(path, &backup)?;
    Ok(Some(backup))
}

fn ensure_parent(path: &Path) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent)?;
        }
    }
    Ok(())
}

/// Recursively copy `src` to `dst`. Creates `dst` fresh. Files and dirs are
/// reproduced; symlinks, sockets, fifos, and other special entries are
/// skipped — Claude config doesn't use them and we don't want to mirror
/// them blindly.
fn copy_tree(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    let mut stack: Vec<PathBuf> = vec![src.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let from = entry.path();
            let rel = from
                .strip_prefix(src)
                .map_err(|e| io::Error::new(ErrorKind::Other, e.to_string()))?;
            let to = dst.join(rel);
            let ftype = entry.file_type()?;
            if ftype.is_dir() {
                fs::create_dir_all(&to)?;
                stack.push(from);
            } else if ftype.is_file() {
                if let Some(parent) = to.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::copy(&from, &to)?;
            }
        }
    }
    Ok(())
}

fn copy_entry(src: &Path, dst: &Path, is_dir: bool) -> io::Result<()> {
    ensure_parent(dst)?;
    if is_dir {
        copy_tree(src, dst)
    } else {
        fs::copy(src, dst).map(|_| ())
    }
}

#[cfg(unix)]
fn make_symlink(target: &Path, link: &Path) -> io::Result<()> {
    ensure_parent(link)?;
    std::os::unix::fs::symlink(target, link)
}

#[cfg(not(unix))]
fn make_symlink(_target: &Path, _link: &Path) -> io::Result<()> {
    Err(io::Error::new(
        ErrorKind::Unsupported,
        "symlink creation is only supported on Unix targets",
    ))
}

#[tauri::command]
pub fn bridge_action(rel: String, action: BridgeAction) -> Result<BridgeActionResult, String> {
    // Reconcile only makes sense from inside WSL — natively on Windows
    // both sides are the same filesystem; natively on Linux/mac there's
    // no Windows host to bridge to.
    if !is_wsl() {
        return Err(
            "bridge actions require running inside WSL with a Windows host on /mnt/c".into(),
        );
    }

    let target = share_target_for(&rel).ok_or_else(|| format!("unknown share target: {rel}"))?;

    let wsl_root = wsl_claude_root().ok_or_else(|| "HOME is not set".to_string())?;
    let win_root =
        windows_claude_root(Path::new("/mnt/c")).ok_or_else(|| {
            "no Windows-side .claude/ found under /mnt/c/Users/*".to_string()
        })?;

    let wsl_path = wsl_root.join(target.rel);
    let win_path = win_root.join(target.rel);

    let backup = match action {
        BridgeAction::CopyWindowsToWsl => {
            if fs::symlink_metadata(&win_path).is_err() {
                return Err("Windows side is missing — nothing to copy".into());
            }
            let bkp = backup_if_exists(&wsl_path).map_err(|e| e.to_string())?;
            copy_entry(&win_path, &wsl_path, target.is_dir).map_err(|e| e.to_string())?;
            bkp
        }
        BridgeAction::CopyWslToWindows => {
            if fs::symlink_metadata(&wsl_path).is_err() {
                return Err("WSL side is missing — nothing to copy".into());
            }
            let bkp = backup_if_exists(&win_path).map_err(|e| e.to_string())?;
            copy_entry(&wsl_path, &win_path, target.is_dir).map_err(|e| e.to_string())?;
            bkp
        }
        BridgeAction::SymlinkWslToWindows => {
            // The link target must exist — otherwise Claude Code on the
            // WSL side would error on its next read.
            if fs::symlink_metadata(&win_path).is_err() {
                return Err(
                    "Windows side must exist before linking — copy WSL → Windows first".into(),
                );
            }
            let bkp = backup_if_exists(&wsl_path).map_err(|e| e.to_string())?;
            make_symlink(&win_path, &wsl_path).map_err(|e| e.to_string())?;
            bkp
        }
    };

    let status = build_target_status(target, Some(&wsl_root), Some(&win_root));
    Ok(BridgeActionResult {
        status,
        backup_path: backup.map(|p| p.display().to_string()),
    })
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

    #[test]
    fn share_target_lookup_round_trip() {
        for t in SHARE_TARGETS {
            assert!(share_target_for(t.rel).is_some(), "missing: {}", t.rel);
        }
        assert!(share_target_for("does-not-exist.json").is_none());
    }

    #[test]
    fn backup_renames_existing_file_and_noops_when_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let present = tmp.path().join("settings.json");
        fs::write(&present, b"{}").unwrap();
        let bkp = backup_if_exists(&present)
            .unwrap()
            .expect("expected a backup path");
        assert!(!present.exists(), "original should be renamed away");
        assert!(bkp.exists());
        let name = bkp.file_name().unwrap().to_string_lossy().into_owned();
        assert!(
            name.starts_with("settings.json.prmptr-backup-"),
            "unexpected backup name: {name}",
        );

        let absent = tmp.path().join("nope");
        assert!(backup_if_exists(&absent).unwrap().is_none());
    }

    #[test]
    fn copy_tree_reproduces_nested_files() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("src");
        let dst = tmp.path().join("dst");
        fs::create_dir_all(src.join("inner")).unwrap();
        fs::write(src.join("top.md"), b"top").unwrap();
        fs::write(src.join("inner/leaf.md"), b"leaf").unwrap();
        copy_tree(&src, &dst).unwrap();
        assert_eq!(fs::read(dst.join("top.md")).unwrap(), b"top");
        assert_eq!(fs::read(dst.join("inner/leaf.md")).unwrap(), b"leaf");
    }

    #[test]
    fn copy_entry_handles_files_and_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let src_file = tmp.path().join("a.json");
        let dst_file = tmp.path().join("nested/a.json");
        fs::write(&src_file, b"v").unwrap();
        copy_entry(&src_file, &dst_file, false).unwrap();
        assert_eq!(fs::read(&dst_file).unwrap(), b"v");

        let src_dir = tmp.path().join("d");
        let dst_dir = tmp.path().join("e/d");
        fs::create_dir_all(&src_dir).unwrap();
        fs::write(src_dir.join("x"), b"x").unwrap();
        copy_entry(&src_dir, &dst_dir, true).unwrap();
        assert_eq!(fs::read(dst_dir.join("x")).unwrap(), b"x");
    }

    #[test]
    #[cfg(unix)]
    fn symlink_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("real.json");
        let link = tmp.path().join("link.json");
        fs::write(&target, b"hi").unwrap();
        make_symlink(&target, &link).unwrap();
        let meta = fs::symlink_metadata(&link).unwrap();
        assert!(meta.file_type().is_symlink());
        assert_eq!(fs::read_link(&link).unwrap(), target);
    }
}
