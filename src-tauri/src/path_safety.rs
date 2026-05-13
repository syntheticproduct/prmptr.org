//! Defense-in-depth path validation for Tauri commands that take a
//! filesystem path from the renderer.
//!
//! A markdown editor by nature has to be able to open files anywhere the
//! user has access to — an allowlist of roots would defeat the product.
//! Instead this module:
//!
//! 1. Canonicalizes paths so symlink chains can't be used to escape a
//!    bounded root passed to [`validate_under_root`].
//! 2. Rejects paths whose canonical form lands inside a small set of
//!    obviously-sensitive system locations (`/proc`, `/sys`, `/etc/shadow`,
//!    Windows `system32\config\…`, …). A compromised renderer can't trivially
//!    read those even with arbitrary `PathBuf` access.
//! 3. Enforces a 100 MB upper bound on file content so a malicious caller
//!    can't OOM the process by pointing it at `/dev/zero`.
//!
//! Errors come back as `std::io::Error` so they slot into existing
//! `#[from] std::io::Error` chains in each module's error type. The
//! `ErrorKind` carries the discrimination — `PermissionDenied` for a
//! security rejection, `InvalidInput` for malformed input, `InvalidData`
//! for an over-limit file.

use std::io::{self, ErrorKind};
use std::path::{Component, Path, PathBuf};

/// Hard cap on file size for read/write through the renderer-facing
/// commands. Prevents a malicious caller from pointing the editor at
/// `/dev/zero` (infinite) or a multi-GB file that would block the IPC
/// channel for minutes. Real markdown prompts are kilobytes; 100 MB is
/// already generous.
pub(crate) const MAX_FILE_BYTES: u64 = 100 * 1024 * 1024;

/// Returns `true` if `canonical` points to a system-sensitive location
/// we never want the renderer to read or write. Defense in depth behind
/// CSP — a real exploit would have to compromise the webview first.
fn is_sensitive(canonical: &Path) -> bool {
    let lower = canonical.to_string_lossy().to_lowercase();

    // Unix / WSL / macOS system roots.
    if lower == "/proc"
        || lower.starts_with("/proc/")
        || lower == "/sys"
        || lower.starts_with("/sys/")
        || lower == "/dev"
        || lower.starts_with("/dev/")
        || lower == "/etc/shadow"
        || lower == "/etc/gshadow"
        || lower == "/etc/sudoers"
        || lower.starts_with("/etc/sudoers.d/")
        || lower.starts_with("/etc/ssh/")
        || lower == "/root"
        || lower.starts_with("/root/")
    {
        return true;
    }

    // Windows system roots. These appear inside WSL as `/mnt/c/windows/...`
    // too, so we check both shapes.
    let win_prefixes = [
        "c:\\windows\\system32\\config\\",
        "c:\\windows\\system32\\winevt\\",
        "c:\\windows\\system32\\drivers\\etc\\",
        "c:\\windows\\security\\",
        "/mnt/c/windows/system32/config/",
        "/mnt/c/windows/system32/winevt/",
        "/mnt/c/windows/system32/drivers/etc/",
        "/mnt/c/windows/security/",
    ];
    for prefix in win_prefixes {
        if lower.starts_with(prefix) {
            return true;
        }
    }

    false
}

fn reject_traversal_components(path: &Path) -> io::Result<()> {
    for comp in path.components() {
        if matches!(comp, Component::ParentDir) {
            return Err(io::Error::new(
                ErrorKind::PermissionDenied,
                format!("path contains '..' segment: {}", path.display()),
            ));
        }
    }
    Ok(())
}

/// Validate a path the renderer wants to **read** from disk (file or dir).
/// The path must exist; this function returns its canonical form, which
/// callers should use for the actual read so a symlink swap-out between
/// validation and use can't bypass the check.
pub(crate) fn validate_read_path(path: &Path) -> io::Result<PathBuf> {
    if path.as_os_str().is_empty() {
        return Err(io::Error::new(ErrorKind::InvalidInput, "empty path"));
    }
    let canonical = path.canonicalize()?;
    if is_sensitive(&canonical) {
        return Err(io::Error::new(
            ErrorKind::PermissionDenied,
            format!("refusing sensitive path: {}", canonical.display()),
        ));
    }
    Ok(canonical)
}

