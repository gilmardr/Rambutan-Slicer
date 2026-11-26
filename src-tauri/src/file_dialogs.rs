//! File dialogs and the scene files the app is launched with: saving print
//! files, picking paths to save or open, handing launch arguments to the
//! window, and focusing or revealing the main window. Moved out of main.rs.

#[allow(unused_imports)]
use super::*;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SavePrintFileArgs {
    default_filename: String,
    bytes: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SavePrintFileFromPathArgs {
    default_filename: String,
    source_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PickSavePathArgs {
    default_filename: String,
    #[serde(default)]
    filters: Option<Vec<SaveDialogFilterDef>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WriteBytesToPathArgs {
    destination_path: String,
    bytes: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PickOpenFilesArgs {
    category: String,
    multiple: bool,
    /// Optional override for the "Scene Files" filter extension list. When set,
    /// the dialog uses exactly these extensions (e.g. so gated file types like
    /// .chitubox behind a disabled experiment are hidden from the filter).
    scene_extensions: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PickedOpenFile {
    path: String,
    name: String,
}

pub(crate) fn is_scene_file_path(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let normalized = ext.trim().trim_start_matches('.');
            normalized.eq_ignore_ascii_case("voxl")
                || BUILTIN_PLUGIN_SCENE_EXTENSIONS
                    .iter()
                    .any(|&s| normalized.eq_ignore_ascii_case(s))
        })
        .unwrap_or(false)
}

pub(crate) fn collect_scene_file_paths_from_args(args: &[String]) -> Vec<String> {
    let mut files: Vec<String> = Vec::new();

    for arg in args.iter().skip(1) {
        let trimmed = arg.trim();
        if trimmed.is_empty() {
            continue;
        }

        let path = std::path::PathBuf::from(trimmed);
        if !path.is_file() {
            continue;
        }

        if !is_scene_file_path(&path) {
            continue;
        }

        files.push(path.to_string_lossy().to_string());
    }

    files
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SceneFileHandoffPayload {
    paths: Vec<String>,
    source: String,
}

pub(crate) fn build_open_dialog_with_filters(
    category: &str,
    scene_extensions: Option<&[String]>,
) -> rfd::FileDialog {
    let mut dialog = rfd::FileDialog::new();

    // Build scene extension list: the frontend-provided override when present
    // (so gated file types are hidden), otherwise voxl + all plugin-registered
    // extensions + zip (for bundles).
    let scene_exts: Vec<&str> = match scene_extensions {
        Some(extensions) => extensions
            .iter()
            .map(|extension| extension.as_str())
            .collect(),
        None => {
            let mut fallback = vec!["voxl"];
            fallback.extend_from_slice(BUILTIN_PLUGIN_SCENE_EXTENSIONS);
            fallback.push("zip");
            fallback
        }
    };

    let normalized = category.trim().to_ascii_lowercase();
    dialog = match normalized.as_str() {
        "mesh" => dialog.add_filter("Mesh Files", &["stl", "obj", "3mf", "step", "stp", "zip"]),
        "scene" => dialog.add_filter("Scene Files", &scene_exts),
        "bundle" => dialog.add_filter("JSON Files", &["json"]),
        "image" => dialog.add_filter("Image Files", &["png", "jpg", "jpeg", "webp"]),
        _ => dialog
            .add_filter("Mesh Files", &["stl", "obj", "3mf", "step", "stp", "zip"])
            .add_filter("Scene Files", &scene_exts),
    };

    dialog
}

#[tauri::command]
pub async fn save_print_file(args: SavePrintFileArgs) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let suggested_name = {
            let trimmed = args.default_filename.trim();
            if trimmed.is_empty() {
                let format_provider = plugin_registry::get_format_provider()
                    .unwrap_or_else(|_| plugin_registry::get_default_format_provider());
                format_provider.default_export_filename()
            } else {
                trimmed.to_string()
            }
        };

        let picked = build_save_dialog_with_filters(&suggested_name, None)
            .save_file()
            .ok_or_else(|| "Save cancelled by user".to_string())?;

        if let Some(parent) = picked.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|err| format!("Failed creating destination folder: {err}"))?;
        }

        std::fs::write(&picked, &args.bytes)
            .map_err(|err| format!("Failed saving print file: {err}"))?;

        Ok(picked.to_string_lossy().to_string())
    })
    .await
    .map_err(|err| format!("Save task failed to join: {err}"))?
}

#[tauri::command]
pub async fn save_print_file_from_path(args: SavePrintFileFromPathArgs) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let suggested_name = {
            let trimmed = args.default_filename.trim();
            if trimmed.is_empty() {
                let format_provider = plugin_registry::get_format_provider()
                    .unwrap_or_else(|_| plugin_registry::get_default_format_provider());
                format_provider.default_export_filename()
            } else {
                trimmed.to_string()
            }
        };

        let source = std::path::PathBuf::from(args.source_path.trim());
        if !source.exists() {
            return Err("Source print file no longer exists on disk".to_string());
        }

        let picked = build_save_dialog_with_filters(&suggested_name, None)
            .save_file()
            .ok_or_else(|| "Save cancelled by user".to_string())?;

        if let Some(parent) = picked.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|err| format!("Failed creating destination folder: {err}"))?;
        }

        std::fs::copy(&source, &picked)
            .map_err(|err| format!("Failed saving print file: {err}"))?;

        Ok(picked.to_string_lossy().to_string())
    })
    .await
    .map_err(|err| format!("Save task failed to join: {err}"))?
}

