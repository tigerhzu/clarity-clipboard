use std::path::Path;

use windows_sys::Win32::{
    Foundation::CloseHandle,
    System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    },
    UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
    },
};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SourceContext {
    pub app_name: Option<String>,
    pub process_name: Option<String>,
    pub window_title: Option<String>,
}

pub fn detect_foreground_source() -> SourceContext {
    unsafe {
        let window = GetForegroundWindow();
        if window.is_null() {
            return SourceContext::default();
        }

        let window_title = read_window_title(window);
        let mut process_id = 0;
        GetWindowThreadProcessId(window, &mut process_id);
        let process_name = read_process_name(process_id);
        let app_name = process_name.as_deref().map(friendly_app_name);

        SourceContext {
            app_name,
            process_name,
            window_title,
        }
    }
}

unsafe fn read_window_title(window: *mut core::ffi::c_void) -> Option<String> {
    let length = unsafe { GetWindowTextLengthW(window) };
    if length <= 0 {
        return None;
    }

    let mut buffer = vec![0u16; length as usize + 1];
    let written = unsafe { GetWindowTextW(window, buffer.as_mut_ptr(), buffer.len() as i32) };
    (written > 0).then(|| String::from_utf16_lossy(&buffer[..written as usize]))
}

unsafe fn read_process_name(process_id: u32) -> Option<String> {
    if process_id == 0 {
        return None;
    }

    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
    if process.is_null() {
        return None;
    }

    let mut buffer = vec![0u16; 32_768];
    let mut size = buffer.len() as u32;
    let succeeded =
        unsafe { QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut size) != 0 };
    unsafe { CloseHandle(process) };

    if !succeeded || size == 0 {
        return None;
    }

    let path = String::from_utf16_lossy(&buffer[..size as usize]);
    Path::new(&path)
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
}

fn friendly_app_name(process_name: &str) -> String {
    let stem = process_name
        .strip_suffix(".exe")
        .unwrap_or(process_name)
        .to_ascii_lowercase();

    match stem.as_str() {
        "msedge" => "Microsoft Edge".into(),
        "chrome" => "Google Chrome".into(),
        "firefox" => "Mozilla Firefox".into(),
        "opera" | "opera_gx" => "Opera".into(),
        "explorer" => "File Explorer".into(),
        "windowsterminal" => "Windows Terminal".into(),
        "powershell" => "Windows PowerShell".into(),
        "pwsh" => "PowerShell".into(),
        "cmd" => "Command Prompt".into(),
        "code" => "Visual Studio Code".into(),
        "devenv" => "Visual Studio".into(),
        "notepad" => "Notepad".into(),
        "outlook" | "olk" => "Microsoft Outlook".into(),
        "teams" | "ms-teams" => "Microsoft Teams".into(),
        "winword" => "Microsoft Word".into(),
        "excel" => "Microsoft Excel".into(),
        "powerpnt" => "Microsoft PowerPoint".into(),
        "onenote" => "Microsoft OneNote".into(),
        "1password" => "1Password".into(),
        "keepass" | "keepassxc" => "KeePass".into(),
        "bitwarden" => "Bitwarden".into(),
        "mstsc" | "msrdc" => "Remote Desktop".into(),
        "clarity-clipboard" => "Clarity Clipboard".into(),
        _ => process_name
            .strip_suffix(".exe")
            .unwrap_or(process_name)
            .replace(['-', '_'], " "),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_common_windows_processes_to_friendly_names() {
        let cases = [
            ("msedge.exe", "Microsoft Edge"),
            ("WindowsTerminal.exe", "Windows Terminal"),
            ("explorer.exe", "File Explorer"),
            ("Code.exe", "Visual Studio Code"),
            ("mstsc.exe", "Remote Desktop"),
        ];

        for (process, expected) in cases {
            assert_eq!(friendly_app_name(process), expected);
        }
    }

    #[test]
    fn creates_a_readable_fallback_name() {
        assert_eq!(friendly_app_name("HaloPSA-Desktop.exe"), "HaloPSA Desktop");
    }
}
