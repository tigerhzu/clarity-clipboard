use rusqlite::Connection;

pub fn run(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        PRAGMA synchronous = NORMAL;

        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS clipboard_items (
            id TEXT PRIMARY KEY NOT NULL,
            content TEXT,
            content_type TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            source_app TEXT,
            source_process TEXT,
            source_window TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            is_pinned INTEGER NOT NULL DEFAULT 0,
            custom_name TEXT,
            file_path TEXT,
            metadata TEXT,
            tags TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_clipboard_items_created_at
            ON clipboard_items(created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_clipboard_items_content_hash
            ON clipboard_items(content_hash);

        INSERT OR IGNORE INTO schema_migrations(version, applied_at)
        VALUES (1, unixepoch('subsec') * 1000);
        "#,
    )?;

    let has_search_index = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = 2)",
        [],
        |row| row.get::<_, bool>(0),
    )?;

    if !has_search_index {
        connection.execute_batch(
            r#"
            CREATE VIRTUAL TABLE IF NOT EXISTS clipboard_items_fts USING fts5(
                item_id UNINDEXED,
                content,
                source_app,
                content_type,
                tags,
                tokenize = 'unicode61 remove_diacritics 2'
            );

            CREATE TRIGGER IF NOT EXISTS clipboard_items_fts_insert
            AFTER INSERT ON clipboard_items BEGIN
                INSERT INTO clipboard_items_fts(item_id, content, source_app, content_type, tags)
                VALUES (new.id, new.content, new.source_app, new.content_type, new.tags);
            END;

            CREATE TRIGGER IF NOT EXISTS clipboard_items_fts_update
            AFTER UPDATE ON clipboard_items BEGIN
                DELETE FROM clipboard_items_fts WHERE item_id = old.id;
                INSERT INTO clipboard_items_fts(item_id, content, source_app, content_type, tags)
                VALUES (new.id, new.content, new.source_app, new.content_type, new.tags);
            END;

            CREATE TRIGGER IF NOT EXISTS clipboard_items_fts_delete
            AFTER DELETE ON clipboard_items BEGIN
                DELETE FROM clipboard_items_fts WHERE item_id = old.id;
            END;

            DELETE FROM clipboard_items_fts;

            INSERT INTO clipboard_items_fts(item_id, content, source_app, content_type, tags)
            SELECT id, content, source_app, content_type, tags FROM clipboard_items;

            INSERT INTO schema_migrations(version, applied_at)
            VALUES (2, unixepoch('subsec') * 1000);
            "#,
        )?;
    }

    let has_library = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = 3)",
        [],
        |row| row.get::<_, bool>(0),
    )?;

    if !has_library {
        connection.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS folders (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_folders_sort_order
                ON folders(sort_order ASC, created_at ASC);

            CREATE TABLE IF NOT EXISTS folder_items (
                id TEXT PRIMARY KEY NOT NULL,
                folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
                source_item_id TEXT,
                content TEXT,
                content_type TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                source_app TEXT,
                source_process TEXT,
                source_window TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                is_pinned INTEGER NOT NULL DEFAULT 0,
                custom_name TEXT,
                file_path TEXT,
                metadata TEXT,
                tags TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_folder_items_folder_order
                ON folder_items(folder_id, sort_order ASC, created_at ASC);

            CREATE UNIQUE INDEX IF NOT EXISTS idx_folder_items_source
                ON folder_items(folder_id, source_item_id)
                WHERE source_item_id IS NOT NULL;

            CREATE TABLE IF NOT EXISTS personal_items (
                id TEXT PRIMARY KEY NOT NULL,
                title TEXT NOT NULL,
                source_item_id TEXT,
                content TEXT,
                content_type TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                source_app TEXT,
                source_process TEXT,
                source_window TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                is_pinned INTEGER NOT NULL DEFAULT 0,
                file_path TEXT,
                metadata TEXT,
                tags TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_personal_items_sort_order
                ON personal_items(sort_order ASC, created_at ASC);

            CREATE UNIQUE INDEX IF NOT EXISTS idx_personal_items_source
                ON personal_items(source_item_id)
                WHERE source_item_id IS NOT NULL;

            INSERT INTO schema_migrations(version, applied_at)
            VALUES (3, unixepoch('subsec') * 1000);
            "#,
        )?;
    }

    Ok(())
}
