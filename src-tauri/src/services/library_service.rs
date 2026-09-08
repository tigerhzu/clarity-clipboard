use chrono::Utc;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::database::{
    models::{ClipboardItem, Folder, FolderItem, NewFolderItem, NewPersonalItem, PersonalItem},
    repository::{ClipboardRepository, RepositoryError},
};

use super::image_service::{ImageService, ImageServiceError};

const MAX_CONTENT_BYTES: usize = 4 * 1024 * 1024;
const MAX_TITLE_CHARACTERS: usize = 120;

#[derive(Debug, thiserror::Error)]
pub enum LibraryServiceError {
    #[error(transparent)]
    Repository(#[from] RepositoryError),
    #[error(transparent)]
    Image(#[from] ImageServiceError),
    #[error("folder name cannot be empty")]
    EmptyFolderName,
    #[error("folder name is too long")]
    FolderNameTooLong,
    #[error("personal item title cannot be empty")]
    EmptyTitle,
    #[error("personal item title is too long")]
    TitleTooLong,
    #[error("personal item content cannot be empty")]
    EmptyContent,
    #[error("personal item content is too large")]
    ContentTooLarge,
    #[error("unsupported personal item content type")]
    UnsupportedContentType,
    #[error("image content cannot be edited as text")]
    ImageContentEdit,
}

pub type LibraryServiceResult<T> = Result<T, LibraryServiceError>;

#[derive(Debug, Clone)]
pub struct LibraryService {
    repository: ClipboardRepository,
    image_service: ImageService,
}

impl LibraryService {
    pub fn new(repository: ClipboardRepository, image_service: ImageService) -> Self {
        Self {
            repository,
            image_service,
        }
    }

    pub fn list_folders(&self) -> LibraryServiceResult<Vec<Folder>> {
        Ok(self.repository.list_folders()?)
    }

    pub fn create_folder(&self, name: &str) -> LibraryServiceResult<Folder> {
        let name = normalize_name(name, false)?;
        Ok(self
            .repository
            .create_folder(&Uuid::new_v4().to_string(), &name, now())?)
    }

    pub fn rename_folder(&self, id: &str, name: &str) -> LibraryServiceResult<Folder> {
        let name = normalize_name(name, false)?;
        Ok(self.repository.rename_folder(id, &name, now())?)
    }

    pub fn delete_folder(&self, id: &str) -> LibraryServiceResult<bool> {
        // Read first so an unknown id is not reported as a successful delete.
        let _ = self.repository.get_folder(id)?;
        let items = self.repository.delete_folder(id)?;
        for item in &items {
            self.remove_snapshot_files(item.file_path.as_deref(), item.metadata.as_deref());
        }
        Ok(true)
    }

    pub fn list_folder_items(&self, folder_id: &str) -> LibraryServiceResult<Vec<FolderItem>> {
        let _ = self.repository.get_folder(folder_id)?;
        Ok(self.repository.list_folder_items(folder_id)?)
    }

    pub fn get_folder_item(&self, id: &str) -> LibraryServiceResult<FolderItem> {
        Ok(self.repository.get_folder_item(id)?)
    }

    pub fn add_clipboard_item_to_folder(
        &self,
        folder_id: &str,
        source_item_id: &str,
    ) -> LibraryServiceResult<FolderItem> {
        let _ = self.repository.get_folder(folder_id)?;
        if let Some(existing) = self
            .repository
            .find_folder_item_by_source(folder_id, source_item_id)?
        {
            return Ok(existing);
        }

        let source = self.repository.get_by_id(source_item_id)?;
        let snapshot_id = Uuid::new_v4().to_string();
        let snapshot = self.snapshot_image(&snapshot_id, &source)?;
        let new_item = NewFolderItem {
            id: snapshot_id,
            folder_id: folder_id.to_owned(),
            source_item_id: Some(source.id.clone()),
            content: source.content.clone(),
            content_type: source.content_type.clone(),
            content_hash: snapshot
                .as_ref()
                .map(|image| image.content_hash.clone())
                .unwrap_or_else(|| source.content_hash.clone()),
            source_app: source.source_app.clone(),
            source_process: source.source_process.clone(),
            source_window: source.source_window.clone(),
            created_at: source.created_at,
            updated_at: source.updated_at,
            is_pinned: source.is_pinned,
            custom_name: source.custom_name.clone(),
            file_path: snapshot.as_ref().map(|image| image.file_path.clone()),
            metadata: snapshot.as_ref().map(|image| image.metadata.clone()),
            tags: source.tags.clone(),
        };

        match self.repository.insert_folder_item(&new_item) {
            Ok(item) => Ok(item),
            Err(error) => {
                if let Some(image) = snapshot {
                    self.remove_snapshot_files(Some(&image.file_path), Some(&image.metadata));
                }
                Err(error.into())
            }
        }
    }

    pub fn update_folder_item(
        &self,
        id: &str,
        title: &str,
        content: Option<&str>,
        content_type: &str,
    ) -> LibraryServiceResult<FolderItem> {
        let current = self.repository.get_folder_item(id)?;
        let title = normalize_name(title, true)?;

        let (content, content_hash, content_type) = if current.content_type == "IMAGE" {
            if content.is_some() || content_type != "IMAGE" {
                return Err(LibraryServiceError::ImageContentEdit);
            }
            (
                None,
                current.content_hash.clone(),
                current.content_type.clone(),
            )
        } else {
            let content = content.ok_or(LibraryServiceError::EmptyContent)?;
            validate_content(content)?;
            validate_content_type(content_type, false)?;
            (
                Some(content.to_owned()),
                hash_content(content),
                content_type.to_owned(),
            )
        };

        Ok(self.repository.update_folder_item(
            id,
            &title,
            content.as_deref(),
            &content_type,
            &content_hash,
            now(),
        )?)
    }

    pub fn remove_folder_item(&self, id: &str) -> LibraryServiceResult<bool> {
        let Some(item) = self.repository.delete_folder_item(id)? else {
            return Ok(false);
        };
        self.remove_snapshot_files(item.file_path.as_deref(), item.metadata.as_deref());
        Ok(true)
    }

    pub fn reorder_folder_items(
        &self,
        folder_id: &str,
        item_ids: &[String],
    ) -> LibraryServiceResult<Vec<FolderItem>> {
        let _ = self.repository.get_folder(folder_id)?;
        Ok(self.repository.reorder_folder_items(folder_id, item_ids)?)
    }

    pub fn list_personal_items(&self) -> LibraryServiceResult<Vec<PersonalItem>> {
        Ok(self.repository.list_personal_items()?)
    }

    pub fn get_personal_item(&self, id: &str) -> LibraryServiceResult<PersonalItem> {
        Ok(self.repository.get_personal_item(id)?)
    }

    pub fn create_personal_item(
        &self,
        title: &str,
        content: &str,
        content_type: &str,
    ) -> LibraryServiceResult<PersonalItem> {
        let title = normalize_name(title, true)?;
        validate_content(content)?;
        validate_content_type(content_type, false)?;
        let now = now();
        let item = NewPersonalItem {
            id: Uuid::new_v4().to_string(),
            title,
            source_item_id: None,
            content: Some(content.to_owned()),
            content_type: content_type.to_owned(),
            content_hash: hash_content(content),
            source_app: None,
            source_process: None,
            source_window: None,
            created_at: now,
            updated_at: now,
            is_pinned: false,
            file_path: None,
            metadata: None,
            tags: None,
        };
        Ok(self.repository.insert_personal_item(&item)?)
    }

    pub fn update_personal_item(
        &self,
        id: &str,
        title: &str,
        content: Option<&str>,
        content_type: &str,
    ) -> LibraryServiceResult<PersonalItem> {
        let current = self.repository.get_personal_item(id)?;
        let title = normalize_name(title, true)?;

        let (content, content_hash, content_type) = if current.content_type == "IMAGE" {
            if content.is_some() || content_type != "IMAGE" {
                return Err(LibraryServiceError::ImageContentEdit);
            }
            (
                None,
                current.content_hash.clone(),
                current.content_type.clone(),
            )
        } else {
            let content = content.ok_or(LibraryServiceError::EmptyContent)?;
            validate_content(content)?;
            validate_content_type(content_type, false)?;
            (
                Some(content.to_owned()),
                hash_content(content),
                content_type.to_owned(),
            )
        };

        Ok(self.repository.update_personal_item(
            id,
            &title,
            content.as_deref(),
            &content_type,
            &content_hash,
            now(),
        )?)
    }

    pub fn delete_personal_item(&self, id: &str) -> LibraryServiceResult<bool> {
        let Some(item) = self.repository.delete_personal_item(id)? else {
            return Ok(false);
        };
        self.remove_snapshot_files(item.file_path.as_deref(), item.metadata.as_deref());
        Ok(true)
    }

    pub fn reorder_personal_items(
        &self,
        item_ids: &[String],
    ) -> LibraryServiceResult<Vec<PersonalItem>> {
        Ok(self.repository.reorder_personal_items(item_ids)?)
    }

    pub fn add_clipboard_item_to_personal(
        &self,
        source_item_id: &str,
    ) -> LibraryServiceResult<PersonalItem> {
        if let Some(existing) = self
            .repository
            .find_personal_item_by_source(source_item_id)?
        {
            return Ok(existing);
        }

        let source = self.repository.get_by_id(source_item_id)?;
        let snapshot_id = Uuid::new_v4().to_string();
        let snapshot = self.snapshot_image(&snapshot_id, &source)?;
        let item = NewPersonalItem {
            id: snapshot_id,
            title: suggested_title(&source),
            source_item_id: Some(source.id.clone()),
            content: source.content.clone(),
            content_type: source.content_type.clone(),
            content_hash: snapshot
                .as_ref()
                .map(|image| image.content_hash.clone())
                .unwrap_or_else(|| source.content_hash.clone()),
            source_app: source.source_app.clone(),
            source_process: source.source_process.clone(),
            source_window: source.source_window.clone(),
            created_at: source.created_at,
            updated_at: source.updated_at,
            is_pinned: source.is_pinned,
            file_path: snapshot.as_ref().map(|image| image.file_path.clone()),
            metadata: snapshot.as_ref().map(|image| image.metadata.clone()),
            tags: source.tags.clone(),
        };

        match self.repository.insert_personal_item(&item) {
            Ok(item) => Ok(item),
            Err(error) => {
                if let Some(image) = snapshot {
                    self.remove_snapshot_files(Some(&image.file_path), Some(&image.metadata));
                }
                Err(error.into())
            }
        }
    }

    fn snapshot_image(
        &self,
        snapshot_id: &str,
        source: &ClipboardItem,
    ) -> LibraryServiceResult<Option<StoredSnapshotImage>> {
        if source.content_type != "IMAGE" {
            return Ok(None);
        }
        let source_path = source.file_path.as_deref().ok_or_else(|| {
            ImageServiceError::Io(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "image file path is missing",
            ))
        })?;
        let stored = self
            .image_service
            .clone_for_collection(snapshot_id, source_path)?;
        Ok(Some(StoredSnapshotImage {
            file_path: stored.file_path,
            metadata: stored.metadata,
            content_hash: stored.content_hash,
        }))
    }

    fn remove_snapshot_files(&self, file_path: Option<&str>, metadata: Option<&str>) {
        self.image_service.remove_item_files(file_path, metadata);
    }
}

#[derive(Debug, Clone)]
struct StoredSnapshotImage {
    file_path: String,
    metadata: String,
    content_hash: String,
}

fn now() -> i64 {
    Utc::now().timestamp_millis()
}

fn normalize_name(value: &str, title: bool) -> LibraryServiceResult<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(if title {
            LibraryServiceError::EmptyTitle
        } else {
            LibraryServiceError::EmptyFolderName
        });
    }
    if value.chars().count() > MAX_TITLE_CHARACTERS {
        return Err(if title {
            LibraryServiceError::TitleTooLong
        } else {
            LibraryServiceError::FolderNameTooLong
        });
    }
    Ok(value.to_owned())
}

