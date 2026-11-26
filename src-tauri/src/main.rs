#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod mesh_minima;
mod mesh_repair;
mod mesh_refine;
mod network;
mod ao_vertex;
mod overhang;
mod spacemouse;
mod updater_channel;

fn default_minimum_aa_alpha_percent() -> f32 {
    35.0
}

fn default_blur_brush_radius_px() -> u32 {
    1
}

fn default_blur_brush_kernel() -> String {
    "gaussian".to_string()
}

fn default_blur_brush_sigma_x() -> f64 {
    0.5
}

fn default_blur_brush_sigma_y() -> f64 {
    0.5
}

fn default_z_blur_radius_layers() -> u32 {
    0
}

fn default_z_blur_kernel() -> String {
    "box".to_string()
}

fn default_z_blur_sigma() -> f64 {
    0.5
}

fn default_anti_aliasing_mode() -> String {
    "Blur".to_string()
}

fn default_z_blend_look_back() -> u32 {
    2
}

fn default_z_blend_max_alpha_percent() -> f32 {
    90.0
}

fn default_dither_device_gamma() -> f64 {
    3.0
}

mod experiments;
mod island_scan;
mod local_backup;
mod print_files;
mod external;
mod file_dialogs;
mod logging;
mod scene_autosave;
mod plugin_registry;
mod webview_watchdog;
mod window_state;

use rayon::{ThreadPool, ThreadPoolBuilder};
use serde::Deserialize;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::ipc::{InvokeBody, Response};
use tauri::Emitter;
use tauri::Manager;
use base64::Engine as _;

// Runtime type aliases — the feat/cef branch requires an explicit runtime
// generic. These select Cef or Wry based on the active cargo feature.
#[cfg(feature = "tauri-cef")]
type DragonFruitAppHandle = tauri::AppHandle<tauri::Cef>;
#[cfg(not(feature = "tauri-cef"))]
type DragonFruitAppHandle = tauri::AppHandle<tauri::Wry>;

#[cfg(feature = "tauri-cef")]
type DragonFruitWindow = tauri::Window<tauri::Cef>;
#[cfg(not(feature = "tauri-cef"))]
type DragonFruitWindow = tauri::Window<tauri::Wry>;

/// Scene file extensions contributed by built-in fileType plugins — auto-generated, do not edit.
use plugin_registry::GENERATED_BUILTIN_PLUGIN_SCENE_FILE_EXTENSIONS as BUILTIN_PLUGIN_SCENE_EXTENSIONS;
#[allow(unused_imports)]
use print_files::*;
#[allow(unused_imports)]
use external::*;
#[allow(unused_imports)]
use file_dialogs::*;
#[allow(unused_imports)]
use logging::*;

fn temp_artifact_path(extension: &str) -> std::path::PathBuf {
    let mut path = std::env::temp_dir();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let clean_ext = extension.trim_start_matches('.');
    path.push(format!("dragonfruit-slice-{stamp}.{clean_ext}"));
    path
}

/// Marker that identifies a scene-file commit temp. Must stay byte-identical:
/// `is_scene_commit_temp_path` gates the discard command on it, so an arbitrary
/// caller-supplied path can never be deleted through that seam.
const SCENE_COMMIT_TEMP_MARKER: &str = ".tmp-";

/// Allocates the staging file for an atomic scene-file commit, as a **sibling**
/// of the target: `<target>.tmp-<pid>-<seq>`.
///
/// Sibling by construction is what makes the commit atomic — `fs::rename` is
/// only guaranteed atomic within a volume, and a temp-dir staging file can
/// easily be on a different one (a project on D:, `%TEMP%` on C:).
///
/// pid + a process-wide counter, the same idiom as
/// `allocate_mesh_stage_file_path` / `temp_artifact_path` above: nanos alone are
/// NOT unique because Windows `SystemTime` granularity lets two concurrent
/// allocations land in the same tick, and the consumer opens with
/// `truncate(true)` — two in-flight saves sharing a name would let one overwrite
/// the other's staging bytes and then rename the wrong content over the user's
/// project. Unlike those two helpers the nanos stamp is deliberately **omitted**
/// here: these temps live next to the user's project rather than in `%TEMP%`,
/// and a bounded per-process name space means a hard crash leaves at most one
/// residue file per concurrent write (reused and truncated by a later run)
/// instead of an unbounded pile of dead files in the user's folder.
fn sibling_commit_temp_path(target: &std::path::Path) -> Result<std::path::PathBuf, String> {
    static COMMIT_TEMP_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            format!(
                "Cannot stage an atomic commit for '{}': no UTF-8 file name",
                target.display()
            )
        })?;

    let parent = target.parent().unwrap_or_else(|| std::path::Path::new("."));
    if !parent.as_os_str().is_empty() {
        std::fs::create_dir_all(parent).map_err(|err| {
            format!(
                "Failed creating destination directory '{}': {err}",
                parent.display()
            )
        })?;
    }

    Ok(parent.join(format!(
        "{file_name}{SCENE_COMMIT_TEMP_MARKER}{}-{}",
        std::process::id(),
        COMMIT_TEMP_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
    )))
}

fn is_scene_commit_temp_path(path: &std::path::Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| {
            let Some((_, suffix)) = name.rsplit_once(SCENE_COMMIT_TEMP_MARKER) else {
                return false;
            };
            let mut parts = suffix.split('-');
            let pid_ok = parts
                .next()
                .map(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
                .unwrap_or(false);
            let seq_ok = parts
                .next()
                .map(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
                .unwrap_or(false);
            pid_ok && seq_ok && parts.next().is_none()
        })
        .unwrap_or(false)
}

const SCENE_COMMIT_RENAME_BACKOFF_MS: [u64; 3] = [50, 150, 300];

/// Commits a fully-written staging file over `target` atomically: fsync the
/// temp, then rename it into place. Either the reader sees the previous good
/// file or it sees the new one — never a truncated prefix of either.
///
/// The bounded retry is a Windows concession: a rename can transiently fail with
/// `ERROR_ACCESS_DENIED` / `ERROR_SHARING_VIOLATION` while an antivirus scanner
/// or an Explorer thumbnailer holds the destination open.
///
/// On terminal failure the temp is removed and the **previous good target is
/// left untouched** — strictly better than the pre-Ph0.1 writer, which had
/// already destroyed it by the time anything could fail.
fn commit_scene_file_atomic(
    temp: &std::path::Path,
    target: &std::path::Path,
) -> Result<(), String> {
    if !temp.exists() {
        return Err(format!(
            "Atomic commit staging file is missing: {}",
            temp.display()
        ));
    }

    // fsync the payload BEFORE the rename, or a power loss can leave the
    // rename durable while the bytes it points at are not.
    //
    // Opened for write rather than read-only (the obvious choice on unix):
    // Windows `FlushFileBuffers` requires write access to the handle, so a
    // read-only handle would fail with ERROR_ACCESS_DENIED on the platform this
    // ships to first.
    let sync_result = std::fs::OpenOptions::new()
        .write(true)
        .open(temp)
        .and_then(|file| file.sync_all());
    if let Err(err) = sync_result {
        let _ = std::fs::remove_file(temp);
        return Err(format!(
            "Failed flushing '{}' to disk before commit: {err}",
            temp.display()
        ));
    }

    let mut last_error: Option<String> = None;
    for (attempt, backoff_ms) in SCENE_COMMIT_RENAME_BACKOFF_MS.iter().enumerate() {
        match std::fs::rename(temp, target) {
            Ok(()) => {
                // Best-effort directory fsync so the rename itself is durable.
                // No portable Windows equivalent (a directory cannot be opened
                // as a file), where NTFS metadata journalling covers it.
                #[cfg(unix)]
                {
                    if let Some(parent) = target.parent() {
                        if let Ok(dir) = std::fs::File::open(parent) {
                            let _ = dir.sync_all();
                        }
                    }
                }
                return Ok(());
            }
            Err(err) => {
                last_error = Some(err.to_string());
                if attempt + 1 < SCENE_COMMIT_RENAME_BACKOFF_MS.len() {
                    std::thread::sleep(std::time::Duration::from_millis(*backoff_ms));
                }
            }
        }
    }

    let _ = std::fs::remove_file(temp);
    Err(format!(
        "Failed committing '{}' over '{}' after {} attempts: {}",
        temp.display(),
        target.display(),
        SCENE_COMMIT_RENAME_BACKOFF_MS.len(),
        last_error.unwrap_or_else(|| "unknown error".to_string()),
    ))
}

/// **User invariant: autosave ALWAYS writes `.voxl`.**
///
/// Deliberately NOT `is_scene_file_path`, which also accepts every plugin scene
/// extension (`BUILTIN_PLUGIN_SCENE_EXTENSIONS`). Autosave emits VOXL bytes, so
/// a plugin-format project must never be handed back as the autosave target —
/// that would write VOXL into a file whose extension promises a foreign format.
/// Since sub-phase B such a project gets a correctly-named
/// `<stem>_autosave.voxl` sidecar instead of being handed back verbatim, and
/// `resolve_scene_autosave_target` uses this predicate to check its own output
/// before returning it.
fn is_voxl_autosave_target(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            ext.trim()
                .trim_start_matches('.')
                .eq_ignore_ascii_case("voxl")
        })
        .unwrap_or(false)
}

/// Allocates the sibling staging path for an atomic scene-file write.
#[tauri::command]
async fn scene_file_begin_atomic_write(target_path: String) -> Result<String, String> {
    let trimmed = target_path.trim().to_string();
    if trimmed.is_empty() {
        return Err("scene_file_begin_atomic_write requires a non-empty target path".into());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let temp = sibling_commit_temp_path(std::path::Path::new(&trimmed))?;
        Ok(temp.to_string_lossy().to_string())
    })
    .await
    .map_err(|err| format!("scene_file_begin_atomic_write task failed: {err}"))?
}

