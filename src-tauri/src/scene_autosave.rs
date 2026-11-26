//! Scene autosave and crash recovery: where autosaved scenes go (a sidecar
//! beside the project, or the app's recovery folder), the manifest that
//! points at the last good payload, and how recovery finds and reads it.
//! Moved out of main.rs.

use serde::{Deserialize, Serialize};
use tauri::ipc::Response;

use crate::{
    is_scene_commit_temp_path, is_scene_file_path, is_voxl_autosave_target,
    sibling_commit_temp_path, DragonFruitAppHandle, SCENE_COMMIT_TEMP_MARKER,
};

// ---------------------------------------------------------------------------
// Scene Autosave
// ---------------------------------------------------------------------------

pub(crate) const SCENE_AUTOSAVE_DIR_NAME: &str = "autosave";
/// The generic-recovery payload name. It carries the `_autosave` marker so the
/// **third** target invariant holds without an exception: every path autosave
/// writes is self-describing, whether it is a sidecar or the fallback. The
/// directory is unchanged, so this is still "the existing generic recovery
/// location"; only the file name gained the marker.
pub(crate) const SCENE_AUTOSAVE_VOXL_FILE: &str = "scene_autosave.voxl";
/// The pre-Ph0.1 generic payload name. Never written any more, always searched:
/// an autosave a user already has on disk must stay recoverable.
pub(crate) const SCENE_AUTOSAVE_LEGACY_VOXL_FILE: &str = "scene.voxl";
pub(crate) const SCENE_AUTOSAVE_MANIFEST_FILE: &str = "manifest.json";

/// Every field added after `saved_at` / `clean` is `#[serde(default)]` so a
/// manifest written by a pre-Ph0.1 build still parses â€” losing recovery for the
/// autosave a user already has on disk would be a worse bug than the one this
/// sub-phase fixes.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SceneAutosaveManifest {
    pub(crate) saved_at: String,
    pub(crate) clean: bool,
    /// Absolute path of the payload actually committed. **Authoritative**: the
    /// manifest is written only after the atomic rename, so this can only ever
    /// name a fully-committed file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) voxl_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) origin: Option<String>,
    /// The project the sidecar belongs to; lets recovery re-derive the sidecar
    /// when `voxl_path` has gone stale.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) project_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) payload_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) fallback_reason: Option<String>,
    /// Failure message from the most recent tick, or None while autosave is healthy (D3).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) last_error: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct SceneAutosaveManifestWrite {
    pub saved_at: String,
    pub clean: bool,
    pub voxl_path: Option<String>,
    pub origin: Option<String>,
    pub project_path: Option<String>,
    pub payload_bytes: Option<u64>,
    pub fallback_reason: Option<String>,
    pub last_error: Option<String>,
    pub delete_payload: bool,
}

/**
 * Builds the manifest to persist for a tick (finding N4, sub-phase D3).
 *
 * Failure honesty requires that **a failed tick must not overwrite the pointer
 * to the last committed payload nor advance `saved_at` past what is on disk.** A
 * naive write that serialized `saved_at: now` on every attempt turned a transient
 * (antivirus locking the file, a share blinking) into a false recovery prompt
 * offering an old payload labeled with a fresh timestamp — turning a
 * *reported* problem into a real one. So on a failure write every
 * payload-describing field, `saved_at` included, falls back to the previous
 * manifest's value. Conversely a successful write clears `last_error`: the
 * condition is over, and a stale error in the settings tab is its own small
 * dishonesty.
 */
