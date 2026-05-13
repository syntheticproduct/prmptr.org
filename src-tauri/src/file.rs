use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Serialize;
use thiserror::Error;

use crate::path_safety;

#[derive(Debug, Error)]
pub enum FileError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("system time: {0}")]
    SystemTime(#[from] std::time::SystemTimeError),
}

// Tauri's invoke handler serializes errors back to the JS side via Serialize.
// We expose a tagged JSON shape: { kind: "Io" | "SystemTime", message: "..." }.
impl Serialize for FileError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let (kind, message) = match self {
            FileError::Io(e) => ("Io", e.to_string()),
            FileError::SystemTime(e) => ("SystemTime", e.to_string()),
        };
        let mut s = serializer.serialize_struct("FileError", 2)?;
        s.serialize_field("kind", kind)?;
        s.serialize_field("message", &message)?;
        s.end()
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    pub size_bytes: u64,
    pub line_count: usize,
    pub word_count: usize,
    pub modified_unix_ms: u128,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptFile {
    pub path: PathBuf,
    pub content: String,
    pub metadata: FileMetadata,
}

fn compute_metadata(path: &Path, content: &str) -> Result<FileMetadata, FileError> {
    let fs_meta = std::fs::metadata(path)?;
    let modified = fs_meta
        .modified()?
        .duration_since(SystemTime::UNIX_EPOCH)?
        .as_millis();

    Ok(FileMetadata {
        size_bytes: fs_meta.len(),
        line_count: content.lines().count(),
        word_count: content.split_whitespace().count(),
        modified_unix_ms: modified,
    })
}

#[tauri::command]
pub fn read_prompt_file(path: PathBuf) -> Result<PromptFile, FileError> {
    let safe = path_safety::validate_read_path(&path).map_err(|e| {
        log::warn!("read_prompt_file rejected {}: {}", path.display(), e);
        e
    })?;
    let size = std::fs::metadata(&safe)?.len();
    path_safety::enforce_size_limit(size).map_err(|e| {
        log::warn!(
            "read_prompt_file rejected oversize {}: {}",
            safe.display(),
            e
        );
        e
    })?;
    let content = std::fs::read_to_string(&safe)?;
    let metadata = compute_metadata(&safe, &content)?;
    Ok(PromptFile {
        path: safe,
        content,
        metadata,
    })
}

#[tauri::command]
pub fn write_prompt_file(path: PathBuf, content: String) -> Result<FileMetadata, FileError> {
    let safe = path_safety::validate_write_path(&path).map_err(|e| {
        log::warn!("write_prompt_file rejected {}: {}", path.display(), e);
        e
    })?;
    path_safety::enforce_size_limit(content.len() as u64).map_err(|e| {
        log::warn!(
            "write_prompt_file rejected oversize {}: {}",
            safe.display(),
            e
        );
        e
    })?;
    std::fs::write(&safe, &content)?;
    compute_metadata(&safe, &content)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirChild {
    pub name: String,
    pub path: PathBuf,
    pub is_dir: bool,
    pub is_hidden: bool,
}

/// List immediate children of a directory. Folders first, then files,
/// alphabetical within each group. `is_hidden` covers Unix dotfiles only —
/// Windows hidden-attribute detection is deferred.
#[tauri::command]
pub fn list_dir(path: PathBuf) -> Result<Vec<DirChild>, FileError> {
    let safe = path_safety::validate_read_path(&path).map_err(|e| {
        log::warn!("list_dir rejected {}: {}", path.display(), e);
        e
    })?;
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&safe)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_hidden = name.starts_with('.');
        let entry_path = entry.path();
        let is_dir = entry_path.is_dir();
        out.push(DirChild {
            name,
            path: entry_path,
            is_dir,
            is_hidden,
        });
    }
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}
