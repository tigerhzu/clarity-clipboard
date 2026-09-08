use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};

use super::{
    migrations,
    models::{
        ClipboardItem, Folder, FolderItem, NewClipboardItem, NewFolderItem, NewPersonalItem,
        PersonalItem, SaveDisposition, SaveResult, SearchCriteria,
    },
};

#[derive(Debug, thiserror::Error)]
pub enum RepositoryError {
    #[error("failed to create application data directory: {0}")]
    Io(#[from] std::io::Error),
    #[error("clipboard database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("invalid collection item order")]
    InvalidOrder,
}

pub type RepositoryResult<T> = Result<T, RepositoryError>;

#[derive(Debug, Clone)]
pub struct ClipboardRepository {
    database_path: PathBuf,
}

impl ClipboardRepository {
    pub fn initialize(database_path: impl AsRef<Path>) -> RepositoryResult<Self> {
        let database_path = database_path.as_ref().to_path_buf();
        if let Some(parent) = database_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let connection = Connection::open(&database_path)?;
        migrations::run(&connection)?;

        Ok(Self { database_path })
    }

    fn open(&self) -> RepositoryResult<Connection> {
        let connection = Connection::open(&self.database_path)?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.busy_timeout(std::time::Duration::from_secs(2))?;
        Ok(connection)
    }

    #[cfg(test)]
    pub fn list_recent(&self, limit: usize) -> RepositoryResult<Vec<ClipboardItem>> {
        let connection = self.open()?;
        let mut statement = connection.prepare(
            r#"
            SELECT id, content, content_type, content_hash,
                   source_app, source_process, source_window,
                   created_at, updated_at, is_pinned, custom_name,
                   file_path, metadata, tags
            FROM clipboard_items
            ORDER BY created_at DESC
            LIMIT ?1
            "#,
        )?;

        let items = statement
            .query_map([limit.clamp(1, 1_000) as i64], map_clipboard_item)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(items)
    }

    pub fn search(&self, criteria: &SearchCriteria) -> RepositoryResult<Vec<ClipboardItem>> {
        let connection = self.open()?;
        let mut statement = connection.prepare(
            r#"
            SELECT i.id, i.content, i.content_type, i.content_hash,
                   i.source_app, i.source_process, i.source_window,
                   i.created_at, i.updated_at, i.is_pinned, i.custom_name,
                   i.file_path, i.metadata, i.tags
            FROM clipboard_items i
            WHERE (
                ?1 = ''
                OR i.id IN (
                    SELECT item_id FROM clipboard_items_fts
                    WHERE clipboard_items_fts MATCH ?4
                )
                OR lower(COALESCE(i.content, '')) LIKE ?2 ESCAPE '\'
                OR lower(COALESCE(i.source_app, '')) LIKE ?2 ESCAPE '\'
                OR lower(i.content_type) LIKE ?2 ESCAPE '\'
                OR lower(COALESCE(i.tags, '')) LIKE ?2 ESCAPE '\'
            )
            AND (
                ?5 = 'ALL'
                OR (?5 = 'PINNED' AND i.is_pinned = 1)
                OR (?5 = 'TEXT' AND i.content_type = 'TEXT')
                OR (?5 = 'LINKS' AND i.content_type = 'URL')
                OR (?5 = 'IMAGES' AND i.content_type = 'IMAGE')
                OR (?5 = 'CODE' AND i.content_type IN ('CODE', 'JSON', 'COMMAND'))
                OR (?5 = 'PATHS' AND i.content_type IN ('FILE_PATH', 'NETWORK_PATH'))
                OR (?5 = 'EMAIL' AND i.content_type = 'EMAIL')
                OR (?5 = 'IP' AND i.content_type = 'IP')
            )
            AND (?6 IS NULL OR i.created_at >= ?6)
            AND (?7 IS NULL OR i.created_at < ?7)
            ORDER BY
                CASE
                    WHEN ?1 = '' THEN 0
                    WHEN lower(COALESCE(i.custom_name, '')) = ?1 THEN 700
                    WHEN lower(COALESCE(i.content, '')) = ?1 THEN 650
                    WHEN lower(COALESCE(i.content, '')) LIKE ?3 ESCAPE '\' THEN 520
                    WHEN lower(COALESCE(i.content, '')) LIKE ?2 ESCAPE '\' THEN 430
                    WHEN lower(COALESCE(i.source_app, '')) LIKE ?2 ESCAPE '\' THEN 300
                    WHEN lower(i.content_type) LIKE ?2 ESCAPE '\' THEN 240
                    WHEN lower(COALESCE(i.tags, '')) LIKE ?2 ESCAPE '\' THEN 220
                    ELSE 150
                END DESC,
                i.is_pinned DESC,
                i.created_at DESC
            LIMIT ?8 OFFSET ?9
            "#,
        )?;

        let items = statement
            .query_map(
                params![
                    criteria.query,
                    criteria.like_pattern,
                    criteria.starts_with_pattern,
                    criteria.fts_query,
                    criteria.filter,
                    criteria.start_ms,
                    criteria.end_ms,
                    criteria.limit.clamp(1, 1_000) as i64,
                    criteria.offset.min(100_000) as i64,
                ],
                map_clipboard_item,
            )?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(items)
    }