pub(crate) fn build_scene_autosave_manifest(
    previous: Option<&SceneAutosaveManifest>,
    write: SceneAutosaveManifestWrite,
) -> SceneAutosaveManifest {
    if write.last_error.is_some() {
        return SceneAutosaveManifest {
            saved_at: previous
                .map(|m| m.saved_at.clone())
                .unwrap_or(write.saved_at),
            clean: write.clean,
            voxl_path: write
                .voxl_path
                .or_else(|| previous.and_then(|m| m.voxl_path.clone())),
            origin: write
                .origin
                .or_else(|| previous.and_then(|m| m.origin.clone())),
            project_path: write
                .project_path
                .or_else(|| previous.and_then(|m| m.project_path.clone())),
            payload_bytes: write
                .payload_bytes
                .or_else(|| previous.and_then(|m| m.payload_bytes)),
            fallback_reason: write
                .fallback_reason
                .or_else(|| previous.and_then(|m| m.fallback_reason.clone())),
            last_error: write.last_error,
        };
    }

    SceneAutosaveManifest {
        saved_at: write.saved_at,
        clean: write.clean,
        voxl_path: if write.delete_payload {
            None
        } else {
            write
                .voxl_path
                .or_else(|| previous.and_then(|m| m.voxl_path.clone()))
        },
        origin: write
            .origin
            .or_else(|| previous.and_then(|m| m.origin.clone())),
        project_path: write
            .project_path
            .or_else(|| previous.and_then(|m| m.project_path.clone())),
        payload_bytes: if write.delete_payload {
            None
        } else {
            write
                .payload_bytes
                .or_else(|| previous.and_then(|m| m.payload_bytes))
        },
        fallback_reason: write
            .fallback_reason
            .or_else(|| previous.and_then(|m| m.fallback_reason.clone())),
        last_error: None,
    }
}

// ---------------------------------------------------------------------------
// Sidecar naming, writability, and payload identity
// ---------------------------------------------------------------------------

/// The marker that makes a recovery file self-describing in Explorer and gates
/// every deletion seam below.
pub(crate) const SCENE_AUTOSAVE_SIDECAR_MARKER: &str = "_autosave";

/// **THE ONE PLACE THE SIDECAR FILE NAME IS BUILT.**
///
/// Every target, every discovery candidate, and every deletion guard routes
/// through this function, so the naming scheme has exactly one definition.
///
/// *Open decision, deliberately left as a one-line change:* a per-process name
/// (`<stem>_<pid>_autosave.voxl`) would make two instances editing the same
/// project unable to collide. It is **not** the default, because the pid is
/// gone by the time it matters: after a crash â€” the one case clean-exit
/// deletion cannot cover â€” recovery would face several `MyPrint_1234_autosave`
/// files with no way to say which is current, and the orphans accumulate
/// forever. A single well-known name is unambiguous at recovery time, which is
/// the moment the file exists for. To switch, change only this format string
/// (and `is_sidecar_autosave_file`'s suffix test to a marker `contains`).
pub(crate) fn sidecar_autosave_file_name(project_stem: &str) -> String {
    format!("{project_stem}{SCENE_AUTOSAVE_SIDECAR_MARKER}.voxl")
}

/// `<dir>/<stem>_autosave.voxl` for a project file. `None` when the path has no
/// usable stem (the caller falls back to the recovery directory).
pub(crate) fn sidecar_autosave_path_for_project(project: &std::path::Path) -> Option<std::path::PathBuf> {
    let stem = project.file_stem().and_then(|s| s.to_str())?.trim();
    if stem.is_empty() {
        return None;
    }
    let parent = project.parent().unwrap_or_else(|| std::path::Path::new(""));
    Some(parent.join(sidecar_autosave_file_name(stem)))
}

/// Windows paths are case-insensitive; a candidate-list check that missed
/// `C:\Projects\...` vs `c:\projects\...` would reject a legitimate recovery.
pub(crate) fn autosave_paths_equal(a: &std::path::Path, b: &std::path::Path) -> bool {
    if a == b {
        return true;
    }
    a.to_string_lossy().to_ascii_lowercase() == b.to_string_lossy().to_ascii_lowercase()
}

pub(crate) fn is_sidecar_autosave_file(path: &std::path::Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    let suffix = format!("{SCENE_AUTOSAVE_SIDECAR_MARKER}.voxl");
    let lower = name.to_ascii_lowercase();
    // Strictly longer than the suffix: a file called exactly `_autosave.voxl`
    // belongs to no project and is not ours to delete.
    lower.ends_with(&suffix) && lower.len() > suffix.len()
}

/// The deletion gate. Only a file this policy could itself have produced â€” a
/// `<stem>_autosave.voxl` sidecar, or the generic recovery payload â€” may be
/// removed through any of the cleanup seams. The user's project never qualifies.
pub(crate) fn is_deletable_autosave_payload(recovery_dir: &std::path::Path, path: &std::path::Path) -> bool {
    is_sidecar_autosave_file(path)
        || autosave_paths_equal(path, &recovery_dir.join(SCENE_AUTOSAVE_LEGACY_VOXL_FILE))
}