/// fsync + atomic rename of a staged scene file over its destination.
#[tauri::command]
async fn scene_file_commit_atomic(temp_path: String, target_path: String) -> Result<(), String> {
    let temp = temp_path.trim().to_string();
    let target = target_path.trim().to_string();
    if temp.is_empty() || target.is_empty() {
        return Err("scene_file_commit_atomic requires non-empty temp and target paths".into());
    }

    tauri::async_runtime::spawn_blocking(move || {
        commit_scene_file_atomic(std::path::Path::new(&temp), std::path::Path::new(&target))
    })
    .await
    .map_err(|err| format!("scene_file_commit_atomic task failed: {err}"))?
}

/// Removes an abandoned commit staging file (the write failed before commit),
/// so a failed save does not litter the user's project folder.
///
/// Gated on `is_scene_commit_temp_path`: this command can only ever delete a
/// path this process's own allocator could have produced, never an arbitrary
/// caller-supplied file.
#[tauri::command]
async fn scene_file_discard_atomic_temp(temp_path: String) -> Result<(), String> {
    let temp = temp_path.trim().to_string();
    if temp.is_empty() {
        return Err("scene_file_discard_atomic_temp requires a non-empty path".into());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let path = std::path::Path::new(&temp);
        if !is_scene_commit_temp_path(path) {
            return Err(format!(
                "Refusing to discard '{temp}': not a scene-file commit temp"
            ));
        }
        if path.exists() {
            std::fs::remove_file(path)
                .map_err(|err| format!("Failed discarding commit temp '{temp}': {err}"))?;
        }
        Ok(())
    })
    .await
    .map_err(|err| format!("scene_file_discard_atomic_temp task failed: {err}"))?
}

fn is_dragonfruit_temp_artifact(path: &std::path::Path) -> bool {
    let file_name_ok = path
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.starts_with("dragonfruit-slice-"))
        .unwrap_or(false);
    let in_temp_dir = path.starts_with(std::env::temp_dir());
    file_name_ok && in_temp_dir
}

fn sweep_stale_temp_artifacts(max_age_seconds: u64) -> u32 {
    let mut removed = 0u32;
    let temp_dir = std::env::temp_dir();
    let cutoff = std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(max_age_seconds))
        .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

    let entries = match std::fs::read_dir(&temp_dir) {
        Ok(entries) => entries,
        Err(_) => return 0,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !is_dragonfruit_temp_artifact(&path) {
            continue;
        }

        let stale = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .map(|modified| modified <= cutoff)
            .unwrap_or(false);

        if stale && std::fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }

    removed
}

fn sweep_all_temp_artifacts() -> u32 {
    let mut removed = 0u32;
    let temp_dir = std::env::temp_dir();
    let entries = match std::fs::read_dir(&temp_dir) {
        Ok(entries) => entries,
        Err(_) => return 0,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !is_dragonfruit_temp_artifact(&path) {
            continue;
        }
        if std::fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }

    removed
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SaveDialogFilterDef {
    name: String,
    extensions: Vec<String>,
}

fn build_save_dialog_with_filters(
    suggested_name: &str,
    custom_filters: Option<&[SaveDialogFilterDef]>,
) -> rfd::FileDialog {
    let mut dialog = rfd::FileDialog::new().set_file_name(suggested_name);

    if let Some(filters) = custom_filters {
        for filter in filters {
            let trimmed_name = filter.name.trim();
            if trimmed_name.is_empty() {
                continue;
            }

            let normalized_exts: Vec<String> = filter
                .extensions
                .iter()
                .map(|ext| ext.trim().trim_start_matches('.').to_ascii_lowercase())
                .filter(|ext| !ext.is_empty())
                .collect();

            if normalized_exts.is_empty() {
                continue;
            }

            let ext_refs: Vec<&str> = normalized_exts.iter().map(String::as_str).collect();
            dialog = dialog.add_filter(trimmed_name, &ext_refs);
        }

        return dialog;
    }

    let maybe_ext = std::path::Path::new(suggested_name)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.trim().trim_start_matches('.').to_ascii_lowercase())
        .filter(|ext| !ext.is_empty());

    if let Some(ext) = maybe_ext.as_deref() {
        dialog = match ext {
            "stl" | "obj" | "3mf" => dialog.add_filter("Mesh Files", &["stl", "obj", "3mf"]),
            "voxl" => dialog.add_filter("Scene Files", &["voxl"]),
            x if BUILTIN_PLUGIN_SCENE_EXTENSIONS.contains(&x) => {
                dialog.add_filter("Scene Files", BUILTIN_PLUGIN_SCENE_EXTENSIONS)
            }
            "json" => dialog.add_filter("JSON Files", &["json"]),
            _ => dialog.add_filter("Print Files", &[ext]),
        };
    }

    dialog
}

static SLICER_POOL: OnceLock<ThreadPool> = OnceLock::new();
static CANCEL_FLAG: OnceLock<Arc<AtomicBool>> = OnceLock::new();
static STAGED_MESH: OnceLock<Mutex<Option<Vec<u8>>>> = OnceLock::new();
static STAGED_MESH_STATS: OnceLock<Mutex<StageMeshStats>> = OnceLock::new();
static STAGED_MESH_FILE_PATH: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static STAGED_MESH_FILE_APPENDER: OnceLock<Mutex<Option<StageFileAppender>>> = OnceLock::new();
const STAGED_MESH_PREALLOC_MIN_BYTES: usize = 16 * 1024 * 1024;
const STAGED_MESH_PREALLOC_MAX_BYTES: usize = 1024 * 1024 * 1024;

pub(crate) struct StageFileAppender {
    pub path: String,
    pub writer: std::io::BufWriter<std::fs::File>,
    #[allow(dead_code)]
    pub len: u64,
}

#[derive(Default, Clone, PartialEq)]
pub(crate) struct StageMeshStats {
    pub chunks_received: u64,
    pub append_ns_total: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StageMeshChunkAck {
    chunk_bytes: u64,
    total_bytes: u64,
    capacity_bytes: u64,
    reserve_grew: bool,
    chunks_received: u64,
    append_ns: u64,
    append_ns_total: u64,
}

pub(crate) fn staged_mesh() -> &'static Mutex<Option<Vec<u8>>> {
    STAGED_MESH.get_or_init(|| Mutex::new(None))
}

pub(crate) fn staged_mesh_stats() -> &'static Mutex<StageMeshStats> {
    STAGED_MESH_STATS.get_or_init(|| Mutex::new(StageMeshStats::default()))
}

pub(crate) fn staged_mesh_file_path() -> &'static Mutex<Option<String>> {
    STAGED_MESH_FILE_PATH.get_or_init(|| Mutex::new(None))
}

pub(crate) fn staged_mesh_file_appender() -> &'static Mutex<Option<StageFileAppender>> {
    STAGED_MESH_FILE_APPENDER.get_or_init(|| Mutex::new(None))
}

fn resolve_mesh_stage_directory() -> std::path::PathBuf {
    let configured = std::env::var("DF_MESH_STAGE_DIR")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .map(std::path::PathBuf::from);

    configured.unwrap_or_else(std::env::temp_dir)
}

fn allocate_mesh_stage_file_path() -> Result<std::path::PathBuf, String> {
    let mut dir = resolve_mesh_stage_directory();
    std::fs::create_dir_all(&dir).map_err(|e| {
        format!(
            "Failed creating mesh stage directory '{}': {e}",
            dir.display()
        )
    })?;

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    dir.push(format!("dragonfruit-mesh-stage-{stamp}.bin"));
    Ok(dir)
}

fn normalize_staged_mesh_prealloc_bytes(total_bytes_hint: usize) -> usize {
    total_bytes_hint
        .max(STAGED_MESH_PREALLOC_MIN_BYTES)
        .min(STAGED_MESH_PREALLOC_MAX_BYTES)
}

fn bytes_to_f32_vec(bytes: &[u8]) -> Result<Vec<f32>, String> {
    if bytes.len() % 4 != 0 {
        return Err(format!(
            "Mesh binary length {} is not a multiple of 4 (f32 size)",
            bytes.len()
        ));
    }

    // Fast path on little-endian targets (Windows/macOS/Linux desktop):
    // memcpy raw bytes into a pre-sized Vec<f32> to avoid per-float conversion overhead.
    #[cfg(target_endian = "little")]
    {
        let count = bytes.len() / 4;
        let mut floats = vec![0.0f32; count];
        unsafe {
            std::ptr::copy_nonoverlapping(
                bytes.as_ptr(),
                floats.as_mut_ptr() as *mut u8,
                bytes.len(),
            );
        }
        return Ok(floats);
    }

    #[cfg(not(target_endian = "little"))]
    {
        let count = bytes.len() / 4;
        let mut floats = Vec::with_capacity(count);
        for chunk in bytes.chunks_exact(4) {
            floats.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
        }
        Ok(floats)
    }
}

fn bytes_into_f32_vec(bytes: Vec<u8>) -> Result<Vec<f32>, String> {
    if bytes.len() % 4 != 0 {
        return Err(format!(
            "Mesh binary length {} is not a multiple of 4 (f32 size)",
            bytes.len()
        ));
    }

    #[cfg(target_endian = "little")]
    {
        let ptr_addr = bytes.as_ptr() as usize;
        let aligned_for_f32 = ptr_addr % std::mem::align_of::<f32>() == 0;
        let capacity_bytes = bytes.capacity();

        // Reinterpret in-place only when alignment and capacity permit exact Vec layout conversion.
        if aligned_for_f32 && (capacity_bytes % 4 == 0) {
            let mut bytes = std::mem::ManuallyDrop::new(bytes);
            let ptr = bytes.as_mut_ptr() as *mut f32;
            let len_f32 = bytes.len() / 4;
            let cap_f32 = bytes.capacity() / 4;
            let floats = unsafe { Vec::from_raw_parts(ptr, len_f32, cap_f32) };
            return Ok(floats);
        }

        return bytes_to_f32_vec(&bytes);
    }

    #[cfg(not(target_endian = "little"))]
    {
        bytes_to_f32_vec(&bytes)
    }
}

