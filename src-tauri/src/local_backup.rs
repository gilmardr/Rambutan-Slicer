//! Local backup: a folder the user picks where the scene state, its history
//! snapshots and copies of the model files are kept. Moved out of main.rs.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};

use crate::{
    commit_scene_file_atomic, sibling_commit_temp_path, DragonFruitAppHandle,
    BUILTIN_PLUGIN_SCENE_EXTENSIONS,
};

const LOCAL_BACKUP_STATE_FILE_NAME: &str = "state.json";
const LOCAL_BACKUP_HISTORY_DIR_NAME: &str = "history";
const LOCAL_BACKUP_MODELS_DIR_NAME: &str = "models";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalBackupStateResponse {
    document_json: Option<String>,
    updated_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalBackupSyncResponse {
    synced_at: String,
    history_id: String,
    state_path: String,
    history_path: String,
    model_files_synced: usize,
    model_files_skipped: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalBackupHistoryEntry {
    id: String,
    path: String,
    updated_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalBackupModelLibraryEntry {
    pub(crate) name: String,
    pub(crate) kind: String,
    pub(crate) stored_name: String,
    pub(crate) size_bytes: u64,
    pub(crate) path: String,
    pub(crate) updated_at: String,
    pub(crate) backup_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalBackupReadHistoryResponse {
    document_json: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalBackupRestoreResponse {
    synced_at: Option<String>,
    document_json: String,
}

fn normalize_backup_directory_path(directory_path: &str) -> Result<std::path::PathBuf, String> {
    let trimmed = directory_path.trim();
    if trimmed.is_empty() {
        return Err("Backup directory path is empty".to_string());
    }

    let mut path = std::path::PathBuf::from(trimmed);
    if !path.is_absolute() {
        path = std::env::current_dir()
            .map_err(|err| format!("Failed to resolve current directory: {err}"))?
            .join(path);
    }

    Ok(path)
}

pub(crate) fn local_backup_state_path(root: &std::path::Path) -> std::path::PathBuf {
    root.join(LOCAL_BACKUP_STATE_FILE_NAME)
}

pub(crate) fn local_backup_history_dir(root: &std::path::Path) -> std::path::PathBuf {
    root.join(LOCAL_BACKUP_HISTORY_DIR_NAME)
}

fn is_valid_local_backup_history_id(id: &str) -> bool {
    id.len() == 13 && id.chars().all(|char| char.is_ascii_digit())
}

pub(crate) fn local_backup_history_file_path(
    root: &std::path::Path,
    id: &str,
) -> Result<std::path::PathBuf, String> {
    if !is_valid_local_backup_history_id(id) {
        return Err("Invalid backup history identifier".to_string());
    }

    Ok(local_backup_history_dir(root).join(format!("{id}.json")))
}

fn is_supported_local_backup_model(kind: &str, extension: &str) -> bool {
    match kind {
        "mesh" => matches!(extension, "stl" | "obj" | "3mf"),
        "scene" => {
            extension == "voxl"
                || extension == "lys"
                || BUILTIN_PLUGIN_SCENE_EXTENSIONS.contains(&extension)
        }
        _ => false,
    }
}

fn local_backup_model_asset_path(root: &std::path::Path, stored_name: &str) -> Option<std::path::PathBuf> {
    let (hash, extension) = stored_name.rsplit_once('.')?;
    if hash.len() != 64
        || !hash.chars().all(|character| character.is_ascii_hexdigit())
        || extension.is_empty()
        || extension.len() > 16
        || !extension.chars().all(|character| character.is_ascii_alphanumeric())
    {
        return None;
    }

    Some(
        root.join(LOCAL_BACKUP_MODELS_DIR_NAME)
            .join(format!("{}.{}", hash.to_ascii_lowercase(), extension.to_ascii_lowercase())),
    )
}

fn file_matches_sha256(path: &std::path::Path, expected_hash: &str, expected_size: u64) -> bool {
    let Ok(file) = std::fs::File::open(path) else {
        return false;
    };
    if file.metadata().map(|metadata| metadata.len()).ok() != Some(expected_size) {
        return false;
    }

    let mut reader = std::io::BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let Ok(read) = reader.read(&mut buffer) else {
            return false;
        };
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    format!("{:x}", hasher.finalize()) == expected_hash
}

pub(crate) fn copy_local_backup_model_asset(
    source: &std::path::Path,
    root: &std::path::Path,
    original_name: &str,
) -> Result<(String, u64), String> {
    let extension = std::path::Path::new(original_name)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 16
                && value.chars().all(|character| character.is_ascii_alphanumeric())
        })
        .ok_or_else(|| format!("Unsupported model filename '{original_name}'"))?;

    let source = std::fs::File::open(source)
        .map_err(|error| format!("Failed opening model file '{}': {error}", source.display()))?;
    let models_dir = root.join(LOCAL_BACKUP_MODELS_DIR_NAME);
    std::fs::create_dir_all(&models_dir).map_err(|error| {
        format!(
            "Failed creating model library '{}': {error}",
            models_dir.display()
        )
    })?;

    let temp_target = models_dir.join("model-asset.bin");
    let temp_path = sibling_commit_temp_path(&temp_target)?;
    let copy_result = (|| {
        let mut reader = std::io::BufReader::new(source);
        let mut writer = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&temp_path)
            .map_err(|error| {
                format!(
                    "Failed staging model asset in '{}': {error}",
                    models_dir.display()
                )
            })?;
        let mut hasher = Sha256::new();
        let mut size_bytes = 0_u64;
        let mut buffer = [0_u8; 64 * 1024];

        loop {
            let read = reader
                .read(&mut buffer)
                .map_err(|error| format!("Failed reading model file: {error}"))?;
            if read == 0 {
                break;
            }
            writer
                .write_all(&buffer[..read])
                .map_err(|error| format!("Failed staging model file: {error}"))?;
            hasher.update(&buffer[..read]);
            size_bytes = size_bytes.saturating_add(read as u64);
        }

        writer
            .flush()
            .map_err(|error| format!("Failed flushing staged model file: {error}"))?;
        drop(writer);

        Ok((format!("{:x}", hasher.finalize()), size_bytes))
    })();
    let (hash, size_bytes) = match copy_result {
        Ok(result) => result,
        Err(error) => {
            let _ = std::fs::remove_file(&temp_path);
            return Err(error);
        }
    };

    let stored_name = format!("{hash}.{extension}");
    let destination = models_dir.join(&stored_name);
    if file_matches_sha256(&destination, &hash, size_bytes) {
        std::fs::remove_file(&temp_path).map_err(|error| {
            format!("Failed removing duplicate model staging file: {error}")
        })?;
    } else {
        commit_scene_file_atomic(&temp_path, &destination)?;
    }

    Ok((stored_name, size_bytes))
}

pub(crate) fn sync_local_backup_model_assets(
    root: &std::path::Path,
    document: &mut serde_json::Value,
) -> (usize, usize) {
    let Some(local_storage) = document
        .get_mut("snapshot")
        .and_then(|snapshot| snapshot.get_mut("localStorage"))
        .and_then(serde_json::Value::as_object_mut)
    else {
        return (0, 0);
    };
    let Some(recent_files_json) = local_storage
        .get("app-recent-opened-files")
        .and_then(serde_json::Value::as_str)
    else {
        return (0, 0);
    };
    let Ok(mut recent_files) = serde_json::from_str::<serde_json::Value>(recent_files_json) else {
        return (0, 0);
    };
    let Some(entries) = recent_files.as_array_mut() else {
        return (0, 0);
    };

    let mut assets = Vec::new();
    let mut skipped = 0;
    for entry in entries {
        let Some(record) = entry.as_object_mut() else {
            continue;
        };
        let Some(id) = record
            .get("id")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
        else {
            continue;
        };
        let Some(name) = record
            .get("name")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
        else {
            continue;
        };
        let Some(kind) = record
            .get("kind")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
        else {
            continue;
        };
        let Some(extension) = std::path::Path::new(&name)
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase)
        else {
            continue;
        };
        if !is_supported_local_backup_model(&kind, &extension) {
            if matches!(kind.as_str(), "mesh" | "scene") {
                if record.remove("sourcePath").is_some() {
                    skipped += 1;
                }
            }
            continue;
        }

        let source_path = record
            .get("sourcePath")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|path| !path.is_empty())
            .map(str::to_string);
        let Some(source_path) = source_path else {
            skipped += 1;
            continue;
        };

        match copy_local_backup_model_asset(
            std::path::Path::new(&source_path),
            root,
            &name,
        ) {
            Ok((stored_name, size_bytes)) => {
                record.remove("sourcePath");
                assets.push(serde_json::json!({
                    "id": id,
                    "name": name,
                    "kind": kind,
                    "storedName": stored_name,
                    "sizeBytes": size_bytes,
                }));
            }
            Err(_) => {
                record.remove("sourcePath");
                skipped += 1;
            }
        }
    }

    let files_synced = assets.len();
    if let Some(value) = local_storage.get_mut("app-recent-opened-files") {
        *value = serde_json::Value::String(recent_files.to_string());
    }
    if let Some(snapshot) = document
        .get_mut("snapshot")
        .and_then(serde_json::Value::as_object_mut)
    {
        snapshot.insert("modelAssets".to_string(), serde_json::Value::Array(assets));
    }

    (files_synced, skipped)
}