/// Deletes the sidecar belonging to `project`, if there is one.
///
/// Used on Save As, where the sidecar beside the **old** project would otherwise
/// be orphaned â€” a `_autosave.voxl` next to a file the user no longer edits
/// implies unsaved work that does not exist.
pub(crate) fn delete_sidecar_for_project(project: &std::path::Path) -> Result<(), String> {
    let Some(sidecar) = sidecar_autosave_path_for_project(project) else {
        return Ok(());
    };
    if !is_sidecar_autosave_file(&sidecar) {
        return Err(format!(
            "Refusing to delete '{}': not an autosave sidecar",
            sidecar.display()
        ));
    }
    if !sidecar.exists() {
        return Ok(());
    }
    std::fs::remove_file(&sidecar)
        .map_err(|err| format!("Failed deleting sidecar '{}': {err}", sidecar.display()))
}

/// Real-syscall writability probe for a prospective sidecar location.
///
/// Deliberately not a metadata/permissions guess: read-only volumes,
/// permission-denied folders, and unreachable network shares all present
/// differently in metadata but identically to an actual create. Reuses sub-phase
/// A's `sibling_commit_temp_path` so the probe exercises the very mechanism the
/// real commit will use, rather than a lookalike.
///
/// Returns `None` when the directory is usable, or the `fallback_reason` to
/// record in the manifest when it is not.
pub(crate) fn probe_directory_writable(sidecar: &std::path::Path) -> Option<&'static str> {
    let parent = sidecar
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."));
    if !parent.as_os_str().is_empty() && !parent.is_dir() {
        return Some("parent-missing");
    }

    let probe = sibling_commit_temp_path(sidecar).ok()?;
    let writable = std::fs::write(&probe, b"").is_ok();
    let _ = std::fs::remove_file(&probe);
    if writable {
        None
    } else {
        Some("parent-unwritable")
    }
}

// ---------------------------------------------------------------------------
// Recovery discovery
// ---------------------------------------------------------------------------

pub(crate) const VOXL_FILE_MAGIC: &[u8; 4] = b"VOXL";

/// A candidate is only advertised if it exists, is non-empty, and actually
/// starts with the VOXL magic â€” a truncated or foreign file must never be
/// offered as a recoverable scene.
pub(crate) fn is_readable_voxl_payload(path: &std::path::Path) -> bool {
    use std::io::Read;
    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    let mut magic = [0u8; 4];
    file.read_exact(&mut magic).is_ok() && &magic == VOXL_FILE_MAGIC
}

/// The ordered recovery candidate list â€” and the **only** paths the recovery
/// reader will ever open.
///
/// 1. `manifest.voxlPath` â€” authoritative: the manifest is written only after
///    the atomic rename, so it can only name a fully-committed payload.
/// 2. the sidecar derived from `manifest.projectPath` â€” covers a project that
///    moved, and manifests from builds older than this change.
/// 3. the legacy generic `<app_data>/autosave/scene.voxl` â€” every autosave
///    written before sub-phase B; back-compat is free and mandatory.
pub(crate) fn scene_autosave_recovery_candidates(
    recovery_dir: &std::path::Path,
    manifest: Option<&SceneAutosaveManifest>,
) -> Vec<std::path::PathBuf> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    if let Some(manifest) = manifest {
        if let Some(voxl_path) = manifest
            .voxl_path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            candidates.push(std::path::PathBuf::from(voxl_path));
        }
        if let Some(project) = manifest
            .project_path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            if let Some(sidecar) = sidecar_autosave_path_for_project(std::path::Path::new(project))
            {
                candidates.push(sidecar);
            }
        }
    }

    candidates.push(recovery_dir.join(SCENE_AUTOSAVE_VOXL_FILE));
    candidates.push(recovery_dir.join(SCENE_AUTOSAVE_LEGACY_VOXL_FILE));

    let mut deduped: Vec<std::path::PathBuf> = Vec::with_capacity(candidates.len());
    for candidate in candidates {
        if !deduped
            .iter()
            .any(|existing| autosave_paths_equal(existing, &candidate))
        {
            deduped.push(candidate);
        }
    }
    deduped
}

