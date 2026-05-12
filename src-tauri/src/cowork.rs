//! Read Cowork mode session metadata from disk.
//!
//! Claude Desktop (Cowork mode) stores per-session metadata as JSON files
//! under `%APPDATA%\Claude\local-agent-mode-sessions\<orgId>\<userId>\`.
//! On Microsoft Store installs this redirects to
//! `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\…`.
//!
//! Each session is one `local_<sessionId>.json` file (plus a `.bak` backup
//! and a sibling directory of the same name holding audit log + outputs).
//!
//! The order of pinned chats in Claude's sidebar is NOT stored in those
//! per-session JSONs. It lives as a `pinnedOrder` array inside a Zustand
//! persist blob in Chromium Local Storage at `…/Claude/Local Storage/leveldb/`.
//! We scan those LevelDB SST/log files as opaque bytes (no LevelDB reader,
//! no DB lock) and pick the freshest occurrence of `"pinnedOrder":[…]`.

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

/// Result of `list_cowork_sessions`. Carries the session list, the pin
/// order extracted from Local Storage, and an optional warning if the pin
/// order couldn't be read (in which case `pinned_order` is empty and the
/// frontend should fall back to its default sort).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoworkListing {
    pub sessions: Vec<CoworkSummary>,
    /// Session IDs (`local_<uuid>` form) in the exact order Claude's
    /// sidebar shows them at the top of the Pinned section. Anything not
    /// in this list but with `is_starred: true` falls in below.
    pub pinned_order: Vec<String>,
    pub pinned_order_warning: Option<String>,
}

#[tauri::command]
pub fn list_cowork_sessions() -> Result<CoworkListing, CoworkError> {
    let root = cowork_root().ok_or(CoworkError::NotFound)?;
    let sessions = walk_sessions(&root)?;
    let (pinned_order, pinned_order_warning) = read_pinned_order(&root);
    Ok(CoworkListing {
        sessions,
        pinned_order,
        pinned_order_warning,
    })
}

/// Locate Claude's Chromium Local Storage leveldb directory. Derived from
/// the session root's parent (`…/Claude/Local Storage/leveldb`). Honors a
/// dedicated dev override since the regular cowork-path override may point
/// at a copy of the sessions dir without a sibling Local Storage tree.
fn local_storage_dir(cowork_root: &Path) -> Option<PathBuf> {
    if let Ok(s) = std::env::var("PRMPTR_COWORK_LOCALSTORAGE_PATH") {
        let p = PathBuf::from(s);
        if p.is_dir() {
            return Some(p);
        }
    }
    let dir = cowork_root
        .parent()?
        .join("Local Storage")
        .join("leveldb");
    if dir.is_dir() {
        Some(dir)
    } else {
        None
    }
}

/// Returns `(ids, optional_warning)`. `ids` are session IDs in the form
/// `local_<uuid>` matching `CoworkSummary.session_id`. Empty vec on any
/// failure — the warning carries a short explanation for the UI.
fn read_pinned_order(cowork_root: &Path) -> (Vec<String>, Option<String>) {
    let dir = match local_storage_dir(cowork_root) {
        Some(d) => d,
        None => {
            return (
                Vec::new(),
                Some("Claude Local Storage directory not found".into()),
            )
        }
    };

    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(e) => {
            return (
                Vec::new(),
                Some(format!("read {}: {}", dir.display(), e)),
            )
        }
    };

    // Among every leveldb data file (.ldb / .log) that contains a
    // `"pinnedOrder":[…]` blob, pick the freshest by mtime. Non-data files
    // (LOCK, LOG, MANIFEST-*, CURRENT) are skipped — LOCK in particular
    // refuses to read on Linux when WSL is bridging the Windows file.
    let mut best: Option<(std::time::SystemTime, Vec<String>)> = None;
    let mut last_io_err: Option<String> = None;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|s| s.to_str()) {
            Some(n) => n,
            None => continue,
        };
        let is_data = name.ends_with(".ldb") || name.ends_with(".log");
        if !is_data {
            continue;
        }
        let bytes = match std::fs::read(&path) {
            Ok(b) => b,
            Err(e) => {
                // File may be locked by Claude Desktop. Remember the last
                // error in case nothing matches at all, but keep going.
                last_io_err = Some(format!("read {}: {}", name, e));
                continue;
            }
        };
        if let Some(ids) = extract_latest_pinned_order(&bytes) {
            let mt = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
            if best.as_ref().map_or(true, |(b, _)| mt >= *b) {
                best = Some((mt, ids));
            }
        }
    }

    match best {
        Some((_, ids)) => (ids, None),
        None => {
            let msg = match last_io_err {
                Some(e) => format!("no pinnedOrder found in {} ({})", dir.display(), e),
                None => format!("no pinnedOrder found in {}", dir.display()),
            };
            (Vec::new(), Some(msg))
        }
    }
}

/// Scan `haystack` for every occurrence of `"pinnedOrder":[…]` and return
/// the IDs from the LAST one (chronologically, since LevelDB log files
/// append). Returns `None` if no occurrence parsed cleanly.
fn extract_latest_pinned_order(haystack: &[u8]) -> Option<Vec<String>> {
    let needle: &[u8] = b"\"pinnedOrder\":[";
    let mut latest: Option<Vec<String>> = None;
    let mut cursor = 0;
    while cursor + needle.len() <= haystack.len() {
        let pos = match find_subseq(&haystack[cursor..], needle) {
            Some(p) => p,
            None => break,
        };
        let array_start = cursor + pos + needle.len();
        let end_offset = match find_array_end(&haystack[array_start..]) {
            Some(e) => e,
            None => break, // truncated mid-array; nothing usable past this
        };
        let body = &haystack[array_start..array_start + end_offset];
        latest = Some(extract_session_ids(body));
        cursor = array_start + end_offset + 1;
    }
    latest
}

