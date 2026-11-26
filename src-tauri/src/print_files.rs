//! Reading and cleaning up sliced print files: whole files, chunks, layer
//! PNGs, island processing on a print file, and the temp-file sweep. Moved out
//! of main.rs.

#[allow(unused_imports)]
use super::*;

#[tauri::command]
pub async fn read_print_file_bytes(source_path: String) -> Result<Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let source = std::path::PathBuf::from(source_path.trim());
        if !source.exists() {
            return Err("Source print file no longer exists on disk".to_string());
        }

        std::fs::read(&source).map_err(|err| format!("Failed reading print file: {err}"))
    })
    .await
    .map_err(|err| format!("Read task failed to join: {err}"))??;

    Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn read_print_file_size(source_path: String) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = std::path::PathBuf::from(source_path.trim());
        if !source.exists() {
            return Err("Source print file no longer exists on disk".to_string());
        }

        std::fs::metadata(&source)
            .map(|meta| meta.len())
            .map_err(|err| format!("Failed reading print file metadata: {err}"))
    })
    .await
    .map_err(|err| format!("Read-size task failed to join: {err}"))?
}

#[tauri::command]
pub async fn read_print_file_chunk(
    source_path: String,
    offset: u64,
    length: u64,
) -> Result<Response, String> {
    const MAX_CHUNK_BYTES: usize = 8 * 1024 * 1024;

    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let source = std::path::PathBuf::from(source_path.trim());
        if !source.exists() {
            return Err("Source print file no longer exists on disk".to_string());
        }

        let mut file = std::fs::File::open(&source)
            .map_err(|err| format!("Failed opening print file: {err}"))?;

        let file_len = file
            .metadata()
            .map_err(|err| format!("Failed reading print file metadata: {err}"))?
            .len();

        if offset >= file_len {
            return Ok(Vec::new());
        }

        let remaining = file_len - offset;
        let requested = length.max(1).min(MAX_CHUNK_BYTES as u64).min(remaining) as usize;

        use std::io::{Read, Seek, SeekFrom};
        file.seek(SeekFrom::Start(offset))
            .map_err(|err| format!("Failed seeking print file chunk: {err}"))?;

        let mut chunk = vec![0u8; requested];
        file.read_exact(&mut chunk)
            .map_err(|err| format!("Failed reading print file chunk: {err}"))?;

        Ok(chunk)
    })
    .await
    .map_err(|err| format!("Read-chunk task failed to join: {err}"))??;

    Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn read_print_layer_png(
    source_path: String,
    layer_number: u32,
    format_hint: String,
) -> Result<Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        if layer_number == 0 {
            return Err("Layer number must be >= 1".to_string());
        }

        let source = std::path::PathBuf::from(source_path.trim());
        if !source.exists() {
            return Err("Source print file no longer exists on disk".to_string());
        }

        dragonfruit_slicing_engine::engine::read_layer_preview_png_by_format_hint(
            &source,
            layer_number,
            &format_hint,
        )
        .map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| format!("Read layer task failed to join: {err}"))??;

    Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn replace_print_layer_pixels_png(
    source_path: String,
    layer_number: u32,
    format_hint: String,
    png_bytes: Vec<u8>,
) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if layer_number == 0 {
            return Err("Layer number must be >= 1".to_string());
        }
        if png_bytes.is_empty() {
            return Err("Edited layer image is empty".to_string());
        }

        let source = std::path::PathBuf::from(source_path.trim());
        if !source.is_file() {
            return Err("Source print file no longer exists on disk".to_string());
        }

        dragonfruit_slicing_engine::engine::replace_print_layer_pixels_png_by_format_hint(
            &source,
            layer_number,
            &format_hint,
            &png_bytes,
        )
        .map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| format!("Edit print layer task failed to join: {err}"))?
}

#[tauri::command]
pub async fn process_print_islands(
    source_path: String,
    format_hint: String,
    minimum_pixels: u32,
    remove: bool,
    progress: tauri::ipc::Channel<(u32, u32)>,
) -> Result<dragonfruit_slicing_engine::encoders::PrintIslandReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = std::path::Path::new(source_path.trim());
        dragonfruit_slicing_engine::engine::process_print_islands_by_format_hint(
            source,
            &format_hint,
            minimum_pixels,
            remove,
            &|done, total| {
                if done == 1 || done == total || done % 8 == 0 {
                    let _ = progress.send((done, total));
                }
            },
        )
        .map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| format!("Print island cleanup task failed to join: {err}"))?
}