/// Metadata-only slice job (no inline triangles — those come from staged binary).
#[derive(Deserialize)]
struct MeshQuantizationMetadata {
    min_x: f32,
    min_y: f32,
    min_z: f32,
    max_x: f32,
    max_y: f32,
    max_z: f32,
}

#[derive(Deserialize)]
struct SliceJobMetadata {
    output_format: String,
    #[serde(default)]
    format_version: Option<String>,
    #[serde(default)]
    output_path: Option<String>,
    source_width_px: u32,
    source_height_px: u32,
    width_px: u32,
    height_px: u32,
    #[serde(default)]
    x_packing_mode: Option<String>,
    png_compression_strategy: String,
    anti_aliasing_level: String,
    #[serde(default = "default_anti_aliasing_mode")]
    anti_aliasing_mode: String,
    #[serde(default = "default_blur_brush_radius_px")]
    blur_brush_radius_px: u32,
    #[serde(default = "default_blur_brush_kernel")]
    blur_brush_kernel: String,
    #[serde(default = "default_blur_brush_sigma_x", alias = "blur_brush_sigma")]
    blur_brush_sigma_x: f64,
    #[serde(default = "default_blur_brush_sigma_y")]
    blur_brush_sigma_y: f64,
    #[serde(default = "default_z_blur_radius_layers")]
    z_blur_radius_layers: u32,
    #[serde(default = "default_z_blur_kernel")]
    z_blur_kernel: String,
    #[serde(default = "default_z_blur_sigma")]
    z_blur_sigma: f64,
    aa_on_supports: bool,
    #[serde(default = "default_minimum_aa_alpha_percent")]
    minimum_aa_alpha_percent: f32,
    #[serde(default)]
    mirror_x: bool,
    #[serde(default)]
    mirror_y: bool,
    #[serde(default = "default_z_blend_look_back")]
    z_blend_look_back: u32,
    #[serde(default)]
    z_blend_minimum_alpha_percent: f32,
    /// Maximum gray level (0–100 %) for z-blend gradient pixels at the inner boundary.
    #[serde(default = "default_z_blend_max_alpha_percent")]
    z_blend_max_alpha_percent: f32,
    /// Optional custom grayscale cure LUT (256 u8 values).
    ///
    /// Used by 3DAA to override the linear cure-window ramp and by 2D Blur AA
    /// to remap the post-blur grayscale output directly.
    #[serde(default)]
    z_blend_custom_lut: Option<Vec<u8>>,
    #[serde(default)]
    zaa_kernel: Option<String>,
    #[serde(default)]
    zaa_pattern: Option<String>,
    #[serde(default)]
    zaa_duplicate_z: Option<bool>,
    #[serde(default)]
    model_triangle_count: u32,
    #[serde(default)]
    model_slice_ranges: Vec<dragonfruit_slicing_engine::types::ModelSliceRangeV1>,
    container_compression_level: u8,
    build_width_mm: f32,
    build_depth_mm: f32,
    layer_height_mm: f32,
    total_layers: u32,
    #[serde(default)]
    bottom_layer_count: u32,
    #[serde(default)]
    inner_diameter_tolerance_mm: f32,
    #[serde(default)]
    outer_diameter_tolerance_mm: f32,
    #[serde(default)]
    bottom_tolerance_enabled: bool,
    #[serde(default)]
    bottom_inner_diameter_tolerance_mm: f32,
    #[serde(default)]
    bottom_outer_diameter_tolerance_mm: f32,
    export_thumbnail_png_base64: Option<String>,
    #[serde(default)]
    dither_enabled: bool,
    #[serde(default)]
    dither_bit_depth: Option<u32>,
    #[serde(default = "default_dither_device_gamma")]
    dither_device_gamma: f64,
    #[serde(default)]
    mesh_encoding: Option<String>,
    #[serde(default)]
    mesh_quantization: Option<MeshQuantizationMetadata>,
    metadata_json: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeSlicerPerfMetrics {
    total_ns: u64,
    index_build_ns: u64,
    render_wall_ns: u64,
    render_ns: u64,
    png_encode_ns: u64,
    archive_encode_ns: u64,
    z_blend_backward_ns: u64,
    z_blend_forward_ns: u64,
    cross_blend_ns: u64,
    cross_blend_touched_pixels: u64,
    cross_blend_contributing_layers: u64,
    post_blur_ns: u64,
    support_merge_ns: u64,
    layers: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeSlicerRuntimeMetrics {
    pool_threads: u32,
    max_concurrent: u32,
    queue_buffer: u32,
    daa_post_threads: u32,
    daa_post_buffer_depth: u32,
    build_profile: String,
    artifact_dir: String,
    mesh_stage_dir: String,
    metadata_parse_ns: u64,
    mesh_decode_ns: u64,
    artifact_metadata_ns: u64,
    wrapper_total_ns: u64,
    wrapper_overhead_ns: u64,
}

fn duration_ns_u64(duration: std::time::Duration) -> u64 {
    duration.as_nanos().min(u64::MAX as u128) as u64
}

fn phase_to_label(phase: dragonfruit_slicing_engine::types::SliceProgressPhaseV3) -> &'static str {
    match phase {
        dragonfruit_slicing_engine::types::SliceProgressPhaseV3::Slicing => "Slicing",
        dragonfruit_slicing_engine::types::SliceProgressPhaseV3::Encoding => "Encoding",
        dragonfruit_slicing_engine::types::SliceProgressPhaseV3::Finalizing => "Finalizing",
    }
}

fn slicer_pool() -> &'static ThreadPool {
    SLICER_POOL.get_or_init(|| {
        let threads = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1);
        ThreadPoolBuilder::new()
            .thread_name(|i| format!("dragonfruit-slicing-engine-{i}"))
            .num_threads(threads)
            .build()
            .expect("failed to create slicer rayon thread pool")
    })
}

fn decode_quantized_u16_mesh(
    bytes: &[u8],
    quant: &MeshQuantizationMetadata,
) -> Result<Vec<f32>, String> {
    if bytes.len() % 2 != 0 {
        return Err(format!(
            "Quantized mesh binary length {} is not a multiple of 2 (u16 size)",
            bytes.len()
        ));
    }

    let spans = [
        (quant.max_x - quant.min_x).max(0.0),
        (quant.max_y - quant.min_y).max(0.0),
        (quant.max_z - quant.min_z).max(0.0),
    ];
    let mins = [quant.min_x, quant.min_y, quant.min_z];
    let values = bytes.len() / 2;
    let mut floats = Vec::with_capacity(values);

    for (index, chunk) in bytes.chunks_exact(2).enumerate() {
        let q = u16::from_le_bytes([chunk[0], chunk[1]]);
        let axis = index % 3;
        let span = spans[axis];
        if span <= 0.0 || !span.is_finite() {
            floats.push(mins[axis]);
            continue;
        }

        let normalized = (q as f32) / 65_535.0;
        floats.push(mins[axis] + normalized * span);
    }

    Ok(floats)
}

fn decode_mesh_bytes(bytes: Vec<u8>, meta: &SliceJobMetadata) -> Result<Vec<f32>, String> {
    match meta.mesh_encoding.as_deref() {
        Some("quantized_u16") => {
            let quant = meta
                .mesh_quantization
                .as_ref()
                .ok_or("Quantized mesh encoding requires mesh_quantization metadata")?;
            decode_quantized_u16_mesh(&bytes, quant)
        }
        Some("raw_f32") | None => bytes_into_f32_vec(bytes),
        Some(other) => Err(format!("Unsupported mesh encoding: {other}")),
    }
}

fn cancel_flag() -> &'static Arc<AtomicBool> {
    CANCEL_FLAG.get_or_init(|| Arc::new(AtomicBool::new(false)))
}

