use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
};

use serde::{Deserialize, Serialize};

const DEFAULT_TEXT_SCALE: u16 = 120;
const DEFAULT_HOTKEY: &str = "Alt+Z";
const LEGACY_DEFAULT_TEXT_SCALE: u16 = 100;
const LEGACY_DEFAULT_HOTKEY: &str = "Control+Alt+Space";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub retention_days: Option<u32>,
    pub excluded_apps: Vec<String>,
    pub sensitive_filter_enabled: bool,
    pub text_scale: u16,
    pub hotkey: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            retention_days: Some(30),
            excluded_apps: vec![
                "1Password.exe".into(),
                "Bitwarden.exe".into(),
                "KeePass.exe".into(),
                "KeePassXC.exe".into(),
                "mstsc.exe".into(),
            ],
            sensitive_filter_enabled: true,
            text_scale: DEFAULT_TEXT_SCALE,
            hotkey: DEFAULT_HOTKEY.into(),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SettingsServiceError {
    #[error("settings file error: {0}")]
    Io(#[from] std::io::Error),
    #[error("settings format error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("settings state lock is unavailable")]
    StateLock,
}

#[derive(Debug, Clone)]
pub struct SettingsService {
    path: PathBuf,
    current: Arc<RwLock<AppSettings>>,
}

impl SettingsService {
    pub fn initialize(path: impl AsRef<Path>) -> Result<Self, SettingsServiceError> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let should_persist;
        let settings = if path.exists() {
            match fs::read_to_string(&path)
                .ok()
                .and_then(|content| serde_json::from_str::<AppSettings>(&content).ok())
            {
                Some(settings) => {
                    let normalized = normalize(settings.clone());
                    should_persist = normalized != settings;
                    normalized
                }
                None => {
                    // A truncated or old settings file must not prevent the
                    // clipboard monitor from starting. Keep a recoverable copy
                    // and restore defaults on the next write.
                    let backup = path.with_extension("json.corrupt");
                    let _ = fs::rename(&path, backup);
                    should_persist = true;
                    AppSettings::default()
                }
            }
        } else {
            should_persist = true;
            AppSettings::default()
        };
        let service = Self {
            path,
            current: Arc::new(RwLock::new(settings.clone())),
        };
        if should_persist || !service.path.exists() {
            service.write(&settings)?;
        }
        Ok(service)
    }

    pub fn get(&self) -> Result<AppSettings, SettingsServiceError> {
        self.current
            .read()
            .map(|settings| settings.clone())
            .map_err(|_| SettingsServiceError::StateLock)
    }

    pub fn update(&self, settings: AppSettings) -> Result<AppSettings, SettingsServiceError> {
        let settings = normalize(settings);
        self.write(&settings)?;
        *self
            .current
            .write()
            .map_err(|_| SettingsServiceError::StateLock)? = settings.clone();
        Ok(settings)
    }

    fn write(&self, settings: &AppSettings) -> Result<(), SettingsServiceError> {
        let temporary_path = self.path.with_extension("json.tmp");
        let content = serde_json::to_vec_pretty(settings)?;
        let mut file = fs::File::create(&temporary_path)?;
        file.write_all(&content)?;
        file.sync_all()?;
        drop(file);

        // Windows does not replace an existing path with rename. Removing the
        // old file only after the complete temporary write keeps partial JSON
        // out of the normal update path and leaves a clean temp file on error.
        if self.path.exists() {
            fs::remove_file(&self.path)?;
        }
        fs::rename(&temporary_path, &self.path)?;
        Ok(())
    }
}

