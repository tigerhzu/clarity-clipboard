use std::sync::OnceLock;

use regex::Regex;

use crate::core::source_detector::SourceContext;

use super::settings_service::{SettingsService, SettingsServiceError};

#[derive(Debug, Clone)]
pub struct PrivacyService {
    settings: SettingsService,
}

impl PrivacyService {
    pub fn new(settings: SettingsService) -> Self {
        Self { settings }
    }

    pub fn should_exclude_source(
        &self,
        source: &SourceContext,
    ) -> Result<bool, SettingsServiceError> {
        let settings = self.settings.get()?;
        let process = normalize_name(source.process_name.as_deref().unwrap_or_default());
        let app = normalize_name(source.app_name.as_deref().unwrap_or_default());
        Ok(settings.excluded_apps.iter().any(|entry| {
            let excluded = normalize_name(entry);
            !excluded.is_empty() && (excluded == process || excluded == app)
        }))
    }

    pub fn should_exclude_text(&self, content: &str) -> Result<bool, SettingsServiceError> {
        Ok(self.settings.get()?.sensitive_filter_enabled && is_sensitive(content))
    }
}

fn normalize_name(value: &str) -> String {
    let lowered = value.trim().to_lowercase();
    lowered.strip_suffix(".exe").unwrap_or(&lowered).to_owned()
}

fn sensitive_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(
            r"(?ix)
            -----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE\s+KEY-----
            |\b(?:sk|rk|pk)-(?:live|test)?-?[A-Za-z0-9_-]{16,}\b
            |\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{20,}\b
            |\bxox[baprs]-[A-Za-z0-9-]{12,}\b
            |\b(?:api[_ -]?key|access[_ -]?token|client[_ -]?secret|password|passwd)\s*[:=]\s*[^\s]{8,}",
        )
        .expect("valid sensitive content regex")
    })
}

fn is_sensitive(content: &str) -> bool {
    sensitive_pattern().is_match(content) || contains_credit_card(content)
}

fn contains_credit_card(content: &str) -> bool {
    let mut candidate = String::new();
    for character in content.chars().chain(std::iter::once(' ')) {
        if character.is_ascii_digit() {
            candidate.push(character);
        } else if character == ' ' || character == '-' {
            continue;
        } else {
            if (13..=19).contains(&candidate.len()) && passes_luhn(&candidate) {
                return true;
            }
            candidate.clear();
        }
    }
    (13..=19).contains(&candidate.len()) && passes_luhn(&candidate)
}

fn passes_luhn(digits: &str) -> bool {
    let sum = digits
        .bytes()
        .rev()
        .enumerate()
        .map(|(index, digit)| {
            let mut value = (digit - b'0') as u32;
            if index % 2 == 1 {
                value *= 2;
                if value > 9 {
                    value -= 9;
                }
            }
            value
        })
        .sum::<u32>();
    sum % 10 == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service() -> PrivacyService {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.keep().join("settings.json");
        PrivacyService::new(SettingsService::initialize(path).unwrap())
    }

    #[test]
    fn excludes_configured_processes() {
        let privacy = service();
        let source = SourceContext {
            app_name: Some("Bitwarden".into()),
            process_name: Some("Bitwarden.exe".into()),
            window_title: None,
        };
        assert!(privacy.should_exclude_source(&source).unwrap());
    }

    #[test]
    fn detects_common_secrets_and_valid_card_numbers() {
        assert!(is_sensitive("api_key = super-secret-value-123"));
        assert!(is_sensitive("4111 1111 1111 1111"));
        assert!(!is_sensitive("ticket number 1234567890"));
    }
}
