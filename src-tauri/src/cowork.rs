//! Read Cowork mode session metadata from disk.
//!
//! Claude Desktop (Cowork mode) stores per-session metadata as JSON files
//! under `%APPDATA%\Claude\local-agent-mode-sessions\<orgId>\<userId>\`.
//! On Microsoft Store installs this redirects to
//! `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\…`.
//!
//! Each session is one `local_<sessionId>.json` file (plus a `.bak` backup
//! and a sibling directory of the same name holding audit log + outputs).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CoworkError {
    #[error("no Claude Cowork session directory found")]
    NotFound,

    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

impl Serialize for CoworkError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let (kind, message) = match self {
            CoworkError::NotFound => ("NotFound", self.to_string()),
            CoworkError::Io(e) => ("Io", e.to_string()),
        };
        let mut s = serializer.serialize_struct("CoworkError", 2)?;
        s.serialize_field("kind", kind)?;
        s.serialize_field("message", &message)?;
        s.end()
    }
}

/// Lightweight summary returned to the frontend — just what the list needs.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoworkSummary {
    pub session_id: String,
    pub title: String,
    pub created_at: Option<i64>,
    pub last_activity_at: Option<i64>,
    pub model: Option<String>,
    pub is_starred: bool,
    pub is_archived: bool,
    pub cwd: Option<String>,
    pub initial_message: Option<String>,
    pub source_path: PathBuf,
}

/// Subset of the on-disk session JSON. `#[serde(default)]` everywhere lets
/// the parser shrug off fields that vary across Claude versions.
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RawSession {
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    created_at: Option<i64>,
    #[serde(default)]
    last_activity_at: Option<i64>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    is_starred: bool,
    #[serde(default)]
    is_archived: bool,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    initial_message: Option<String>,
}

fn cowork_root() -> Option<PathBuf> {
    // Explicit override wins (useful in WSL dev where the env vars don't
    // resolve to Windows paths).
    if let Ok(s) = std::env::var("PRMPTR_COWORK_PATH") {
        let p = PathBuf::from(s);
        if p.is_dir() {
            return Some(p);
        }
    }

    let candidates: [Option<PathBuf>; 2] = [
        // Non-Store install
        std::env::var_os("APPDATA").map(|a| {
            PathBuf::from(a)
                .join("Claude")
                .join("local-agent-mode-sessions")
        }),
        // Microsoft Store install (sandboxed package path)
        std::env::var_os("LOCALAPPDATA").map(|a| {
            PathBuf::from(a)
                .join("Packages")
                .join("Claude_pzs8sxrjxfjjc")
                .join("LocalCache")
                .join("Roaming")
                .join("Claude")
                .join("local-agent-mode-sessions")
        }),
    ];

    candidates.into_iter().flatten().find(|p| p.is_dir())
}

fn read_session_file(path: &Path) -> Option<CoworkSummary> {
    let content = std::fs::read_to_string(path).ok()?;
    let raw: RawSession = serde_json::from_str(&content).ok()?;
    let session_id = raw.session_id.or_else(|| {
        // Derive from filename: local_<uuid>.json → local_<uuid>
        path.file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
    })?;
    Some(CoworkSummary {
        session_id,
        title: raw.title.unwrap_or_else(|| "(untitled)".into()),
        created_at: raw.created_at,
        last_activity_at: raw.last_activity_at,
        model: raw.model,
        is_starred: raw.is_starred,
        is_archived: raw.is_archived,
        cwd: raw.cwd,
        initial_message: raw.initial_message,
        source_path: path.to_path_buf(),
    })
}

fn walk_sessions(root: &Path) -> Result<Vec<CoworkSummary>, CoworkError> {
    let mut out = Vec::new();
    for org in std::fs::read_dir(root)? {
        let org_path = org?.path();
        if !org_path.is_dir() {
            continue;
        }
        for user in std::fs::read_dir(&org_path)? {
            let user_path = user?.path();
            if !user_path.is_dir() {
                continue;
            }
            for entry in std::fs::read_dir(&user_path)? {
                let entry_path = entry?.path();
                if !entry_path.is_file() {
                    continue;
                }
                let name = match entry_path.file_name().and_then(|s| s.to_str()) {
                    Some(s) => s,
                    None => continue,
                };
                // Match local_<uuid>.json, skip the .bak siblings.
                if !name.starts_with("local_") || !name.ends_with(".json") {
                    continue;
                }
                if name.ends_with(".bak") {
                    continue;
                }
                if let Some(summary) = read_session_file(&entry_path) {
                    out.push(summary);
                }
            }
        }
    }
    // Most-recently-active first.
    out.sort_by(|a, b| b.last_activity_at.cmp(&a.last_activity_at));
    Ok(out)
}

#[tauri::command]
pub fn list_cowork_sessions() -> Result<Vec<CoworkSummary>, CoworkError> {
    let root = cowork_root().ok_or(CoworkError::NotFound)?;
    walk_sessions(&root)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveOutcome {
    pub updated: usize,
    pub failed: Vec<FailedUpdate>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedUpdate {
    pub path: PathBuf,
    pub reason: String,
}

/// Set `isArchived` on each of the given session JSON files. Reads each file
/// as untyped JSON, mutates only the one field, writes back — every other
/// field (model, slashCommands, mcp tools, etc.) is preserved verbatim.
///
/// Returns per-path success/failure. Doesn't bail on the first error; tries
/// each file independently.
///
/// Caveat: if Claude Desktop has the session open it may re-serialize the
/// file on session close and overwrite our change. UI should warn.
#[tauri::command]
pub fn set_cowork_archived(
    paths: Vec<PathBuf>,
    archived: bool,
) -> Result<ArchiveOutcome, CoworkError> {
    let mut updated = 0usize;
    let mut failed = Vec::new();

    for path in paths {
        match write_archived_field(&path, archived) {
            Ok(()) => updated += 1,
            Err(e) => failed.push(FailedUpdate {
                path,
                reason: e.to_string(),
            }),
        }
    }

    Ok(ArchiveOutcome { updated, failed })
}

fn write_archived_field(path: &Path, archived: bool) -> Result<(), Box<dyn std::error::Error>> {
    let content = std::fs::read_to_string(path)?;
    let mut value: serde_json::Value = serde_json::from_str(&content)?;
    let obj = value
        .as_object_mut()
        .ok_or("session file is not a JSON object")?;
    obj.insert("isArchived".into(), serde_json::Value::Bool(archived));
    let serialized = serde_json::to_string(&value)?;
    std::fs::write(path, serialized)?;
    Ok(())
}
