use std::{thread, time::Duration};

use chrono::Utc;
use tauri::{AppHandle, Emitter};

use crate::database::repository::{ClipboardRepository, RepositoryError};

use super::{
    image_service::ImageService,
    settings_service::{SettingsService, SettingsServiceError},
};

const CLEANUP_INTERVAL: Duration = Duration::from_secs(60 * 60);

#[derive(Debug, thiserror::Error)]
pub enum CleanupServiceError {
    #[error(transparent)]
    Repository(#[from] RepositoryError),
    #[error(transparent)]
    Settings(#[from] SettingsServiceError),
}

#[derive(Debug, Clone)]
pub struct CleanupService {
    repository: ClipboardRepository,
    image_service: ImageService,
    settings_service: SettingsService,
}

impl CleanupService {
    pub fn new(
        repository: ClipboardRepository,
        image_service: ImageService,
        settings_service: SettingsService,
    ) -> Self {
        Self {
            repository,
            image_service,
            settings_service,
        }
    }

    pub fn start(self, app_handle: AppHandle) {
        thread::Builder::new()
            .name("clipboard-cleanup".into())
            .spawn(move || loop {
                match self.run_once() {
                    Ok(removed) if removed > 0 => {
                        let _ = app_handle.emit(
                            "clipboard://changed",
                            serde_json::json!({
                                "kind": "cleanup",
                                "removed": removed,
                            }),
                        );
                    }
                    Ok(_) => {}
                    Err(error) => {
                        eprintln!("Could not clean clipboard history: {error}");
                    }
                }
                thread::sleep(CLEANUP_INTERVAL);
            })
            .expect("failed to spawn clipboard cleanup thread");
    }

    pub fn run_once(&self) -> Result<usize, CleanupServiceError> {
        let Some(days) = self.settings_service.get()?.retention_days else {
            return Ok(0);
        };
        let cutoff = Utc::now().timestamp_millis() - i64::from(days) * 86_400_000;
        let expired = self.repository.delete_expired_unpinned(cutoff)?;
        for item in &expired {
            if item.content_type == "IMAGE" {
                self.image_service
                    .remove_item_files(item.file_path.as_deref(), item.metadata.as_deref());
            }
        }
        Ok(expired.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::models::NewClipboardItem;
    use crate::services::settings_service::AppSettings;

    fn old_item(id: &str, created_at: i64) -> NewClipboardItem {
        NewClipboardItem {
            id: id.into(),
            content: Some(id.into()),
            content_type: "TEXT".into(),
            content_hash: id.into(),
            source_app: None,
            source_process: None,
            source_window: None,
            created_at,
            file_path: None,
            metadata: None,
            tags: None,
        }
    }

    #[test]
    fn removes_expired_items_but_keeps_pinned_items() {
        let directory = tempfile::tempdir().unwrap();
        let repository =
            ClipboardRepository::initialize(directory.path().join("clipboard.db")).unwrap();
        let image_service = ImageService::initialize(directory.path().join("images")).unwrap();
        let settings = SettingsService::initialize(directory.path().join("settings.json")).unwrap();
        settings
            .update(AppSettings {
                retention_days: Some(7),
                excluded_apps: Vec::new(),
                sensitive_filter_enabled: true,
                text_scale: 120,
                hotkey: "Alt+Z".into(),
                hermes_enabled: false,
            })
            .unwrap();
        let old_time = Utc::now().timestamp_millis() - 8 * 86_400_000;
        repository
            .save_with_consecutive_deduplication(old_item("expired", old_time), 0)
            .unwrap();
        repository
            .save_with_consecutive_deduplication(old_item("pinned", old_time + 1), 0)
            .unwrap();
        repository.toggle_pin("pinned").unwrap();

        let cleanup = CleanupService::new(repository.clone(), image_service, settings);
        assert_eq!(cleanup.run_once().unwrap(), 1);
        assert!(repository.get_by_id("expired").is_err());
        assert!(repository.get_by_id("pinned").unwrap().is_pinned);
    }
}