pub(crate) fn restore_local_backup_model_paths(
    root: &std::path::Path,
    document: &mut serde_json::Value,
) -> usize {
    let Some(snapshot) = document.get("snapshot") else {
        return 0;
    };
    let asset_paths: std::collections::HashMap<String, (String, u64)> = snapshot
        .get("modelAssets")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|asset| {
            let id = asset.get("id")?.as_str()?.to_string();
            let stored_name = asset.get("storedName")?.as_str()?;
            let path = local_backup_model_asset_path(root, stored_name)?;
            if !path.is_file() {
                return None;
            }
            let kind = asset.get("kind")?.as_str()?;
            let extension = std::path::Path::new(stored_name)
                .extension()?
                .to_str()?
                .to_ascii_lowercase();
            if !is_supported_local_backup_model(kind, &extension) {
                return None;
            }
            let size_bytes = asset.get("sizeBytes")?.as_u64()?;
            let expected_hash = stored_name.rsplit_once('.')?.0;
            if !file_matches_sha256(&path, expected_hash, size_bytes) {
                return None;
            }
            Some((id, (path.to_string_lossy().to_string(), size_bytes)))
        })
        .collect();

    let Some(local_storage) = document
        .get_mut("snapshot")
        .and_then(|snapshot| snapshot.get_mut("localStorage"))
        .and_then(serde_json::Value::as_object_mut)
    else {
        return 0;
    };
    let Some(recent_files_json) = local_storage
        .get("app-recent-opened-files")
        .and_then(serde_json::Value::as_str)
    else {
        return 0;
    };
    let Ok(mut recent_files) = serde_json::from_str::<serde_json::Value>(recent_files_json) else {
        return 0;
    };
    let Some(entries) = recent_files.as_array_mut() else {
        return 0;
    };

    let mut restored = 0;
    for entry in entries {
        let Some(record) = entry.as_object_mut() else {
            continue;
        };
        let Some(id) = record.get("id").and_then(serde_json::Value::as_str) else {
            continue;
        };
        if let Some((path, size_bytes)) = asset_paths.get(id) {
            record.insert("sourcePath".to_string(), serde_json::Value::String(path.clone()));
            record.insert("sizeBytes".to_string(), serde_json::Value::from(*size_bytes));
            restored += 1;
        }
    }

    local_storage.insert(
        "app-recent-opened-files".to_string(),
        serde_json::Value::String(recent_files.to_string()),
    );
    restored
}