/// The read gate: `scene_autosave_read_voxl_bytes` accepts a path **only** if
/// the resolver itself produced it. Same discipline as
/// `scene_file_discard_atomic_temp` â€” an arbitrary caller-supplied path can
/// never be turned into a file read through this seam.
pub(crate) fn is_allowed_recovery_read(candidates: &[std::path::PathBuf], path: &std::path::Path) -> bool {
    candidates
        .iter()
        .any(|candidate| autosave_paths_equal(candidate, path))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SceneAutosaveRecoveryCandidate {
    pub(crate) voxl_path: std::path::PathBuf,
    pub(crate) origin: String,
    pub(crate) saved_at: Option<String>,
    pub(crate) clean: bool,
    pub(crate) project_path: Option<String>,
    pub(crate) payload_bytes: u64,
    pub(crate) fallback_reason: Option<String>,
}

pub(crate) fn resolve_scene_autosave_recovery(
    recovery_dir: &std::path::Path,
    manifest: Option<&SceneAutosaveManifest>,
) -> Option<SceneAutosaveRecoveryCandidate> {
    let generic = recovery_dir.join(SCENE_AUTOSAVE_VOXL_FILE);
    let legacy_generic = recovery_dir.join(SCENE_AUTOSAVE_LEGACY_VOXL_FILE);

    for candidate in scene_autosave_recovery_candidates(recovery_dir, manifest) {
        if !is_readable_voxl_payload(&candidate) {
            continue;
        }

        let origin = if autosave_paths_equal(&candidate, &generic)
            || autosave_paths_equal(&candidate, &legacy_generic)
        {
            SCENE_AUTOSAVE_ORIGIN_RECOVERY_DIR.to_string()
        } else {
            manifest
                .and_then(|m| m.origin.clone())
                .unwrap_or_else(|| SCENE_AUTOSAVE_ORIGIN_SIDECAR.to_string())
        };

        let payload_bytes = std::fs::metadata(&candidate).map(|m| m.len()).unwrap_or(0);

        return Some(SceneAutosaveRecoveryCandidate {
            voxl_path: candidate,
            origin,
            saved_at: manifest.map(|m| m.saved_at.clone()),
            clean: manifest.map(|m| m.clean).unwrap_or(false),
            project_path: manifest.and_then(|m| m.project_path.clone()),
            payload_bytes,
            fallback_reason: manifest.and_then(|m| m.fallback_reason.clone()),
        });
    }

    None
}

// ---------------------------------------------------------------------------
// Stale commit-temp sweep (inherited from sub-phase A)
// ---------------------------------------------------------------------------

/// The pid segment of a `<target>.tmp-<pid>-<seq>` name.
pub(crate) fn scene_commit_temp_pid(path: &std::path::Path) -> Option<u32> {
    let name = path.file_name().and_then(|n| n.to_str())?;
    let (_, suffix) = name.rsplit_once(SCENE_COMMIT_TEMP_MARKER)?;
    suffix.split('-').next()?.parse::<u32>().ok()
}

/// Removes commit temps abandoned by a crashed write.
///
/// Conservative by construction, because these live in the user's own project
/// folder: only names `is_scene_commit_temp_path` recognises (sub-phase A's
/// exact pattern), only in a directory autosave already writes to, never this
/// process's own temps (they may be in flight â€” `scene_file_discard_atomic_temp`
/// owns those), and only past an age gate so another instance's in-flight write
/// is never deleted out from under it.
pub(crate) fn sweep_stale_scene_commit_temps(dir: &std::path::Path, min_age_seconds: u64) -> u32 {
    let cutoff = std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(min_age_seconds))
        .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
    let current_pid = std::process::id();

    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };

    let mut removed = 0u32;
    for entry in entries.flatten() {
        let path = entry.path();
        if !is_scene_commit_temp_path(&path) {
            continue;
        }
        if scene_commit_temp_pid(&path) == Some(current_pid) {
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

/// Crash residue can be minutes old for a large scene; anything younger than
/// this may still be an in-flight write from a second instance.
pub(crate) const SCENE_COMMIT_TEMP_SWEEP_MIN_AGE_SECONDS: u64 = 30 * 60;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SceneAutosavePaths {
    pub(crate) voxl_path: String,
    pub(crate) manifest_path: String,
    pub(crate) origin: String,
    pub(crate) project_path: Option<String>,
    pub(crate) fallback_reason: Option<String>,
}

/// Where an autosave tick will land, and why.
///
/// Pure and app-handle-free on purpose: the recovery directory is passed in, so
/// the whole target policy â€” including the three invariants the user pinned â€”
/// is testable without a Tauri runtime.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SceneAutosaveTarget {
    pub(crate) voxl_path: std::path::PathBuf,
    pub(crate) origin: &'static str,
    pub(crate) project_path: Option<String>,
    pub(crate) fallback_reason: Option<&'static str>,
}

pub(crate) const SCENE_AUTOSAVE_ORIGIN_SIDECAR: &str = "sidecar";
pub(crate) const SCENE_AUTOSAVE_ORIGIN_RECOVERY_DIR: &str = "recovery-dir";

/// Resolves where an autosave tick lands.
///
/// **User item 5.** A project that has been saved or opened gets its recovery
/// copy *beside it* as `<stem>_autosave.voxl` â€” local and obvious, not a hidden
/// app-data path the user would have to hunt for. Untitled scenes keep the
/// generic recovery location exactly as before.
///
/// **Binding fallback directive.** Any failure of the sidecar target â€” folder
/// gone, read-only volume, permission denied, unreachable network share â€” falls
/// back to the generic recovery location with a `fallback_reason` recorded in
/// the manifest. Never fail an autosave over a folder-policy question, and never
/// lie about where the payload actually went.
///
/// Three invariants hold for every input, each with its own test: the result
/// never equals the project path, always ends in `.voxl`, and always carries the
/// `_autosave` marker.
pub(crate) fn resolve_scene_autosave_target(
    recovery_dir: &std::path::Path,
    preferred_project_path: Option<&str>,
) -> SceneAutosaveTarget {
    let fallback = |project: Option<&str>, reason: &'static str| SceneAutosaveTarget {
        voxl_path: recovery_dir.join(SCENE_AUTOSAVE_VOXL_FILE),
        origin: SCENE_AUTOSAVE_ORIGIN_RECOVERY_DIR,
        project_path: project.map(str::to_string),
        fallback_reason: Some(reason),
    };

    let Some(project) = preferred_project_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return fallback(None, "no-project");
    };

    let path = std::path::Path::new(project);
    // `is_scene_file_path`, not `is_voxl_autosave_target`: a project saved in a
    // plugin scene format is still a project and still deserves a sidecar. It
    // gets a correctly-named `.voxl` one, so VOXL bytes never land in a file
    // whose extension promises a foreign format (invariant b).
    if !is_scene_file_path(path) {
        return fallback(Some(project), "not-a-scene-file");
    }

    let Some(sidecar) = sidecar_autosave_path_for_project(path) else {
        return fallback(Some(project), "not-a-scene-file");
    };

    // Invariants (a) and (b), enforced rather than assumed: the target is never
    // the file the user saves to, and it always ends in `.voxl`. Both are
    // unreachable by construction â€” `sidecar_autosave_file_name` inserts the
    // marker before a hard-coded `.voxl` â€” but they are the locks this whole
    // sub-phase exists for, so the resolver checks its own output instead of
    // trusting that the naming helper is never changed carelessly.
    if autosave_paths_equal(&sidecar, path) || !is_voxl_autosave_target(&sidecar) {
        return fallback(Some(project), "not-a-scene-file");
    }

    if let Some(reason) = probe_directory_writable(&sidecar) {
        return fallback(Some(project), reason);
    }

    SceneAutosaveTarget {
        voxl_path: sidecar,
        origin: SCENE_AUTOSAVE_ORIGIN_SIDECAR,
        project_path: Some(project.to_string()),
        fallback_reason: None,
    }
}

