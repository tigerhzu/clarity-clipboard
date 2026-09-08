use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardItem {
    pub id: String,
    pub content: Option<String>,
    pub content_type: String,
    pub content_hash: String,
    pub source_app: Option<String>,
    pub source_process: Option<String>,
    pub source_window: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub is_pinned: bool,
    pub custom_name: Option<String>,
    pub file_path: Option<String>,
    pub metadata: Option<String>,
    pub tags: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub sort_order: i64,
    pub item_count: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FolderItem {
    pub id: String,
    pub folder_id: String,
    pub source_item_id: Option<String>,
    pub content: Option<String>,
    pub content_type: String,
    pub content_hash: String,
    pub source_app: Option<String>,
    pub source_process: Option<String>,
    pub source_window: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub is_pinned: bool,
    pub custom_name: Option<String>,
    pub file_path: Option<String>,
    pub metadata: Option<String>,
    pub tags: Option<String>,
    pub sort_order: i64,
}

impl FolderItem {
    pub fn as_clipboard_item(&self) -> ClipboardItem {
        ClipboardItem {
            id: self.id.clone(),
            content: self.content.clone(),
            content_type: self.content_type.clone(),
            content_hash: self.content_hash.clone(),
            source_app: self.source_app.clone(),
            source_process: self.source_process.clone(),
            source_window: self.source_window.clone(),
            created_at: self.created_at,
            updated_at: self.updated_at,
            is_pinned: self.is_pinned,
            custom_name: self.custom_name.clone(),
            file_path: self.file_path.clone(),
            metadata: self.metadata.clone(),
            tags: self.tags.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct NewFolderItem {
    pub id: String,
    pub folder_id: String,
    pub source_item_id: Option<String>,
    pub content: Option<String>,
    pub content_type: String,
    pub content_hash: String,
    pub source_app: Option<String>,
    pub source_process: Option<String>,
    pub source_window: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub is_pinned: bool,
    pub custom_name: Option<String>,
    pub file_path: Option<String>,
    pub metadata: Option<String>,
    pub tags: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PersonalItem {
    pub id: String,
    pub title: String,
    pub custom_name: Option<String>,
    pub source_item_id: Option<String>,
    pub content: Option<String>,
    pub content_type: String,
    pub content_hash: String,
    pub source_app: Option<String>,
    pub source_process: Option<String>,
    pub source_window: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub is_pinned: bool,
    pub file_path: Option<String>,
    pub metadata: Option<String>,
    pub tags: Option<String>,
    pub sort_order: i64,
}

impl PersonalItem {
    pub fn as_clipboard_item(&self) -> ClipboardItem {
        ClipboardItem {
            id: self.id.clone(),
            content: self.content.clone(),
            content_type: self.content_type.clone(),
            content_hash: self.content_hash.clone(),
            source_app: self.source_app.clone(),
            source_process: self.source_process.clone(),
            source_window: self.source_window.clone(),
            created_at: self.created_at,
            updated_at: self.updated_at,
            is_pinned: self.is_pinned,
            custom_name: Some(self.title.clone()),
            file_path: self.file_path.clone(),
            metadata: self.metadata.clone(),
            tags: self.tags.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct NewPersonalItem {
    pub id: String,
    pub title: String,
    pub source_item_id: Option<String>,
    pub content: Option<String>,
    pub content_type: String,
    pub content_hash: String,
    pub source_app: Option<String>,
    pub source_process: Option<String>,
    pub source_window: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub is_pinned: bool,
    pub file_path: Option<String>,
    pub metadata: Option<String>,
    pub tags: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewClipboardItem {
    pub id: String,
    pub content: Option<String>,
    pub content_type: String,
    pub content_hash: String,
    pub source_app: Option<String>,
    pub source_process: Option<String>,
    pub source_window: Option<String>,
    pub created_at: i64,
    pub file_path: Option<String>,
    pub metadata: Option<String>,
    pub tags: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SaveDisposition {
    Inserted,
    RefreshedDuplicate,
}

#[derive(Debug, Clone)]
pub struct SaveResult {
    pub item: ClipboardItem,
    pub disposition: SaveDisposition,
}

#[derive(Debug, Clone)]
pub struct SearchCriteria {
    pub query: String,
    pub like_pattern: String,
    pub starts_with_pattern: String,
    pub fts_query: String,
    pub filter: String,
    pub start_ms: Option<i64>,
    pub end_ms: Option<i64>,
    pub limit: usize,
    pub offset: usize,
}