pub(crate) fn collect_local_backup_model_library(
    root: &std::path::Path,
) -> Result<Vec<LocalBackupModelLibraryEntry>, String> {
    let mut documents = Vec::new();
    let state_path = local_backup_state_path(root);
    if state_path.is_file() {
        documents.push(state_path);
    }

    let history_dir = local_backup_history_dir(root);
    if history_dir.is_dir() {
        let entries = std::fs::read_dir(&history_dir).map_err(|error| {
            format!(
                "Failed listing backup history directory '{}': {error}",
                history_dir.display()
            )
        })?;
        for entry in entries.flatten() {
            let path = entry.path();
            let id = path.file_stem().and_then(|value| value.to_str()).unwrap_or_default();
            if path.is_file()
                && path.extension().and_then(|value| value.to_str()) == Some("json")
                && is_valid_local_backup_history_id(id)
            {
                documents.push(path);
            }
        }
    }

    let mut library = std::collections::HashMap::<String, LocalBackupModelLibraryEntry>::new();
    for path in documents {
        let Ok(raw) = std::fs::read_to_string(path) else {
            continue;
        };
        let Ok(document) = serde_json::from_str::<serde_json::Value>(&raw) else {
            continue;
        };
        let updated_at = document
            .get("updatedAt")
            .and_then(serde_json::Value::as_str)
            .or_else(|| {
                document
                    .get("snapshot")
                    .and_then(|snapshot| snapshot.get("updatedAt"))
                    .and_then(serde_json::Value::as_str)
            })
            .unwrap_or_default()
            .to_string();
        let Some(assets) = document
            .get("snapshot")
            .and_then(|snapshot| snapshot.get("modelAssets"))
            .and_then(serde_json::Value::as_array)
        else {
            continue;
        };

        for asset in assets {
            let (Some(name), Some(kind), Some(stored_name), Some(size_bytes)) = (
                asset.get("name").and_then(serde_json::Value::as_str),
                asset.get("kind").and_then(serde_json::Value::as_str),
                asset.get("storedName").and_then(serde_json::Value::as_str),
                asset.get("sizeBytes").and_then(serde_json::Value::as_u64),
            ) else {
                continue;
            };
            let Some(asset_path) = local_backup_model_asset_path(root, stored_name) else {
                continue;
            };
            let Some((expected_hash, extension)) = stored_name.rsplit_once('.') else {
                continue;
            };
            if !is_supported_local_backup_model(kind, extension)
                || !file_matches_sha256(&asset_path, expected_hash, size_bytes)
            {
                continue;
            }

            let entry = library
                .entry(stored_name.to_string())
                .or_insert_with(|| LocalBackupModelLibraryEntry {
                    name: name.to_string(),
                    kind: kind.to_string(),
                    stored_name: stored_name.to_string(),
                    size_bytes,
                    path: asset_path.to_string_lossy().to_string(),
                    updated_at: updated_at.clone(),
                    backup_count: 0,
                });
            entry.backup_count = entry.backup_count.saturating_add(1);
            if updated_at >= entry.updated_at {
                entry.name = name.to_string();
                entry.kind = kind.to_string();
                entry.size_bytes = size_bytes;
                entry.path = asset_path.to_string_lossy().to_string();
                entry.updated_at = updated_at.clone();
            }
        }
    }

    let mut entries: Vec<_> = library.into_values().collect();
    entries.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.stored_name.cmp(&right.stored_name))
    });
    Ok(entries)
}

