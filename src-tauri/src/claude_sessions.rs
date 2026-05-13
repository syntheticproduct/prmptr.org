//! Read Claude Code session JSONL files from `~/.claude/projects/<encoded>/`.
//!
//! Each session is one `<uuid>.jsonl` file (one JSON object per line). The
//! parent directory name is the project path with `/` and `.` replaced by
//! `-`, so a git worktree at `/foo/bar/.claude/worktrees/session1` becomes
//! `-foo-bar--claude-worktrees-session1`.
//!
//! "This project's sessions" = the encoded current-project root plus any
//! `<root>--claude-worktrees-<name>` siblings (git worktrees of the same repo).

use std::collections::VecDeque;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use serde_json::Value;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ClaudeSessionsError {
    #[error("home directory not resolvable")]
    NoHome,

    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

impl Serialize for ClaudeSessionsError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let (kind, message) = match self {
            ClaudeSessionsError::NoHome => ("NoHome", self.to_string()),
            ClaudeSessionsError::Io(e) => ("Io", e.to_string()),
        };
        let mut s = serializer.serialize_struct("ClaudeSessionsError", 2)?;
        s.serialize_field("kind", kind)?;
        s.serialize_field("message", &message)?;
        s.end()
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionSummary {
    /// Full session UUID (filename stem).
    pub id: String,
    /// File mtime in ms since epoch.
    pub when_unix_ms: i64,
    /// File size in bytes.
    pub size_bytes: u64,
    /// Count of human-authored user prompts (excludes tool_result entries).
    pub turns: u32,
    /// Friendly worktree label: "(main)" or "sessionN".
    pub worktree: String,
    /// First human prompt's text, truncated to ~200 chars. May be empty.
    pub topic: String,
    /// Absolute path to the .jsonl on disk.
    pub source_path: PathBuf,
    /// True when this session was loaded from the archive root.
    pub archived: bool,
    /// "active" or "archive".
    pub source: SessionSource,
    /// Best-effort decoded display path. The encoder is lossy (`/` and `.`
    /// both → `-`), so the result is exact only for paths we recognise from
    /// the current project tree; otherwise it's a heuristic guess with
    /// "(approx)" appended.
    pub project_decoded: String,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionSource {
    Active,
    Archive,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MovedEntry {
    pub from: PathBuf,
    pub to: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedEntry {
    pub path: PathBuf,
    pub reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveResult {
    pub moved: Vec<MovedEntry>,
    pub failed: Vec<FailedEntry>,
}

/// Encode a filesystem path the way Claude Code names project directories:
/// every `/` and `.` becomes `-`.
fn encode_project_dir(path: &Path) -> String {
    let s = path.to_string_lossy().to_string();
    s.chars()
        .map(|c| if c == '/' || c == '.' { '-' } else { c })
        .collect()
}

/// From a CWD like `/foo/bar/.claude/worktrees/sessionN`, walk back to the
/// repo root `/foo/bar`. If the CWD doesn't sit under `.claude/worktrees`,
/// return it unchanged.
fn main_repo_root(cwd: &Path) -> PathBuf {
    let s = cwd.to_string_lossy();
    if let Some(idx) = s.find("/.claude/worktrees/") {
        PathBuf::from(&s[..idx])
    } else {
        cwd.to_path_buf()
    }
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn active_root() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".claude").join("projects"))
}

fn archive_root() -> Option<PathBuf> {
    if let Ok(s) = std::env::var("PRMPTR_CLAUDE_ARCHIVE_PATH") {
        let p = PathBuf::from(s);
        if !p.as_os_str().is_empty() {
            return Some(p);
        }
    }
    home_dir().map(|h| h.join(".claude").join("projects-archive"))
}

/// Best-effort reverse of `encode_project_dir`. The encoder collapses `/`
/// and `.` to `-`, so unambiguous decoding is impossible in general. We
/// recognise the two shapes we actually care about (the current main repo
/// and its `<root>/.claude/worktrees/<name>` siblings) and emit them
/// verbatim; for anything else we fall back to a `--` → `/.`, `-` → `/`
/// heuristic and tag it `(approx)`.
fn decode_project_dir(dir_name: &str, main_root: &Path, main_prefix: &str) -> String {
    if dir_name == main_prefix {
        return main_root.to_string_lossy().into_owned();
    }
    let wt_marker = format!("{}--claude-worktrees-", main_prefix);
    if let Some(suffix) = dir_name.strip_prefix(&wt_marker) {
        let mut p = main_root.to_path_buf();
        p.push(".claude");
        p.push("worktrees");
        p.push(suffix);
        return p.to_string_lossy().into_owned();
    }
    // Heuristic — replace consecutive `--` with `/.` then any remaining `-`
    // with `/`. Sentinel char keeps the two passes from colliding.
    const SENTINEL: char = '\u{FFFE}';
    let s = dir_name.replace("--", &SENTINEL.to_string());
    let s = s.replace('-', "/");
    let s = s.replace(SENTINEL, "/.");
    format!("{} (approx)", s)
}

fn mtime_unix_ms(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Pull a usable "topic" string out of a parsed JSONL line. Returns None
/// unless the line is a user prompt the human actually typed (skips
/// `tool_result` entries, attachment records, system events).
fn extract_user_text(v: &Value) -> Option<String> {
    if v.get("type").and_then(Value::as_str) != Some("user") {
        return None;
    }
    let msg = v.get("message")?;
    let content = msg.get("content")?;

    // String content = a real typed prompt.
    if let Some(s) = content.as_str() {
        let trimmed = s.trim();
        if trimmed.is_empty() {
            return None;
        }
        return Some(trimmed.to_string());
    }

    // Array content with at least one text item is also a real prompt;
    // any item with type tool_result means this is a synthetic message
    // injecting tool output, which we want to skip.
    if let Some(arr) = content.as_array() {
        let has_tool_result = arr
            .iter()
            .any(|c| c.get("type").and_then(Value::as_str) == Some("tool_result"));
        if has_tool_result {
            return None;
        }
        for c in arr {
            if c.get("type").and_then(Value::as_str) == Some("text") {
                if let Some(s) = c.get("text").and_then(Value::as_str) {
                    let trimmed = s.trim();
                    if !trimmed.is_empty() {
                        return Some(trimmed.to_string());
                    }
                }
            }
        }
    }
    None
}

fn truncate_topic(s: &str) -> String {
    const MAX: usize = 200;
    // Strip newlines so the topic renders on one row.
    let one_line: String = s.chars().map(|c| if c == '\n' { ' ' } else { c }).collect();
    let collapsed = one_line.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= MAX {
        collapsed
    } else {
        let mut out: String = collapsed.chars().take(MAX).collect();
        out.push('…');
        out
    }
}

fn scan_session(path: &Path) -> std::io::Result<(u32, String)> {
    let f = fs::File::open(path)?;
    let reader = BufReader::new(f);
    let mut turns: u32 = 0;
    let mut topic = String::new();

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            // Skip malformed lines rather than aborting — Claude sometimes
            // writes partial lines during crashes.
            Err(_) => continue,
        };
        if line.is_empty() {
            continue;
        }
        let v: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(text) = extract_user_text(&v) {
            turns = turns.saturating_add(1);
            if topic.is_empty() {
                topic = truncate_topic(&text);
            }
        }
    }
    Ok((turns, topic))
}

fn worktree_label(dir_name: &str, main_prefix: &str) -> String {
    if dir_name == main_prefix {
        return "(main)".to_string();
    }
    let wt_marker = format!("{}--claude-worktrees-", main_prefix);
    if let Some(suffix) = dir_name.strip_prefix(&wt_marker) {
        return suffix.to_string();
    }
    // Shouldn't happen — but fall back to the dir name so the row is
    // identifiable rather than blank.
    dir_name.to_string()
}

/// Walk one root (active or archive), pulling out sessions belonging to the
/// current project (main repo + its worktrees). A missing root is treated
/// as "no sessions" rather than an error — the archive root may not exist
/// yet on first run.
fn scan_root(
    root: &Path,
    main_root: &Path,
    main_prefix: &str,
    wt_prefix: &str,
    source: SessionSource,
) -> Vec<ClaudeSessionSummary> {
    let mut out: Vec<ClaudeSessionSummary> = Vec::new();
    let entries = match fs::read_dir(root) {
        Ok(e) => e,
        Err(e) => {
            // Missing archive root on first run is expected. Other errors
            // (permission denied, etc.) are worth a warning so the user
            // knows the listing is incomplete.
            if e.kind() != std::io::ErrorKind::NotFound {
                log::warn!("scan_root {} failed: {}", root.display(), e);
            }
            return out;
        }
    };
    let archived = matches!(source, SessionSource::Archive);

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let dir_name = entry.file_name().to_string_lossy().into_owned();
        let matches = dir_name == main_prefix || dir_name.starts_with(wt_prefix);
        if !matches {
            continue;
        }
        let dir_path = entry.path();
        if !dir_path.is_dir() {
            continue;
        }
        let label = worktree_label(&dir_name, main_prefix);
        let project_decoded = decode_project_dir(&dir_name, main_root, main_prefix);

        let jsonls = match fs::read_dir(&dir_path) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for jf in jsonls {
            let jf = match jf {
                Ok(e) => e,
                Err(_) => continue,
            };
            let p = jf.path();
            if p.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let meta = match jf.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let id = p
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            if id.is_empty() {
                continue;
            }
            let (turns, topic) = scan_session(&p).unwrap_or((0, String::new()));
            out.push(ClaudeSessionSummary {
                id,
                when_unix_ms: mtime_unix_ms(&meta),
                size_bytes: meta.len(),
                turns,
                worktree: label.clone(),
                topic,
                source_path: p,
                archived,
                source,
                project_decoded: project_decoded.clone(),
            });
        }
    }
    out
}

struct SessionRoots {
    projects_root: PathBuf,
    archive_root: Option<PathBuf>,
    repo_root: PathBuf,
    main_prefix: String,
    wt_prefix: String,
}

/// True if `projects_root` contains any directory whose name matches
/// `main_prefix` or starts with `wt_prefix` (i.e. a session dir for this
/// repo or one of its worktrees).
fn root_has_match(projects_root: &Path, main_prefix: &str, wt_prefix: &str) -> bool {
    let Ok(entries) = fs::read_dir(projects_root) else {
        return false;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name == main_prefix || name.starts_with(wt_prefix) {
            return true;
        }
    }
    false
}

/// Find Claude session roots for the current repo. Tries:
///   1. The default `~/.claude/projects/` (resolved from $HOME) walked back
///      from CWD — the dev-server path.
///   2. On Windows, probe `\\wsl.localhost\<distro>\home\<user>\` for a
///      `projects/prmptr.org` checkout — the installed-binary path. WSL
///      hosts the Claude data; the Windows install dir doesn't.
fn resolve_session_roots() -> Option<SessionRoots> {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
    let main_root = main_repo_root(&cwd);
    let main_prefix = encode_project_dir(&main_root);
    let wt_prefix = format!("{}--claude-worktrees-", main_prefix);
    let default_active = active_root();
    let default_archive = archive_root();

    if let Some(ref p) = default_active {
        if root_has_match(p, &main_prefix, &wt_prefix) {
            return Some(SessionRoots {
                projects_root: p.clone(),
                archive_root: default_archive.clone(),
                repo_root: main_root.clone(),
                main_prefix: main_prefix.clone(),
                wt_prefix: wt_prefix.clone(),
            });
        }
    }

    if let Some((projects, repo)) = probe_wsl_for_self() {
        let main_prefix = encode_project_dir(&repo);
        let wt_prefix = format!("{}--claude-worktrees-", main_prefix);
        if root_has_match(&projects, &main_prefix, &wt_prefix) {
            return Some(SessionRoots {
                projects_root: projects,
                // Archive root override isn't auto-probed on WSL yet — falls
                // back to None so the archive scan is skipped rather than
                // looking in the wrong place.
                archive_root: None,
                repo_root: repo,
                main_prefix,
                wt_prefix,
            });
        }
    }

    // Nothing matched anywhere. Return the default roots so the caller can
    // still scan (and honestly report empty) instead of crashing.
    default_active.map(|p| SessionRoots {
        projects_root: p,
        archive_root: default_archive,
        repo_root: main_root,
        main_prefix,
        wt_prefix,
    })
}

/// Probe `\\wsl.localhost\<distro>\home\<user>\` looking for this app's
/// repo (`projects/prmptr.org`). When found, return `(claude_projects_root,
/// repo_root_in_wsl_form)`. The repo root is expressed as a `/home/...`
/// Unix path so its encoding lines up with the directory names Claude
/// Code created inside the WSL filesystem.
fn probe_wsl_for_self() -> Option<(PathBuf, PathBuf)> {
    const APP_REPO_NAME: &str = "prmptr.org";
    let wsl_root = Path::new(r"\\wsl.localhost\");
    if !wsl_root.exists() {
        return None;
    }
    let distros = fs::read_dir(wsl_root).ok()?;
    for distro in distros.flatten() {
        let home = distro.path().join("home");
        let Ok(users) = fs::read_dir(&home) else {
            continue;
        };
        for user in users.flatten() {
            let user_path = user.path();
            let projects_root = user_path.join(".claude").join("projects");
            let repo_check = user_path.join("projects").join(APP_REPO_NAME);
            if !projects_root.is_dir() || !repo_check.is_dir() {
                continue;
            }
            let user_name = user_path.file_name()?.to_string_lossy().to_string();
            let unix_repo =
                PathBuf::from(format!("/home/{}/projects/{}", user_name, APP_REPO_NAME));
            return Some((projects_root, unix_repo));
        }
    }
    None
}

pub fn list_sessions_impl(
    include_archived: bool,
) -> Result<Vec<ClaudeSessionSummary>, ClaudeSessionsError> {
    let Some(roots) = resolve_session_roots() else {
        return Ok(Vec::new());
    };

    let mut out: Vec<ClaudeSessionSummary> = Vec::new();

    out.extend(scan_root(
        &roots.projects_root,
        &roots.repo_root,
        &roots.main_prefix,
        &roots.wt_prefix,
        SessionSource::Active,
    ));
    if include_archived {
        if let Some(archive) = roots.archive_root {
            out.extend(scan_root(
                &archive,
                &roots.repo_root,
                &roots.main_prefix,
                &roots.wt_prefix,
                SessionSource::Archive,
            ));
        }
    }

    out.sort_by_key(|b| std::cmp::Reverse(b.when_unix_ms));
    Ok(out)
}

#[tauri::command]
pub fn list_claude_sessions(
    include_archived: bool,
) -> Result<Vec<ClaudeSessionSummary>, ClaudeSessionsError> {
    list_sessions_impl(include_archived)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeMessageBrief {
    /// "user" or "assistant".
    pub role: String,
    /// Visible text content (joined across text items, no tool_use/tool_result).
    pub text: String,
    /// ISO 8601 timestamp from the JSONL line, if present.
    pub timestamp: Option<String>,
}

fn extract_message(v: &Value) -> Option<ClaudeMessageBrief> {
    let line_type = v.get("type").and_then(Value::as_str)?;
    let timestamp = v
        .get("timestamp")
        .and_then(Value::as_str)
        .map(|s| s.to_string());

    if line_type == "user" {
        // Real human prompt only — skip synthetic tool_result wrappers.
        let text = extract_user_text(v)?;
        return Some(ClaudeMessageBrief {
            role: "user".to_string(),
            text,
            timestamp,
        });
    }

    if line_type == "assistant" {
        let msg = v.get("message")?;
        let content = msg.get("content")?;
        // Assistant content is typically a list of items (thinking, text,
        // tool_use). Take all text items, joined.
        if let Some(arr) = content.as_array() {
            let mut parts: Vec<String> = Vec::new();
            for c in arr {
                if c.get("type").and_then(Value::as_str) == Some("text") {
                    if let Some(s) = c.get("text").and_then(Value::as_str) {
                        let trimmed = s.trim();
                        if !trimmed.is_empty() {
                            parts.push(trimmed.to_string());
                        }
                    }
                }
            }
            if parts.is_empty() {
                return None;
            }
            return Some(ClaudeMessageBrief {
                role: "assistant".to_string(),
                text: parts.join("\n\n"),
                timestamp,
            });
        }
        // Rare: string content. Use verbatim.
        if let Some(s) = content.as_str() {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                return None;
            }
            return Some(ClaudeMessageBrief {
                role: "assistant".to_string(),
                text: trimmed.to_string(),
                timestamp,
            });
        }
    }
    None
}

#[tauri::command]
pub fn read_claude_session_tail(
    path: String,
    max_messages: usize,
) -> Result<Vec<ClaudeMessageBrief>, ClaudeSessionsError> {
    let path = PathBuf::from(path);
    let f = fs::File::open(&path)?;
    let reader = BufReader::new(f);
    let cap = max_messages.max(1);
    let mut buf: VecDeque<ClaudeMessageBrief> = VecDeque::with_capacity(cap);

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        if line.is_empty() {
            continue;
        }
        let v: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(m) = extract_message(&v) {
            if buf.len() == cap {
                buf.pop_front();
            }
            buf.push_back(m);
        }
    }
    Ok(buf.into_iter().collect())
}

/// Move one .jsonl from `src_root`-rooted location to its mirror under
/// `dst_root`. Returns the final destination path (may have a collision
/// suffix). Validates the source is actually under `src_root` to keep this
/// command from acting as a generic file mover.
fn move_one_session(src: &Path, src_root: &Path, dst_root: &Path) -> Result<PathBuf, String> {
    if src.extension().and_then(|e| e.to_str()) != Some("jsonl") {
        return Err("not a .jsonl file".to_string());
    }
    let canonical_src = src
        .canonicalize()
        .map_err(|e| format!("canonicalize source: {}", e))?;
    let canonical_src_root = match src_root.canonicalize() {
        Ok(p) => p,
        Err(e) => return Err(format!("canonicalize source root: {}", e)),
    };
    let rel = canonical_src
        .strip_prefix(&canonical_src_root)
        .map_err(|_| format!("path not under {}", canonical_src_root.display()))?;

    let mut dst = dst_root.to_path_buf();
    dst.push(rel);

    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create destination dir: {}", e))?;
    }

    if dst.exists() {
        let ts = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let stem = dst
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("session");
        let new_name = format!("{}-{}.jsonl", stem, ts);
        dst.set_file_name(new_name);
    }

    match fs::rename(&canonical_src, &dst) {
        Ok(_) => Ok(dst),
        // EXDEV (Linux) / ERROR_NOT_SAME_DEVICE (Windows 17): cross-device,
        // need to copy then delete. Verify the copy succeeded before
        // removing the source — never destroy data on a partial write.
        Err(e) => {
            let exdev = e.raw_os_error() == Some(18) || e.raw_os_error() == Some(17);
            if !exdev {
                return Err(format!("rename: {}", e));
            }
            let src_size = fs::metadata(&canonical_src)
                .map_err(|e| format!("stat source: {}", e))?
                .len();
            fs::copy(&canonical_src, &dst).map_err(|e| format!("copy: {}", e))?;
            let dst_size = fs::metadata(&dst)
                .map_err(|e| format!("stat destination: {}", e))?
                .len();
            if dst_size != src_size {
                let _ = fs::remove_file(&dst);
                return Err(format!(
                    "size mismatch after copy ({} vs {} bytes)",
                    src_size, dst_size
                ));
            }
            fs::remove_file(&canonical_src)
                .map_err(|e| format!("remove source after copy: {}", e))?;
            Ok(dst)
        }
    }
}

