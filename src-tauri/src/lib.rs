mod commands;
mod core;
mod database;
mod services;

use database::repository::ClipboardRepository;
use services::{
    cleanup_service::CleanupService, clipboard_service::ClipboardService,
    image_service::ImageService, privacy_service::PrivacyService, search_service::SearchService,
    settings_service::SettingsService,
};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_directory = app.path().app_data_dir()?;
            let repository = ClipboardRepository::initialize(data_directory.join("clipboard.db"))?;
            let image_service = ImageService::initialize(data_directory.join("images"))?;
            let settings_service =
                SettingsService::initialize(data_directory.join("settings.json"))?;
            let privacy_service = PrivacyService::new(settings_service.clone());
            let clipboard_service =
                ClipboardService::new(repository.clone(), image_service.clone(), privacy_service);
            let search_service = SearchService::new(repository.clone());
            let cleanup_service =
                CleanupService::new(repository, image_service, settings_service.clone());

            if let Err(error) = clipboard_service.reclassify_existing_items() {
                eprintln!("Could not reclassify existing clipboard items: {error}");
            }

            app.manage(clipboard_service.clone());
            app.manage(search_service);
            app.manage(settings_service);
            app.manage(cleanup_service.clone());
            core::clipboard_monitor::start(clipboard_service, app.handle().clone());
            cleanup_service.start();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::clipboard::list_clipboard_items,
            commands::clipboard::toggle_clipboard_pin,
            commands::clipboard::delete_clipboard_item,
            commands::clipboard::copy_clipboard_item,
            commands::clipboard::get_clipboard_image,
            commands::clipboard::get_clipboard_settings,
            commands::clipboard::update_clipboard_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Clarity Clipboard");
}