pub(crate) fn write_local_backup_file_atomic(
    target: &std::path::Path,
    content: &[u8],
) -> Result<(), String> {
    let temp = sibling_commit_temp_path(target)?;
    if let Err(err) = std::fs::write(&temp, content) {
        let _ = std::fs::remove_file(&temp);
        return Err(format!(
            "Failed staging local backup '{}': {err}",
            target.display()
        ));
    }

    commit_scene_file_atomic(&temp, target).map_err(|error| {
        format!(
            "Failed committing local backup '{}': {error}",
            target.display()
        )
    })
}

fn ensure_local_backup_structure(root: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(|err| {
        format!(
            "Failed creating backup directory '{}': {err}",
            root.display()
        )
    })?;

    std::fs::create_dir_all(local_backup_history_dir(root)).map_err(|err| {
        format!(
            "Failed creating backup history directory '{}': {err}",
            local_backup_history_dir(root).display()
        )
    })?;

    Ok(())
}

fn extract_backup_document_updated_at(raw: &str) -> Option<String> {
    let parsed = serde_json::from_str::<serde_json::Value>(raw).ok()?;

    parsed
        .get("updatedAt")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .or_else(|| {
            parsed
                .get("snapshot")
                .and_then(|snapshot| snapshot.get("updatedAt"))
                .and_then(|value| value.as_str())
                .map(|value| value.to_string())
        })
}

