use std::{thread, time::Duration};

use clipboard_win::{formats::Bitmap, get_clipboard, get_clipboard_string, Format, Monitor};
use tauri::{AppHandle, Emitter};

use crate::core::source_detector::detect_foreground_source;
use crate::database::models::SaveDisposition;
use crate::services::clipboard_service::ClipboardService;

const READ_RETRIES: usize = 5;

pub fn start(service: ClipboardService, app_handle: AppHandle) {
    thread::Builder::new()
        .name("clipboard-monitor".into())
        .spawn(move || {
            loop {
                let mut monitor = match Monitor::new() {
                    Ok(monitor) => monitor,
                    Err(error) => {
                        eprintln!("Could not start clipboard monitor: {error}; retrying");
                        thread::sleep(Duration::from_secs(2));
                        continue;
                    }
                };

                loop {
                    match monitor.recv() {
                        Ok(true) => {
                            let source = detect_foreground_source();
                            if Bitmap.is_format_avail() {
                                if let Some(bitmap) = read_bitmap_with_retry() {
                                    match service.ingest_bitmap_with_source(bitmap, source.clone())
                                    {
                                        Ok(Some(result)) => {
                                            emit_change(&app_handle, result);
                                            continue;
                                        }
                                        Ok(None) => continue,
                                        Err(error) => {
                                            // A malformed or unavailable bitmap should not
                                            // hide a valid text representation on the same
                                            // clipboard update.
                                            eprintln!("Could not save clipboard image: {error}")
                                        }
                                    }
                                }
                            }

                            if let Some(content) = read_text_with_retry() {
                                match service.ingest_text_with_source(content, source) {
                                    Ok(Some(result)) => emit_change(&app_handle, result),
                                    Ok(None) => {}
                                    Err(error) => {
                                        eprintln!("Could not save clipboard text: {error}")
                                    }
                                }
                            }
                        }
                        Ok(false) => return,
                        Err(error) => {
                            eprintln!("Clipboard monitor stopped: {error}; retrying");
                            thread::sleep(Duration::from_millis(500));
                            break;
                        }
                    }
                }
            }
        })
        .expect("failed to spawn clipboard monitor thread");
}

fn emit_change(app_handle: &AppHandle, result: crate::database::models::SaveResult) {
    let kind = match result.disposition {
        SaveDisposition::Inserted => "inserted",
        SaveDisposition::RefreshedDuplicate => "refreshed_duplicate",
    };
    let payload = serde_json::json!({
        "id": result.item.id,
        "kind": kind,
    });
    let _ = app_handle.emit("clipboard://changed", payload);
}

fn read_text_with_retry() -> Option<String> {
    for attempt in 0..READ_RETRIES {
        match get_clipboard_string() {
            Ok(content) => return Some(content),
            Err(_) if attempt + 1 < READ_RETRIES => thread::sleep(Duration::from_millis(20)),
            Err(_) => return None,
        }
    }
    None
}

fn read_bitmap_with_retry() -> Option<Vec<u8>> {
    for attempt in 0..READ_RETRIES {
        match get_clipboard(Bitmap) {
            Ok(bitmap) => return Some(bitmap),
            Err(_) if attempt + 1 < READ_RETRIES => thread::sleep(Duration::from_millis(20)),
            Err(_) => return None,
        }
    }
    None
}
