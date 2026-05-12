//! Inspect the user's Claude Code global config tree at `~/.claude.json`
//! and `~/.claude/`. Returns a structured manifest the UI renders.
//!
//! Huge files (history.jsonl, transcripts) get truncated. Huge directories
//! return only their first N entries. The goal is a quick visual scan, not
//! a full mirror.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use thiserror::Error;

const FILE_CONTENT_LIMIT: usize = 64 * 1024; // 64 KB
const DIR_ENTRY_LIMIT: usize = 200;

#[derive(Debug, Error)]
pub enum SettingsError {
    #[error("home directory not found")]
    NoHome,

    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

impl Serialize for SettingsError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let (kind, message) = match self {
            SettingsError::NoHome => ("NoHome", self.to_string()),
            SettingsError::Io(e) => ("Io", e.to_string()),
        };
        let mut s = serializer.serialize_struct("SettingsError", 2)?;
        s.serialize_field("kind", kind)?;
        s.serialize_field("message", &message)?;
        s.end()
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirChild {
    pub name: String,
    pub is_dir: bool,
    pub size_bytes: u64,
    pub child_count: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum EntryBody {
    #[serde(rename_all = "camelCase")]
    File {
        size_bytes: u64,
        line_count: Option<usize>,
        content: String,
        truncated: bool,
        modified_unix_ms: Option<u128>,
    },
    #[serde(rename_all = "camelCase")]
    Dir {
        entry_count: usize,
        truncated: bool,
        children: Vec<DirChild>,
        total_size_bytes: u64,
    },
    Missing,
    #[serde(rename_all = "camelCase")]
    Error {
        message: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigEntry {
    pub label: String,
    pub path: PathBuf,
    pub note: Option<String>,
    pub body: EntryBody,
}

fn home_dir() -> Option<PathBuf> {
    // Prefer explicit override for dev/cross-machine scenarios.
    if let Ok(p) = std::env::var("PRMPTR_CLAUDE_HOME") {
        let path = PathBuf::from(p);
        if path.exists() {
            return Some(path);
        }
    }
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn read_file_entry(path: &Path) -> EntryBody {
    let meta = match fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return EntryBody::Missing,
    };
    if !meta.is_file() {
        return EntryBody::Error {
            message: "not a regular file".into(),
        };
    }
    let size_bytes = meta.len();
    let modified_unix_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis());

    let raw = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(e) => {
            return EntryBody::Error {
                message: e.to_string(),
            }
        }
    };

    let truncated = raw.len() > FILE_CONTENT_LIMIT;
    let slice = if truncated {
        &raw[..FILE_CONTENT_LIMIT]
    } else {
        &raw[..]
    };
    let content = String::from_utf8_lossy(slice).into_owned();

    // Line count only for files we believe are text and not too huge.
    let line_count = if raw.len() < 4 * 1024 * 1024 {
        Some(raw.iter().filter(|b| **b == b'\n').count() + 1)
    } else {
        None
    };

    EntryBody::File {
        size_bytes,
        line_count,
        content,
        truncated,
        modified_unix_ms,
    }
}

fn dir_total_size(path: &Path) -> u64 {
    let Ok(read) = fs::read_dir(path) else {
        return 0;
    };
    let mut total = 0u64;
    for entry in read.flatten() {
        if let Ok(meta) = entry.metadata() {
            if meta.is_file() {
                total += meta.len();
            }
        }
    }
    total
}

fn read_dir_entry(path: &Path) -> EntryBody {
    let read = match fs::read_dir(path) {
        Ok(r) => r,
        Err(_) => return EntryBody::Missing,
    };
    let mut entries: Vec<_> = read.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    let entry_count = entries.len();
    let truncated = entry_count > DIR_ENTRY_LIMIT;

    let mut children = Vec::with_capacity(entries.len().min(DIR_ENTRY_LIMIT));
    let mut total_size_bytes = 0u64;
    for entry in entries.iter().take(DIR_ENTRY_LIMIT) {
        let name = entry.file_name().to_string_lossy().into_owned();
        let meta = entry.metadata().ok();
        let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let size_bytes = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let child_count = if is_dir {
            fs::read_dir(entry.path()).ok().map(|r| r.count())
        } else {
            None
        };
        total_size_bytes += size_bytes;
        children.push(DirChild {
            name,
            is_dir,
            size_bytes,
            child_count,
        });
    }
    // For the visible slice we summed file sizes only; add a quick scan of
    // the rest if truncated so the displayed total isn't misleading.
    if truncated {
        for entry in entries.iter().skip(DIR_ENTRY_LIMIT) {
            if let Ok(m) = entry.metadata() {
                if m.is_file() {
                    total_size_bytes += m.len();
                }
            }
        }
    }
    EntryBody::Dir {
        entry_count,
        truncated,
        children,
        total_size_bytes,
    }
}

fn entry(label: &str, path: PathBuf, note: Option<&str>, is_dir_expected: bool) -> ConfigEntry {
    let body = if !path.exists() {
        EntryBody::Missing
    } else if is_dir_expected {
        read_dir_entry(&path)
    } else {
        read_file_entry(&path)
    };
    ConfigEntry {
        label: label.into(),
        path,
        note: note.map(String::from),
        body,
    }
}

#[tauri::command]
pub fn read_global_settings() -> Result<Vec<ConfigEntry>, SettingsError> {
    let home = home_dir().ok_or(SettingsError::NoHome)?;
    let claude = home.join(".claude");

    let entries = vec![
        entry(
            "~/.claude.json",
            home.join(".claude.json"),
            Some("Auth + per-project metadata. Don't delete."),
            false,
        ),
        entry(
            "~/.claude/CLAUDE.md",
            claude.join("CLAUDE.md"),
            Some("User-level memory loaded every session."),
            false,
        ),
        entry(
            "~/.claude/settings.json",
            claude.join("settings.json"),
            Some("Global config: permissions, hooks, model, env."),
            false,
        ),
        entry(
            "~/.claude/history.jsonl",
            claude.join("history.jsonl"),
            Some("Every prompt typed across sessions."),
            false,
        ),
        entry(
            "~/.claude/stats-cache.json",
            claude.join("stats-cache.json"),
            Some("Aggregated token/usage stats."),
            false,
        ),
        entry(
            "~/.claude/projects/",
            claude.join("projects"),
            Some("Session transcripts, path-encoded per project."),
            true,
        ),
        entry(
            "~/.claude/todos/",
            claude.join("todos"),
            Some("Per-session todo lists."),
            true,
        ),
        entry(
            "~/.claude/plans/",
            claude.join("plans"),
            Some("Plan-mode markdown docs."),
            true,
        ),
        entry(
            "~/.claude/file-history/",
            claude.join("file-history"),
            Some("Checkpoints for undo / rollback."),
            true,
        ),
        entry(
            "~/.claude/session-env/",
            claude.join("session-env"),
            Some("Per-session env vars."),
            true,
        ),
        entry(
            "~/.claude/shell-snapshots/",
            claude.join("shell-snapshots"),
            Some("Captured shell environments."),
            true,
        ),
        entry(
            "~/.claude/debug/",
            claude.join("debug"),
            Some("Debug logs per session."),
            true,
        ),
        entry(
            "~/.claude/commands/",
            claude.join("commands"),
            Some("Personal slash commands (/user:foo)."),
            true,
        ),
        entry(
            "~/.claude/skills/",
            claude.join("skills"),
            Some("Personal skills (SKILL.md per subfolder)."),
            true,
        ),
        entry(
            "~/.claude/agents/",
            claude.join("agents"),
            Some("Personal subagent definitions."),
            true,
        ),
        entry(
            "~/.claude/rules/",
            claude.join("rules"),
            Some("Personal rules, loaded before project rules."),
            true,
        ),
        entry(
            "~/.claude/plugins/",
            claude.join("plugins"),
            Some("Installed plugins. Don't delete."),
            true,
        ),
        entry(
            "~/.claude/worktrees/",
            claude.join("worktrees"),
            Some("Git worktree workspace for isolated agents."),
            true,
        ),
        entry(
            "~/.claude/backups/",
            claude.join("backups"),
            Some("File backups."),
            true,
        ),
    ];

    let _ = dir_total_size; // (silence unused warning if optimizer drops it)
    Ok(entries)
}

#[tauri::command]
pub fn open_global_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    const WINDOW_LABEL: &str = "global-settings";
    if let Some(existing) = app.get_webview_window(WINDOW_LABEL) {
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Dev: hit the Next.js route directly so HMR works.
    // Release: load the bundled static export.
    #[cfg(debug_assertions)]
    let url = tauri::WebviewUrl::External(
        "http://localhost:3000/settings"
            .parse()
            .expect("dev URL parse"),
    );
    #[cfg(not(debug_assertions))]
    let url = tauri::WebviewUrl::App("settings.html".into());

    tauri::WebviewWindowBuilder::new(&app, WINDOW_LABEL, url)
    .title("Global Settings · prmptr.org")
    .inner_size(1100.0, 850.0)
    .min_inner_size(700.0, 500.0)
    .resizable(true)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}