/// Build a progress callback that throttles `window.emit` to at most ~60 fps.
///
/// The first event, any phase change, and the final event (done == total) are
/// always emitted immediately.  Intermediate updates are skipped if fewer than
/// 16 ms have elapsed since the last emit.
fn make_throttled_progress_cb(
    win: DragonFruitWindow,
) -> dragonfruit_slicing_engine::types::ProgressCallbackV3 {
    use std::sync::Mutex;
    use std::time::Instant;

    struct State {
        last_emit: Instant,
        last_phase: String,
    }

    let state = Arc::new(Mutex::new(State {
        last_emit: Instant::now(),
        last_phase: String::new(),
    }));

    Arc::new(
        move |update: dragonfruit_slicing_engine::types::SliceProgressUpdateV3| {
            let phase = phase_to_label(update.phase).to_string();
            let is_final = update.done >= update.total;

            let should_emit = {
                let mut s = state.lock().unwrap();
                let phase_changed = s.last_phase != phase;
                let elapsed = s.last_emit.elapsed().as_millis() >= 8;

                if is_final || phase_changed || elapsed {
                    s.last_emit = Instant::now();
                    s.last_phase = phase.clone();
                    true
                } else {
                    false
                }
            };

            if should_emit {
                let _ = win.emit(
                    "slicer://progress",
                    SliceProgressPayload {
                        done: update.done,
                        total: update.total,
                        phase,
                    },
                );
            }
        },
    )
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SliceProgressPayload {
    done: u32,
    total: u32,
    phase: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeSliceTempPathResult {
    temp_path: String,
    byte_len: u64,
    perf: Option<NativeSlicerPerfMetrics>,
    runtime: NativeSlicerRuntimeMetrics,
}

fn v3_runtime_metrics(
    output_path: &std::path::Path,
    daa_post_threads: u32,
    daa_post_buffer_depth: u32,
    metadata_parse_ns: u64,
    mesh_decode_ns: u64,
    artifact_metadata_ns: u64,
    wrapper_total_ns: u64,
    wrapper_overhead_ns: u64,
) -> NativeSlicerRuntimeMetrics {
    let hw_threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);
    let max_concurrent = std::env::var("DF_V3_MAX_CONCURRENT")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .filter(|v| *v >= 1)
        .unwrap_or(hw_threads)
        .clamp(1, hw_threads);
    let queue_buffer = (max_concurrent * 2).clamp(2, 16);

    let artifact_dir = output_path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| std::env::temp_dir().to_string_lossy().to_string());

    let mesh_stage_dir = resolve_mesh_stage_directory().to_string_lossy().to_string();

    let build_profile = if cfg!(debug_assertions) {
        "debug".to_string()
    } else {
        "release".to_string()
    };

    NativeSlicerRuntimeMetrics {
        pool_threads: hw_threads as u32,
        max_concurrent: max_concurrent as u32,
        queue_buffer: queue_buffer as u32,
        daa_post_threads,
        daa_post_buffer_depth,
        build_profile,
        artifact_dir,
        mesh_stage_dir,
        metadata_parse_ns,
        mesh_decode_ns,
        artifact_metadata_ns,
        wrapper_total_ns,
        wrapper_overhead_ns,
    }
}

// ---------------------------------------------------------------------------
// Native mesh export (STL / 3MF)
// ---------------------------------------------------------------------------

/// Read a little-endian `f32` from a byte slice at the given byte offset.
#[inline(always)]
fn read_f32_le(data: &[u8], off: usize) -> f32 {
    f32::from_le_bytes([data[off], data[off + 1], data[off + 2], data[off + 3]])
}

/// Write binary STL directly to `dest_path` from raw triangle staging data.
///
/// Staging format: 9 × f32 per triangle (v0x v0y v0z  v1x v1y v1z  v2x v2y v2z), LE.
fn write_binary_stl(raw: &[u8], tri_count: usize, dest_path: &str) -> Result<(), String> {
    use std::io::{BufWriter, Write};

    let file =
        std::fs::File::create(dest_path).map_err(|e| format!("Failed creating STL file: {e}"))?;
    let mut w = BufWriter::with_capacity(256 * 1024, file);

    // 80-byte header (all zeros)
    w.write_all(&[0u8; 80])
        .map_err(|e| format!("STL write: {e}"))?;
    w.write_all(&(tri_count as u32).to_le_bytes())
        .map_err(|e| format!("STL write: {e}"))?;

    for i in 0..tri_count {
        let base = i * 36; // 9 floats × 4 bytes
        let v0x = read_f32_le(raw, base);
        let v0y = read_f32_le(raw, base + 4);
        let v0z = read_f32_le(raw, base + 8);
        let v1x = read_f32_le(raw, base + 12);
        let v1y = read_f32_le(raw, base + 16);
        let v1z = read_f32_le(raw, base + 20);
        let v2x = read_f32_le(raw, base + 24);
        let v2y = read_f32_le(raw, base + 28);
        let v2z = read_f32_le(raw, base + 32);

        // Face normal = cross(v1 - v0, v2 - v0), normalized
        let e1x = v1x - v0x;
        let e1y = v1y - v0y;
        let e1z = v1z - v0z;
        let e2x = v2x - v0x;
        let e2y = v2y - v0y;
        let e2z = v2z - v0z;
        let mut nx = e1y * e2z - e1z * e2y;
        let mut ny = e1z * e2x - e1x * e2z;
        let mut nz = e1x * e2y - e1y * e2x;
        let len = (nx * nx + ny * ny + nz * nz).sqrt();
        if len > 1e-30 {
            let inv = 1.0 / len;
            nx *= inv;
            ny *= inv;
            nz *= inv;
        }

        // Normal
        w.write_all(&nx.to_le_bytes())
            .map_err(|e| format!("STL write: {e}"))?;
        w.write_all(&ny.to_le_bytes())
            .map_err(|e| format!("STL write: {e}"))?;
        w.write_all(&nz.to_le_bytes())
            .map_err(|e| format!("STL write: {e}"))?;
        // 3 vertices
        w.write_all(&raw[base..base + 36])
            .map_err(|e| format!("STL write: {e}"))?;
        // Attribute byte count
        w.write_all(&0u16.to_le_bytes())
            .map_err(|e| format!("STL write: {e}"))?;
    }

    w.flush().map_err(|e| format!("STL flush: {e}"))?;
    Ok(())
}

/// Write a 3MF file (DEFLATE-compressed ZIP) directly to `dest_path` from raw
/// triangle staging data.
///
/// The `zip` crate handles DEFLATE compression, CRC32, and central directory
/// bookkeeping.  XML text for vertex/triangle tags compresses ~10–20× with
/// DEFLATE, so the resulting 3MF is typically smaller than the equivalent
/// binary STL.
fn write_3mf(raw: &[u8], tri_count: usize, dest_path: &str) -> Result<(), String> {
    use std::io::{BufWriter, Write};
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    let file =
        std::fs::File::create(dest_path).map_err(|e| format!("Failed creating 3MF file: {e}"))?;
    // Large outer buffer so 4 MB compressed chunks land on disk efficiently.
    let buf_writer = BufWriter::with_capacity(4 * 1024 * 1024, file);
    let mut zip = ZipWriter::new(buf_writer);

    // Level 1 = fastest deflate. Repetitive XML (vertex/triangle tags) still
    // compresses 5–8× even at level 1, so output size stays reasonable while
    // the compressor runs ~5× faster than the default level 6.
    let deflate_opts = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .compression_level(Some(1));

    // ── [Content_Types].xml ──
    zip.start_file("[Content_Types].xml", deflate_opts)
        .map_err(|e| format!("3MF zip: {e}"))?;
    zip.write_all(
        b"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
          <Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\
          <Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\
          <Default Extension=\"model\" ContentType=\"application/vnd.ms-package.3dmanufacturing-3dmodel+xml\"/>\
          </Types>",
    )
    .map_err(|e| format!("3MF zip: {e}"))?;

    // ── _rels/.rels ──
    zip.start_file("_rels/.rels", deflate_opts)
        .map_err(|e| format!("3MF zip: {e}"))?;
    zip.write_all(
        b"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
          <Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
          <Relationship Target=\"/3D/3dmodel.model\" Id=\"rel0\" \
          Type=\"http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel\"/>\
          </Relationships>",
    )
    .map_err(|e| format!("3MF zip: {e}"))?;

    // ── 3D/3dmodel.model ──
    // The old approach called zip.write_all once per vertex/triangle — for a
    // 2 M-triangle mesh that is ~8 M individual DEFLATE feed calls, each with
    // full compressor overhead. Instead we accumulate XML into a 4 MB in-memory
    // chunk and flush to DEFLATE in bulk, reducing compressor calls by >1000×.
    zip.start_file("3D/3dmodel.model", deflate_opts)
        .map_err(|e| format!("3MF zip: {e}"))?;

    const CHUNK: usize = 4 * 1024 * 1024;
    let mut buf: Vec<u8> = Vec::with_capacity(CHUNK + 512);

    buf.extend_from_slice(
        b"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
          <model unit=\"millimeter\" xml:lang=\"en-US\" \
          xmlns=\"http://schemas.microsoft.com/3dmanufacturing/core/2015/02\">\
          <resources><object id=\"1\" type=\"model\"><mesh><vertices>",
    );

    // ── Vertices ──
    for i in 0..tri_count {
        let base = i * 36;
        for j in 0..3usize {
            let fbase = base + j * 12;
            let x = read_f32_le(raw, fbase);
            let y = read_f32_le(raw, fbase + 4);
            let z = read_f32_le(raw, fbase + 8);
            write!(buf, "<vertex x=\"{x:.4}\" y=\"{y:.4}\" z=\"{z:.4}\"/>").unwrap();
        }
        // Flush every ~4 MB so we never hold more than one chunk in memory.
        if buf.len() >= CHUNK {
            zip.write_all(&buf).map_err(|e| format!("3MF zip: {e}"))?;
            buf.clear();
        }
    }

    buf.extend_from_slice(b"</vertices><triangles>");

    // ── Triangles (sequential indices: tri i → 3i, 3i+1, 3i+2) ──
    for i in 0..tri_count {
        let v0 = i * 3;
        write!(
            buf,
            "<triangle v1=\"{v0}\" v2=\"{}\" v3=\"{}\"/>",
            v0 + 1,
            v0 + 2
        )
        .unwrap();
        if buf.len() >= CHUNK {
            zip.write_all(&buf).map_err(|e| format!("3MF zip: {e}"))?;
            buf.clear();
        }
    }

    buf.extend_from_slice(
        b"</triangles></mesh></object></resources>\
          <build><item objectid=\"1\"/></build></model>",
    );
    zip.write_all(&buf).map_err(|e| format!("3MF zip: {e}"))?;

    zip.finish().map_err(|e| format!("3MF zip finish: {e}"))?;
    Ok(())
}

