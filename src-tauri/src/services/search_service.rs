use chrono::{Datelike, Days, Local, TimeZone};

use crate::database::{
    models::{ClipboardItem, SearchCriteria},
    repository::{ClipboardRepository, RepositoryError},
};

#[derive(Debug, thiserror::Error)]
pub enum SearchServiceError {
    #[error(transparent)]
    Repository(#[from] RepositoryError),
}

#[derive(Debug, Clone)]
pub struct SearchService {
    repository: ClipboardRepository,
}

impl SearchService {
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