fn normalize(mut settings: AppSettings) -> AppSettings {
    settings.retention_days = match settings.retention_days {
        Some(7 | 14 | 30) => settings.retention_days,
        // Migrate the removed 90-day choice to the longest remaining finite
        // retention period instead of unexpectedly changing it to forever.
        Some(90) => Some(30),
        _ => None,
    };

    let mut seen = HashSet::new();
    settings.excluded_apps = settings
        .excluded_apps
        .into_iter()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .filter(|value| seen.insert(value.to_lowercase()))
        .take(100)
        .collect();
    let is_legacy_default_profile = settings.text_scale == LEGACY_DEFAULT_TEXT_SCALE
        && settings
            .hotkey
            .trim()
            .eq_ignore_ascii_case(LEGACY_DEFAULT_HOTKEY);
    settings.text_scale = match settings.text_scale {
        LEGACY_DEFAULT_TEXT_SCALE if is_legacy_default_profile => DEFAULT_TEXT_SCALE,
        100 | 120 | 150 => settings.text_scale,
        _ => DEFAULT_TEXT_SCALE,
    };
    settings.hotkey = {
        let value = settings.hotkey.trim().to_owned();
        if value.eq_ignore_ascii_case("Control+Fn")
            || value.eq_ignore_ascii_case(LEGACY_DEFAULT_HOTKEY)
        {
            DEFAULT_HOTKEY.into()
        } else if value.is_empty() || value.len() > 64 || !value.contains('+') {
            DEFAULT_HOTKEY.into()
        } else {
            value
        }
    };
    settings
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_new_preferences_as_defaults() {
        let settings = AppSettings::default();

        assert_eq!(settings.text_scale, DEFAULT_TEXT_SCALE);
        assert_eq!(settings.hotkey, DEFAULT_HOTKEY);
    }

    #[test]
    fn persists_and_normalizes_settings() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        let service = SettingsService::initialize(&path).unwrap();
        let updated = service
            .update(AppSettings {
                retention_days: Some(14),
                excluded_apps: vec![" Bitwarden.exe ".into(), "bitwarden.exe".into()],
                sensitive_filter_enabled: false,
                text_scale: 140,
                hotkey: "Control+Alt+Space".into(),
            })
            .unwrap();

        assert_eq!(updated.retention_days, Some(14));
        assert_eq!(updated.excluded_apps, vec!["Bitwarden.exe"]);
        assert_eq!(updated.text_scale, DEFAULT_TEXT_SCALE);
        assert_eq!(updated.hotkey, DEFAULT_HOTKEY);
        assert_eq!(
            SettingsService::initialize(path).unwrap().get().unwrap(),
            updated
        );
    }

    #[test]
    fn recovers_from_corrupt_settings_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        fs::write(&path, b"{not valid json").unwrap();

        let service = SettingsService::initialize(&path).unwrap();

        assert_eq!(service.get().unwrap(), AppSettings::default());
        assert!(path.exists());
        assert!(directory.path().join("settings.json.corrupt").exists());
        assert!(serde_json::from_str::<AppSettings>(&fs::read_to_string(path).unwrap()).is_ok());
    }

    #[test]
    fn fills_text_scale_for_legacy_settings_files() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        fs::write(
            &path,
            br#"{"retentionDays":30,"excludedApps":[],"sensitiveFilterEnabled":true,"hotkey":"Control+Fn"}"#,
        )
        .unwrap();

        let service = SettingsService::initialize(&path).unwrap();

        assert_eq!(service.get().unwrap().text_scale, DEFAULT_TEXT_SCALE);
        assert_eq!(service.get().unwrap().hotkey, DEFAULT_HOTKEY);
    }

    #[test]
    fn migrates_previous_default_profile() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        fs::write(&path, br#"{"textScale":100,"hotkey":"Control+Alt+Space"}"#).unwrap();

        let service = SettingsService::initialize(&path).unwrap();

        assert_eq!(service.get().unwrap().text_scale, DEFAULT_TEXT_SCALE);
        assert_eq!(service.get().unwrap().hotkey, DEFAULT_HOTKEY);
        let persisted = fs::read_to_string(path).unwrap();
        assert!(persisted.contains("\"textScale\": 120"));
        assert!(persisted.contains("\"hotkey\": \"Alt+Z\""));
    }
}
