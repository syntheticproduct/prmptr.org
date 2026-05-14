//! Worktree janitor: scan `~/projects/*/.claude/worktrees/*/` (and any
//! roots in `PRMPTR_JANITOR_SCAN_ROOTS`), return one row per worktree
//! with disk usage, last activity, git status, and a category flag so
//! the UI can warn before deleting an intentional perch.
//!
//! Two categories matter for safety:
//! - `Numbered` (`worktreeN`) — Camille uses these as live parallel
//!   workspaces. The UI dims the delete button.
//! - `Auto` (anything else, typically `adjective-verbing-noun` shapes
//!   minted by tooling) — usually safe to clean.
//!
//! Deletion prefers `git worktree remove` so the parent repo's
//! `.git/worktrees/<name>` admin entry is cleaned up too. Falls back to
//! `fs::remove_dir_all` when the worktree isn't registered. Both paths
//! are gated by a path-shape check (`*/.claude/worktrees/*`) so this
//! command can't be used as a generic recursive delete.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant, UNIX_EPOCH};

use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum JanitorError {
    #[error("home directory not resolvable")]
    NoHome,

    #[error("path is not under any */.claude/worktrees/ directory: {0}")]
    NotAWorktreePath(String),

    #[error("worktree path does not exist: {0}")]
    NotFound(String),

    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

impl Serialize for JanitorError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let (kind, message) = match self {
            JanitorError::NoHome => ("NoHome", self.to_string()),
            JanitorError::NotAWorktreePath(_) => ("NotAWorktreePath", self.to_string()),
            JanitorError::NotFound(_) => ("NotFound", self.to_string()),
            JanitorError::Io(e) => ("Io", e.to_string()),
        };
        let mut s = serializer.serialize_struct("JanitorError", 2)?;
        s.serialize_field("kind", kind)?;
        s.serialize_field("message", &message)?;
        s.end()
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WorktreeCategory {
    /// `worktreeN` — Camille uses these as intentional parallel workspaces.
    Numbered,
    /// Auto-named (e.g. `elegant-singing-fairy`) — usually safe to clean.
    Auto,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum WorktreeStatus {
    /// Has `.git`, working tree is clean.
    Clean,
    /// Has `.git`, `git status --porcelain` returned non-empty.
    Dirty,
    /// Directory exists but has no `.git` entry — orphaned.
    NotGit,
    /// `git status` failed (binary missing, locked repo, etc.).
    Unknown,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeEntry {
    /// Display name (final path component).
    pub name: String,
    /// Absolute path to the worktree directory.
    pub path: PathBuf,
    /// Parent project name (e.g. "prmptr.org").
    pub project: String,
    /// Absolute path to the parent repo (parent of `.claude/worktrees/`).
    pub project_path: PathBuf,
    /// Heuristic safety classification.
    pub category: WorktreeCategory,
    pub status: WorktreeStatus,
    /// Recursive total file size in bytes. Capped by [`SIZE_CAP_BYTES`];
    /// if hit, `size_capped` is true.
    pub size_bytes: u64,
    pub size_capped: bool,
    /// Most recent mtime found while walking (shallow). Unix ms.
    pub last_activity_ms: i64,
    /// Best-effort current branch, when readable.
    pub branch: Option<String>,
    /// True when `.git/worktrees/<name>` exists in the parent repo. A
    /// proper `git worktree remove` will succeed cleanly; if false, we
    /// can only do a `rm -rf`.
    pub registered: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JanitorListing {
    pub entries: Vec<WorktreeEntry>,
    /// Scan roots that were checked. Useful for the empty-state hint
    /// ("we looked here, found nothing").
    pub scan_roots: Vec<PathBuf>,
    /// True when at least one scan was truncated for time.
    pub truncated: bool,
}

/// 5 GB upper bound per worktree size walk. Anything larger gets
/// reported as `size_capped = true` and the partial sum.
const SIZE_CAP_BYTES: u64 = 5 * 1024 * 1024 * 1024;
/// Cap directory recursion depth — pathological symlink loops still
/// terminate even if `is_symlink` lies.
const MAX_DEPTH: usize = 32;
/// Wall-clock cap on a single worktree's size walk.
const PER_WORKTREE_WALK_BUDGET: Duration = Duration::from_secs(3);
/// Total wall-clock cap on `list_worktrees`. If we hit it, return what
/// we have so far + `truncated = true`.
const TOTAL_LIST_BUDGET: Duration = Duration::from_secs(15);

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// Roots under which we look for `<project>/.claude/worktrees/<name>/`.
/// Defaults to `$HOME/projects/`. Override with `PRMPTR_JANITOR_SCAN_ROOTS`
/// (colon-separated list of absolute paths).
fn scan_roots() -> Vec<PathBuf> {
    if let Ok(s) = std::env::var("PRMPTR_JANITOR_SCAN_ROOTS") {
        let parts: Vec<PathBuf> = s
            .split(':')
            .filter(|p| !p.is_empty())
            .map(PathBuf::from)
            .collect();
        if !parts.is_empty() {
            return parts;
        }
    }
    home_dir().map_or_else(Vec::new, |h| vec![h.join("projects")])
}

fn mtime_unix_ms(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn classify_name(name: &str) -> WorktreeCategory {
    // `worktreeN` is Camille's reserved shape — strict match.
    if let Some(rest) = name.strip_prefix("worktree") {
        if !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()) {
            return WorktreeCategory::Numbered;
        }
    }
    WorktreeCategory::Auto
}

/// Walk a directory, summing file sizes and tracking the most recent
/// mtime. Bounded by size cap, depth cap, and a wall-clock budget so a
/// huge `node_modules` doesn't stall the scan.
fn walk_size(root: &Path, deadline: Instant) -> (u64, i64, bool) {
    let mut total: u64 = 0;
    let mut newest: i64 = 0;
    let mut capped = false;
    let mut stack: Vec<(PathBuf, usize)> = vec![(root.to_path_buf(), 0)];

    while let Some((dir, depth)) = stack.pop() {
        if Instant::now() >= deadline {
            capped = true;
            break;
        }
        if total >= SIZE_CAP_BYTES {
            capped = true;
            break;
        }
        if depth >= MAX_DEPTH {
            continue;
        }
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            // Don't follow symlinks — avoids both loops and accidental
            // double-counting of files reached through two paths.
            if meta.file_type().is_symlink() {
                continue;
            }
            if meta.is_dir() {
                stack.push((path, depth + 1));
            } else if meta.is_file() {
                total = total.saturating_add(meta.len());
                let m = mtime_unix_ms(&meta);
                if m > newest {
                    newest = m;
                }
            }
        }
    }
    (total, newest, capped)
}

/// Run `git -C <wt> status --porcelain` to determine dirty/clean. Empty
/// stdout = clean; any output = dirty; non-zero exit = Unknown.
fn git_status(worktree: &Path) -> WorktreeStatus {
    // Don't waste a fork if there's no .git at all.
    let dotgit = worktree.join(".git");
    if !dotgit.exists() {
        return WorktreeStatus::NotGit;
    }
    let out = Command::new("git")
        .arg("-C")
        .arg(worktree)
        .arg("status")
        .arg("--porcelain")
        .output();
    match out {
        Ok(o) if o.status.success() => {
            if o.stdout.iter().all(|b| b.is_ascii_whitespace()) {
                WorktreeStatus::Clean
            } else {
                WorktreeStatus::Dirty
            }
        }
        _ => WorktreeStatus::Unknown,
    }
}

fn git_branch(worktree: &Path) -> Option<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(worktree)
        .arg("branch")
        .arg("--show-current")
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// True when the parent repo registers this worktree (i.e. a clean
/// `git worktree remove` will work). Checks `<parent>/.git/worktrees/<name>`.
fn is_registered(parent_repo: &Path, worktree_name: &str) -> bool {
    parent_repo
        .join(".git")
        .join("worktrees")
        .join(worktree_name)
        .exists()
}

fn collect_worktrees_under_project(
    project_path: &Path,
    deadline: Instant,
    truncated: &mut bool,
) -> Vec<WorktreeEntry> {
    let mut out: Vec<WorktreeEntry> = Vec::new();
    let wt_root = project_path.join(".claude").join("worktrees");
    let entries = match fs::read_dir(&wt_root) {
        Ok(e) => e,
        Err(_) => return out,
    };
    let project_name = project_path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| project_path.display().to_string());

    for entry in entries.flatten() {
        if Instant::now() >= deadline {
            *truncated = true;
            break;
        }
        let path = entry.path();
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !meta.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        // Skip hidden / dotfile names — `.DS_Store`, etc.
        if name.starts_with('.') {
            continue;
        }
        let walk_deadline = (Instant::now() + PER_WORKTREE_WALK_BUDGET).min(deadline);
        let (size_bytes, newest_mtime, size_capped) = walk_size(&path, walk_deadline);
        let dir_mtime = mtime_unix_ms(&meta);
        let last_activity_ms = newest_mtime.max(dir_mtime);
        let status = git_status(&path);
        let branch = git_branch(&path);
        let registered = is_registered(project_path, &name);
        out.push(WorktreeEntry {
            name: name.clone(),
            path,
            project: project_name.clone(),
            project_path: project_path.to_path_buf(),
            category: classify_name(&name),
            status,
            size_bytes,
            size_capped,
            last_activity_ms,
            branch,
            registered,
        });
    }
    out
}

pub fn list_worktrees_impl() -> Result<JanitorListing, JanitorError> {
    let roots = scan_roots();
    if roots.is_empty() {
        return Err(JanitorError::NoHome);
    }
    let deadline = Instant::now() + TOTAL_LIST_BUDGET;
    let mut entries: Vec<WorktreeEntry> = Vec::new();
    let mut truncated = false;

    for root in &roots {
        let projects = match fs::read_dir(root) {
            Ok(e) => e,
            Err(e) => {
                if e.kind() != std::io::ErrorKind::NotFound {
                    log::warn!("janitor: scan root {} failed: {}", root.display(), e);
                }
                continue;
            }
        };
        for project in projects.flatten() {
            if Instant::now() >= deadline {
                truncated = true;
                break;
            }
            let project_path = project.path();
            if !project_path.is_dir() {
                continue;
            }
            entries.extend(collect_worktrees_under_project(
                &project_path,
                deadline,
                &mut truncated,
            ));
        }
        if truncated {
            break;
        }
    }

    // Numbered last (intentional), then by stale-then-big so the "easy
    // wins" sort to the top. Stale = older mtime first.
    entries.sort_by(|a, b| {
        let cat_rank = |c: WorktreeCategory| match c {
            WorktreeCategory::Auto => 0,
            WorktreeCategory::Numbered => 1,
        };
        cat_rank(a.category)
            .cmp(&cat_rank(b.category))
            .then_with(|| a.last_activity_ms.cmp(&b.last_activity_ms))
            .then_with(|| b.size_bytes.cmp(&a.size_bytes))
    });

    Ok(JanitorListing {
        entries,
        scan_roots: roots,
        truncated,
    })
}

#[tauri::command]
pub fn list_project_worktrees() -> Result<JanitorListing, JanitorError> {
    list_worktrees_impl()
}

/// Path shape check: must resolve to `<something>/.claude/worktrees/<name>`.
/// Refusing anything else keeps the delete command from being usable as a
/// generic `rm -rf` even if the caller forges an arbitrary path.
fn validate_worktree_shape(path: &Path) -> Result<(PathBuf, String), JanitorError> {
    let canonical = match path.canonicalize() {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(JanitorError::NotFound(path.display().to_string()));
        }
        Err(e) => return Err(JanitorError::Io(e)),
    };
    // Parent must be ".../worktrees", grandparent must be ".claude".
    let parent = canonical.parent();
    let grandparent = parent.and_then(Path::parent);
    let great_grandparent = grandparent.and_then(Path::parent);
    let ok = parent
        .and_then(|p| p.file_name())
        .is_some_and(|n| n == "worktrees")
        && grandparent
            .and_then(|p| p.file_name())
            .is_some_and(|n| n == ".claude")
        && great_grandparent.is_some();
    if !ok {
        return Err(JanitorError::NotAWorktreePath(
            canonical.display().to_string(),
        ));
    }
    let name = canonical
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| JanitorError::NotAWorktreePath(canonical.display().to_string()))?;
    Ok((canonical, name))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteOutcome {
    pub deleted: PathBuf,
    /// Which strategy actually removed it. Useful for the UI to surface
    /// "we had to force this — there were uncommitted changes".
    pub method: DeleteMethod,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DeleteMethod {
    /// `git worktree remove <path>` succeeded.
    GitWorktreeRemove,
    /// `git worktree remove --force <path>` succeeded.
    GitWorktreeRemoveForce,
    /// `fs::remove_dir_all` — the worktree wasn't registered, or git
    /// rejected the remove for a reason force didn't fix.
    FilesystemRemove,
}

/// Delete a worktree directory. `force = true` allows removing trees with
/// uncommitted changes (passes `--force` to `git worktree remove`, or
/// proceeds with a recursive delete if git refuses).
#[tauri::command]
pub fn delete_project_worktree(path: String, force: bool) -> Result<DeleteOutcome, JanitorError> {
    let (canonical, name) = validate_worktree_shape(Path::new(&path))?;
    log::info!(
        "janitor: delete request path={} force={}",
        canonical.display(),
        force
    );

    // Climb to the parent repo (drop /.claude/worktrees/<name>).
    let parent_repo = canonical
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .map(Path::to_path_buf);

    if let Some(repo) = &parent_repo {
        if repo.join(".git").exists() && is_registered(repo, &name) {
            let mut args: Vec<String> = vec![
                "-C".to_string(),
                repo.to_string_lossy().into_owned(),
                "worktree".to_string(),
                "remove".to_string(),
            ];
            if force {
                args.push("--force".to_string());
            }
            args.push(canonical.to_string_lossy().into_owned());
            let result = Command::new("git").args(&args).output();
            if let Ok(o) = result {
                if o.status.success() {
                    // Belt-and-braces — git should have cleaned admin
                    // entries but `prune` makes sure of it.
                    let _ = Command::new("git")
                        .arg("-C")
                        .arg(repo)
                        .arg("worktree")
                        .arg("prune")
                        .output();
                    let method = if force {
                        DeleteMethod::GitWorktreeRemoveForce
                    } else {
                        DeleteMethod::GitWorktreeRemove
                    };
                    return Ok(DeleteOutcome {
                        deleted: canonical,
                        method,
                    });
                }
                log::warn!(
                    "janitor: git worktree remove failed (force={force}): exit={:?} stderr={}",
                    o.status.code(),
                    String::from_utf8_lossy(&o.stderr).trim()
                );
            } else if let Err(e) = result {
                log::warn!("janitor: failed to invoke git: {e}");
            }
        }
    }

    // Fallback: recursive delete. Only fires when (a) parent repo isn't
    // a git repo, (b) the worktree isn't registered, or (c) git refused
    // and the caller asked us to force.
    if !force
        && parent_repo
            .as_ref()
            .is_some_and(|r| is_registered(r, &name))
    {
        return Err(JanitorError::Io(std::io::Error::other(
            "git refused to remove this worktree (likely uncommitted changes); retry with force",
        )));
    }
    fs::remove_dir_all(&canonical)?;
    if let Some(repo) = &parent_repo {
        let _ = Command::new("git")
            .arg("-C")
            .arg(repo)
            .arg("worktree")
            .arg("prune")
            .output();
    }
    Ok(DeleteOutcome {
        deleted: canonical,
        method: DeleteMethod::FilesystemRemove,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;

    fn tmp(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("prmptr-janitor-{}-{}", std::process::id(), name));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn classify_recognises_numbered() {
        assert!(matches!(
            classify_name("worktree1"),
            WorktreeCategory::Numbered
        ));
        assert!(matches!(
            classify_name("worktree42"),
            WorktreeCategory::Numbered
        ));
        assert!(matches!(classify_name("worktree"), WorktreeCategory::Auto));
        assert!(matches!(classify_name("worktreeA"), WorktreeCategory::Auto));
        assert!(matches!(
            classify_name("elegant-singing-fairy"),
            WorktreeCategory::Auto
        ));
    }

    #[test]
    fn walk_size_sums_files() {
        let root = tmp("walk-sum");
        let f = root.join("a.txt");
        let mut h = File::create(&f).unwrap();
        h.write_all(&[0u8; 1024]).unwrap();
        let sub = root.join("sub");
        fs::create_dir_all(&sub).unwrap();
        let f2 = sub.join("b.txt");
        let mut h2 = File::create(&f2).unwrap();
        h2.write_all(&[0u8; 2048]).unwrap();

        let (total, newest, capped) = walk_size(&root, Instant::now() + Duration::from_secs(5));
        assert_eq!(total, 1024 + 2048);
        assert!(newest > 0);
        assert!(!capped);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn validate_shape_rejects_arbitrary_dir() {
        let dir = tmp("not-a-worktree");
        let res = validate_worktree_shape(&dir);
        assert!(matches!(res, Err(JanitorError::NotAWorktreePath(_))));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn validate_shape_accepts_proper_worktree_path() {
        let root = tmp("shape-ok");
        let path = root.join(".claude").join("worktrees").join("worktree3");
        fs::create_dir_all(&path).unwrap();
        let (canonical, name) = validate_worktree_shape(&path).unwrap();
        assert_eq!(name, "worktree3");
        assert!(canonical.ends_with("worktree3"));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn validate_shape_reports_missing_path() {
        let dir = tmp("shape-missing");
        let ghost = dir.join(".claude").join("worktrees").join("never-existed");
        let res = validate_worktree_shape(&ghost);
        assert!(matches!(res, Err(JanitorError::NotFound(_))));
        fs::remove_dir_all(&dir).ok();
    }
}