/// Exports raw staged geometry to a properly formatted mesh file.
///
/// JS sends raw triangle vertex data (9 × f32 LE per triangle) to a staging
/// file via `append_mesh_stage_chunk`, then calls this command to convert
/// the staging file into a valid STL or 3MF at the user-chosen destination.
#[tauri::command]
async fn export_mesh_file(
    staging_path: String,
    dest_path: String,
    format: String,
) -> Result<String, String> {
    // Flush and release the staged file appender if it was writing to our staging file,
    // so all buffered bytes are written before we read.
    {
        let mut lock = staged_mesh_file_appender()
            .lock()
            .map_err(|e| format!("Appender lock poisoned: {e}"))?;
        let matches = lock.as_ref().map_or(false, |a| a.path == staging_path);
        if matches {
            if let Some(appender) = lock.as_mut() {
                use std::io::Write;
                appender
                    .writer
                    .flush()
                    .map_err(|e| format!("Failed flushing staging appender: {e}"))?;
            }
            *lock = None; // release file handle
        }
    }

    let raw = std::fs::read(&staging_path)
        .map_err(|e| format!("Failed reading staging file '{}': {e}", staging_path))?;

    if raw.len() % 36 != 0 {
        return Err(format!(
            "Invalid staging data: {} bytes is not a multiple of 36 (9 × f32 per triangle)",
            raw.len()
        ));
    }
    let tri_count = raw.len() / 36;
    if tri_count == 0 {
        return Err("Cannot export: no triangles in staged geometry.".into());
    }

    log::info!(
        "[export_mesh_file] {} triangles → {} format → {}",
        tri_count,
        format,
        dest_path
    );

    match format.as_str() {
        "stl" => write_binary_stl(&raw, tri_count, &dest_path)?,
        "3mf" => write_3mf(&raw, tri_count, &dest_path)?,
        _ => return Err(format!("Unsupported export format: {format}")),
    }

    // Clean up staging file
    let _ = std::fs::remove_file(&staging_path);

    Ok(dest_path)
}

/// Receive raw mesh bytes from the frontend via efficient binary IPC in chunks.
/// The bytes are stored in a pre-allocated memory vector and consumed by the next `slice_solid_native_to_temp_path` call.
#[tauri::command]
async fn stage_mesh_binary_start(total_bytes: usize) -> Result<(), String> {
    let reserve_bytes = normalize_staged_mesh_prealloc_bytes(total_bytes);
    *staged_mesh()
        .lock()
        .map_err(|e| format!("staged mesh lock poisoned: {e}"))? =
        Some(Vec::with_capacity(reserve_bytes));

    *staged_mesh_stats()
        .lock()
        .map_err(|e| format!("staged mesh stats lock poisoned: {e}"))? = StageMeshStats::default();

    *staged_mesh_file_path()
        .lock()
        .map_err(|e| format!("staged mesh file-path lock poisoned: {e}"))? = None;

    *staged_mesh_file_appender()
        .lock()
        .map_err(|e| format!("staged mesh file appender lock poisoned: {e}"))? = None;

    Ok(())
}

#[tauri::command]
async fn allocate_mesh_stage_path() -> Result<String, String> {
    let path = allocate_mesh_stage_file_path()?;
    Ok(path.to_string_lossy().to_string())
}

/// Decodes the percent-encoded `x-mesh-stage-path` header back into a path.
///
/// The path cannot ride in the header verbatim: HTTP header values are
/// visible-ASCII only, so `HeaderValue::to_str` rejects every byte outside
/// 0x20-0x7E and a destination like `C:\Users\...\Tatsaechliche Dokumente\x.voxl`
/// (any accent, umlaut or CJK character) failed on its very first chunk. Saving
/// a project into such a folder was impossible, and the frontend's fallback
/// chain turned the failure into a browser download rather than an error.
///
/// The sender is `encodeStagePathHeader` in `nativeSlicerBridge.ts`; every
/// caller of this command goes through it, so the value here is always
/// percent-encoded ASCII. An unencoded ASCII path decodes to itself, but a
/// literal `%` would not survive the round trip - encode on the way in.
fn decode_stage_path_header(raw: &[u8]) -> Result<String, String> {
    let encoded = std::str::from_utf8(raw)
        .map_err(|err| format!("Invalid x-mesh-stage-path header value: {err}"))?;

    percent_encoding::percent_decode_str(encoded)
        .decode_utf8()
        .map(|decoded| decoded.into_owned())
        .map_err(|err| format!("Invalid x-mesh-stage-path header encoding: {err}"))
}

#[tauri::command]
async fn append_mesh_stage_chunk(request: tauri::ipc::Request<'_>) -> Result<u64, String> {
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) => bytes,
        InvokeBody::Json(_) => {
            return Err("append_mesh_stage_chunk expects raw binary body, got JSON".into())
        }
    };

    let path_header = request
        .headers()
        .get("x-mesh-stage-path")
        .ok_or("append_mesh_stage_chunk missing x-mesh-stage-path header")?;

    let decoded_path = decode_stage_path_header(path_header.as_bytes())?;
    let path_text = decoded_path.trim();

    if path_text.is_empty() {
        return Err("append_mesh_stage_chunk received empty x-mesh-stage-path header".into());
    }

    let path = std::path::PathBuf::from(path_text);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Failed creating mesh stage directory: {err}"))?;
    }

    let offset_header = request.headers().get("x-mesh-stage-offset");
    let is_first_chunk = match offset_header {
        Some(value) => {
            let raw = value
                .to_str()
                .map_err(|e| format!("Invalid x-mesh-stage-offset header value: {e}"))?
                .trim();
            if raw.is_empty() {
                false
            } else {
                raw.parse::<u64>()
                    .map_err(|e| format!("Invalid x-mesh-stage-offset header value: {e}"))?
                    == 0
            }
        }
        None => false,
    };

    stage_append_chunk(path_text, bytes, is_first_chunk)
}

/// Body of `append_mesh_stage_chunk`, extracted from the `#[tauri::command]`
/// wrapper so the writer's crash-safety and contention contracts can be driven
/// directly from unit tests (a `tauri::ipc::Request` cannot be constructed in
/// one). Behaviour is byte-for-byte the pre-extraction behaviour apart from the
/// explicitly-documented contention backstop below.
pub(crate) fn stage_append_chunk(
    path_text: &str,
    bytes: &[u8],
    is_first_chunk: bool,
) -> Result<u64, String> {
    let path = std::path::PathBuf::from(path_text);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("Failed creating mesh stage directory: {err}"))?;
    }

    let mut appender_lock = staged_mesh_file_appender()
        .lock()
        .map_err(|e| format!("staged mesh file appender lock poisoned: {e}"))?;

    // Contention backstop (Ph0.1 A / finding N2). There is exactly ONE
    // process-global appender. A mid-sequence chunk (offset != 0) that arrives
    // while a *different* path owns the appender means two chunked writes are
    // interleaving: the previous code silently evicted the other writer and
    // re-opened with truncate(true), so this chunk landed at offset 0 and the
    // other writer's bytes were destroyed — both files corrupt, no error.
    // The frontend single-flight queue (`runExclusiveNativeWrite` in
    // nativeSlicerBridge.ts) makes this unreachable for callers that go through
    // it; this backstop covers the one caller that streams chunks directly
    // (`sliceExportOrchestrator.handleMeshFileChunk`). A loud error beats two
    // silently corrupt files.
    //
    // Deliberately NOT extended to the `None` case: `handleMeshFileChunk` sends
    // no `x-mesh-stage-offset` header at all, so *every* chunk of a slice stage
    // is `is_first_chunk == false` and relies on the `None` branch to open its
    // file. Erroring there would break slicing outright.
    if let Some(existing) = appender_lock.as_ref() {
        if !is_first_chunk && existing.path != path_text {
            return Err(format!(
                "concurrent mesh-stage write detected: '{}' is mid-write while a chunk arrived for '{}'",
                existing.path, path_text
            ));
        }
    }

    let needs_new_appender = match appender_lock.as_ref() {
        Some(existing) => is_first_chunk || existing.path != path_text,
        None => true,
    };

    if needs_new_appender {
        if let Some(existing) = appender_lock.as_mut() {
            use std::io::Write;
            let _ = existing.writer.flush();
        }

        let file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&path)
            .map_err(|err| format!("Failed opening mesh stage file for write: {err}"))?;

        *appender_lock = Some(StageFileAppender {
            path: path_text.to_string(),
            writer: std::io::BufWriter::with_capacity(4 * 1024 * 1024, file),
            len: 0,
        });
    }

    let appender = appender_lock
        .as_mut()
        .ok_or("Failed initializing mesh stage file appender")?;

    use std::io::Write;
    appender
        .writer
        .write_all(bytes)
        .map_err(|err| format!("Failed appending mesh stage bytes: {err}"))?;
    appender
        .writer
        .flush()
        .map_err(|err| format!("Failed flushing mesh stage bytes: {err}"))?;
    appender.len = appender.len.saturating_add(bytes.len() as u64);

    Ok(appender.len)
}

#[tauri::command]
async fn finish_mesh_stage_write(path: String) -> Result<u64, String> {
    finish_stage_write(&path)
}

/// Body of `finish_mesh_stage_write`, extracted for the same reason as
/// `stage_append_chunk`.
pub(crate) fn finish_stage_write(path: &str) -> Result<u64, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("finish_mesh_stage_write requires a non-empty path".into());
    }

    let mut appender_lock = staged_mesh_file_appender()
        .lock()
        .map_err(|e| format!("staged mesh file appender lock poisoned: {e}"))?;

    if let Some(appender) = appender_lock.as_mut() {
        if appender.path == trimmed {
            use std::io::Write;
            appender
                .writer
                .flush()
                .map_err(|e| format!("Failed flushing mesh stage file writer: {e}"))?;
            let len = appender.len;
            *appender_lock = None; // release OS file handle immediately
            return Ok(len);
        }
    }

    // No open appender for this path (already closed or never opened).
    Ok(0)
}