pub(crate) fn scene_autosave_resolve_dir(app: &DragonFruitAppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    let base = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Failed resolving app data dir: {err}"))?;
    let dir = base.join(SCENE_AUTOSAVE_DIR_NAME);
    std::fs::create_dir_all(&dir)
        .map_err(|err| format!("Failed creating autosave dir '{}': {err}", dir.display()))?;
    Ok(dir)
}

#[tauri::command]
pub async fn scene_autosave_get_paths(
    app: DragonFruitAppHandle,
    preferred_save_path: Option<String>,
) -> Result<SceneAutosavePaths, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = scene_autosave_resolve_dir(&app)?;
        let target = resolve_scene_autosave_target(&dir, preferred_save_path.as_deref());

        // Sweep crash residue from the directory we are about to write to, and
        // only that one. A `<project>.voxl.tmp-<pid>-<seq>` left by a killed
        // write is confusing clutter sitting next to the user's project.
        if let Some(parent) = target.voxl_path.parent() {
            sweep_stale_scene_commit_temps(parent, SCENE_COMMIT_TEMP_SWEEP_MIN_AGE_SECONDS);
        }

        Ok(SceneAutosavePaths {
            voxl_path: target.voxl_path.to_string_lossy().to_string(),
            manifest_path: dir
                .join(SCENE_AUTOSAVE_MANIFEST_FILE)
                .to_string_lossy()
                .to_string(),
            origin: target.origin.to_string(),
            project_path: target.project_path,
            fallback_reason: target.fallback_reason.map(str::to_string),
        })
    })
    .await
    .map_err(|err| format!("scene_autosave_get_paths task failed: {err}"))?
}

