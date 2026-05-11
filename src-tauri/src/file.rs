use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Serialize;
use thiserror::Error;

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
    let content = std::fs::read_to_string(&path)?;
    let metadata = compute_metadata(&path, &content)?;
    Ok(PromptFile { path, content, metadata })
}

#[tauri::command]
pub fn write_prompt_file(path: PathBuf, content: String) -> Result<FileMetadata, FileError> {
    std::fs::write(&path, &content)?;
    compute_metadata(&path, &content)
}