#[tauri::command]
async fn stage_mesh_file_path(mesh_file_path: String) -> Result<u64, String> {
    let trimmed = mesh_file_path.trim();
    if trimmed.is_empty() {
        return Err("stage_mesh_file_path requires a non-empty path".into());
    }

    let path = std::path::PathBuf::from(trimmed);
    if !path.exists() {
        return Err(format!(
            "Mesh stage file does not exist: {}",
            path.display()
        ));
    }

    {
        let mut appender_lock = staged_mesh_file_appender()
            .lock()
            .map_err(|e| format!("staged mesh file appender lock poisoned: {e}"))?;
        if let Some(appender) = appender_lock.as_mut() {
            if appender.path == trimmed {
                use std::io::Write;
                appender
                    .writer
                    .flush()
                    .map_err(|e| format!("Failed flushing mesh stage file writer: {e}"))?;
            }
        }
    }

    let len = std::fs::metadata(&path)
        .map_err(|e| format!("Failed reading mesh stage file metadata: {e}"))?
        .len();

    *staged_mesh()
        .lock()
        .map_err(|e| format!("staged mesh lock poisoned: {e}"))? = None;

    *staged_mesh_file_path()
        .lock()
        .map_err(|e| format!("staged mesh file-path lock poisoned: {e}"))? =
        Some(path.to_string_lossy().to_string());

    *staged_mesh_stats()
        .lock()
        .map_err(|e| format!("staged mesh stats lock poisoned: {e}"))? = StageMeshStats {
        chunks_received: 1,
        append_ns_total: 0,
    };

    Ok(len)
}

#[tauri::command]
async fn stage_mesh_binary_set(
    request: tauri::ipc::Request<'_>,
) -> Result<StageMeshChunkAck, String> {
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) => bytes,
        InvokeBody::Json(_) => {
            return Err("stage_mesh_binary_set expects raw binary body, got JSON".into())
        }
    };

    let reserve_bytes = normalize_staged_mesh_prealloc_bytes(bytes.len());
    let append_start = std::time::Instant::now();
    let mut staged = Vec::with_capacity(reserve_bytes);
    staged.extend_from_slice(bytes);
    let append_ns = append_start.elapsed().as_nanos().min(u64::MAX as u128) as u64;
    let capacity_bytes = staged.capacity() as u64;
    let total_bytes = staged.len() as u64;

    *staged_mesh()
        .lock()
        .map_err(|e| format!("staged mesh lock poisoned: {e}"))? = Some(staged);

    *staged_mesh_stats()
        .lock()
        .map_err(|e| format!("staged mesh stats lock poisoned: {e}"))? = StageMeshStats {
        chunks_received: 1,
        append_ns_total: append_ns,
    };

    *staged_mesh_file_path()
        .lock()
        .map_err(|e| format!("staged mesh file-path lock poisoned: {e}"))? = None;

    *staged_mesh_file_appender()
        .lock()
        .map_err(|e| format!("staged mesh file appender lock poisoned: {e}"))? = None;

    Ok(StageMeshChunkAck {
        chunk_bytes: total_bytes,
        total_bytes,
        capacity_bytes,
        reserve_grew: capacity_bytes > reserve_bytes as u64,
        chunks_received: 1,
        append_ns,
        append_ns_total: append_ns,
    })
}

#[tauri::command]
async fn stage_mesh_binary_chunk(
    request: tauri::ipc::Request<'_>,
) -> Result<StageMeshChunkAck, String> {
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) => bytes,
        InvokeBody::Json(_) => {
            return Err("stage_mesh_binary_chunk expects raw binary body, got JSON".into())
        }
    };

    let mut lock = staged_mesh()
        .lock()
        .map_err(|e| format!("staged mesh lock poisoned: {e}"))?;

    let vec = lock
        .as_mut()
        .ok_or("Staged mesh not started. Call stage_mesh_binary_start first")?;

    let chunk_bytes = bytes.len() as u64;
    let capacity_before = vec.capacity();
    let append_start = std::time::Instant::now();
    vec.extend_from_slice(bytes);
    let append_ns = append_start.elapsed().as_nanos().min(u64::MAX as u128) as u64;
    let capacity_after = vec.capacity();
    let total_bytes = vec.len() as u64;

    drop(lock);

    let mut stats = staged_mesh_stats()
        .lock()
        .map_err(|e| format!("staged mesh stats lock poisoned: {e}"))?;
    stats.chunks_received = stats.chunks_received.saturating_add(1);
    stats.append_ns_total = stats.append_ns_total.saturating_add(append_ns);

    Ok(StageMeshChunkAck {
        chunk_bytes,
        total_bytes,
        capacity_bytes: capacity_after as u64,
        reserve_grew: capacity_after > capacity_before,
        chunks_received: stats.chunks_received,
        append_ns,
        append_ns_total: stats.append_ns_total,
    })
}

