use chrono::{Datelike, Days, Local, TimeZone};

use crate::database::{
    models::{ClipboardItem, SearchCriteria},
    repository::{ClipboardRepository, RepositoryError},
};

#[derive(Debug, thiserror::Error)]
pub enum SearchServiceError {
    #[error(transparent)]
    Repository(#[from] RepositoryError),
    #[error("invalid calendar date range")]
    InvalidDateRange,
}

#[derive(Debug, Clone)]
pub struct SearchService {
    repository: ClipboardRepository,
}

impl SearchService {
    pub fn activity_days(
        &self,
        start_ms: i64,
        end_ms: i64,
    ) -> Result<Vec<crate::database::models::ClipboardDay>, SearchServiceError> {
        validate_date_range(Some(start_ms), Some(end_ms))?;
        Ok(self.repository.activity_days(start_ms, end_ms)?)
    }

    pub fn search_dated(
        &self,
        query: &str,
        filter: &str,
        limit: usize,
        offset: usize,
        start_ms: Option<i64>,
        end_ms: Option<i64>,
    ) -> Result<Vec<ClipboardItem>, SearchServiceError> {
        let mut criteria = self.criteria(query, filter, limit, offset);
        apply_date_range(&mut criteria, start_ms, end_ms)?;
        Ok(self.repository.search(&criteria)?)
    }

    pub fn count_dated(
        &self,
        query: &str,
        filter: &str,
        start_ms: Option<i64>,
        end_ms: Option<i64>,
    ) -> Result<usize, SearchServiceError> {
        let mut criteria = self.criteria(query, filter, 1, 0);
        apply_date_range(&mut criteria, start_ms, end_ms)?;
        Ok(self.repository.count(&criteria)?)
    }

    pub fn new(repository: ClipboardRepository) -> Self {
        Self { repository }
    }

    #[cfg(test)]
    pub fn search(
        &self,
        query: &str,
        filter: &str,
        limit: usize,
    ) -> Result<Vec<ClipboardItem>, SearchServiceError> {
        self.search_page(query, filter, limit, 0)
    }

