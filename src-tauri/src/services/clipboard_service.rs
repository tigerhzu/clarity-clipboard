use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use chrono::Utc;
use clipboard_win::{formats::Bitmap, set_clipboard_string, Clipboard, Setter};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::core::classifier::{ClipboardClassifier, ContentType};
use crate::core::source_detector::SourceContext;
use crate::database::{
    models::{ClipboardItem, NewClipboardItem, SaveResult},
    repository::{ClipboardRepository, RepositoryError},
};

use super::{
    image_service::{ImageService, ImageServiceError},
    privacy_service::PrivacyService,
    settings_service::SettingsServiceError,
};

const CONSECUTIVE_DUPLICATE_WINDOW_MS: i64 = 5_000;
const INTERNAL_COPY_SUPPRESSION_WINDOW: Duration = Duration::from_secs(3);

#[derive(Debug, thiserror::Error)]
pub enum ClipboardServiceError {
    #[error(transparent)]
    Repository(#[from] RepositoryError),
    #[error("clipboard access failed: {0}")]
    Clipboard(String),
    #[error("clipboard state lock is unavailable")]
    StateLock,
    #[error(transparent)]
    Image(#[from] ImageServiceError),
    #[error(transparent)]
    Settings(#[from] SettingsServiceError),
}

#[derive(Debug, Clone)]
pub struct ClipboardService {
    repository: ClipboardRepository,
    classifier: ClipboardClassifier,
    internal_copies: Arc<Mutex<VecDeque<(String, Instant)>>>,
    internal_image_copies: Arc<Mutex<VecDeque<Instant>>>,
    image_service: ImageService,
    privacy_service: PrivacyService,
}

impl ClipboardService {
    pub fn new(
        repository: ClipboardRepository,
        image_service: ImageService,
        privacy_service: PrivacyService,
    ) -> Self {
        Self {
            repository,
            classifier: ClipboardClassifier,
            internal_copies: Arc::new(Mutex::new(VecDeque::new())),
            internal_image_copies: Arc::new(Mutex::new(VecDeque::new())),
            image_service,
            privacy_service,
        }
    }

    #[cfg(test)]
    pub fn list_recent(
        &self,
        limit: usize,
    ) -> Result<Vec<crate::database::models::ClipboardItem>, ClipboardServiceError> {
        Ok(self.repository.list_recent(limit)?)
    }

    #[cfg(test)]
    pub fn ingest_text(
        &self,
        content: String,
    ) -> Result<Option<SaveResult>, ClipboardServiceError> {
        self.ingest_text_with_source(content, SourceContext::default())
    }

    pub fn ingest_text_with_source(
        &self,
        content: String,
        source: SourceContext,
    ) -> Result<Option<SaveResult>, ClipboardServiceError> {
        if content.is_empty() {
            return Ok(None);
        }
        if self.privacy_service.should_exclude_source(&source)?
            || self.privacy_service.should_exclude_text(&content)?
        {
            return Ok(None);
        }

        let now = Utc::now().timestamp_millis();
        let content_hash = hash_content(&content);
        if self.consume_internal_copy(&content_hash)? {
            return Ok(None);
        }
        let content_type = self.classifier.classify(&content);
        let item = NewClipboardItem {
            id: Uuid::new_v4().to_string(),
            content: Some(content),
            content_type: content_type.as_str().to_owned(),
            content_hash,
            source_app: source.app_name,
            source_process: source.process_name,
            source_window: source.window_title,
            created_at: now,
            file_path: None,
            metadata: None,
            tags: None,
        };

        Ok(Some(self.repository.save_with_consecutive_deduplication(
            item,
            CONSECUTIVE_DUPLICATE_WINDOW_MS,
        )?))
    }

    pub fn ingest_bitmap_with_source(
        &self,
        bitmap: Vec<u8>,
        source: SourceContext,
    ) -> Result<Option<SaveResult>, ClipboardServiceError> {
        if bitmap.is_empty()
            || self.consume_internal_image_copy()?
            || self.privacy_service.should_exclude_source(&source)?
        {
            return Ok(None);
        }

        let now = Utc::now().timestamp_millis();
        let id = Uuid::new_v4().to_string();
        let stored = self.image_service.store_bitmap(&id, &bitmap)?;
        let new_file_path = stored.file_path.clone();
        let new_metadata = stored.metadata.clone();
        let item = NewClipboardItem {
            id,
            content: None,
            content_type: "IMAGE".into(),
            content_hash: stored.content_hash,
            source_app: source.app_name,
            source_process: source.process_name,
            source_window: source.window_title,
            created_at: now,
            file_path: Some(stored.file_path),
            metadata: Some(stored.metadata),
            tags: None,
        };

        let result = match self
            .repository
            .save_with_consecutive_deduplication(item, CONSECUTIVE_DUPLICATE_WINDOW_MS)
        {
            Ok(result) => result,
            Err(error) => {
                self.image_service
                    .remove_item_files(Some(&new_file_path), Some(&new_metadata));
                return Err(error.into());
            }
        };
        if result.disposition == crate::database::models::SaveDisposition::RefreshedDuplicate {
            self.image_service
                .remove_item_files(Some(&new_file_path), Some(&new_metadata));
        }
        Ok(Some(result))
    }

    pub fn toggle_pin(&self, id: &str) -> Result<ClipboardItem, ClipboardServiceError> {
        Ok(self.repository.toggle_pin(id)?)
    }

    pub fn delete_item(&self, id: &str) -> Result<bool, ClipboardServiceError> {
        let item = self.repository.get_by_id(id)?;
        let deleted = self.repository.delete_item(id)?;
        if deleted && item.content_type == "IMAGE" {
            self.image_service
                .remove_item_files(item.file_path.as_deref(), item.metadata.as_deref());
        }
        Ok(deleted)
    }

    pub fn copy_item(&self, id: &str) -> Result<ClipboardItem, ClipboardServiceError> {
        let item = self.repository.get_by_id(id)?;
        if item.content_type == "IMAGE" {
            let path = item.file_path.as_deref().ok_or_else(|| {
                ClipboardServiceError::Clipboard("image file path is missing".into())
            })?;
            let bitmap = self.image_service.bitmap_for_clipboard(path)?;
            self.register_internal_image_copy()?;
            let result = (|| {
                let _clipboard = Clipboard::new_attempts(10)
                    .map_err(|error| ClipboardServiceError::Clipboard(error.to_string()))?;
                clipboard_win::empty()
                    .map_err(|error| ClipboardServiceError::Clipboard(error.to_string()))?;
                Bitmap
                    .write_clipboard(&bitmap)
                    .map_err(|error| ClipboardServiceError::Clipboard(error.to_string()))
            })();
            if let Err(error) = result {
                let _ = self.consume_internal_image_copy();
                return Err(error);
            }
            return Ok(item);
        }

        let content = item.content.as_deref().unwrap_or_default();
        if content.is_empty() {
            return Err(ClipboardServiceError::Clipboard(
                "item has no text content".into(),
            ));
        }

        let hash = hash_content(content);
        self.register_internal_copy(hash.clone())?;
        if let Err(error) = set_clipboard_string(content) {
            let _ = self.consume_internal_copy(&hash);
            return Err(ClipboardServiceError::Clipboard(error.to_string()));
        }
        Ok(item)
    }

    pub fn image_data_url(
        &self,
        id: &str,
        thumbnail: bool,
    ) -> Result<String, ClipboardServiceError> {
        let item = self.repository.get_by_id(id)?;
        if item.content_type != "IMAGE" {
            return Err(ClipboardServiceError::Clipboard(
                "item is not an image".into(),
            ));
        }
        let path = if thumbnail {
            item.metadata
                .as_deref()
                .and_then(|value| {
                    serde_json::from_str::<super::image_service::ImageMetadata>(value).ok()
                })
                .map(|metadata| metadata.thumbnail_path)
                .or(item.file_path)
        } else {
            item.file_path
        }
        .ok_or_else(|| ClipboardServiceError::Clipboard("image file path is missing".into()))?;
        Ok(self.image_service.data_url(&path)?)
    }

    pub fn reclassify_existing_items(&self) -> Result<usize, ClipboardServiceError> {
        let updates = self
            .repository
            .text_items_for_reclassification()?
            .into_iter()
            .filter_map(|(id, content)| {
                let content_type = self.classifier.classify(&content);
                (content_type != ContentType::Text).then(|| (id, content_type.as_str().to_owned()))
            })
            .collect::<Vec<_>>();
        Ok(self.repository.update_content_types(&updates)?)
    }

    fn register_internal_copy(&self, hash: String) -> Result<(), ClipboardServiceError> {
        let mut copies = self
            .internal_copies
            .lock()
            .map_err(|_| ClipboardServiceError::StateLock)?;
        prune_internal_copies(&mut copies);
        copies.push_back((hash, Instant::now()));
        Ok(())
    }

    fn consume_internal_copy(&self, hash: &str) -> Result<bool, ClipboardServiceError> {
        let mut copies = self
            .internal_copies
            .lock()
            .map_err(|_| ClipboardServiceError::StateLock)?;
        prune_internal_copies(&mut copies);
        if let Some(position) = copies.iter().position(|(candidate, _)| candidate == hash) {
            copies.remove(position);
            return Ok(true);
        }
        Ok(false)
    }

    fn register_internal_image_copy(&self) -> Result<(), ClipboardServiceError> {
        let mut copies = self
            .internal_image_copies
            .lock()
            .map_err(|_| ClipboardServiceError::StateLock)?;
        prune_internal_image_copies(&mut copies);
        copies.push_back(Instant::now());
        Ok(())
    }

    fn consume_internal_image_copy(&self) -> Result<bool, ClipboardServiceError> {
        let mut copies = self
            .internal_image_copies
            .lock()
            .map_err(|_| ClipboardServiceError::StateLock)?;
        prune_internal_image_copies(&mut copies);
        Ok(copies.pop_front().is_some())
    }
}

fn hash_content(content: &str) -> String {
    hex::encode(Sha256::digest(content.as_bytes()))
}

fn prune_internal_copies(copies: &mut VecDeque<(String, Instant)>) {
    while copies
        .front()
        .is_some_and(|(_, created)| created.elapsed() > INTERNAL_COPY_SUPPRESSION_WINDOW)
    {
        copies.pop_front();
    }
}

fn prune_internal_image_copies(copies: &mut VecDeque<Instant>) {
    while copies
        .front()
        .is_some_and(|created| created.elapsed() > INTERNAL_COPY_SUPPRESSION_WINDOW)
    {
        copies.pop_front();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service() -> (tempfile::TempDir, ClipboardService) {
        let directory = tempfile::tempdir().expect("temporary directory");
        let repository = ClipboardRepository::initialize(directory.path().join("clipboard.db"))
            .expect("repository");
        let image_service = ImageService::initialize(directory.path().join("images")).unwrap();
        let settings = super::super::settings_service::SettingsService::initialize(
            directory.path().join("settings.json"),
        )
        .unwrap();
        let privacy_service = PrivacyService::new(settings);
        (
            directory,
            ClipboardService::new(repository, image_service, privacy_service),
        )
    }

    #[test]
    fn persists_text_in_newest_first_order() {
        let (_directory, service) = service();
        service.ingest_text("first".into()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        service.ingest_text("second".into()).unwrap();

        let items = service.list_recent(20).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].content.as_deref(), Some("second"));
        assert_eq!(items[1].content.as_deref(), Some("first"));
    }

    #[test]
    fn refreshes_an_immediate_consecutive_duplicate() {
        let (_directory, service) = service();
        let first = service.ingest_text("same content".into()).unwrap().unwrap();
        let duplicate = service.ingest_text("same content".into()).unwrap().unwrap();

        let items = service.list_recent(20).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(duplicate.item.id, first.item.id);
        assert_eq!(
            duplicate.disposition,
            crate::database::models::SaveDisposition::RefreshedDuplicate
        );
    }

    #[test]
    fn ignores_an_empty_clipboard_string() {
        let (_directory, service) = service();
        assert!(service.ingest_text(String::new()).unwrap().is_none());
        assert!(service.list_recent(20).unwrap().is_empty());
    }

    #[test]
    fn stores_the_classifier_result() {
        let (_directory, service) = service();
        let result = service
            .ingest_text("192.168.10.25".into())
            .unwrap()
            .unwrap();
        assert_eq!(result.item.content_type, "IP");
    }

    #[test]
    fn preserves_source_context_with_the_item() {
        let (_directory, service) = service();
        let source = SourceContext {
            app_name: Some("Microsoft Edge".into()),
            process_name: Some("msedge.exe".into()),
            window_title: Some("Clarity docs".into()),
        };
        let result = service
            .ingest_text_with_source("source test".into(), source)
            .unwrap()
            .unwrap();

        assert_eq!(result.item.source_app.as_deref(), Some("Microsoft Edge"));
        assert_eq!(result.item.source_process.as_deref(), Some("msedge.exe"));
        assert_eq!(result.item.source_window.as_deref(), Some("Clarity docs"));
    }

    #[test]
    fn toggles_pin_and_deletes_an_item() {
        let (_directory, service) = service();
        let item = service
            .ingest_text("action target".into())
            .unwrap()
            .unwrap()
            .item;

        let pinned = service.toggle_pin(&item.id).unwrap();
        assert!(pinned.is_pinned);
        let unpinned = service.toggle_pin(&item.id).unwrap();
        assert!(!unpinned.is_pinned);
        assert!(service.delete_item(&item.id).unwrap());
        assert!(service.list_recent(20).unwrap().is_empty());
    }

    #[test]
    fn suppresses_a_registered_internal_copy_once() {
        let (_directory, service) = service();
        let content = "copied inside Clarity";
        service
            .register_internal_copy(hash_content(content))
            .unwrap();

        assert!(service.ingest_text(content.into()).unwrap().is_none());
        assert!(service.ingest_text(content.into()).unwrap().is_some());
    }

    #[test]
    fn persists_and_deletes_an_image() {
        use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
        use std::io::Cursor;

        let (_directory, service) = service();
        let source =
            DynamicImage::ImageRgba8(RgbaImage::from_pixel(24, 18, Rgba([12, 34, 56, 255])));
        let mut bitmap = Cursor::new(Vec::new());
        source.write_to(&mut bitmap, ImageFormat::Bmp).unwrap();
        let item = service
            .ingest_bitmap_with_source(bitmap.into_inner(), SourceContext::default())
            .unwrap()
            .unwrap()
            .item;

        assert_eq!(item.content_type, "IMAGE");
        let file_path = item.file_path.clone().unwrap();
        assert!(std::path::Path::new(&file_path).exists());
        assert!(service
            .image_data_url(&item.id, false)
            .unwrap()
            .starts_with("data:image/png;base64,"));
        assert!(service
            .image_data_url(&item.id, true)
            .unwrap()
            .starts_with("data:image/png;base64,"));
        assert!(service.delete_item(&item.id).unwrap());
        assert!(!std::path::Path::new(&file_path).exists());
    }
}