#[tauri::command]
async fn slice_solid_native_to_temp_path(
    window: DragonFruitWindow,
    job_json: String,
) -> Result<NativeSliceTempPathResult, String> {
    // Take the pre-staged mesh bytes (set by stage_mesh_binary)
    let staged_mesh_bytes = staged_mesh()
        .lock()
        .map_err(|e| format!("staged mesh lock poisoned: {e}"))?
        .take();

    let mesh_bytes = if let Some(bytes) = staged_mesh_bytes {
        bytes
    } else {
        {
            let mut appender_lock = staged_mesh_file_appender()
                .lock()
                .map_err(|e| format!("staged mesh file appender lock poisoned: {e}"))?;
            if let Some(appender) = appender_lock.as_mut() {
                use std::io::Write;
                appender
                    .writer
                    .flush()
                    .map_err(|e| format!("Failed flushing mesh stage file writer: {e}"))?;
            }
        }

        let staged_path = staged_mesh_file_path()
            .lock()
            .map_err(|e| format!("staged mesh file-path lock poisoned: {e}"))?
            .take()
            .ok_or("No staged mesh binary or file path — call stage_mesh_binary_* or stage_mesh_file_path first")?;

        let path = std::path::PathBuf::from(staged_path.trim());
        if !path.exists() {
            return Err(format!(
                "Staged mesh file no longer exists: {}",
                path.display()
            ));
        }

        let bytes = std::fs::read(&path)
            .map_err(|e| format!("Failed reading staged mesh file '{}': {e}", path.display()))?;

        let _ = std::fs::remove_file(&path);
        *staged_mesh_file_appender()
            .lock()
            .map_err(|e| format!("staged mesh file appender lock poisoned: {e}"))? = None;
        bytes
    };

    let flag = cancel_flag().clone();
    flag.store(false, Ordering::SeqCst);

    let win = window.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let wrapper_start = std::time::Instant::now();

        let metadata_parse_start = std::time::Instant::now();
        let meta: SliceJobMetadata = serde_json::from_str(&job_json)
            .map_err(|err| format!("Invalid slice job metadata JSON: {err}"))?;
        let metadata_parse_ns = duration_ns_u64(metadata_parse_start.elapsed());
        let requested_output_path = meta
            .output_path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string());

        let mesh_decode_start = std::time::Instant::now();
        let triangles_xyz = decode_mesh_bytes(mesh_bytes, &meta)?;
        let mesh_decode_ns = duration_ns_u64(mesh_decode_start.elapsed());

        let job = dragonfruit_slicing_engine::SliceJobV3 {
            output_format: meta.output_format,
            format_version: meta.format_version,
            source_width_px: meta.source_width_px,
            source_height_px: meta.source_height_px,
            width_px: meta.width_px,
            height_px: meta.height_px,
            x_packing_mode: meta.x_packing_mode.unwrap_or_else(|| "none".to_string()),
            png_compression_strategy: meta.png_compression_strategy,
            anti_aliasing_level: meta.anti_aliasing_level,
            anti_aliasing_mode: meta.anti_aliasing_mode,
            blur_brush_radius_px: meta.blur_brush_radius_px,
            blur_brush_kernel: meta.blur_brush_kernel,
            blur_brush_sigma_x: meta.blur_brush_sigma_x,
            blur_brush_sigma_y: meta.blur_brush_sigma_y,
            z_blur_radius_layers: meta.z_blur_radius_layers,
            z_blur_kernel: meta.z_blur_kernel,
            z_blur_sigma: meta.z_blur_sigma,
            aa_on_supports: meta.aa_on_supports,
            model_triangle_count: meta.model_triangle_count,
              model_slice_ranges: meta.model_slice_ranges,
            minimum_aa_alpha_percent: meta.minimum_aa_alpha_percent,
            mirror_x: meta.mirror_x,
            mirror_y: meta.mirror_y,
            z_blend_look_back: meta.z_blend_look_back,
            z_blend_minimum_alpha_percent: meta.z_blend_minimum_alpha_percent,
            z_blend_max_alpha_percent: meta.z_blend_max_alpha_percent,
            z_blend_custom_lut: meta.z_blend_custom_lut,
            zaa_kernel: meta.zaa_kernel,
            zaa_pattern: meta.zaa_pattern,
            zaa_duplicate_z: meta.zaa_duplicate_z,
            dither_enabled: meta.dither_enabled,
            dither_bit_depth: meta.dither_bit_depth,
            dither_device_gamma: meta.dither_device_gamma,
            container_compression_level: meta.container_compression_level,
            build_width_mm: meta.build_width_mm,
            build_depth_mm: meta.build_depth_mm,
            layer_height_mm: meta.layer_height_mm,
            total_layers: meta.total_layers,
            bottom_layer_count: meta.bottom_layer_count,
            inner_diameter_tolerance_mm: meta.inner_diameter_tolerance_mm,
            outer_diameter_tolerance_mm: meta.outer_diameter_tolerance_mm,
            bottom_tolerance_enabled: meta.bottom_tolerance_enabled,
            bottom_inner_diameter_tolerance_mm: meta.bottom_inner_diameter_tolerance_mm,
            bottom_outer_diameter_tolerance_mm: meta.bottom_outer_diameter_tolerance_mm,
            export_thumbnail_png_base64: meta.export_thumbnail_png_base64,
            triangles_xyz,
            metadata_json: meta.metadata_json,
        };

        eprintln!(
            "[SupportAA] native job decoded: model_triangles={} support_triangles={} total_triangles={} aa_on_supports={} mode={} level={} mesh_encoding={}",
            job.model_triangle_count,
            (job.triangles_xyz.len() / 9).saturating_sub(job.model_triangle_count as usize),
            job.triangles_xyz.len() / 9,
            job.aa_on_supports,
            job.anti_aliasing_mode,
            job.anti_aliasing_level,
            meta.mesh_encoding.as_deref().unwrap_or("raw_f32"),
        );
        let fingerprint = |start: usize, end: usize| {
            let mut hash = 0x811c9dc5u32;
            for value in &job.triangles_xyz[start.min(job.triangles_xyz.len())
                ..end.min(job.triangles_xyz.len())]
            {
                hash ^= value.to_bits();
                hash = hash.wrapping_mul(0x01000193);
            }
            format!("{hash:08x}")
        };
        let multiset_fingerprint = |start: usize, end: usize| {
            let mut xor = 0u32;
            let mut sum = 0u32;
            for value in &job.triangles_xyz[start.min(job.triangles_xyz.len())
                ..end.min(job.triangles_xyz.len())]
            {
                let bits = value.to_bits();
                xor ^= bits;
                sum = sum.wrapping_add(bits);
            }
            format!("{xor:08x}:{sum:08x}")
        };
        let model_float_end = (job.model_triangle_count as usize)
            .saturating_mul(9)
            .min(job.triangles_xyz.len());
        eprintln!(
            "[SupportAA] native geometry fingerprints: model={} support={} model_multiset={} support_multiset={}",
            fingerprint(0, model_float_end),
            fingerprint(model_float_end, job.triangles_xyz.len()),
            multiset_fingerprint(0, model_float_end),
            multiset_fingerprint(model_float_end, job.triangles_xyz.len()),
        );

        let progress_cb = make_throttled_progress_cb(win);
        let requested_output_path = requested_output_path.clone();

        slicer_pool().install(
            || -> Result<(String, u64, NativeSlicerPerfMetrics, NativeSlicerRuntimeMetrics), String> {
            let ext = if job.output_format.trim().is_empty() {
                let format_provider = plugin_registry::get_format_provider()
                    .unwrap_or_else(|_| plugin_registry::get_default_format_provider());
                format_provider.default_export_format()
            } else {
                job.output_format.trim_start_matches('.')
            };
            let path = if let Some(requested_path) = requested_output_path.as_deref() {
                let requested = std::path::PathBuf::from(requested_path);
                if let Some(parent) = requested.parent() {
                    std::fs::create_dir_all(parent)
                        .map_err(|err| format!("Failed creating output folder: {err}"))?;
                }
                requested
            } else {
                temp_artifact_path(ext)
            };

            let perf_raw = dragonfruit_slicing_engine::engine::slice_with_progress_v3_to_path(
                &job,
                &path,
                Some(progress_cb),
                Some(flag.as_ref()),
            )
            .map_err(|err| format!("V3 slicing failed: {err}"))?;

            let perf = NativeSlicerPerfMetrics {
                total_ns: perf_raw.total_ns,
                index_build_ns: perf_raw.index_build_ns,
                render_wall_ns: perf_raw.render_wall_ns,
                render_ns: perf_raw.render_ns,
                png_encode_ns: perf_raw.png_encode_ns,
                archive_encode_ns: perf_raw.archive_encode_ns,
                z_blend_backward_ns: perf_raw.z_blend_backward_ns,
                z_blend_forward_ns: perf_raw.z_blend_forward_ns,
                cross_blend_ns: perf_raw.cross_blend_ns,
                cross_blend_touched_pixels: perf_raw.cross_blend_touched_pixels,
                cross_blend_contributing_layers: perf_raw.cross_blend_contributing_layers,
                post_blur_ns: perf_raw.post_blur_ns,
                support_merge_ns: perf_raw.support_merge_ns,
                layers: perf_raw.layers,
            };

            let artifact_metadata_start = std::time::Instant::now();
            let byte_len = std::fs::metadata(&path)
                .map_err(|err| format!("Failed reading temp artifact metadata: {err}"))?
                .len();
            let artifact_metadata_ns = duration_ns_u64(artifact_metadata_start.elapsed());

            let wrapper_total_ns = duration_ns_u64(wrapper_start.elapsed());
            let wrapper_overhead_ns = wrapper_total_ns.saturating_sub(perf_raw.total_ns);
            let runtime = v3_runtime_metrics(
                &path,
                perf_raw.daa_post_threads,
                perf_raw.daa_post_buffer_depth,
                metadata_parse_ns,
                mesh_decode_ns,
                artifact_metadata_ns,
                wrapper_total_ns,
                wrapper_overhead_ns,
            );

            Ok((
                path.to_string_lossy().to_string(),
                byte_len,
                perf,
                runtime,
            ))
        },
        )
    })
    .await
    .map_err(|err| format!("Native slicer task failed to join: {err}"))??;

    Ok(NativeSliceTempPathResult {
        temp_path: result.0,
        byte_len: result.1,
        perf: Some(result.2),
        runtime: result.3,
    })
}

#[tauri::command]
async fn cancel_slicing() -> Result<(), String> {
    cancel_flag().store(true, Ordering::SeqCst);
    Ok(())
}

