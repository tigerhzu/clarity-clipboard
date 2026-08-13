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
}