/// Validate a path the renderer wants to **write** to. The parent must
/// exist (we canonicalize it); the target file may or may not. Returns
/// the path with a canonicalized parent + the original file name, safe
/// to pass to `fs::write`.
pub(crate) fn validate_write_path(path: &Path) -> io::Result<PathBuf> {
    if path.as_os_str().is_empty() {
        return Err(io::Error::new(ErrorKind::InvalidInput, "empty path"));
    }
    reject_traversal_components(path)?;

    let parent = match path.parent() {
        Some(p) if !p.as_os_str().is_empty() => p,
        _ => {
            return Err(io::Error::new(
                ErrorKind::InvalidInput,
                format!("path has no parent directory: {}", path.display()),
            ))
        }
    };
    let file_name = path.file_name().ok_or_else(|| {
        io::Error::new(
            ErrorKind::InvalidInput,
            format!("path has no file name: {}", path.display()),
        )
    })?;
    let canonical_parent = parent.canonicalize()?;
    let final_path = canonical_parent.join(file_name);
    if is_sensitive(&final_path) {
        return Err(io::Error::new(
            ErrorKind::PermissionDenied,
            format!("refusing sensitive path: {}", final_path.display()),
        ));
    }
    Ok(final_path)
}

/// Validate that `path` resolves to a location under `root` after
/// canonicalization. Returns the canonical form of `path`. Useful for
/// commands that should only ever touch app-internal data (e.g.
/// the Cowork session JSON files under Claude Desktop's appdata).
pub(crate) fn validate_under_root(path: &Path, root: &Path) -> io::Result<PathBuf> {
    let canonical_path = path.canonicalize()?;
    let canonical_root = root.canonicalize()?;
    if canonical_path.starts_with(&canonical_root) {
        Ok(canonical_path)
    } else {
        Err(io::Error::new(
            ErrorKind::PermissionDenied,
            format!(
                "path {} not under {}",
                canonical_path.display(),
                canonical_root.display()
            ),
        ))
    }
}

pub(crate) fn enforce_size_limit(size: u64) -> io::Result<()> {
    if size > MAX_FILE_BYTES {
        return Err(io::Error::new(
            ErrorKind::InvalidData,
            format!(
                "file too large: {} bytes (limit {} bytes)",
                size, MAX_FILE_BYTES
            ),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "prmptr-path-safety-{}-{}",
            std::process::id(),
            name
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn rejects_empty_path() {
        let res = validate_read_path(Path::new(""));
        assert!(res.is_err());
        assert_eq!(res.unwrap_err().kind(), ErrorKind::InvalidInput);
    }

    #[test]
    fn rejects_proc_self() {
        // /proc/self/cmdline reliably exists on Linux/WSL.
        if !Path::new("/proc/self/cmdline").exists() {
            return; // not Linux, skip
        }
        let res = validate_read_path(Path::new("/proc/self/cmdline"));
        let err = res.unwrap_err();
        assert_eq!(err.kind(), ErrorKind::PermissionDenied);
        assert!(err.to_string().contains("/proc/"));
    }

    #[test]
    fn rejects_etc_shadow_even_unreadable() {
        // /etc/shadow on most systems errors on canonicalize-but-allowed if
        // it doesn't exist or is readable. The sensitive check fires
        // regardless of read permission, but only if the file exists.
        let p = Path::new("/etc/shadow");
        if p.exists() {
            let res = validate_read_path(p);
            // Either a perm error from canonicalize (we can't read) or
            // our explicit rejection — both are fine; either way the
            // renderer cannot read it.
            assert!(res.is_err());
        }
    }

    #[test]
    fn allows_normal_files() {
        let dir = tmp("normal");
        let f = dir.join("hello.md");
        fs::write(&f, "x").unwrap();
        let canonical = validate_read_path(&f).expect("normal file should be allowed");
        assert!(canonical.ends_with("hello.md"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_path_rejects_traversal() {
        let dir = tmp("traversal");
        let bad = dir.join("..").join("escape.md");
        let res = validate_write_path(&bad);
        assert!(res.is_err());
        assert_eq!(res.unwrap_err().kind(), ErrorKind::PermissionDenied);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_path_allows_new_file_with_existing_parent() {
        let dir = tmp("write-new");
        let f = dir.join("new.md");
        let res = validate_write_path(&f).expect("new file in existing dir should be allowed");
        assert!(res.ends_with("new.md"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn under_root_holds_for_in_root_path() {
        let root = tmp("under-root");
        let f = root.join("ok.json");
        fs::write(&f, "{}").unwrap();
        let res = validate_under_root(&f, &root).unwrap();
        assert!(res.starts_with(root.canonicalize().unwrap()));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn under_root_rejects_outside() {
        let root_a = tmp("root-a");
        let root_b = tmp("root-b");
        let outside = root_b.join("evil.json");
        fs::write(&outside, "{}").unwrap();
        let res = validate_under_root(&outside, &root_a);
        assert!(res.is_err());
        assert_eq!(res.unwrap_err().kind(), ErrorKind::PermissionDenied);
        fs::remove_dir_all(&root_a).ok();
        fs::remove_dir_all(&root_b).ok();
    }

    #[test]
    fn size_limit_enforced() {
        assert!(enforce_size_limit(MAX_FILE_BYTES).is_ok());
        let res = enforce_size_limit(MAX_FILE_BYTES + 1);
        assert!(res.is_err());
        assert_eq!(res.unwrap_err().kind(), ErrorKind::InvalidData);
    }
}