#[tauri::command]
pub async fn pick_save_path(args: PickSavePathArgs) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let suggested_name = {
            let trimmed = args.default_filename.trim();
            if trimmed.is_empty() {
                let format_provider = plugin_registry::get_format_provider()
                    .unwrap_or_else(|_| plugin_registry::get_default_format_provider());
                format_provider.default_export_filename()
            } else {
                trimmed.to_string()
            }
        };

        let picked = build_save_dialog_with_filters(&suggested_name, args.filters.as_deref())
            .save_file()
            .ok_or_else(|| "Save cancelled by user".to_string())?;

        Ok(picked.to_string_lossy().to_string())
    })
    .await
    .map_err(|err| format!("Save picker task failed to join: {err}"))?
}

#[tauri::command]
pub async fn write_bytes_to_path(args: WriteBytesToPathArgs) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let trimmed_destination = args.destination_path.trim();
        if trimmed_destination.is_empty() {
            return Err("Destination path is empty".to_string());
        }

        let destination = std::path::PathBuf::from(trimmed_destination);

        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|err| format!("Failed creating destination folder: {err}"))?;
        }

        std::fs::write(&destination, &args.bytes)
            .map_err(|err| format!("Failed writing file bytes: {err}"))?;

        Ok(destination.to_string_lossy().to_string())
    })
    .await
    .map_err(|err| format!("Write-bytes task failed to join: {err}"))?
}

#[tauri::command]
pub async fn pick_open_files(args: PickOpenFilesArgs) -> Result<Vec<PickedOpenFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dialog =
            build_open_dialog_with_filters(&args.category, args.scene_extensions.as_deref());

        let picked_paths: Vec<std::path::PathBuf> = if args.multiple {
            dialog.pick_files().unwrap_or_default()
        } else {
            match dialog.pick_file() {
                Some(path) => vec![path],
                None => Vec::new(),
            }
        };

        if picked_paths.is_empty() {
            return Err("Open cancelled by user".to_string());
        }

        let files = picked_paths
            .into_iter()
            .map(|path| PickedOpenFile {
                name: path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("file")
                    .to_string(),
                path: path.to_string_lossy().to_string(),
            })
            .collect::<Vec<_>>();

        Ok(files)
    })
    .await
    .map_err(|err| format!("Open picker task failed to join: {err}"))?
}

#[tauri::command]
pub async fn get_launch_scene_files() -> Result<Vec<PickedOpenFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let files = collect_scene_file_paths_from_args(&std::env::args().collect::<Vec<_>>())
            .into_iter()
            .map(|path_text| {
                let path = std::path::PathBuf::from(&path_text);
                PickedOpenFile {
                    name: path
                        .file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or("file")
                        .to_string(),
                    path: path_text,
                }
            })
            .collect::<Vec<_>>();

        Ok(files)
    })
    .await
    .map_err(|err| format!("Launch scene-files task failed to join: {err}"))?
}

pub(crate) fn emit_scene_file_handoff(app: &DragonFruitAppHandle, args: &[String], source: &str) {
    let paths = collect_scene_file_paths_from_args(args);
    if paths.is_empty() {
        return;
    }

    let payload = SceneFileHandoffPayload {
        paths,
        source: source.to_string(),
    };

    let _ = app.emit("dragonfruit://scene-file-handoff", payload);
}

pub(crate) fn focus_main_window(app: &DragonFruitAppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let is_visible = window.is_visible().unwrap_or(true);
        if !is_visible {
            let _ = window.show();
        }

        let is_minimized = window.is_minimized().unwrap_or(false);
        if is_minimized {
            let _ = window.unminimize();
        }

        let is_focused = window.is_focused().unwrap_or(false);
        if !is_focused {
            let _ = window.set_focus();
        }
    }
}

#[tauri::command]
pub fn get_slicer_engine_version() -> &'static str {
    dragonfruit_slicing_engine::ENGINE_VERSION
}

#[tauri::command]
pub async fn notify_launch_scene_handoff(app: DragonFruitAppHandle) -> Result<(), String> {
    let args = std::env::args().collect::<Vec<_>>();
    emit_scene_file_handoff(&app, &args, "primary-launch");
    Ok(())
}

#[tauri::command]
pub async fn focus_main_window_command(app: DragonFruitAppHandle) -> Result<(), String> {
    focus_main_window(&app);
    Ok(())
}

/// Reveals the main window without calling set_focus().
/// Used at startup to avoid triggering the Windows focus-stealing prevention
/// mechanism, which plays an error sound when SetForegroundWindow is called
/// from a process that does not currently own the foreground.
/// Also closes the splash screen window if it is still open.
#[tauri::command]
pub async fn reveal_main_window_command(app: DragonFruitAppHandle) -> Result<(), String> {
    // Show the main window first so there is no gap between splash close and
    // main window appearance (which would expose the desktop for a frame).
    // Geometry (restored session state or first-launch maximize) was already
    // applied at window creation, so showing here causes no resize flash.
    if let Some(window) = app.get_webview_window("main") {
        let is_visible = window.is_visible().unwrap_or(true);
        if !is_visible {
            // Re-enable taskbar entry just before we make the window visible.
            #[cfg(target_os = "windows")]
            let _ = window.set_skip_taskbar(false);
            let _ = window.show();
        }
    }
    if let Some(splash) = app.get_webview_window("splashscreen") {
        let _ = splash.close();
    }
    Ok(())
}