#[tauri::command]
pub async fn local_backup_default_directory(app: DragonFruitAppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;

        let base = app
            .path()
            .app_data_dir()
            .map_err(|err| format!("Failed resolving app data directory: {err}"))?;

        let directory = base.join("backups");
        std::fs::create_dir_all(&directory).map_err(|err| {
            format!(
                "Failed creating default backup directory '{}': {err}",
                directory.display()
            )
        })?;

        Ok(directory.to_string_lossy().to_string())
    })
    .await
    .map_err(|err| format!("Default backup directory task failed to join: {err}"))?
}

#[tauri::command]
pub async fn local_backup_pick_directory(current_path: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = rfd::FileDialog::new();

        if let Some(path) = current_path
            .as_deref()
            .map(str::trim)
            .filter(|path| !path.is_empty())
        {
            dialog = dialog.set_directory(path);
        }

        let picked = dialog
            .pick_folder()
            .ok_or_else(|| "Folder selection cancelled by user".to_string())?;

        Ok(picked.to_string_lossy().to_string())
    })
    .await
    .map_err(|err| format!("Pick backup folder task failed to join: {err}"))?
}

#[tauri::command]
pub async fn local_backup_read_state(
    directory_path: String,
) -> Result<LocalBackupStateResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = normalize_backup_directory_path(&directory_path)?;
        let state_path = local_backup_state_path(&root);

        match std::fs::read_to_string(&state_path) {
            Ok(content) => Ok(LocalBackupStateResponse {
                updated_at: extract_backup_document_updated_at(&content),
                document_json: Some(content),
            }),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(LocalBackupStateResponse {
                    updated_at: None,
                    document_json: None,
                })
            }
            Err(error) => Err(format!(
                "Failed reading backup state file '{}': {error}",
                state_path.display()
            )),
        }
    })
    .await
    .map_err(|err| format!("Read backup state task failed to join: {err}"))?
}

#[tauri::command]
pub async fn local_backup_sync(
    directory_path: String,
    document_json: String,
) -> Result<LocalBackupSyncResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = normalize_backup_directory_path(&directory_path)?;
        ensure_local_backup_structure(&root)?;

        let mut parsed = serde_json::from_str::<serde_json::Value>(&document_json)
            .map_err(|err| format!("Invalid backup document JSON: {err}"))?;
        let (model_files_synced, model_files_skipped) =
            sync_local_backup_model_assets(&root, &mut parsed);
        let normalized_document = serde_json::to_string_pretty(&parsed)
            .map_err(|err| format!("Failed formatting backup document JSON: {err}"))?;

        let synced_at = parsed
            .get("updatedAt")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string())
            .or_else(|| {
                parsed
                    .get("snapshot")
                    .and_then(|snapshot| snapshot.get("updatedAt"))
                    .and_then(|value| value.as_str())
                    .map(|value| value.to_string())
            })
            .unwrap_or_else(|| String::new());

        let history_id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis().to_string())
            .unwrap_or_else(|_| "0".to_string());

        let state_path = local_backup_state_path(&root);
        let history_path = local_backup_history_file_path(&root, &history_id)?;

        write_local_backup_file_atomic(&history_path, normalized_document.as_bytes())?;
        write_local_backup_file_atomic(&state_path, normalized_document.as_bytes())?;

        Ok(LocalBackupSyncResponse {
            synced_at,
            history_id,
            state_path: state_path.to_string_lossy().to_string(),
            history_path: history_path.to_string_lossy().to_string(),
            model_files_synced,
            model_files_skipped,
        })
    })
    .await
    .map_err(|err| format!("Local backup sync task failed to join: {err}"))?
}

