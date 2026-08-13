use std::{
    fs,
    path::{Path, PathBuf},
};

use rusqlite::{params, Connection, Row, Transaction};

use super::{
    migrations,
    models::{ClipboardItem, NewClipboardItem, SaveDisposition, SaveResult, SearchCriteria},
};

#[derive(Debug, thiserror::Error)]
pub enum RepositoryError {
    #[error("failed to create application data directory: {0}")]
    Io(#[from] std::io::Error),
    #[error("clipboard database error: {0}")]
    Database(#[from] rusqlite::Error),
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
            LIMIT ?8
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
                ],
                map_clipboard_item,
            )?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(items)
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
                    "UPDATE clipboard_items SET created_at = ?1, updated_at = ?1 WHERE id = ?2",
                    params![item.created_at, latest.id],
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
