use std::path::PathBuf;
use std::process::Command;
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

/// Detect WSL by env var or kernel signature. WSLg's clipboard bridge does
/// not forward image MIME types between Windows and Linux, so on WSL we
/// can't use arboard for image clipboard — we have to talk to Windows
/// directly via PowerShell.
fn is_wsl() -> bool {
    if std::env::var_os("WSL_DISTRO_NAME").is_some() {
        return true;
    }
    if std::env::var_os("WSL_INTEROP").is_some() {
        return true;
    }
    if let Ok(content) = std::fs::read_to_string("/proc/version") {
        return content.to_lowercase().contains("microsoft");
    }
    false
}

/// Native arboard path — works on Windows, macOS, and Linux when the
/// compositor supports the wlr-data-control protocol (most modern ones).
fn native_clipboard_image_to_path() -> Result<ClipboardImageResult, ClipboardError> {
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

/// WSL fallback: shell out to PowerShell.exe (which is on $PATH inside WSL
/// via Windows interop). Reads the Windows clipboard image, saves it to
/// %TEMP%\prmptr-clips\, replaces the Windows clipboard with the resulting
/// Windows path as text. The path lands as a Windows-style path because the
/// downstream consumer (other Windows apps the user is pasting into) needs
/// it that way.
fn powershell_clipboard_image_to_path() -> Result<ClipboardImageResult, ClipboardError> {
    // Single PowerShell script: read image, save, set clipboard text, emit
    // path|width|height|size on stdout. Stderr "no image" → NoImage.
    const SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms | Out-Null
Add-Type -AssemblyName System.Drawing | Out-Null
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img -eq $null) {
    [Console]::Error.WriteLine('no image')
    exit 1
}
$dir = Join-Path $env:TEMP 'prmptr-clips'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$ts = [int64]([DateTimeOffset]::Now.ToUnixTimeMilliseconds())
$path = Join-Path $dir ('clip-' + $ts + '.png')
$img.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
[System.Windows.Forms.Clipboard]::SetText($path)
$size = (Get-Item $path).Length
[Console]::Out.WriteLine($path + '|' + $img.Width + '|' + $img.Height + '|' + $size)
"#;

    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
        .output()
        .map_err(|e| {
            ClipboardError::Clipboard(format!("powershell.exe not invocable: {e}"))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("no image") {
            return Err(ClipboardError::NoImage);
        }
        return Err(ClipboardError::Clipboard(format!(
            "powershell exited {}: {}",
            output.status,
            stderr.trim()
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout.trim();
    let parts: Vec<&str> = line.split('|').collect();
    if parts.len() != 4 {
        return Err(ClipboardError::Clipboard(format!(
            "unexpected powershell output: {line:?}"
        )));
    }

    let path = PathBuf::from(parts[0]);
    let width: u32 = parts[1]
        .parse()
        .map_err(|e| ClipboardError::Clipboard(format!("bad width {:?}: {e}", parts[1])))?;
    let height: u32 = parts[2]
        .parse()
        .map_err(|e| ClipboardError::Clipboard(format!("bad height {:?}: {e}", parts[2])))?;
    let bytes_written: u64 = parts[3]
        .parse()
        .map_err(|e| ClipboardError::Clipboard(format!("bad size {:?}: {e}", parts[3])))?;

    Ok(ClipboardImageResult {
        path,
        width,
        height,
        bytes_written,
    })
}

/// Read the current clipboard image, save it as PNG in the OS temp dir under
/// `prmptr-clips/`, and replace the clipboard contents with the path as text.
///
/// Dispatches by platform: WSL → PowerShell.exe (WSLg's clipboard bridge
/// can't forward image MIME types); everything else → arboard.
#[tauri::command]
pub fn clipboard_image_to_path() -> Result<ClipboardImageResult, ClipboardError> {
    if is_wsl() {
        return powershell_clipboard_image_to_path();
    }
    native_clipboard_image_to_path()
}
