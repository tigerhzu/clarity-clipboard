#![cfg_attr(windows, windows_subsystem = "windows")]

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--mcp") {
        if let Err(error) = clarity_clipboard_lib::integration::run_mcp() {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    clarity_clipboard_lib::run();
}