    pub fn count(&self, criteria: &SearchCriteria) -> RepositoryResult<usize> {
        let connection = self.open()?;
        let mut statement = connection.prepare(
            r#"
            SELECT COUNT(*)
            FROM clipboard_items i
            WHERE (
                ?1 = ''
                OR i.id IN (
                    SELECT item_id FROM clipboard_items_fts
                    WHERE clipboard_items_fts MATCH ?4
                )
                OR lower(COALESCE(i.content, '')) LIKE ?2 ESCAPE '\'
                OR lower(COALESCE(i.source_app, '')) LIKE ?2 ESCAPE '\'
                OR lower(i.content_type) LIKE ?2 ESCAPE '\'
                OR lower(COALESCE(i.tags, '')) LIKE ?2 ESCAPE '\'
            )
            AND (
                ?5 = 'ALL'
                OR (?5 = 'PINNED' AND i.is_pinned = 1)
                OR (?5 = 'TEXT' AND i.content_type = 'TEXT')
                OR (?5 = 'LINKS' AND i.content_type = 'URL')
                OR (?5 = 'IMAGES' AND i.content_type = 'IMAGE')
                OR (?5 = 'CODE' AND i.content_type IN ('CODE', 'JSON', 'COMMAND'))
                OR (?5 = 'PATHS' AND i.content_type IN ('FILE_PATH', 'NETWORK_PATH'))
                OR (?5 = 'EMAIL' AND i.content_type = 'EMAIL')
                OR (?5 = 'IP' AND i.content_type = 'IP')
            )
            AND (?6 IS NULL OR i.created_at >= ?6)
            AND (?7 IS NULL OR i.created_at < ?7)
            "#,
        )?;

        let total = statement.query_row(
            params![
                criteria.query,
                criteria.like_pattern,
                criteria.starts_with_pattern,
                criteria.fts_query,
                criteria.filter,
                criteria.start_ms,
                criteria.end_ms,
            ],
            |row| row.get::<_, i64>(0),
        )?;
        Ok(usize::try_from(total).unwrap_or(0))
    }

    pub fn get_by_id(&self, id: &str) -> RepositoryResult<ClipboardItem> {
        let connection = self.open()?;
        Ok(connection.query_row(
            r#"
            SELECT id, content, content_type, content_hash,
                   source_app, source_process, source_window,
                   created_at, updated_at, is_pinned, custom_name,
                   file_path, metadata, tags
            FROM clipboard_items
            WHERE id = ?1
            "#,
            [id],
            map_clipboard_item,
        )?)
    }