fn move_sessions(
    paths: Vec<String>,
    unarchive: bool,
) -> Result<ArchiveResult, ClaudeSessionsError> {
    let active = active_root().ok_or(ClaudeSessionsError::NoHome)?;
    let archive = archive_root().ok_or(ClaudeSessionsError::NoHome)?;

    // Make sure the destination tree exists before we try to write into it.
    // Source has to exist or there's nothing to move, so no need to create it.
    let dst_root_for_init = if unarchive { &active } else { &archive };
    let _ = fs::create_dir_all(dst_root_for_init);

    let (src_root, dst_root) = if unarchive {
        (&archive, &active)
    } else {
        (&active, &archive)
    };

    let mut moved: Vec<MovedEntry> = Vec::new();
    let mut failed: Vec<FailedEntry> = Vec::new();

    for path_str in paths {
        let src = PathBuf::from(&path_str);
        match move_one_session(&src, src_root, dst_root) {
            Ok(dst) => moved.push(MovedEntry { from: src, to: dst }),
            Err(reason) => failed.push(FailedEntry { path: src, reason }),
        }
    }

    Ok(ArchiveResult { moved, failed })
}

#[tauri::command]
pub fn archive_sessions(paths: Vec<String>) -> Result<ArchiveResult, ClaudeSessionsError> {
    let result = move_sessions(paths, false)?;
    log::info!(
        "archive_sessions: moved={} failed={}",
        result.moved.len(),
        result.failed.len()
    );
    for f in &result.failed {
        log::warn!("archive_sessions failed {}: {}", f.path.display(), f.reason);
    }
    Ok(result)
}

#[tauri::command]
pub fn unarchive_sessions(paths: Vec<String>) -> Result<ArchiveResult, ClaudeSessionsError> {
    let result = move_sessions(paths, true)?;
    log::info!(
        "unarchive_sessions: moved={} failed={}",
        result.moved.len(),
        result.failed.len()
    );
    for f in &result.failed {
        log::warn!(
            "unarchive_sessions failed {}: {}",
            f.path.display(),
            f.reason
        );
    }
    Ok(result)
}
