use tauri::State;

#[tauri::command]
pub fn save_manual_item(
    service: State<'_, LibraryService>,
    input: crate::services::library_service::ManualItemInput,
) -> Result<crate::database::models::ClipboardItem, String> {
    service
        .save_manual_item(input)
        .map_err(|error| error.to_string())
}

use crate::{
    database::models::{Folder, FolderItem, PersonalItem},
    services::{clipboard_service::ClipboardService, library_service::LibraryService},
};

#[tauri::command]
pub fn list_folders(service: State<'_, LibraryService>) -> Result<Vec<Folder>, String> {
    service.list_folders().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn reorder_folders(
    service: State<'_, LibraryService>,
    folder_ids: Vec<String>,
) -> Result<Vec<Folder>, String> {
    service
        .reorder_folders(&folder_ids)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_folder(service: State<'_, LibraryService>, name: String) -> Result<Folder, String> {
    service
        .create_folder(&name)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn rename_folder(
    service: State<'_, LibraryService>,
    id: String,
    name: String,
) -> Result<Folder, String> {
    service
        .rename_folder(&id, &name)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_folder(service: State<'_, LibraryService>, id: String) -> Result<bool, String> {
    service
        .delete_folder(&id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_folder_items(
    service: State<'_, LibraryService>,
    folder_id: String,
) -> Result<Vec<FolderItem>, String> {
    service
        .list_folder_items(&folder_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn add_clipboard_item_to_folder(
    service: State<'_, LibraryService>,
    folder_id: String,
    source_item_id: String,
) -> Result<FolderItem, String> {
    service
        .add_clipboard_item_to_folder(&folder_id, &source_item_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_folder_item(
    service: State<'_, LibraryService>,
    id: String,
    title: String,
    content: Option<String>,
    content_type: String,
) -> Result<FolderItem, String> {
    service
        .update_folder_item(&id, &title, content.as_deref(), &content_type)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn remove_folder_item(service: State<'_, LibraryService>, id: String) -> Result<bool, String> {
    service
        .remove_folder_item(&id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn reorder_folder_items(
    service: State<'_, LibraryService>,
    folder_id: String,
    item_ids: Vec<String>,
) -> Result<Vec<FolderItem>, String> {
    service
        .reorder_folder_items(&folder_id, &item_ids)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn copy_folder_item(
    service: State<'_, LibraryService>,
    clipboard: State<'_, ClipboardService>,
    id: String,
) -> Result<FolderItem, String> {
    let item = service
        .get_folder_item(&id)
        .map_err(|error| error.to_string())?;
    clipboard
        .copy_item_content(&item.as_clipboard_item())
        .map_err(|error| error.to_string())?;
    Ok(item)
}

#[tauri::command]
pub fn get_folder_item_image(
    service: State<'_, LibraryService>,
    clipboard: State<'_, ClipboardService>,
    id: String,
    thumbnail: Option<bool>,
) -> Result<String, String> {
    let item = service
        .get_folder_item(&id)
        .map_err(|error| error.to_string())?;
    clipboard
        .image_data_url_for_item(&item.as_clipboard_item(), thumbnail.unwrap_or(false))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_personal_items(
    service: State<'_, LibraryService>,
) -> Result<Vec<PersonalItem>, String> {
    service
        .list_personal_items()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_personal_item(
    service: State<'_, LibraryService>,
    title: String,
    content: String,
    content_type: String,
) -> Result<PersonalItem, String> {
    service
        .create_personal_item(&title, &content, &content_type)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_personal_item(
    service: State<'_, LibraryService>,
    id: String,
    title: String,
    content: Option<String>,
    content_type: String,
) -> Result<PersonalItem, String> {
    service
        .update_personal_item(&id, &title, content.as_deref(), &content_type)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_personal_item(
    service: State<'_, LibraryService>,
    id: String,
) -> Result<bool, String> {
    service
        .delete_personal_item(&id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn add_clipboard_item_to_personal(
    service: State<'_, LibraryService>,
    source_item_id: String,
) -> Result<PersonalItem, String> {
    service
        .add_clipboard_item_to_personal(&source_item_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn reorder_personal_items(
    service: State<'_, LibraryService>,
    item_ids: Vec<String>,
) -> Result<Vec<PersonalItem>, String> {
    service
        .reorder_personal_items(&item_ids)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn copy_personal_item(
    service: State<'_, LibraryService>,
    clipboard: State<'_, ClipboardService>,
    id: String,
) -> Result<PersonalItem, String> {
    let item = service
        .get_personal_item(&id)
        .map_err(|error| error.to_string())?;
    clipboard
        .copy_item_content(&item.as_clipboard_item())
        .map_err(|error| error.to_string())?;
    Ok(item)
}

#[tauri::command]
pub fn get_personal_item_image(
    service: State<'_, LibraryService>,
    clipboard: State<'_, ClipboardService>,
    id: String,
    thumbnail: Option<bool>,
) -> Result<String, String> {
    let item = service
        .get_personal_item(&id)
        .map_err(|error| error.to_string())?;
    clipboard
        .image_data_url_for_item(&item.as_clipboard_item(), thumbnail.unwrap_or(false))
        .map_err(|error| error.to_string())
}