/// Writes the recovery manifest â€” **always after** the payload has been
/// committed by sub-phase A's atomic rename. That ordering is what makes
/// `voxl_path` authoritative: the manifest can only ever name a file that is
/// already complete on disk.
///
/// `delete_payload` is the cleanup seam. It removes the payload the *previous*
/// manifest advertised (plus the legacy generic location), gated on
/// `is_deletable_autosave_payload` so the user's project can never be reached
/// through it. Callers use it only after a successful save, restore, or an
/// explicit discard â€” never while unsaved work exists.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn scene_autosave_write_manifest(
    app: DragonFruitAppHandle,
    saved_at: String,
    clean: bool,
    voxl_path: Option<String>,
    origin: Option<String>,
    project_path: Option<String>,
    payload_bytes: Option<u64>,
    fallback_reason: Option<String>,
    last_error: Option<String>,
    delete_payload: Option<bool>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = scene_autosave_resolve_dir(&app)?;
        let path = dir.join(SCENE_AUTOSAVE_MANIFEST_FILE);

        let previous: Option<SceneAutosaveManifest> = std::fs::read_to_string(&path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok());

        if delete_payload.unwrap_or(false) {
            let mut targets: Vec<std::path::PathBuf> = vec![
                dir.join(SCENE_AUTOSAVE_LEGACY_VOXL_FILE),
                dir.join(SCENE_AUTOSAVE_VOXL_FILE),
            ];
            for advertised in [
                previous.as_ref().and_then(|m| m.voxl_path.clone()),
                voxl_path.clone(),
            ]
            .into_iter()
            .flatten()
            {
                targets.push(std::path::PathBuf::from(advertised));
            }
            if let Some(project) = previous
                .as_ref()
                .and_then(|m| m.project_path.clone())
                .or_else(|| project_path.clone())
            {
                if let Some(sidecar) =
                    sidecar_autosave_path_for_project(std::path::Path::new(&project))
                {
                    targets.push(sidecar);
                }
            }

            for target in targets {
                if !is_deletable_autosave_payload(&dir, &target) {
                    continue;
                }
                if target.exists() {
                    let _ = std::fs::remove_file(&target);
                }
            }
        }

        let manifest = build_scene_autosave_manifest(
            previous.as_ref(),
            SceneAutosaveManifestWrite {
                saved_at,
                clean,
                voxl_path,
                origin,
                project_path,
                payload_bytes,
                fallback_reason,
                last_error,
                delete_payload: delete_payload.unwrap_or(false),
            },
        );
        let json = serde_json::to_string(&manifest)
            .map_err(|err| format!("Failed serializing autosave manifest: {err}"))?;
        std::fs::write(&path, json.as_bytes())
            .map_err(|err| format!("Failed writing autosave manifest: {err}"))?;
        Ok(())
    })
    .await
    .map_err(|err| format!("scene_autosave_write_manifest task failed: {err}"))?
}