fn validate_content(content: &str) -> LibraryServiceResult<()> {
    if content.is_empty() {
        return Err(LibraryServiceError::EmptyContent);
    }
    if content.len() > MAX_CONTENT_BYTES {
        return Err(LibraryServiceError::ContentTooLarge);
    }
    Ok(())
}

fn validate_content_type(content_type: &str, allow_image: bool) -> LibraryServiceResult<()> {
    let is_valid = matches!(
        content_type,
        "TEXT"
            | "URL"
            | "EMAIL"
            | "IP"
            | "FILE_PATH"
            | "NETWORK_PATH"
            | "CODE"
            | "JSON"
            | "COMMAND"
    ) || (allow_image && content_type == "IMAGE");
    if is_valid {
        Ok(())
    } else {
        Err(LibraryServiceError::UnsupportedContentType)
    }
}

fn hash_content(content: &str) -> String {
    hex::encode(Sha256::digest(content.as_bytes()))
}

fn suggested_title(item: &ClipboardItem) -> String {
    if let Some(name) = item
        .custom_name
        .as_deref()
        .filter(|name| !name.trim().is_empty())
    {
        return name.trim().chars().take(MAX_TITLE_CHARACTERS).collect();
    }
    if item.content_type == "IMAGE" {
        return "保存的圖片".into();
    }
    let content = item.content.as_deref().unwrap_or_default();
    let first_line = content
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("未命名資料");
    let mut title: String = first_line
        .chars()
        .take(MAX_TITLE_CHARACTERS.saturating_sub(1))
        .collect();
    if first_line.chars().count() > MAX_TITLE_CHARACTERS {
        title.push('…');
    }
    title
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::models::NewClipboardItem;
    use crate::services::{
        cleanup_service::CleanupService,
        image_service::ImageService,
        privacy_service::PrivacyService,
        settings_service::{AppSettings, SettingsService},
    };

    fn service() -> (tempfile::TempDir, LibraryService, ClipboardRepository) {
        let directory = tempfile::tempdir().unwrap();
        let repository =
            ClipboardRepository::initialize(directory.path().join("clipboard.db")).unwrap();
        let image_service = ImageService::initialize(directory.path().join("images")).unwrap();
        let settings = SettingsService::initialize(directory.path().join("settings.json")).unwrap();
        let _privacy = PrivacyService::new(settings);
        let library = LibraryService::new(repository.clone(), image_service);
        (directory, library, repository)
    }

    #[test]
    fn creates_and_reorders_persistent_personal_items() {
        let (_directory, library, repository) = service();
        let first = library
            .create_personal_item("第一筆", "one", "TEXT")
            .unwrap();
        let second = library
            .create_personal_item("第二筆", "two", "COMMAND")
            .unwrap();

        let reordered = library
            .reorder_personal_items(&[second.id.clone(), first.id.clone()])
            .unwrap();
        assert_eq!(reordered[0].id, second.id);
        assert_eq!(repository.list_personal_items().unwrap()[1].id, first.id);

        let updated = library
            .update_personal_item(&first.id, "更新後", Some("three"), "TEXT")
            .unwrap();
        assert_eq!(updated.title, "更新後");
        assert_eq!(updated.content.as_deref(), Some("three"));
    }

    #[test]
    fn creates_and_reorders_persistent_folder_items() {
        let (_directory, library, repository) = service();
        for (id, content) in [("history-one", "one"), ("history-two", "two")] {
            repository
                .save_with_consecutive_deduplication(
                    NewClipboardItem {
                        id: id.into(),
                        content: Some(content.into()),
                        content_type: "TEXT".into(),
                        content_hash: format!("hash-{id}"),
                        source_app: None,
                        source_process: None,
                        source_window: None,
                        created_at: 100,
                        file_path: None,
                        metadata: None,
                        tags: None,
                    },
                    0,
                )
                .unwrap();
        }
        let folder = library.create_folder("工作常用").unwrap();
        let first = library
            .add_clipboard_item_to_folder(&folder.id, "history-one")
            .unwrap();
        let second = library
            .add_clipboard_item_to_folder(&folder.id, "history-two")
            .unwrap();

        let reordered = library
            .reorder_folder_items(&folder.id, &[second.id.clone(), first.id.clone()])
            .unwrap();
        assert_eq!(
            reordered
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            [second.id.as_str(), first.id.as_str()]
        );
        assert_eq!(
            repository.list_folder_items(&folder.id).unwrap()[0].id,
            second.id
        );

        let updated = library
            .update_folder_item(&first.id, "第一筆改名", Some("updated"), "TEXT")
            .unwrap();
        assert_eq!(updated.custom_name.as_deref(), Some("第一筆改名"));
        assert_eq!(updated.content.as_deref(), Some("updated"));
    }

    #[test]
    fn saved_collections_survive_history_retention_cleanup() {
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
            })
            .unwrap();
        let old_time = chrono::Utc::now().timestamp_millis() - 8 * 86_400_000;
        repository
            .save_with_consecutive_deduplication(
                NewClipboardItem {
                    id: "expiring-history".into(),
                    content: Some("keep in collections".into()),
                    content_type: "TEXT".into(),
                    content_hash: "keep-in-collections".into(),
                    source_app: Some("Notepad".into()),
                    source_process: None,
                    source_window: None,
                    created_at: old_time,
                    file_path: None,
                    metadata: None,
                    tags: None,
                },
                0,
            )
            .unwrap();

        let library = LibraryService::new(repository.clone(), image_service.clone());
        let folder = library.create_folder("永久保存").unwrap();
        library
            .add_clipboard_item_to_folder(&folder.id, "expiring-history")
            .unwrap();
        library
            .add_clipboard_item_to_personal("expiring-history")
            .unwrap();

        let cleanup = CleanupService::new(repository.clone(), image_service, settings);
        assert_eq!(cleanup.run_once().unwrap(), 1);
        assert!(repository.get_by_id("expiring-history").is_err());
        assert_eq!(library.list_folder_items(&folder.id).unwrap().len(), 1);
        assert_eq!(library.list_personal_items().unwrap().len(), 1);
        assert_eq!(
            library.list_personal_items().unwrap()[0].content.as_deref(),
            Some("keep in collections")
        );
    }

    #[test]
    fn folder_snapshot_survives_history_deletion() {
        let (_directory, library, repository) = service();
        repository
            .save_with_consecutive_deduplication(
                NewClipboardItem {
                    id: "history-item".into(),
                    content: Some("keep this forever".into()),
                    content_type: "TEXT".into(),
                    content_hash: "history-hash".into(),
                    source_app: Some("Notepad".into()),
                    source_process: None,
                    source_window: Some("Notes".into()),
                    created_at: 100,
                    file_path: None,
                    metadata: None,
                    tags: None,
                },
                0,
            )
            .unwrap();
        let folder = library.create_folder("工作常用").unwrap();
        let saved = library
            .add_clipboard_item_to_folder(&folder.id, "history-item")
            .unwrap();

        assert!(repository.delete_item("history-item").unwrap());
        let remaining = library.list_folder_items(&folder.id).unwrap();
        assert_eq!(remaining[0].id, saved.id);
        assert_eq!(remaining[0].content.as_deref(), Some("keep this forever"));
        assert_eq!(remaining[0].source_app.as_deref(), Some("Notepad"));
    }

    #[test]
    fn image_snapshot_has_independent_files() {
        use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
        use std::io::Cursor;

        let directory = tempfile::tempdir().unwrap();
        let repository =
            ClipboardRepository::initialize(directory.path().join("clipboard.db")).unwrap();
        let image_service = ImageService::initialize(directory.path().join("images")).unwrap();
        let settings = SettingsService::initialize(directory.path().join("settings.json")).unwrap();
        let _privacy = PrivacyService::new(settings);
        let library = LibraryService::new(repository.clone(), image_service.clone());

        let image =
            DynamicImage::ImageRgba8(RgbaImage::from_pixel(32, 24, Rgba([40, 80, 120, 255])));
        let mut bitmap = Cursor::new(Vec::new());
        image.write_to(&mut bitmap, ImageFormat::Bmp).unwrap();
        let stored = image_service
            .store_bitmap("history-image", &bitmap.into_inner())
            .unwrap();
        repository
            .save_with_consecutive_deduplication(
                NewClipboardItem {
                    id: "history-image".into(),
                    content: None,
                    content_type: "IMAGE".into(),
                    content_hash: stored.content_hash,
                    source_app: Some("Paint".into()),
                    source_process: None,
                    source_window: None,
                    created_at: 100,
                    file_path: Some(stored.file_path.clone()),
                    metadata: Some(stored.metadata.clone()),
                    tags: None,
                },
                0,
            )
            .unwrap();

        let folder = library.create_folder("圖片保存").unwrap();
        let saved = library
            .add_clipboard_item_to_folder(&folder.id, "history-image")
            .unwrap();
        let saved_path = saved.file_path.clone().unwrap();
        let saved_metadata = saved.metadata.clone().unwrap();

        assert_ne!(saved_path, stored.file_path);
        assert!(std::path::Path::new(&saved_path).exists());
        repository.delete_item("history-image").unwrap();
        image_service.remove_item_files(Some(&stored.file_path), Some(&stored.metadata));
        assert!(!std::path::Path::new(&stored.file_path).exists());
        assert!(std::path::Path::new(&saved_path).exists());

        library.delete_folder(&folder.id).unwrap();
        assert!(!std::path::Path::new(&saved_path).exists());
        let metadata: super::super::image_service::ImageMetadata =
            serde_json::from_str(&saved_metadata).unwrap();
        assert!(!std::path::Path::new(&metadata.thumbnail_path).exists());
    }
}