/// Decode a run of layer preview PNGs in one round trip, in parallel.
///
/// Each layer costs a file open, an RLE decode and a PNG encode, and the printing workspace
/// wants the layers either side of the one on screen at once. Doing them here means one IPC
/// round trip and as many cores as the machine has, rather than one blocking task per layer,
/// one after another.
///
/// The answer is packed as `[u32 little-endian length][bytes]` per layer, in the order asked
/// for, and an empty entry is a layer that would not decode. It is one binary payload rather
/// than a list of them, which is what the bridge can hand straight to the caller.
#[tauri::command]
pub async fn read_print_layer_pngs(
    source_path: String,
    layer_numbers: Vec<u32>,
    format_hint: String,
) -> Result<Response, String> {
    let packed = tauri::async_runtime::spawn_blocking(move || {
        if layer_numbers.is_empty() {
            return Ok(Vec::new());
        }

        let source = std::path::PathBuf::from(source_path.trim());
        if !source.exists() {
            return Err("Source print file no longer exists on disk".to_string());
        }
        if layer_numbers.iter().any(|number| *number == 0) {
            return Err("Layer number must be >= 1".to_string());
        }

        use rayon::prelude::*;
        let decoded: Vec<Vec<u8>> = layer_numbers
            .par_iter()
            .map(|layer_number| {
                dragonfruit_slicing_engine::engine::read_layer_preview_png_by_format_hint(
                    &source,
                    *layer_number,
                    &format_hint,
                )
                .unwrap_or_default()
            })
            .collect();

        let mut packed: Vec<u8> = Vec::with_capacity(decoded.iter().map(|bytes| bytes.len() + 4).sum());
        for bytes in decoded {
            packed.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
            packed.extend_from_slice(&bytes);
        }

        Ok(packed)
    })
    .await
    .map_err(|err| format!("Read layers task failed to join: {err}"))??;

    Ok(Response::new(packed))
}

/// Which of these paths already exist on disk.
///
/// For a caller about to write files over them: a batch of plate outputs lands in a folder the
/// user picked, and that folder may already hold files of the same names from an earlier run.
#[tauri::command]
pub async fn existing_paths(paths: Vec<String>) -> Result<Vec<bool>, String> {
    let existing = tauri::async_runtime::spawn_blocking(move || {
        paths
            .iter()
            .map(|path| std::path::Path::new(path.trim()).exists())
            .collect::<Vec<bool>>()
    })
    .await
    .map_err(|err| format!("Path check task failed to join: {err}"))?;

    Ok(existing)
}

#[tauri::command]
pub async fn delete_print_temp_file(source_path: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = std::path::PathBuf::from(source_path.trim());
        if !source.exists() {
            return Ok(false);
        }
        if !is_dragonfruit_temp_artifact(&source) {
            return Err("Refusing to delete non-DragonFruit temp artifact path".to_string());
        }
        std::fs::remove_file(&source)
            .map_err(|err| format!("Failed deleting temp artifact: {err}"))?;
        Ok(true)
    })
    .await
    .map_err(|err| format!("Delete task failed to join: {err}"))?
}

#[tauri::command]
pub async fn cleanup_stale_print_temp_files(max_age_seconds: u64) -> Result<u32, String> {
    let age = max_age_seconds.max(60);
    let removed = tauri::async_runtime::spawn_blocking(move || sweep_stale_temp_artifacts(age))
        .await
        .map_err(|err| format!("Cleanup task failed to join: {err}"))?;
    Ok(removed)
}

#[tauri::command]
pub async fn cleanup_all_print_temp_files() -> Result<u32, String> {
    let removed = tauri::async_runtime::spawn_blocking(sweep_all_temp_artifacts)
        .await
        .map_err(|err| format!("Cleanup-all task failed to join: {err}"))?;
    Ok(removed)
}