#[tauri::command]
pub async fn local_backup_list_history(
    directory_path: String,
) -> Result<Vec<LocalBackupHistoryEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = normalize_backup_directory_path(&directory_path)?;
        let history_dir = local_backup_history_dir(&root);

        if !history_dir.exists() {
            return Ok(Vec::new());
        }

        let read_dir = std::fs::read_dir(&history_dir).map_err(|err| {
            format!(
                "Failed listing backup history directory '{}': {err}",
                history_dir.display()
            )
        })?;

        let mut entries: Vec<LocalBackupHistoryEntry> = Vec::new();

        for dir_entry in read_dir.flatten() {
            let path = dir_entry.path();
            if !path.is_file() {
                continue;
            }

            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| value.to_ascii_lowercase())
                .unwrap_or_default();
            if extension != "json" {
                continue;
            }

            let id = path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_string();
            if !is_valid_local_backup_history_id(&id) {
                continue;
            }

            let updated_at = std::fs::read_to_string(&path)
                .ok()
                .and_then(|content| extract_backup_document_updated_at(&content));

            entries.push(LocalBackupHistoryEntry {
                id,
                path: path.to_string_lossy().to_string(),
                updated_at,
            });
        }

        entries.sort_by(|left, right| right.id.cmp(&left.id));

        Ok(entries)
    })
    .await
    .map_err(|err| format!("List local backup history task failed to join: {err}"))?
}

#[tauri::command]
pub async fn local_backup_list_model_library(
    directory_path: String,
) -> Result<Vec<LocalBackupModelLibraryEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = normalize_backup_directory_path(&directory_path)?;
        collect_local_backup_model_library(&root)
    })
    .await
    .map_err(|err| format!("List local backup model library task failed to join: {err}"))?
}

#[tauri::command]
pub async fn local_backup_read_history_item(
    directory_path: String,
    id: String,
) -> Result<LocalBackupReadHistoryResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = normalize_backup_directory_path(&directory_path)?;
        let history_path = local_backup_history_file_path(&root, id.trim())?;

        let document_json = std::fs::read_to_string(&history_path).map_err(|err| {
            format!(
                "Failed reading backup history file '{}': {err}",
                history_path.display()
            )
        })?;

        Ok(LocalBackupReadHistoryResponse { document_json })
    })
    .await
    .map_err(|err| format!("Read local backup history item task failed to join: {err}"))?
}

#[tauri::command]
pub async fn local_backup_delete_history_item(
    directory_path: String,
    id: String,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = normalize_backup_directory_path(&directory_path)?;
        let history_path = local_backup_history_file_path(&root, id.trim())?;

        match std::fs::remove_file(&history_path) {
            Ok(()) => Ok(true),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(format!(
                "Failed deleting backup history file '{}': {error}",
                history_path.display()
            )),
        }
    })
    .await
    .map_err(|err| format!("Delete local backup history item task failed to join: {err}"))?
}

#[tauri::command]
pub async fn local_backup_restore_history_item(
    directory_path: String,
    id: String,
) -> Result<LocalBackupRestoreResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = normalize_backup_directory_path(&directory_path)?;
        ensure_local_backup_structure(&root)?;

        let history_path = local_backup_history_file_path(&root, id.trim())?;
        let state_path = local_backup_state_path(&root);

        let source_document_json = std::fs::read_to_string(&history_path).map_err(|err| {
            format!(
                "Failed reading backup history file '{}': {err}",
                history_path.display()
            )
        })?;
        let mut document = serde_json::from_str::<serde_json::Value>(&source_document_json)
            .map_err(|err| format!("Invalid backup history document JSON: {err}"))?;
        restore_local_backup_model_paths(&root, &mut document);
        let document_json = serde_json::to_string_pretty(&document)
            .map_err(|err| format!("Failed formatting restored backup document: {err}"))?;

        write_local_backup_file_atomic(&state_path, document_json.as_bytes())?;

        Ok(LocalBackupRestoreResponse {
            synced_at: extract_backup_document_updated_at(&document_json),
            document_json,
        })
    })
    .await
    .map_err(|err| format!("Restore local backup history item task failed to join: {err}"))?
}