/// Deletes the sidecar belonging to a specific project.
///
/// Save As uses this on the **old** project path, so a successful Save As never
/// orphans a `_autosave.voxl` beside a file the user has stopped editing.
#[tauri::command]
pub async fn scene_autosave_delete_sidecar(project_path: String) -> Result<(), String> {
    let trimmed = project_path.trim().to_string();
    if trimmed.is_empty() {
        return Ok(());
    }
    tauri::async_runtime::spawn_blocking(move || {
        delete_sidecar_for_project(std::path::Path::new(&trimmed))
    })
    .await
    .map_err(|err| format!("scene_autosave_delete_sidecar task failed: {err}"))?
}

#[tauri::command]
pub async fn scene_autosave_read_manifest(
    app: DragonFruitAppHandle,
) -> Result<Option<SceneAutosaveManifest>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = scene_autosave_resolve_dir(&app)?;
        let path = dir.join(SCENE_AUTOSAVE_MANIFEST_FILE);
        if !path.exists() {
            return Ok(None);
        }
        let content = std::fs::read_to_string(&path)
            .map_err(|err| format!("Failed reading autosave manifest: {err}"))?;
        let manifest: SceneAutosaveManifest = serde_json::from_str(&content)
            .map_err(|err| format!("Failed parsing autosave manifest: {err}"))?;
        Ok(Some(manifest))
    })
    .await
    .map_err(|err| format!("scene_autosave_read_manifest task failed: {err}"))?
}

pub(crate) fn scene_autosave_read_manifest_from_dir(dir: &std::path::Path) -> Option<SceneAutosaveManifest> {
    let path = dir.join(SCENE_AUTOSAVE_MANIFEST_FILE);
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

/// **Recovery-discovery parity.** Without this, sidecar path control would be a
/// regression rather than a fix: the manifest would advertise a payload beside
/// the project and the reader â€” hard-wired to the generic location before this
/// change â€” could not open it.
#[tauri::command]
pub async fn scene_autosave_resolve_recovery(
    app: DragonFruitAppHandle,
) -> Result<Option<SceneAutosaveRecoveryCandidate>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = scene_autosave_resolve_dir(&app)?;
        let manifest = scene_autosave_read_manifest_from_dir(&dir);
        Ok(resolve_scene_autosave_recovery(&dir, manifest.as_ref()))
    })
    .await
    .map_err(|err| format!("scene_autosave_resolve_recovery task failed: {err}"))?
}

/// Reads a recovery payload. `path` is accepted **only** when it appears in the
/// resolver's own candidate list â€” never an arbitrary caller-supplied path.
/// Omitting it keeps the pre-Ph0.1 behaviour of reading the generic location.
#[tauri::command]
pub async fn scene_autosave_read_voxl_bytes(
    app: DragonFruitAppHandle,
    path: Option<String>,
) -> Result<Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let dir = scene_autosave_resolve_dir(&app)?;
        let manifest = scene_autosave_read_manifest_from_dir(&dir);
        let candidates = scene_autosave_recovery_candidates(&dir, manifest.as_ref());

        let requested = path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(std::path::PathBuf::from);

        let target = match requested {
            Some(requested) => {
                if !is_allowed_recovery_read(&candidates, &requested) {
                    return Err(format!(
                        "Refusing to read '{}': not an autosave recovery candidate",
                        requested.display()
                    ));
                }
                requested
            }
            None => resolve_scene_autosave_recovery(&dir, manifest.as_ref())
                .map(|candidate| candidate.voxl_path)
                .ok_or_else(|| "No autosaved scene file found".to_string())?,
        };

        if !target.exists() {
            return Err("No autosaved scene file found".to_string());
        }
        std::fs::read(&target).map_err(|err| format!("Failed reading autosaved scene: {err}"))
    })
    .await
    .map_err(|err| format!("scene_autosave_read_voxl_bytes task failed: {err}"))??;

    Ok(Response::new(bytes))
}
