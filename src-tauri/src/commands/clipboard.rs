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
) -> Result<Vec<ClipboardItem>, String> {
    service
        .search(
            query.as_deref().unwrap_or_default(),
            filter.as_deref().unwrap_or("ALL"),
            limit.unwrap_or(250),
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
    cleanup.run_once().map_err(|error| error.to_string())?;
    Ok(settings)
}
