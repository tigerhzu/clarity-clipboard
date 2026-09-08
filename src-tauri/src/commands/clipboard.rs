use tauri::State;

use crate::services::{
    cleanup_service::CleanupService,
    settings_service::{AppSettings, SettingsService},
};
use crate::{
    database::models::ClipboardItem,
    services::{clipboard_service::ClipboardService, search_service::SearchService},
};

#[tauri::command]
pub fn list_clipboard_items(
    service: State<'_, SearchService>,
    query: Option<String>,
    filter: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<Vec<ClipboardItem>, String> {
    service
        .search_page(
            query.as_deref().unwrap_or_default(),
            filter.as_deref().unwrap_or("ALL"),
            limit.unwrap_or(250),
            offset.unwrap_or(0),
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn count_clipboard_items(
    service: State<'_, SearchService>,
    query: Option<String>,
    filter: Option<String>,
) -> Result<usize, String> {
    service
        .count(
            query.as_deref().unwrap_or_default(),
            filter.as_deref().unwrap_or("ALL"),
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn toggle_clipboard_pin(
    service: State<'_, ClipboardService>,
    id: String,
) -> Result<ClipboardItem, String> {
    service.toggle_pin(&id).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_clipboard_item(
    service: State<'_, ClipboardService>,
    id: String,
) -> Result<bool, String> {
    service.delete_item(&id).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn copy_clipboard_item(
    service: State<'_, ClipboardService>,
    id: String,
) -> Result<ClipboardItem, String> {
    service.copy_item(&id).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_clipboard_image(
    service: State<'_, ClipboardService>,
    id: String,
    thumbnail: Option<bool>,
) -> Result<String, String> {
    service
        .image_data_url(&id, thumbnail.unwrap_or(false))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_clipboard_settings(service: State<'_, SettingsService>) -> Result<AppSettings, String> {
    service.get().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_clipboard_settings(
    service: State<'_, SettingsService>,
    cleanup: State<'_, CleanupService>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    let settings = service
        .update(settings)
        .map_err(|error| error.to_string())?;
    // Settings are already durable at this point. Cleanup is best-effort so a
    // transient database/file issue does not tell the user that their settings
    // were lost after they were successfully written.
    if let Err(error) = cleanup.run_once() {
        eprintln!("Could not apply retention cleanup after settings update: {error}");
    }
    Ok(settings)
}