fn main() {
    // Issue #83: on Linux with Nvidia+Wayland, WebKitGTK's DMA-BUF renderer
    // can crash inside gbm_bo_create_with_modifiers. Setting this env var
    // before any GTK/WebKit init forces the SHM fallback path, which is
    // slightly slower but stable. Only applies to the wry (WebKitGTK) path;
    // CEF uses its own compositor and is unaffected.
    #[cfg(all(target_os = "linux", not(feature = "tauri-cef")))]
    {
        if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
            // NOTE: called at the very start of main, single-threaded, before
            // any other threads or libraries are initialized. On Rust edition
            // 2024+ this will require an unsafe block (set_var became unsafe).
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    // rustls 0.23 will not pick a crypto provider on its own. tauri-plugin-updater
    // enables reqwest's `rustls-no-provider`, and reqwest then calls get_default()
    // without the crate-features fallback, so building the updater's HTTP client
    // panics with "No provider set" unless one was installed process-wide first.
    // rustls' own `ring` feature being on (via ureq) is not enough. Err just means
    // someone else got here first. See issue #615.
    let _ = rustls::crypto::ring::default_provider().install_default();

    // Install a panic hook that writes the panic location and message to the
    // DragonFruit log before the default handler runs.  This ensures that even
    // hard crashes leave a human-readable trace in the log file rather than
    // only a terse Windows Event 1005 entry.
    let default_panic_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "unknown location".to_string());
        let message: String = if let Some(s) = info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "(non-string panic payload)".to_string()
        };
        log::error!("[panic] {message} at {location}");
        default_panic_hook(info);
    }));

    // Sweep week-old stale temp artifacts on app startup.
    let _ = sweep_stale_temp_artifacts(7 * 24 * 60 * 60);

    // Initialize plugin registry and register built-in plugins
    if let Err(error) = plugin_registry::initialize_plugins() {
        if cfg!(debug_assertions) {
            log::warn!("[plugin-registry] WARNING: {error}");
        } else {
            panic!("Failed to initialize plugin registry: {error}");
        }
    }

    // NOTE: nothing may be logged before this point. `tauri-plugin-log` attaches
    // the `log` facade during its plugin setup, so any record emitted earlier is
    // silently dropped. The startup header lives in `log_startup_header()`,
    // called from `setup()`, for exactly this reason.

    let _log_level = read_log_level_pref();
    // Logging is backend-agnostic: tauri-plugin-log declares tauri with
    // default-features = false, so it does not drag in wry.
    #[cfg(feature = "logging")]
    let log_plugin = {
        use tauri_plugin_log::{Builder as LogBuilder, RotationStrategy, Target, TargetKind};
        LogBuilder::new()
            .targets([
                Target::new(TargetKind::Stdout),
                Target::new(TargetKind::LogDir {
                    file_name: Some("dragonfruit".to_string()),
                }),
                Target::new(TargetKind::Webview),
            ])
            .level(_log_level)
            // Suppress chatty low-level transport crates — these flood the log
            // at DEBUG/TRACE and contain no actionable application information.
            .level_for("tungstenite", log::LevelFilter::Warn)
            .level_for("reqwest", log::LevelFilter::Warn)
            .level_for("hyper", log::LevelFilter::Warn)
            .level_for("hyper_util", log::LevelFilter::Warn)
            .level_for("rustls", log::LevelFilter::Warn)
            .level_for("h2", log::LevelFilter::Warn)
            .level_for("tokio_tungstenite", log::LevelFilter::Warn)
            // The Vulkan loader hands wgpu every implicit layer installed on the
            // machine, and a third-party overlay whose manifest is missing or
            // whose layer violates the loader's naming policy is reported as an
            // ERROR on the instance we asked for — Epic's EOS layer, Samsung's
            // Galaxy overlay, Overwolf's OBS hook. None of it is ours and none of
            // it is actionable, and every record is mirrored into the webview
            // console by the log plugin, where it reads as an application crash.
            // wgpu failures we can act on come back as `Err` from our own calls
            // (`dragonfruit-ao-gpu` logs its fallback itself).
            .level_for("wgpu_hal", log::LevelFilter::Off)
            .max_file_size(5_000_000)
            .rotation_strategy(RotationStrategy::KeepOne)
            .build()
    };

    let builder = tauri::Builder::default();
    #[cfg(feature = "logging")]
    let builder = builder.plugin(log_plugin);
    let builder = builder.setup(|app| {
        let app_handle = app.handle().clone();

        log_startup_header();

        app.manage(window_state::WindowStateTracker::default());
        app.manage(webview_watchdog::WebviewLiveness::default());
        webview_watchdog::spawn(app_handle.clone());
        app.manage(experiments::ExperimentsState::default());

        // Defer main window creation to an async task so the splashscreen's
        // WebView2 instance fully initialises before the main window's does.
        // On Windows, simultaneous WebView2 init produces a brief window flash
        // even when the main window is created with visible=false.
        tauri::async_runtime::spawn(async move {
            use tauri::WebviewWindowBuilder;

            // Give the splash WebView2 a head-start on Windows only.
            #[cfg(target_os = "windows")]
            tokio::time::sleep(std::time::Duration::from_millis(120)).await;

            let config = app_handle.config();
            let Some(window_config) = config.app.windows.iter().find(|w| w.label == "main") else {
                log::error!("Missing 'main' window config in tauri.conf.json");
                return;
            };

            let builder = match WebviewWindowBuilder::from_config(&app_handle, window_config) {
                Ok(b) => b,
                Err(e) => {
                    log::error!("Failed to create main window builder: {e}");
                    return;
                }
            };

            // Keep custom titlebar behavior on non-macOS.
            #[cfg(not(target_os = "macos"))]
            let builder = builder.decorations(false);

            // Belt-and-suspenders: enforce hidden + no taskbar entry while
            // the window is invisible, regardless of config values. On Windows
            // a taskbar button flash is the tell-tale sign the window was
            // briefly visible during WebView2 initialisation.
            let builder = builder.visible(false);
            #[cfg(target_os = "windows")]
            let builder = builder.skip_taskbar(true);

            match builder.build() {
                Ok(window) => {
                    // Restore the previous session's geometry while the window
                    // is still hidden; first launch keeps the maximized default.
                    match window_state::load(&app_handle) {
                        Some(state) => window_state::restore(&window, &state),
                        None => {
                            let _ = window.maximize();
                        }
                    }
                    window_state::track(&window);
                    // Keep navlib's `active` / `focus` in step with the window, so
                    // the driver stops routing the puck to a backgrounded app.
                    spacemouse::track_window_focus(&window);

                    // On macOS, reveal immediately so a frontend startup hiccup
                    // can't leave the app invisible when created as hidden.
                    #[cfg(target_os = "macos")]
                    {
                        if let Err(error) = window.show() {
                            log::warn!("Failed to show main window during setup: {error}");
                        }
                    }
                    log::info!("Main window created successfully");
                }
                Err(e) => log::error!("Failed to build main window: {e}"),
            }
        });

        Ok(())
    });

    // Single-instance plugin also disabled on CEF (same wry collision).
    #[cfg(not(feature = "tauri-cef"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        log::info!("Single-instance activated: second launch detected (args={argv:?})");
        let has_scene_files = !collect_scene_file_paths_from_args(&argv).is_empty();
        emit_scene_file_handoff(app, &argv, "single-instance");

        // Only force foreground when this second launch is handing off a scene file.
        // Avoiding unconditional focus here reduces Windows "error" chimes when users
        // launch the app again while it's already running.
        if has_scene_files {
            focus_main_window(app);
        }
    }));

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_plugin_macos_fps::init());

    // Process plugin — used for app relaunch flows.
    let builder = builder.plugin(tauri_plugin_process::init());

    builder
        .invoke_handler(tauri::generate_handler![
            webview_watchdog::webview_heartbeat,
            stage_mesh_binary_start,
            allocate_mesh_stage_path,
            append_mesh_stage_chunk,
            finish_mesh_stage_write,
            scene_file_begin_atomic_write,
            scene_file_commit_atomic,
            scene_file_discard_atomic_temp,
            stage_mesh_file_path,
            stage_mesh_binary_set,
            stage_mesh_binary_chunk,
            slice_solid_native_to_temp_path,
            cancel_slicing,
            island_scan::run_island_scan_native,
            mesh_minima::scan_mesh_minima,
            mesh_minima::scan_mesh_minima_from_path,
            mesh_minima::scan_voxel_islands_from_path,
            mesh_minima::scan_islands_from_path,
            ao_vertex::bake_vertex_occlusion,
            overhang::scan_overhangs,
            export_mesh_file,
            file_dialogs::save_print_file,
            file_dialogs::save_print_file_from_path,
            file_dialogs::pick_save_path,
            file_dialogs::pick_open_files,
            file_dialogs::get_launch_scene_files,
            experiments::set_experiment_overrides,
            external::fetch_sponsor_avatar,
            external::fetch_external_text,
            file_dialogs::get_slicer_engine_version,
            file_dialogs::notify_launch_scene_handoff,
            file_dialogs::focus_main_window_command,
            file_dialogs::reveal_main_window_command,
            file_dialogs::write_bytes_to_path,
            print_files::read_print_file_bytes,
            print_files::read_print_file_size,
            print_files::read_print_file_chunk,
            print_files::read_print_layer_png,
            print_files::read_print_layer_pngs,
            print_files::replace_print_layer_pixels_png,
            print_files::process_print_islands,
            print_files::existing_paths,
            print_files::delete_print_temp_file,
            print_files::cleanup_stale_print_temp_files,
            print_files::cleanup_all_print_temp_files,
            local_backup::local_backup_default_directory,
            local_backup::local_backup_pick_directory,
            local_backup::local_backup_read_state,
            local_backup::local_backup_sync,
            local_backup::local_backup_list_history,
            local_backup::local_backup_list_model_library,
            local_backup::local_backup_read_history_item,
            local_backup::local_backup_delete_history_item,
            local_backup::local_backup_restore_history_item,
            scene_autosave::scene_autosave_get_paths,
            scene_autosave::scene_autosave_write_manifest,
            scene_autosave::scene_autosave_read_manifest,
            scene_autosave::scene_autosave_read_voxl_bytes,
            scene_autosave::scene_autosave_resolve_recovery,
            scene_autosave::scene_autosave_delete_sidecar,
            external::reveal_in_file_manager,
            external::open_external_url,
            external::launch_external_process,
            external::fetch_sponsor_avatar,
            external::discover_uvtools_path,
            logging::set_log_level_pref,
            logging::read_log_tail,
            logging::open_log_file,
            logging::delete_log_file,
            spacemouse::spacemouse_native_start,
            spacemouse::spacemouse_native_stop,
            spacemouse::spacemouse_native_sync,
            network::plugin_network_request,
            network::ensure_rtsp_relay,
            mesh_repair::mesh_analyze_from_path,
            mesh_refine::refine_mesh_soup,
            mesh_repair::mesh_analyze_staged,
            mesh_repair::mesh_repair_from_path,
            mesh_repair::mesh_repair_parts_from_path,
            mesh_repair::mesh_load_from_path,
            mesh_repair::mesh_repair_staged,
            mesh_repair::mesh_repair_cancel,
            mesh_repair::mesh_classify_staged,
            mesh_repair::mesh_hollow_staged,
            mesh_repair::mesh_shrinkwrap_staged,
            mesh_repair::mesh_tet_surface_staged,
            mesh_repair::mesh_solid_remesh_staged,
            mesh_repair::mesh_hollow_preview_capture_staged_source,
            mesh_repair::mesh_hollow_preview_from_captured_source,
            mesh_repair::mesh_hollow_apply_from_captured_source,
            mesh_repair::mesh_hollow_preview_read_positions,
            mesh_repair::mesh_hollow_preview_read_infill_positions,
            mesh_repair::mesh_hollow_preview_read_removed_voxel_centers,
            mesh_repair::mesh_hollow_preview_read_removed_voxel_indices,
            mesh_repair::mesh_hollow_preview_read_blocked_voxel_centers,
            mesh_repair::mesh_hollow_preview_read_blocked_voxel_indices,
            mesh_repair::mesh_hollow_preview_select_removed_voxels_in_polygon,
            mesh_repair::mesh_hollow_preview_read_cavity_positions,
            mesh_repair::mesh_hollow_staged_read_cavity_positions,
            mesh_repair::mesh_punch_staged,
            mesh_repair::mesh_punch_capture_staged_source,
            mesh_repair::mesh_punch_from_captured_source,
            mesh_repair::mesh_punch_read_positions,
            mesh_repair::mesh_organic_cut_staged,
            mesh_repair::mesh_organic_cut_capture_staged_source,
            mesh_repair::mesh_organic_cut_from_captured_source,
            mesh_repair::mesh_organic_cut_read_part,
            mesh_repair::mesh_organic_cut_geodesic_loop,
            mesh_repair::mesh_organic_cut_geodesic_loop_bytes,
            mesh_repair::mesh_organic_cut_read_geodesic,
            mesh_repair::mesh_organic_cut_membrane_preview,
            mesh_repair::mesh_organic_cut_plane_tenon_preview,
            mesh_repair::mesh_organic_cut_read_membrane,
            mesh_repair::mesh_organic_cut_read_tenon,
            mesh_repair::mesh_repair_read_positions,
            mesh_repair::load_mesh_file,
            mesh_repair::load_mesh_bytes,
            mesh_repair::load_mesh_range,
            updater_channel::check_updates,
            updater_channel::perform_update,
            updater_channel::get_saved_update_channel,
            updater_channel::save_update_channel
        ])
        .build(tauri::generate_context!())
        .expect("error while running DragonFruit desktop app")
        .run(|app_handle, event| {
            // CloseRequested does not fire on macOS Cmd+Q, so also flush the
            // tracked window state when the app itself is quitting.
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                window_state::save(app_handle);
            }
        });
}

#[cfg(test)]
mod tests;