    pub fn toggle_pin(&self, id: &str) -> RepositoryResult<ClipboardItem> {
        let mut connection = self.open()?;
        let transaction = connection.transaction()?;
        let changed = transaction.execute(
            "UPDATE clipboard_items SET is_pinned = CASE is_pinned WHEN 0 THEN 1 ELSE 0 END, updated_at = ?1 WHERE id = ?2",
            params![chrono::Utc::now().timestamp_millis(), id],
        )?;
        if changed == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows.into());
        }
        let item = find_by_id_tx(&transaction, id)?;
        transaction.commit()?;
        Ok(item)
    }

    pub fn delete_item(&self, id: &str) -> RepositoryResult<bool> {
        let connection = self.open()?;
        Ok(connection.execute("DELETE FROM clipboard_items WHERE id = ?1", [id])? > 0)
    }

    pub fn delete_expired_unpinned(&self, cutoff_ms: i64) -> RepositoryResult<Vec<ClipboardItem>> {
        let mut connection = self.open()?;
        let transaction = connection.transaction()?;
        let expired = {
            let mut statement = transaction.prepare(
                r#"
                SELECT id, content, content_type, content_hash,
                       source_app, source_process, source_window,
                       created_at, updated_at, is_pinned, custom_name,
                       file_path, metadata, tags
                FROM clipboard_items
                WHERE is_pinned = 0 AND created_at < ?1
                "#,
            )?;
            let items = statement
                .query_map([cutoff_ms], map_clipboard_item)?
                .collect::<Result<Vec<_>, _>>()?;
            items
        };
        transaction.execute(
            "DELETE FROM clipboard_items WHERE is_pinned = 0 AND created_at < ?1",
            [cutoff_ms],
        )?;
        transaction.commit()?;
        Ok(expired)
    }

    pub fn text_items_for_reclassification(&self) -> RepositoryResult<Vec<(String, String)>> {
        let connection = self.open()?;
        let mut statement = connection.prepare(
            "SELECT id, content FROM clipboard_items WHERE content_type = 'TEXT' AND content IS NOT NULL",
        )?;
        let items = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(items)
    }

    pub fn update_content_types(&self, updates: &[(String, String)]) -> RepositoryResult<usize> {
        if updates.is_empty() {
            return Ok(0);
        }

        let mut connection = self.open()?;
        let transaction = connection.transaction()?;
        let changed = {
            let mut statement = transaction.prepare(
                "UPDATE clipboard_items SET content_type = ?1, updated_at = updated_at WHERE id = ?2 AND content_type = 'TEXT'",
            )?;
            let mut changed = 0;
            for (id, content_type) in updates {
                changed += statement.execute(params![content_type, id])?;
            }
            changed
        };
        transaction.commit()?;
        Ok(changed)
    }

    pub fn save_with_consecutive_deduplication(
        &self,
        item: NewClipboardItem,
        dedupe_window_ms: i64,
    ) -> RepositoryResult<SaveResult> {
        let mut connection = self.open()?;
        let transaction = connection.transaction()?;

        let latest = latest_item(&transaction)?;
        if let Some(latest) = latest {
            let within_window =
                item.created_at.saturating_sub(latest.created_at) <= dedupe_window_ms;
            if latest.content_hash == item.content_hash && within_window {
                transaction.execute(
                    "UPDATE clipboard_items SET created_at = ?1, updated_at = ?1, source_app = ?3, source_process = ?4, source_window = ?5 WHERE id = ?2",
                    params![
                        item.created_at,
                        latest.id,
                        item.source_app,
                        item.source_process,
                        item.source_window,
                    ],
                )?;
                let refreshed = find_by_id_tx(&transaction, &latest.id)?;
                transaction.commit()?;
                return Ok(SaveResult {
                    item: refreshed,
                    disposition: SaveDisposition::RefreshedDuplicate,
                });
            }
        }

        transaction.execute(
            r#"
            INSERT INTO clipboard_items (
                id, content, content_type, content_hash,
                source_app, source_process, source_window,
                created_at, updated_at, is_pinned, custom_name,
                file_path, metadata, tags
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7,
                ?8, ?8, 0, NULL, ?9, ?10, ?11
            )
            "#,
            params![
                item.id,
                item.content,
                item.content_type,
                item.content_hash,
                item.source_app,
                item.source_process,
                item.source_window,
                item.created_at,
                item.file_path,
                item.metadata,
                item.tags,
            ],
        )?;

        let inserted = find_by_id_tx(&transaction, &item.id)?;
        transaction.commit()?;
        Ok(SaveResult {
            item: inserted,
            disposition: SaveDisposition::Inserted,
        })
    }

    pub fn list_folders(&self) -> RepositoryResult<Vec<Folder>> {
        let connection = self.open()?;
        let mut statement = connection.prepare(
            r#"
            SELECT f.id, f.name, f.created_at, f.updated_at, f.sort_order,
                   (SELECT COUNT(*) FROM folder_items i WHERE i.folder_id = f.id)
            FROM folders f
            ORDER BY f.sort_order ASC, f.created_at ASC
            "#,
        )?;
        let folders = statement
            .query_map([], map_folder)
            .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())?;
        Ok(folders)
    }

    pub fn get_folder(&self, id: &str) -> RepositoryResult<Folder> {
        let connection = self.open()?;
        Ok(connection.query_row(
            r#"
            SELECT f.id, f.name, f.created_at, f.updated_at, f.sort_order,
                   (SELECT COUNT(*) FROM folder_items i WHERE i.folder_id = f.id)
            FROM folders f
            WHERE f.id = ?1
            "#,
            [id],
            map_folder,
        )?)
    }

    pub fn create_folder(&self, id: &str, name: &str, now: i64) -> RepositoryResult<Folder> {
        let connection = self.open()?;
        connection.execute(
            r#"
            INSERT INTO folders (id, name, created_at, updated_at, sort_order)
            VALUES (
                ?1, ?2, ?3, ?3,
                COALESCE((SELECT MAX(sort_order) + 1 FROM folders), 0)
            )
            "#,
            params![id, name, now],
        )?;
        Ok(connection.query_row(
            r#"
            SELECT f.id, f.name, f.created_at, f.updated_at, f.sort_order,
                   (SELECT COUNT(*) FROM folder_items i WHERE i.folder_id = f.id)
            FROM folders f
            WHERE f.id = ?1
            "#,
            [id],
            map_folder,
        )?)
    }

    pub fn rename_folder(&self, id: &str, name: &str, now: i64) -> RepositoryResult<Folder> {
        let connection = self.open()?;
        let changed = connection.execute(
            "UPDATE folders SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![name, now, id],
        )?;
        if changed == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows.into());
        }
        Ok(connection.query_row(
            r#"
            SELECT f.id, f.name, f.created_at, f.updated_at, f.sort_order,
                   (SELECT COUNT(*) FROM folder_items i WHERE i.folder_id = f.id)
            FROM folders f
            WHERE f.id = ?1
            "#,
            [id],
            map_folder,
        )?)
    }

    pub fn delete_folder(&self, id: &str) -> RepositoryResult<Vec<FolderItem>> {
        let mut connection = self.open()?;
        let transaction = connection.transaction()?;
        let items = {
            let mut statement = transaction.prepare(
                r#"
                SELECT id, folder_id, source_item_id, content, content_type, content_hash,
                       source_app, source_process, source_window, created_at, updated_at,
                       is_pinned, custom_name, file_path, metadata, tags, sort_order
                FROM folder_items
                WHERE folder_id = ?1
                ORDER BY sort_order ASC, created_at ASC
                "#,
            )?;
            statement
                .query_map([id], map_folder_item)
                .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())?
        };
        let deleted = transaction.execute("DELETE FROM folders WHERE id = ?1", [id])?;
        if deleted == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows.into());
        }
        transaction.commit()?;
        Ok(items)
    }

    pub fn list_folder_items(&self, folder_id: &str) -> RepositoryResult<Vec<FolderItem>> {
        let connection = self.open()?;
        let mut statement = connection.prepare(
            r#"
            SELECT id, folder_id, source_item_id, content, content_type, content_hash,
                   source_app, source_process, source_window, created_at, updated_at,
                   is_pinned, custom_name, file_path, metadata, tags, sort_order
            FROM folder_items
            WHERE folder_id = ?1
            ORDER BY sort_order ASC, created_at ASC
            "#,
        )?;
        let items = statement
            .query_map([folder_id], map_folder_item)
            .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())?;
        Ok(items)
    }

    pub fn get_folder_item(&self, id: &str) -> RepositoryResult<FolderItem> {
        let connection = self.open()?;
        Ok(connection.query_row(
            r#"
            SELECT id, folder_id, source_item_id, content, content_type, content_hash,
                   source_app, source_process, source_window, created_at, updated_at,
                   is_pinned, custom_name, file_path, metadata, tags, sort_order
            FROM folder_items
            WHERE id = ?1
            "#,
            [id],
            map_folder_item,
        )?)
    }

    pub fn find_folder_item_by_source(
        &self,
        folder_id: &str,
        source_item_id: &str,
    ) -> RepositoryResult<Option<FolderItem>> {
        let connection = self.open()?;
        Ok(connection
            .query_row(
                r#"
                SELECT id, folder_id, source_item_id, content, content_type, content_hash,
                       source_app, source_process, source_window, created_at, updated_at,
                       is_pinned, custom_name, file_path, metadata, tags, sort_order
                FROM folder_items
                WHERE folder_id = ?1 AND source_item_id = ?2
                LIMIT 1
                "#,
                params![folder_id, source_item_id],
                map_folder_item,
            )
            .optional()?)
    }

    pub fn insert_folder_item(&self, item: &NewFolderItem) -> RepositoryResult<FolderItem> {
        let connection = self.open()?;
        connection.execute(
            r#"
            INSERT INTO folder_items (
                id, folder_id, source_item_id, content, content_type, content_hash,
                source_app, source_process, source_window, created_at, updated_at,
                is_pinned, custom_name, file_path, metadata, tags, sort_order
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                ?12, ?13, ?14, ?15, ?16,
                COALESCE((SELECT MAX(sort_order) + 1 FROM folder_items WHERE folder_id = ?2), 0)
            )
            "#,
            params![
                item.id,
                item.folder_id,
                item.source_item_id,
                item.content,
                item.content_type,
                item.content_hash,
                item.source_app,
                item.source_process,
                item.source_window,
                item.created_at,
                item.updated_at,
                item.is_pinned,
                item.custom_name,
                item.file_path,
                item.metadata,
                item.tags,
            ],
        )?;
        Ok(connection.query_row(
            r#"
            SELECT id, folder_id, source_item_id, content, content_type, content_hash,
                   source_app, source_process, source_window, created_at, updated_at,
                   is_pinned, custom_name, file_path, metadata, tags, sort_order
            FROM folder_items
            WHERE id = ?1
            "#,
            [&item.id],
            map_folder_item,
        )?)
    }

    pub fn update_folder_item(
        &self,
        id: &str,
        custom_name: &str,
        content: Option<&str>,
        content_type: &str,
        content_hash: &str,
        now: i64,
    ) -> RepositoryResult<FolderItem> {
        let connection = self.open()?;
        let changed = connection.execute(
            r#"
            UPDATE folder_items
            SET custom_name = ?1, content = ?2, content_type = ?3,
                content_hash = ?4, updated_at = ?5
            WHERE id = ?6
            "#,
            params![custom_name, content, content_type, content_hash, now, id],
        )?;
        if changed == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows.into());
        }
        Ok(connection.query_row(
            r#"
            SELECT id, folder_id, source_item_id, content, content_type, content_hash,
                   source_app, source_process, source_window, created_at, updated_at,
                   is_pinned, custom_name, file_path, metadata, tags, sort_order
            FROM folder_items
            WHERE id = ?1
            "#,
            [id],
            map_folder_item,
        )?)
    }

    pub fn delete_folder_item(&self, id: &str) -> RepositoryResult<Option<FolderItem>> {
        let mut connection = self.open()?;
        let transaction = connection.transaction()?;
        let item = transaction
            .query_row(
                r#"
                SELECT id, folder_id, source_item_id, content, content_type, content_hash,
                       source_app, source_process, source_window, created_at, updated_at,
                       is_pinned, custom_name, file_path, metadata, tags, sort_order
                FROM folder_items
                WHERE id = ?1
                "#,
                [id],
                map_folder_item,
            )
            .optional()?;
        if item.is_none() {
            transaction.commit()?;
            return Ok(None);
        }
        transaction.execute("DELETE FROM folder_items WHERE id = ?1", [id])?;
        transaction.commit()?;
        Ok(item)
    }

    pub fn reorder_folder_items(
        &self,
        folder_id: &str,
        item_ids: &[String],
    ) -> RepositoryResult<Vec<FolderItem>> {
        let mut connection = self.open()?;
        let transaction = connection.transaction()?;
        let total = transaction.query_row(
            "SELECT COUNT(*) FROM folder_items WHERE folder_id = ?1",
            [folder_id],
            |row| row.get::<_, i64>(0),
        )?;
        if usize::try_from(total).unwrap_or(0) != item_ids.len() {
            return Err(RepositoryError::InvalidOrder);
        }
        let mut seen = HashSet::with_capacity(item_ids.len());
        for (sort_order, item_id) in item_ids.iter().enumerate() {
            if !seen.insert(item_id) {
                return Err(RepositoryError::InvalidOrder);
            }
            let changed = transaction.execute(
                "UPDATE folder_items SET sort_order = ?1 WHERE id = ?2 AND folder_id = ?3",
                params![sort_order as i64, item_id, folder_id],
            )?;
            if changed != 1 {
                return Err(RepositoryError::InvalidOrder);
            }
        }
        transaction.commit()?;
        Ok(self.list_folder_items(folder_id)?)
    }

    pub fn list_personal_items(&self) -> RepositoryResult<Vec<PersonalItem>> {
        let connection = self.open()?;
        let mut statement = connection.prepare(
            r#"
            SELECT id, title, source_item_id, content, content_type, content_hash,
                   source_app, source_process, source_window, created_at, updated_at,
                   is_pinned, file_path, metadata, tags, sort_order
            FROM personal_items
            ORDER BY sort_order ASC, created_at ASC
            "#,
        )?;
        let items = statement
            .query_map([], map_personal_item)
            .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())?;
        Ok(items)
    }

    pub fn get_personal_item(&self, id: &str) -> RepositoryResult<PersonalItem> {
        let connection = self.open()?;
        Ok(connection.query_row(
            r#"
            SELECT id, title, source_item_id, content, content_type, content_hash,
                   source_app, source_process, source_window, created_at, updated_at,
                   is_pinned, file_path, metadata, tags, sort_order
            FROM personal_items
            WHERE id = ?1
            "#,
            [id],
            map_personal_item,
        )?)
    }

    pub fn find_personal_item_by_source(
        &self,
        source_item_id: &str,
    ) -> RepositoryResult<Option<PersonalItem>> {
        let connection = self.open()?;
        Ok(connection
            .query_row(
                r#"
                SELECT id, title, source_item_id, content, content_type, content_hash,
                       source_app, source_process, source_window, created_at, updated_at,
                       is_pinned, file_path, metadata, tags, sort_order
                FROM personal_items
                WHERE source_item_id = ?1
                LIMIT 1
                "#,
                [source_item_id],
                map_personal_item,
            )
            .optional()?)
    }

    pub fn insert_personal_item(&self, item: &NewPersonalItem) -> RepositoryResult<PersonalItem> {
        let connection = self.open()?;
        connection.execute(
            r#"
            INSERT INTO personal_items (
                id, title, source_item_id, content, content_type, content_hash,
                source_app, source_process, source_window, created_at, updated_at,
                is_pinned, file_path, metadata, tags, sort_order
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                ?12, ?13, ?14, ?15,
                COALESCE((SELECT MAX(sort_order) + 1 FROM personal_items), 0)
            )
            "#,
            params![
                item.id,
                item.title,
                item.source_item_id,
                item.content,
                item.content_type,
                item.content_hash,
                item.source_app,
                item.source_process,
                item.source_window,
                item.created_at,
                item.updated_at,
                item.is_pinned,
                item.file_path,
                item.metadata,
                item.tags,
            ],
        )?;
        Ok(connection.query_row(
            r#"
            SELECT id, title, source_item_id, content, content_type, content_hash,
                   source_app, source_process, source_window, created_at, updated_at,
                   is_pinned, file_path, metadata, tags, sort_order
            FROM personal_items
            WHERE id = ?1
            "#,
            [&item.id],
            map_personal_item,
        )?)
    }

    pub fn update_personal_item(
        &self,
        id: &str,
        title: &str,
        content: Option<&str>,
        content_type: &str,
        content_hash: &str,
        now: i64,
    ) -> RepositoryResult<PersonalItem> {
        let connection = self.open()?;
        let changed = connection.execute(
            r#"
            UPDATE personal_items
            SET title = ?1, content = ?2, content_type = ?3,
                content_hash = ?4, updated_at = ?5
            WHERE id = ?6
            "#,
            params![title, content, content_type, content_hash, now, id],
        )?;
        if changed == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows.into());
        }
        Ok(connection.query_row(
            r#"
            SELECT id, title, source_item_id, content, content_type, content_hash,
                   source_app, source_process, source_window, created_at, updated_at,
                   is_pinned, file_path, metadata, tags, sort_order
            FROM personal_items
            WHERE id = ?1
            "#,
            [id],
            map_personal_item,
        )?)
    }

    pub fn delete_personal_item(&self, id: &str) -> RepositoryResult<Option<PersonalItem>> {
        let mut connection = self.open()?;
        let transaction = connection.transaction()?;
        let item = transaction
            .query_row(
                r#"
                SELECT id, title, source_item_id, content, content_type, content_hash,
                       source_app, source_process, source_window, created_at, updated_at,
                       is_pinned, file_path, metadata, tags, sort_order
                FROM personal_items
                WHERE id = ?1
                "#,
                [id],
                map_personal_item,
            )
            .optional()?;
        if item.is_none() {
            transaction.commit()?;
            return Ok(None);
        }
        transaction.execute("DELETE FROM personal_items WHERE id = ?1", [id])?;
        transaction.commit()?;
        Ok(item)
    }

    pub fn reorder_personal_items(
        &self,
        item_ids: &[String],
    ) -> RepositoryResult<Vec<PersonalItem>> {
        let mut connection = self.open()?;
        let transaction = connection.transaction()?;
        let total = transaction.query_row("SELECT COUNT(*) FROM personal_items", [], |row| {
            row.get::<_, i64>(0)
        })?;
        if usize::try_from(total).unwrap_or(0) != item_ids.len() {
            return Err(RepositoryError::InvalidOrder);
        }
        let mut seen = HashSet::with_capacity(item_ids.len());
        for (sort_order, item_id) in item_ids.iter().enumerate() {
            if !seen.insert(item_id) {
                return Err(RepositoryError::InvalidOrder);
            }
            let changed = transaction.execute(
                "UPDATE personal_items SET sort_order = ?1 WHERE id = ?2",
                params![sort_order as i64, item_id],
            )?;
            if changed != 1 {
                return Err(RepositoryError::InvalidOrder);
            }
        }
        transaction.commit()?;
        Ok(self.list_personal_items()?)
    }
}

