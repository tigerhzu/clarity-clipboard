use std::{net::IpAddr, sync::OnceLock};

use regex::Regex;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ContentType {
    Text,
    Url,
    Email,
    Ip,
    FilePath,
    NetworkPath,
    Code,
    #[allow(dead_code)]
    Image,
    Json,
    Command,
}

impl ContentType {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Text => "TEXT",
            Self::Url => "URL",
            Self::Email => "EMAIL",
            Self::Ip => "IP",
            Self::FilePath => "FILE_PATH",
            Self::NetworkPath => "NETWORK_PATH",
            Self::Code => "CODE",
            Self::Image => "IMAGE",
            Self::Json => "JSON",
            Self::Command => "COMMAND",
        }
    }
}

#[derive(Debug, Default, Clone, Copy)]
pub struct ClipboardClassifier;

impl ClipboardClassifier {
    pub fn classify(&self, content: &str) -> ContentType {
        let value = content.trim();
        if value.is_empty() {
            return ContentType::Text;
        }

        if is_json(value) {
            return ContentType::Json;
        }
        if url_regex().is_match(value) {
            return ContentType::Url;
        }
        if email_regex().is_match(value) {
            return ContentType::Email;
        }
        if value.parse::<IpAddr>().is_ok() {
            return ContentType::Ip;
        }
        if network_path_regex().is_match(value) {
            return ContentType::NetworkPath;
        }
        if file_path_regex().is_match(value) {
            return ContentType::FilePath;
        }
        if looks_like_command(value) {
            return ContentType::Command;
        }
        if looks_like_code(value) {
            return ContentType::Code;
        }
        ContentType::Text
    }
}

fn is_json(value: &str) -> bool {
    ((value.starts_with('{') && value.ends_with('}'))
        || (value.starts_with('[') && value.ends_with(']')))
        && serde_json::from_str::<serde_json::Value>(value).is_ok()
}

fn looks_like_command(value: &str) -> bool {
    if value.contains('\n') || value.contains('\r') {
        return false;
    }

    powershell_command_regex().is_match(value)
        || shell_command_regex().is_match(value)
        || value.starts_with("./")
        || value.starts_with(".\\")
}

fn looks_like_code(value: &str) -> bool {
    let signals = [
        "function ",
        "fn ",
        "const ",
        "let ",
        "var ",
        "class ",
        "interface ",
        "SELECT ",
        "INSERT ",
        "UPDATE ",
        "DELETE ",
        "import ",
        "from ",
        "public ",
        "private ",
        "#include",
        "<?php",
    ];
    let lower = value.to_ascii_lowercase();
    let keyword_signal = signals
        .iter()
        .any(|signal| lower.contains(&signal.to_ascii_lowercase()));
    let syntax_signal = (value.contains('{') && value.contains('}'))
        || (value.contains('(') && value.contains(')') && value.contains(';'))
        || value
            .lines()
            .filter(|line| line.trim_end().ends_with(';'))
            .count()
            >= 2;

    keyword_signal && (syntax_signal || value.contains('\n'))
}

fn url_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"(?i)^https?://[^\s]+$").expect("valid URL regex"))
}

fn email_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?i)^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$")
            .expect("valid email regex")
    })
}

fn network_path_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r#"^\\\\[^\\/:*?"<>|]+\\[^\r\n]+$"#).expect("valid UNC regex"))
}

fn file_path_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?i)^(?:[a-z]:[\\/]|file:///)[^\r\n]+$").expect("valid file path regex")
    })
}

fn powershell_command_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?i)^(?:get|set|new|remove|add|invoke|start|stop|restart|test|connect|disconnect|enable|disable|update|export|import|convert|select|where|write|read|clear|copy|move|rename|install|uninstall)-[a-z][a-z0-9-]*(?:\s+.*)?$")
            .expect("valid PowerShell command regex")
    })
}

fn shell_command_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?i)^(?:git|cargo|npm|pnpm|yarn|node|python|py|pip|winget|docker|kubectl|ssh|scp|curl|ipconfig|ping|tracert|nslookup|netstat|robocopy|xcopy|cmd|powershell|pwsh)(?:\s+.*)?$")
            .expect("valid shell command regex")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_required_content_types() {
        let classifier = ClipboardClassifier;
        let cases = [
            ("一般的文字內容", ContentType::Text),
            ("https://github.com/tigerhzu", ContentType::Url),
            ("tiger@example.com", ContentType::Email),
            ("192.168.1.20", ContentType::Ip),
            (r"C:\Users\Tiger\notes.txt", ContentType::FilePath),
            (r"\\NAS01\SHARE", ContentType::NetworkPath),
            (r#"{"name":"Tiger"}"#, ContentType::Json),
            ("Get-ADUser Tiger", ContentType::Command),
            ("git status --short", ContentType::Command),
            (
                "function greet() {\n  return 'hello';\n}",
                ContentType::Code,
            ),
        ];

        for (content, expected) in cases {
            assert_eq!(classifier.classify(content), expected, "{content}");
        }
    }

    #[test]
    fn does_not_treat_invalid_structured_values_as_special_types() {
        let classifier = ClipboardClassifier;
        assert_eq!(classifier.classify("{not json}"), ContentType::Text);
        assert_eq!(classifier.classify("hello@example"), ContentType::Text);
        assert_eq!(classifier.classify("999.1.2.3"), ContentType::Text);
    }
}
