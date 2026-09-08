mod commands;
mod core;
mod database;
mod services;

use database::repository::ClipboardRepository;
use services::{
    cleanup_service::CleanupService, clipboard_service::ClipboardService,
    image_service::ImageService, library_service::LibraryService, privacy_service::PrivacyService,
    search_service::SearchService, settings_service::SettingsService,
};
use tauri::Manager;

#[cfg(windows)]
fn start_installer_quit_listener(app: tauri::AppHandle) {
    use std::{ffi::OsStr, os::windows::ffi::OsStrExt, ptr, thread};
    use windows_sys::Win32::{
        Foundation::{CloseHandle, WAIT_OBJECT_0},
        System::Threading::{CreateEventW, WaitForSingleObject, INFINITE},
    };

    let event_name = OsStr::new("Local\\ClarityClipboard.Quit")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let event = unsafe { CreateEventW(ptr::null(), 1, 0, event_name.as_ptr()) };
    if event.is_null() {
        return;
    }

    let event_address = event as usize;
    thread::spawn(move || {
        let event = event_address as windows_sys::Win32::Foundation::HANDLE;
        let wait_result = unsafe { WaitForSingleObject(event, INFINITE) };
        if wait_result == WAIT_OBJECT_0 {
            app.exit(0);
        }
        unsafe {
            CloseHandle(event);
        }
    });
}

#[cfg(desktop)]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    WindowEvent,
};

#[cfg(desktop)]
fn show_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg(desktop)]
fn toggle_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        show_main_window(app);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(|app, _shortcut, event| {
                        if event.state != tauri_plugin_global_shortcut::ShortcutState::Pressed {
                            return;
                        }

                        toggle_main_window(app);
                    })
                    .build(),
            )
            .on_window_event(|window, event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    // Closing the window hides the UI but keeps clipboard
                    // monitoring and the global shortcut alive in the background.
                    api.prevent_close();
                    let _ = window.hide();
                }
            });
    }

    builder
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
            let library_service = LibraryService::new(repository.clone(), image_service.clone());
            let cleanup_service =
                CleanupService::new(repository, image_service, settings_service.clone());

            if let Err(error) = clipboard_service.reclassify_existing_items() {
                eprintln!("Could not reclassify existing clipboard items: {error}");
            }

            app.manage(clipboard_service.clone());
            app.manage(search_service);
            app.manage(settings_service);
            app.manage(cleanup_service.clone());
            app.manage(library_service);

            #[cfg(desktop)]
            {
                #[cfg(windows)]
                start_installer_quit_listener(app.handle().clone());

                let show_item = MenuItem::with_id(app, "show", "顯示剪貼後台", true, None::<&str>)?;
                let quit_item = MenuItem::with_id(app, "quit", "結束剪貼後台", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show_item, &quit_item])?;
                let tray_icon =
                    tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))?;

                TrayIconBuilder::new()
                    .icon(tray_icon)
                    .tooltip("剪貼後台")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            toggle_main_window(&tray.app_handle());
                        }
                    })
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => show_main_window(app),
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .build(app)?;
            }

            core::clipboard_monitor::start(clipboard_service, app.handle().clone());
            cleanup_service.start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::clipboard::list_clipboard_items,
            commands::clipboard::count_clipboard_items,
            commands::clipboard::toggle_clipboard_pin,
            commands::clipboard::delete_clipboard_item,
            commands::clipboard::copy_clipboard_item,
            commands::clipboard::get_clipboard_image,
            commands::clipboard::get_clipboard_settings,
            commands::clipboard::update_clipboard_settings,
            commands::library::list_folders,
            commands::library::create_folder,
            commands::library::rename_folder,
            commands::library::delete_folder,
            commands::library::list_folder_items,
            commands::library::add_clipboard_item_to_folder,
            commands::library::update_folder_item,
            commands::library::remove_folder_item,
            commands::library::reorder_folder_items,
            commands::library::copy_folder_item,
            commands::library::get_folder_item_image,
            commands::library::list_personal_items,
            commands::library::create_personal_item,
            commands::library::update_personal_item,
            commands::library::delete_personal_item,
            commands::library::add_clipboard_item_to_personal,
            commands::library::reorder_personal_items,
            commands::library::copy_personal_item,
            commands::library::get_personal_item_image,
        ])
        .run(tauri::generate_context!())
        .expect("error while running 剪貼後台");
}
