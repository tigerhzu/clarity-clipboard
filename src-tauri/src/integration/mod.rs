mod tools;
mod transport;

use crate::database::repository::ClipboardRepository;
use crate::services::{
    clipboard_service::ClipboardService, library_service::LibraryService,
    search_service::SearchService, settings_service::SettingsService,
};
use serde::Serialize;
use std::{fs, path::Path, sync::Arc};
use tauri::{Emitter, State};

pub const PROMPT: &str = include_str!("hermes-prompt.txt");

#[derive(Clone)]
pub struct ToolServices {
    repository: ClipboardRepository,
    clipboard: ClipboardService,
    search: SearchService,
    library: LibraryService,
    settings: SettingsService,
    changed: Arc<dyn Fn() + Send + Sync>,
}

pub struct HermesIntegration {
    bridge: Option<transport::Bridge>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationInfo {
    available: bool,
    error: Option<String>,
    prompt: &'static str,
}

impl HermesIntegration {
    pub fn start(
        directory: &Path,
        repository: ClipboardRepository,
        clipboard: ClipboardService,
        search: SearchService,
        library: LibraryService,
        settings: SettingsService,
        app: tauri::AppHandle,
    ) -> Self {
        let services = ToolServices {
            repository,
            clipboard,
            search,
            library,
            settings,
            changed: Arc::new(move || {
                let _ = app.emit("clarity://library-changed", ());
            }),
        };
        match transport::Bridge::start(directory, services) {
            Ok(bridge) => Self {
                bridge: Some(bridge),
                error: None,
            },
            Err(error) => Self {
                bridge: None,
                error: Some(error),
            },
        }
    }
}

#[tauri::command]
pub fn get_hermes_integration(integration: State<'_, HermesIntegration>) -> IntegrationInfo {
    IntegrationInfo {
        available: integration.bridge.is_some(),
        error: integration.error.clone(),
        prompt: PROMPT,
    }
}

#[tauri::command]
pub fn copy_hermes_prompt(clipboard: State<'_, ClipboardService>) -> Result<(), String> {
    // Use the normal copy suppression so this setup prompt is not recorded as history.
    let item = crate::database::models::ClipboardItem {
        id: String::new(),
        content: Some(PROMPT.into()),
        content_type: "TEXT".into(),
        content_hash: String::new(),
        source_app: None,
        source_process: None,
        source_window: None,
        created_at: 0,
        updated_at: 0,
        is_pinned: false,
        custom_name: None,
        file_path: None,
        metadata: None,
        tags: None,
    };
    clipboard
        .copy_item_content(&item)
        .map_err(|error| error.to_string())
}

/// Called before the single-instance gate: MCP subprocesses never create a UI or DB.
pub fn run_mcp() -> Result<(), String> {
    let context: tauri::Context<tauri::Wry> = tauri::generate_context!();
    let appdata = std::env::var_os("APPDATA")
        .ok_or("找不到 Windows APPDATA；請在同一個 Windows 使用者環境執行 Hermes")?;
    let descriptor = std::path::PathBuf::from(appdata)
        .join(&context.config().identifier)
        .join("hermes-bridge.json");
    transport::run_stdio(&descriptor)
}

fn persist_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    fs::write(path, bytes).map_err(|e| e.to_string())
}