fn latest_item(transaction: &Transaction<'_>) -> rusqlite::Result<Option<ClipboardItem>> {
    let mut statement = transaction.prepare(
        r#"
        SELECT id, content, content_type, content_hash,
               source_app, source_process, source_window,
               created_at, updated_at, is_pinned, custom_name,
               file_path, metadata, tags
        FROM clipboard_items
        ORDER BY created_at DESC
        LIMIT 1
        "#,
    )?;
    let mut rows = statement.query([])?;
    rows.next()?.map(map_clipboard_item).transpose()
}

fn find_by_id_tx(transaction: &Transaction<'_>, id: &str) -> rusqlite::Result<ClipboardItem> {
    transaction.query_row(
        r#"
        SELECT id, content, content_type, content_hash,
               source_app, source_process, source_window,
               created_at, updated_at, is_pinned, custom_name,
               file_path, metadata, tags
        FROM clipboard_items
        WHERE id = ?1
        "#,
        [id],
        map_clipboard_item,
    )
}

fn map_clipboard_item(row: &Row<'_>) -> rusqlite::Result<ClipboardItem> {
    Ok(ClipboardItem {
        id: row.get(0)?,
        content: row.get(1)?,
        content_type: row.get(2)?,
        content_hash: row.get(3)?,
        source_app: row.get(4)?,
        source_process: row.get(5)?,
        source_window: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        is_pinned: row.get(9)?,
        custom_name: row.get(10)?,
        file_path: row.get(11)?,
        metadata: row.get(12)?,
        tags: row.get(13)?,
    })
}

