//! Log level preference, startup header and the log file commands (tail,
//! open, delete). Moved out of main.rs.

#[allow(unused_imports)]
use super::*;

/// Returns the path to the log-level preference file.
/// This is intentionally computed with raw env vars so it can be called
/// before the Tauri app (and its path resolver) is initialised.
pub(crate) fn resolve_log_level_pref_path() -> std::path::PathBuf {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").unwrap_or_default();
        std::path::PathBuf::from(appdata)
            .join("org.openresinalliance.dragonfruit")
            .join("loglevel")
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        std::path::PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("org.openresinalliance.dragonfruit")
            .join("loglevel")
    }
    #[cfg(target_os = "linux")]
    {
        let base = std::env::var("XDG_DATA_HOME").unwrap_or_else(|_| {
            format!("{}/.local/share", std::env::var("HOME").unwrap_or_default())
        });
        std::path::PathBuf::from(base)
            .join("org.openresinalliance.dragonfruit")
            .join("loglevel")
    }
}

/// Fixed header written once per run, as the first thing in the log file.
///
/// Every performance report needs an anchor: a 12-second freeze means nothing
/// until you know the version, the platform and how many cores it had. The
/// webview logs its own half (GPU, viewport) from `startupHeader.ts`.
///
/// Must run inside `setup()` — the log plugin attaches the `log` facade during
/// plugin setup, so records emitted before that are dropped on the floor.
pub(crate) fn log_startup_header() {
    let cores = std::thread::available_parallelism()
        .map(|n| n.get().to_string())
        .unwrap_or_else(|_| "unknown".to_string());

    log::info!(
        "[header] DragonFruit {} (debug={}) os={} arch={} cores={} log_level={}",
        env!("CARGO_PKG_VERSION"),
        cfg!(debug_assertions),
        std::env::consts::OS,
        std::env::consts::ARCH,
        cores,
        log::max_level(),
    );
}

pub(crate) fn read_log_level_pref() -> log::LevelFilter {
    let content = std::fs::read_to_string(resolve_log_level_pref_path()).unwrap_or_default();
    match content.trim() {
        "error" => log::LevelFilter::Error,
        "warn" => log::LevelFilter::Warn,
        "info" => log::LevelFilter::Info,
        "debug" => log::LevelFilter::Debug,
        "trace" => log::LevelFilter::Trace,
        _ => log::LevelFilter::Info,
    }
}

/// Persist the user's preferred log level to disk AND apply it immediately
/// at runtime via `log::set_max_level`. No restart required.
#[tauri::command]
pub async fn set_log_level_pref(level: String) -> Result<(), String> {
    const VALID: &[&str] = &["error", "warn", "info", "debug", "trace"];
    let level = level.trim().to_lowercase();
    if !VALID.contains(&level.as_str()) {
        return Err(format!("Invalid log level: {level}"));
    }
    // Apply immediately — log::set_max_level is atomic and takes effect for all
    // subsequent log macro calls without any restart.
    let filter = match level.as_str() {
        "error" => log::LevelFilter::Error,
        "warn" => log::LevelFilter::Warn,
        "info" => log::LevelFilter::Info,
        "debug" => log::LevelFilter::Debug,
        "trace" => log::LevelFilter::Trace,
        _ => log::LevelFilter::Info,
    };
    log::set_max_level(filter);
    // Persist for next startup.
    let path = resolve_log_level_pref_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create config dir: {e}"))?;
    }
    std::fs::write(&path, level.as_bytes())
        .map_err(|e| format!("Failed to write log level pref: {e}"))
}

/// Return the last `lines` lines of the log file for the live viewer in Settings.
/// Returns an empty string if the file does not yet exist.
#[tauri::command]
pub async fn read_log_tail(app: DragonFruitAppHandle, lines: usize) -> Result<String, String> {
    use tauri::Manager;
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to resolve log dir: {e}"))?;
    let log_file = log_dir.join("dragonfruit.log");
    match std::fs::read_to_string(&log_file) {
        Ok(content) => {
            let max = lines.clamp(10, 10_000);
            // Collect the last `max` non-empty lines without reversing the order.
            let all: Vec<&str> = content.lines().collect();
            let tail = if all.len() > max {
                &all[all.len() - max..]
            } else {
                &all[..]
            };
            Ok(tail.join("\n"))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("Failed to read log file: {e}")),
    }
}

/// Open the log file in the OS default text editor / viewer.
#[tauri::command]
pub async fn open_log_file(app: DragonFruitAppHandle) -> Result<(), String> {
    use tauri::Manager;
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to resolve log dir: {e}"))?;
    let log_file = log_dir.join("dragonfruit.log");
    if !log_file.exists() {
        return Err("Log file does not exist yet.".to_string());
    }
    let path_str = log_file.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("notepad.exe")
            .arg(&path_str)
            .spawn()
            .map_err(|e| format!("Failed to open log file: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-t", &path_str])
            .spawn()
            .map_err(|e| format!("Failed to open log file: {e}"))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path_str)
            .spawn()
            .map_err(|e| format!("Failed to open log file: {e}"))?;
    }
    Ok(())
}

/// Delete the log file so it starts fresh on the next write.
#[tauri::command]
pub async fn delete_log_file(app: DragonFruitAppHandle) -> Result<(), String> {
    use tauri::Manager;
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to resolve log dir: {e}"))?;
    let log_file = log_dir.join("dragonfruit.log");
    match std::fs::remove_file(&log_file) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Failed to delete log file: {e}")),
    }
}
