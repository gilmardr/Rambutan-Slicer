//! In-app updates stay disabled until 3DRESIN has an independent release feed.

use serde::Serialize;
use tauri::Manager;

#[cfg(feature = "tauri-cef")]
type UpdaterAppHandle = tauri::AppHandle<tauri::Cef>;
#[cfg(not(feature = "tauri-cef"))]
type UpdaterAppHandle = tauri::AppHandle<tauri::Wry>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub update_available: bool,
    pub version: String,
    pub current_version: String,
    pub body: Option<String>,
    pub date: Option<String>,
    pub download_url: Option<String>,
}

#[tauri::command]
pub async fn check_updates(
    app_handle: UpdaterAppHandle,
    channel: Option<String>,
    allow_same_version: Option<bool>,
    #[allow(non_snake_case)] allowSameVersion: Option<bool>,
) -> Result<Option<UpdateCheckResult>, String> {
    let _ = (app_handle, channel, allow_same_version, allowSameVersion);
    Ok(None)
}

#[tauri::command]
pub async fn perform_update(
    on_chunk: tauri::ipc::Channel<PerformUpdateProgress>,
) -> Result<String, String> {
    let _ = on_chunk;
    Err("In-app updates are not configured for this 3DRESIN build.".into())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformUpdateProgress {
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub phase: String,
}

#[tauri::command]
pub fn get_saved_update_channel(app_handle: UpdaterAppHandle) -> String {
    let path = app_handle
        .path()
        .app_data_dir()
        .map(|p| p.join("update-channel.txt"));

    match path {
        Ok(path) if path.exists() => std::fs::read_to_string(path)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| value == "stable" || value == "dev")
            .unwrap_or_else(|| "stable".to_string()),
        _ => "stable".to_string(),
    }
}

#[tauri::command]
pub fn save_update_channel(app_handle: UpdaterAppHandle, channel: String) -> Result<(), String> {
    if channel != "stable" && channel != "dev" {
        return Err(format!(
            "Invalid channel '{channel}'. Must be 'stable' or 'dev'."
        ));
    }

    let path = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?
        .join("update-channel.txt");

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create app data dir: {e}"))?;
    }

    std::fs::write(path, channel).map_err(|e| format!("Failed to write update channel: {e}"))
}