/// Walk a JSON-array body (caller already consumed the opening `[`) and
/// return the index of the matching `]`. String-aware so brackets inside
/// quoted strings don't confuse the depth counter.
fn find_array_end(slice: &[u8]) -> Option<usize> {
    let mut in_string = false;
    let mut escaped = false;
    let mut depth: i32 = 1;
    for (i, &b) in slice.iter().enumerate() {
        if escaped {
            escaped = false;
            continue;
        }
        if in_string {
            match b {
                b'\\' => escaped = true,
                b'"' => in_string = false,
                _ => {}
            }
        } else {
            match b {
                b'"' => in_string = true,
                b'[' => depth += 1,
                b']' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(i);
                    }
                }
                _ => {}
            }
        }
    }
    None
}

/// Pick out every `cowork:local_<uuid>` token in `body` and return the
/// `local_<uuid>` portion (matching `CoworkSummary.session_id`). Order is
/// preserved.
fn extract_session_ids(body: &[u8]) -> Vec<String> {
    const PREFIX: &[u8] = b"cowork:local_";
    const KEEP_OFFSET: usize = b"cowork:".len(); // strip "cowork:", keep "local_…"
    const ID_LEN: usize = b"local_".len() + 36; // "local_" + UUID

    let mut out = Vec::new();
    let mut i = 0;
    while i + PREFIX.len() <= body.len() {
        if &body[i..i + PREFIX.len()] == PREFIX {
            let id_start = i + KEEP_OFFSET;
            let id_end = id_start + ID_LEN;
            if id_end <= body.len()
                && is_uuid_form(&body[id_start + b"local_".len()..id_end])
            {
                if let Ok(s) = std::str::from_utf8(&body[id_start..id_end]) {
                    out.push(s.to_string());
                }
                i = id_end;
                continue;
            }
        }
        i += 1;
    }
    out
}

fn is_uuid_form(b: &[u8]) -> bool {
    b.len() == 36
        && b[8] == b'-'
        && b[13] == b'-'
        && b[18] == b'-'
        && b[23] == b'-'
        && b.iter().enumerate().all(|(i, &c)| {
            matches!(i, 8 | 13 | 18 | 23) || c.is_ascii_hexdigit()
        })
}

fn find_subseq(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|w| w == needle)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_array_end_handles_strings_with_brackets() {
        // Body shape: ["a]b","c"]
        let body = br#""a]b","c"]"#;
        let end = find_array_end(body).expect("should find ]");
        assert_eq!(end, body.len() - 1);
    }

    #[test]
    fn extract_session_ids_picks_uuids() {
        let body = br#""cowork:local_929cd075-6f9a-4f2a-b27f-f31da43dcadf","cowork:local_2eeb9c5b-bc8b-4011-9075-d1d42d26e2d6""#;
        let ids = extract_session_ids(body);
        assert_eq!(
            ids,
            vec![
                "local_929cd075-6f9a-4f2a-b27f-f31da43dcadf".to_string(),
                "local_2eeb9c5b-bc8b-4011-9075-d1d42d26e2d6".to_string(),
            ]
        );
    }

    #[test]
    fn extract_session_ids_skips_garbage() {
        let body = br#""cowork:local_not-a-uuid","cowork:local_929cd075-6f9a-4f2a-b27f-f31da43dcadf""#;
        let ids = extract_session_ids(body);
        assert_eq!(
            ids,
            vec!["local_929cd075-6f9a-4f2a-b27f-f31da43dcadf".to_string()]
        );
    }

    #[test]
    fn extract_latest_picks_last_occurrence_in_file() {
        // Two writes in one log file: the second (later) one wins.
        let blob = b"\
            \x00\x01\x02\"pinnedOrder\":[\"cowork:local_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\"]\
            \x00\x01\x02\"pinnedOrder\":[\"cowork:local_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb\",\"cowork:local_cccccccc-cccc-cccc-cccc-cccccccccccc\"]\
            \x00";
        let ids = extract_latest_pinned_order(blob).unwrap();
        assert_eq!(
            ids,
            vec![
                "local_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb".to_string(),
                "local_cccccccc-cccc-cccc-cccc-cccccccccccc".to_string(),
            ]
        );
    }

    /// End-to-end against the live Claude Local Storage on this machine.
    /// Requires PRMPTR_COWORK_PATH (or PRMPTR_COWORK_LOCALSTORAGE_PATH) to be
    /// set; ignored otherwise so CI/build environments don't need it.
    #[test]
    fn live_pinned_order_smoke() {
        let cowork = match std::env::var("PRMPTR_COWORK_PATH") {
            Ok(s) => PathBuf::from(s),
            Err(_) => {
                eprintln!("skipping: PRMPTR_COWORK_PATH not set");
                return;
            }
        };
        let (ids, warning) = read_pinned_order(&cowork);
        eprintln!("warning: {:?}", warning);
        eprintln!("pinned count: {}", ids.len());
        for (i, id) in ids.iter().enumerate() {
            eprintln!("  [{}] {}", i, id);
        }
        // The user reported "Optimize candidate positioning prompt" is at
        // the top — its sessionId is local_929cd075-…
        assert!(!ids.is_empty(), "expected at least one pinned id");
        assert_eq!(ids[0], "local_929cd075-6f9a-4f2a-b27f-f31da43dcadf");
    }
}
