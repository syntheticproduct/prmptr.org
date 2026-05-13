//! Read the Windows Accessibility "Text size" slider so menus/chrome can
//! scale without dragging the editor along. Lives at
//! `HKCU\Software\Microsoft\Accessibility\TextScaleFactor` as a DWORD
//! between 100 (default) and 225. Off Windows we return 100 (no scaling).

#[tauri::command]
pub fn text_scale_factor() -> u32 {
    read_factor()
}

#[cfg(windows)]
fn read_factor() -> u32 {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(key) = hkcu.open_subkey(r"Software\Microsoft\Accessibility") else {
        return 100;
    };
    key.get_value::<u32, _>("TextScaleFactor")
        .ok()
        .filter(|v| (50..=400).contains(v))
        .unwrap_or(100)
}

#[cfg(not(windows))]
fn read_factor() -> u32 {
    100
}
