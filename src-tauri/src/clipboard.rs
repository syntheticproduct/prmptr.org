use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use arboard::Clipboard;
use image::{ImageBuffer, Rgba};
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ClipboardError {
    #[error("no image in clipboard")]
    NoImage,

    #[error("clipboard: {0}")]
    Clipboard(String),

    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("image encode: {0}")]
    Image(String),

    #[error("system time: {0}")]
    Time(#[from] std::time::SystemTimeError),
}

impl From<arboard::Error> for ClipboardError {
    fn from(e: arboard::Error) -> Self {
        match e {
            arboard::Error::ContentNotAvailable => ClipboardError::NoImage,
            other => ClipboardError::Clipboard(other.to_string()),
        }
    }
}

impl From<image::ImageError> for ClipboardError {
    fn from(e: image::ImageError) -> Self {
        ClipboardError::Image(e.to_string())
    }
}

impl Serialize for ClipboardError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let (kind, message) = match self {
            ClipboardError::NoImage => ("NoImage", self.to_string()),
            ClipboardError::Clipboard(s) => ("Clipboard", s.clone()),
            ClipboardError::Io(e) => ("Io", e.to_string()),
            ClipboardError::Image(s) => ("Image", s.clone()),
            ClipboardError::Time(e) => ("Time", e.to_string()),
        };
        let mut s = serializer.serialize_struct("ClipboardError", 2)?;
        s.serialize_field("kind", kind)?;
        s.serialize_field("message", &message)?;
        s.end()
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardImageResult {
    pub path: PathBuf,
    pub width: u32,
    pub height: u32,
    pub bytes_written: u64,
}

/// Read the current clipboard image, save it as PNG in the OS temp dir under
/// `prmptr-clips/`, and replace the clipboard contents with the path as text.
///
/// Subsequent paste actions in any app yield the saved file path — useful for
/// shuttling screenshots into chat apps or file fields that expect a path.
#[tauri::command]
pub fn clipboard_image_to_path() -> Result<ClipboardImageResult, ClipboardError> {
    let mut clipboard = Clipboard::new()?;
    let img = clipboard.get_image()?;

    let dir = std::env::temp_dir().join("prmptr-clips");
    std::fs::create_dir_all(&dir)?;

    let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis();
    let path = dir.join(format!("clip-{stamp}.png"));

    let width = img.width as u32;
    let height = img.height as u32;
    let buf: ImageBuffer<Rgba<u8>, Vec<u8>> =
        ImageBuffer::from_raw(width, height, img.bytes.into_owned())
            .ok_or_else(|| ClipboardError::Image("buffer length doesn't match dimensions".into()))?;
    buf.save_with_format(&path, image::ImageFormat::Png)?;

    let bytes_written = std::fs::metadata(&path)?.len();
    clipboard.set_text(path.to_string_lossy().to_string())?;

    Ok(ClipboardImageResult {
        path,
        width,
        height,
        bytes_written,
    })
}