fn map_folder(row: &Row<'_>) -> rusqlite::Result<Folder> {
    Ok(Folder {
        id: row.get(0)?,
        name: row.get(1)?,
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
        sort_order: row.get(4)?,
        item_count: usize::try_from(row.get::<_, i64>(5)?).unwrap_or(0),
    })
}

fn map_folder_item(row: &Row<'_>) -> rusqlite::Result<FolderItem> {
    Ok(FolderItem {
        id: row.get(0)?,
        folder_id: row.get(1)?,
        source_item_id: row.get(2)?,
        content: row.get(3)?,
        content_type: row.get(4)?,
        content_hash: row.get(5)?,
        source_app: row.get(6)?,
        source_process: row.get(7)?,
        source_window: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        is_pinned: row.get(11)?,
        custom_name: row.get(12)?,
        file_path: row.get(13)?,
        metadata: row.get(14)?,
        tags: row.get(15)?,
        sort_order: row.get(16)?,
    })
}

fn map_personal_item(row: &Row<'_>) -> rusqlite::Result<PersonalItem> {
    Ok(PersonalItem {
        id: row.get(0)?,
        title: row.get(1)?,
        custom_name: Some(row.get::<_, String>(1)?),
        source_item_id: row.get(2)?,
        content: row.get(3)?,
        content_type: row.get(4)?,
        content_hash: row.get(5)?,
        source_app: row.get(6)?,
        source_process: row.get(7)?,
        source_window: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        is_pinned: row.get(11)?,
        file_path: row.get(12)?,
        metadata: row.get(13)?,
        tags: row.get(14)?,
        sort_order: row.get(15)?,
    })
}