    #[cfg(test)]
    pub fn search_page(
        &self,
        query: &str,
        filter: &str,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<ClipboardItem>, SearchServiceError> {
        let criteria = self.criteria(query, filter, limit, offset);
        Ok(self.repository.search(&criteria)?)
    }

    #[cfg(test)]
    pub fn count(&self, query: &str, filter: &str) -> Result<usize, SearchServiceError> {
        let criteria = self.criteria(query, filter, 1, 0);
        Ok(self.repository.count(&criteria)?)
    }

    fn criteria(&self, query: &str, filter: &str, limit: usize, offset: usize) -> SearchCriteria {
        let query = query.trim().to_lowercase();
        let (content_filter, start_ms, end_ms) = resolve_filter(filter);
        SearchCriteria {
            like_pattern: format!("%{}%", escape_like(&query)),
            starts_with_pattern: format!("{}%", escape_like(&query)),
            fts_query: build_fts_query(&query),
            query,
            filter: content_filter,
            start_ms,
            end_ms,
            limit,
            offset,
        }
    }
}

fn validate_date_range(
    start_ms: Option<i64>,
    end_ms: Option<i64>,
) -> Result<(), SearchServiceError> {
    match (start_ms, end_ms) {
        (None, None) => Ok(()),
        (Some(start), Some(end)) if end > start && end.saturating_sub(start) <= 32 * 86_400_000 => {
            Ok(())
        }
        _ => Err(SearchServiceError::InvalidDateRange),
    }
}

fn apply_date_range(
    criteria: &mut SearchCriteria,
    start_ms: Option<i64>,
    end_ms: Option<i64>,
) -> Result<(), SearchServiceError> {
    validate_date_range(start_ms, end_ms)?;
    if let (Some(start), Some(end)) = (start_ms, end_ms) {
        criteria.start_ms = Some(
            criteria
                .start_ms
                .map_or(start, |existing| existing.max(start)),
        );
        criteria.end_ms = Some(criteria.end_ms.map_or(end, |existing| existing.min(end)));
    }
    Ok(())
}

fn resolve_filter(filter: &str) -> (String, Option<i64>, Option<i64>) {
    let normalized = filter.trim().to_ascii_uppercase();
    let today = Local::now().date_naive();
    let start_today = local_midnight(today);
    let start_yesterday = today
        .checked_sub_days(Days::new(1))
        .map(local_midnight)
        .unwrap_or(start_today);
    let start_week = today
        .checked_sub_days(Days::new(today.weekday().num_days_from_monday().into()))
        .map(local_midnight)
        .unwrap_or(start_today);

    match normalized.as_str() {
        "TODAY" => ("ALL".into(), Some(start_today), None),
        "YESTERDAY" => ("ALL".into(), Some(start_yesterday), Some(start_today)),
        "THIS_WEEK" => ("ALL".into(), Some(start_week), None),
        "OLDER" => ("ALL".into(), None, Some(start_week)),
        "PINNED" | "TEXT" | "LINKS" | "IMAGES" | "CODE" | "PATHS" | "EMAIL" | "IP" => {
            (normalized, None, None)
        }
        _ => ("ALL".into(), None, None),
    }
}

fn local_midnight(date: chrono::NaiveDate) -> i64 {
    date.and_hms_opt(0, 0, 0)
        .and_then(|datetime| Local.from_local_datetime(&datetime).earliest())
        .map(|datetime| datetime.timestamp_millis())
        .unwrap_or(0)
}

fn escape_like(query: &str) -> String {
    query
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn build_fts_query(query: &str) -> String {
    let tokens = query
        .split(|character: char| !character.is_alphanumeric())
        .filter(|token| !token.is_empty())
        .map(|token| format!("\"{}\"*", token.replace('"', "\"\"")))
        .collect::<Vec<_>>();

    if tokens.is_empty() {
        "\"__clarity_no_query__\"".to_owned()
    } else {
        tokens.join(" AND ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::{
        clipboard_service::ClipboardService, image_service::ImageService,
        privacy_service::PrivacyService, settings_service::SettingsService,
    };

    #[test]
    fn calendar_dates_combine_with_search_categories_and_pagination() {
        use crate::database::models::NewClipboardItem;
        let directory = tempfile::tempdir().unwrap();
        let repository =
            ClipboardRepository::initialize(directory.path().join("calendar.db")).unwrap();
        let search = SearchService::new(repository.clone());
        let date = chrono::NaiveDate::from_ymd_opt(2026, 9, 15).unwrap();
        let start = local_midnight(date);
        let end = local_midnight(date.succ_opt().unwrap());
        for index in 0..262 {
            let timestamp = match index {
                0 => start - 1,
                261 => end,
                _ => start + index,
            };
            repository
                .save_with_consecutive_deduplication(
                    NewClipboardItem {
                        id: index.to_string(),
                        content: Some(format!("calendar note {index}")),
                        content_type: if index == 1 {
                            "IMAGE".into()
                        } else {
                            "TEXT".into()
                        },
                        content_hash: index.to_string(),
                        source_app: None,
                        source_process: None,
                        source_window: None,
                        created_at: timestamp,
                        file_path: None,
                        metadata: None,
                        tags: None,
                    },
                    5000,
                )
                .unwrap();
        }
        assert_eq!(
            search
                .count_dated("", "ALL", Some(start), Some(end))
                .unwrap(),
            260
        );
        assert_eq!(
            search
                .search_dated("", "ALL", 250, 0, Some(start), Some(end))
                .unwrap()
                .len(),
            250
        );
        assert_eq!(
            search
                .search_dated("", "ALL", 250, 250, Some(start), Some(end))
                .unwrap()
                .len(),
            10
        );
        assert_eq!(
            search
                .count_dated("", "TEXT", Some(start), Some(end))
                .unwrap(),
            259
        );
        assert_eq!(
            search
                .search_dated("calendar", "IMAGES", 250, 0, Some(start), Some(end))
                .unwrap()[0]
                .id,
            "1"
        );
        repository.toggle_pin("1").unwrap();
        assert_eq!(
            search
                .count_dated("", "PINNED", Some(start), Some(end))
                .unwrap(),
            1
        );
        let days = search.activity_days(start, end).unwrap();
        assert_eq!(days.len(), 1);
        assert_eq!(days[0].date, "2026-09-15");
        assert_eq!(days[0].count, 260);
        repository.delete_item("1").unwrap();
        assert_eq!(search.activity_days(start, end).unwrap()[0].count, 259);
        assert!(search
            .count_dated("", "ALL", Some(end), Some(start))
            .is_err());
        assert!(search.count_dated("", "ALL", Some(start), None).is_err());
    }

    #[test]
    fn duplicates_across_midnight_keep_both_calendar_days() {
        use crate::database::models::{NewClipboardItem, SaveDisposition};
        let directory = tempfile::tempdir().unwrap();
        let repository =
            ClipboardRepository::initialize(directory.path().join("calendar.db")).unwrap();
        let midnight = local_midnight(chrono::NaiveDate::from_ymd_opt(2026, 9, 15).unwrap());
        let item = |id: &str, created_at| NewClipboardItem {
            id: id.into(),
            content: Some("same text".into()),
            content_type: "TEXT".into(),
            content_hash: "same hash".into(),
            source_app: None,
            source_process: None,
            source_window: None,
            created_at,
            file_path: None,
            metadata: None,
            tags: None,
        };
        repository
            .save_with_consecutive_deduplication(item("before", midnight - 1000), 5000)
            .unwrap();
        let after = repository
            .save_with_consecutive_deduplication(item("after", midnight + 1000), 5000)
            .unwrap();
        assert_eq!(after.disposition, SaveDisposition::Inserted);
        let duplicate = repository
            .save_with_consecutive_deduplication(item("duplicate", midnight + 2000), 5000)
            .unwrap();
        assert_eq!(duplicate.disposition, SaveDisposition::RefreshedDuplicate);
        assert_eq!(
            repository
                .activity_days(midnight - 5000, midnight + 5000)
                .unwrap()
                .len(),
            2
        );
    }

    fn services() -> (tempfile::TempDir, ClipboardService, SearchService) {
        let directory = tempfile::tempdir().expect("temporary directory");
        let repository = ClipboardRepository::initialize(directory.path().join("clipboard.db"))
            .expect("repository");
        let image_service = ImageService::initialize(directory.path().join("images")).unwrap();
        let settings = SettingsService::initialize(directory.path().join("settings.json")).unwrap();
        (
            directory,
            ClipboardService::new(
                repository.clone(),
                image_service,
                PrivacyService::new(settings),
            ),
            SearchService::new(repository),
        )
    }

    #[test]
    fn partial_search_finds_command_tokens() {
        let (_directory, clipboard, search) = services();
        clipboard.ingest_text("Get-ADUser Tiger".into()).unwrap();
        clipboard
            .ingest_text("Get-ADReplicationPartnerMetadata".into())
            .unwrap();
        clipboard.ingest_text("unrelated note".into()).unwrap();

        let results = search.search("AD", "ALL", 20).unwrap();
        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|item| item
            .content
            .as_deref()
            .unwrap_or_default()
            .contains("AD")));
    }

    #[test]
    fn content_filter_groups_code_json_and_commands() {
        let (_directory, clipboard, search) = services();
        clipboard.ingest_text(r#"{"name":"Tiger"}"#.into()).unwrap();
        clipboard.ingest_text("192.168.1.20".into()).unwrap();
        clipboard.ingest_text("git status".into()).unwrap();

        let results = search.search("", "CODE", 20).unwrap();
        assert_eq!(results.len(), 2);
        assert!(results
            .iter()
            .all(|item| matches!(item.content_type.as_str(), "JSON" | "COMMAND" | "CODE")));
    }

    #[test]
    fn exact_match_ranks_ahead_of_a_partial_match() {
        let (_directory, clipboard, search) = services();
        clipboard.ingest_text("AD reference notes".into()).unwrap();
        clipboard.ingest_text("AD".into()).unwrap();

        let results = search.search("AD", "ALL", 20).unwrap();
        assert_eq!(results[0].content.as_deref(), Some("AD"));
    }

    #[test]
    fn count_and_pages_cover_more_than_the_initial_batch() {
        let (_directory, clipboard, search) = services();
        for index in 0..260 {
            clipboard
                .ingest_text(format!("clipboard item {index}"))
                .unwrap();
        }

        assert_eq!(search.count("", "ALL").unwrap(), 260);
        assert_eq!(search.search_page("", "ALL", 250, 0).unwrap().len(), 250);
        assert_eq!(search.search_page("", "ALL", 250, 250).unwrap().len(), 10);
    }
}
