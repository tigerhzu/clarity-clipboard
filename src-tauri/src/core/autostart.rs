//! Current-user login startup. Debug/test applications never register themselves.
pub const APP_ID: &str = "com.tigerhzu.clarityclipboard";

pub fn sync(identifier: &str, enabled: bool) -> Result<(), String> {
    if cfg!(debug_assertions) || identifier != APP_ID {
        return Ok(());
    }
    #[cfg(windows)]
    {
        set_enabled(enabled).map_err(|e| format!("無法設定 Windows 登入啟動：{e}"))?;
    }
    Ok(())
}

#[cfg(windows)]
fn set_enabled(enabled: bool) -> std::io::Result<()> {
    use std::{os::windows::ffi::OsStrExt, ptr};
    use windows_sys::Win32::{
        Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS},
        System::Registry::{
            RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegSetValueExW, HKEY_CURRENT_USER,
            KEY_SET_VALUE, REG_SZ,
        },
    };
    let wide = |value: &std::ffi::OsStr| value.encode_wide().chain(Some(0)).collect::<Vec<_>>();
    let key_path = wide(std::ffi::OsStr::new(
        r"Software\Microsoft\Windows\CurrentVersion\Run",
    ));
    let name = wide(std::ffi::OsStr::new("ClarityClipboard"));
    let mut key = ptr::null_mut();
    let status = unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            key_path.as_ptr(),
            0,
            ptr::null(),
            0,
            KEY_SET_VALUE,
            ptr::null(),
            &mut key,
            ptr::null_mut(),
        )
    };
    if status != ERROR_SUCCESS {
        return Err(std::io::Error::from_raw_os_error(status as i32));
    }
    let status = if enabled {
        let exe = std::env::current_exe();
        match exe {
            Ok(exe) => {
                let mut command = std::ffi::OsString::from("\"");
                command.push(exe);
                command.push("\" --background");
                let value = wide(&command);
                unsafe {
                    RegSetValueExW(
                        key,
                        name.as_ptr(),
                        0,
                        REG_SZ,
                        value.as_ptr().cast(),
                        (value.len() * 2) as u32,
                    )
                }
            }
            Err(error) => {
                unsafe {
                    RegCloseKey(key);
                }
                return Err(error);
            }
        }
    } else {
        unsafe { RegDeleteValueW(key, name.as_ptr()) }
    };
    unsafe {
        RegCloseKey(key);
    }
    if status == ERROR_SUCCESS || (!enabled && status == ERROR_FILE_NOT_FOUND) {
        Ok(())
    } else {
        Err(std::io::Error::from_raw_os_error(status as i32))
    }
}
