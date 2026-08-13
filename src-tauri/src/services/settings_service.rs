use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub retention_days: Option<u32>,
    pub excluded_apps: Vec<String>,
    pub sensitive_filter_enabled: bool,
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

        let settings = if path.exists() {
            let content = fs::read_to_string(&path)?;
            normalize(serde_json::from_str(&content)?)
        } else {
            AppSettings::default()
        };
        let service = Self {
            path,
            current: Arc::new(RwLock::new(settings.clone())),
        };
        if !service.path.exists() {
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
        fs::write(&self.path, serde_json::to_vec_pretty(settings)?)?;
        Ok(())
    }
}

fn normalize(mut settings: AppSettings) -> AppSettings {
    settings.retention_days = match settings.retention_days {
        Some(7 | 30 | 90) => settings.retention_days,
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
    settings
}

#[cfg(test)]
mod tests {
    use super::*;

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
            })
            .unwrap();

        assert_eq!(updated.retention_days, None);
        assert_eq!(updated.excluded_apps, vec!["Bitwarden.exe"]);
        assert_eq!(
            SettingsService::initialize(path).unwrap().get().unwrap(),
            updated
        );
    }
}
