// -----------------------------------------------------------------------
// Shared writer-test scaffolding (Ph0.1 sub-phase A)
// -----------------------------------------------------------------------

/// `append_mesh_stage_chunk` owns ONE process-global appender, so every test
/// that drives the writer must run alone. `cargo test` runs tests on
/// parallel threads by default; without this they would evict each other's
/// appenders and go flaky for the very reason sub-phase A exists.
static WRITER_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn lock_writer_tests() -> std::sync::MutexGuard<'static, ()> {
    let guard = WRITER_TEST_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    // A test that simulated a crash leaves the appender open; start clean.
    *super::staged_mesh_file_appender()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    guard
}

/// pid + process-wide sequence, same rationale as
/// `allocate_mesh_stage_file_path`: nanos alone collide on Windows.
fn unique_test_dir(tag: &str) -> std::path::PathBuf {
    static TEST_DIR_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let dir = std::env::temp_dir().join(format!(
        "dragonfruit-test-{tag}-{}-{}",
        std::process::id(),
        TEST_DIR_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("failed creating test dir");
    dir
}

/// Mirrors the frontend's native VOXL write seam
/// (`ExportManager.downloadFile` → `writeFileAtomicToNativePath`, which both
/// autosave and explicit save funnel through) so the crash-safety invariant
/// is asserted against the real writer rather than a paraphrase of it.
/// `interrupt_after_bytes` models the process dying mid-write: chunks stop
/// and nothing commits, exactly as a kill would leave things.
fn voxl_write_seam(
    target: &std::path::Path,
    bytes: &[u8],
    interrupt_after_bytes: Option<usize>,
) -> Result<(), String> {
    let temp = super::sibling_commit_temp_path(target)?;
    let temp_text = temp.to_string_lossy().to_string();
    let cut = interrupt_after_bytes
        .unwrap_or(bytes.len())
        .min(bytes.len());

    super::stage_append_chunk(&temp_text, &bytes[..cut], true)?;
    if interrupt_after_bytes.is_some() {
        // Process dies here: no further chunks, no finish, no commit.
        return Ok(());
    }
    super::stage_append_chunk(&temp_text, &bytes[cut..], false)?;
    super::finish_stage_write(&temp_text)?;
    super::commit_scene_file_atomic(&temp, target)
}

/// **The data-loss regression.** Before sub-phase A the seam wrote straight
/// to the destination with `truncate(true)` on chunk 0
/// (`append_mesh_stage_chunk`), so a crash between truncate and the last
/// chunk left a truncated scene file and no fallback — the user's project
/// destroyed by an autosave tick or a Ctrl+S that never finished.
#[test]
fn interrupted_voxl_write_preserves_previous_good_file() {
    let _guard = lock_writer_tests();
    let dir = unique_test_dir("atomic-commit");
    let target = dir.join("MyPrint.voxl");

    let good: Vec<u8> = (0..64u32).flat_map(|i| i.to_le_bytes()).collect();
    voxl_write_seam(&target, &good, None).expect("initial good write failed");
    assert_eq!(
        std::fs::read(&target).expect("good file unreadable"),
        good,
        "the baseline write did not produce the expected file"
    );

    let replacement = vec![0xABu8; 4096];
    let _ = voxl_write_seam(&target, &replacement, Some(1024));

    assert_eq!(
        std::fs::read(&target).expect("previous good file no longer exists"),
        good,
        "an interrupted write destroyed the previous good scene file"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

/// **The non-ASCII destination regression.** The staging path crosses the
/// IPC bridge in the `x-mesh-stage-path` header, and HTTP header values are
/// visible ASCII only. A project under `Tatsächliche Dokumente` therefore
/// failed on its first chunk with "failed to convert header to a str", and
/// the frontend's fallback chain downgraded the failure to a browser
/// download: the user picked a destination, got a success toast, and the
/// scene file was never written there. The path is percent-encoded on the
/// wire now, so the whole seam has to work under a non-ASCII directory.
#[test]
fn voxl_write_seam_works_under_a_non_ascii_path() {
    let _guard = lock_writer_tests();
    let dir = unique_test_dir("atomic-nonascii").join("Tatsächliche Dokumente");
    std::fs::create_dir_all(&dir).expect("failed creating non-ASCII test dir");
    let target = dir.join("Füße & Hände.voxl");

    let payload: Vec<u8> = (0..256u32).flat_map(|i| i.to_le_bytes()).collect();
    voxl_write_seam(&target, &payload, None).expect("write to a non-ASCII path failed");

    assert_eq!(
        std::fs::read(&target).expect("no file written to the non-ASCII path"),
        payload,
    );

    let _ = std::fs::remove_dir_all(dir.parent().unwrap());
}

/// The header carries a percent-encoded path; decoding it is what makes the
/// non-ASCII destination above reach the writer at all.
#[test]
fn stage_path_header_decodes_percent_encoding() {
    assert_eq!(
        super::decode_stage_path_header(
            b"C%3A%5CUsers%5CSomeone%5CTats%C3%A4chliche%20Dokumente%5CF%C3%BC%C3%9Fe.voxl"
        )
        .expect("decoding a percent-encoded path failed"),
        r"C:\Users\Someone\Tatsächliche Dokumente\Füße.voxl",
    );
}

/// An ASCII path with nothing to decode must survive untouched, so the
/// encoding change cannot alter the paths that already worked.
#[test]
fn stage_path_header_passes_plain_ascii_through() {
    assert_eq!(
        super::decode_stage_path_header(b"C%3A%5Cprojects%5Cscene.voxl")
            .expect("decoding failed"),
        r"C:\projects\scene.voxl",
    );
    assert_eq!(
        super::decode_stage_path_header(b"/tmp/scene.voxl").expect("decoding failed"),
        "/tmp/scene.voxl",
    );
}

/// The happy path of the commit: the target becomes the temp's bytes and no
/// `.tmp-` residue is left beside the user's project.
#[test]
fn commit_atomic_replaces_target_and_removes_temp() {
    let _guard = lock_writer_tests();
    let dir = unique_test_dir("atomic-replace");
    let target = dir.join("MyPrint.voxl");
    std::fs::write(&target, b"old contents").expect("seed write failed");

    let temp = super::sibling_commit_temp_path(&target).expect("temp alloc failed");
    std::fs::write(&temp, b"new contents").expect("temp write failed");
    super::commit_scene_file_atomic(&temp, &target).expect("commit failed");

    assert_eq!(std::fs::read(&target).unwrap(), b"new contents");
    assert!(!temp.exists(), "commit left a temp file beside the project");
    let residue: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.contains(".tmp-"))
        .collect();
    assert!(residue.is_empty(), "temp residue left behind: {residue:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn local_backup_atomic_writer_replaces_snapshot_without_changing_its_path() {
    let dir = unique_test_dir("local-backup-atomic");
    let target = dir.join("state.json");

    super::local_backup::write_local_backup_file_atomic(&target, br#"{"version":1}"#)
        .expect("initial backup write failed");
    super::local_backup::write_local_backup_file_atomic(&target, br#"{"version":2}"#)
        .expect("backup replacement failed");

    assert_eq!(
        std::fs::read(&target).expect("backup state unreadable"),
        br#"{"version":2}"#,
    );
    assert!(
        std::fs::read_dir(&dir)
            .expect("backup directory unreadable")
            .all(|entry| entry.expect("backup entry unreadable").path() == target),
        "atomic replacement should leave no staging files behind"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn local_backup_model_asset_copy_is_content_addressed_and_deduplicated() {
    let dir = unique_test_dir("local-backup-model-asset");
    let source = dir.join("source.stl");
    let backup = dir.join("backup");
    std::fs::create_dir_all(&dir).expect("test directory creation failed");
    std::fs::write(&source, b"prepared model bytes").expect("source write failed");

    let (first_name, first_size) =
        super::local_backup::copy_local_backup_model_asset(&source, &backup, "sample.stl")
            .expect("first model asset copy failed");
    let (second_name, second_size) =
        super::local_backup::copy_local_backup_model_asset(&source, &backup, "sample.stl")
            .expect("duplicate model asset copy failed");

    assert_eq!(first_name, second_name);
    assert_eq!(first_size, b"prepared model bytes".len() as u64);
    assert_eq!(second_size, first_size);
    assert_eq!(
        std::fs::read(backup.join("models").join(&first_name))
            .expect("synced model asset unreadable"),
        b"prepared model bytes",
    );
    assert_eq!(
        std::fs::read_dir(backup.join("models"))
            .expect("model library directory unreadable")
            .count(),
        1,
        "identical model files should share one library asset"
    );

    std::fs::write(backup.join("models").join(&first_name), b"corrupt")
        .expect("corrupting synced asset failed");
    super::local_backup::copy_local_backup_model_asset(&source, &backup, "sample.stl")
        .expect("corrupt model asset repair failed");
    assert_eq!(
        std::fs::read(backup.join("models").join(first_name))
            .expect("repaired model asset unreadable"),
        b"prepared model bytes",
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn local_backup_model_asset_sync_and_restore_rewrite_recent_file_paths() {
    let dir = unique_test_dir("local-backup-model-roundtrip");
    let source = dir.join("Prepared.stl");
    let backup = dir.join("backup");
    std::fs::create_dir_all(&dir).expect("test directory creation failed");
    std::fs::write(&source, b"prepared model bytes").expect("source write failed");
    let mut document = serde_json::json!({
        "snapshot": {
            "localStorage": {
                "app-recent-opened-files": serde_json::json!([{
                    "id": "mesh-id",
                    "name": "Prepared.stl",
                    "kind": "mesh",
                    "sourcePath": source.to_string_lossy(),
                    "sizeBytes": 999,
                    "openedAt": 123,
                }]).to_string(),
            },
        },
    });

    let synced = super::local_backup::sync_local_backup_model_assets(&backup, &mut document);
    assert_eq!(synced, (1, 0));
    let recent_files_json = document["snapshot"]["localStorage"]["app-recent-opened-files"]
        .as_str()
        .expect("recent file index missing from snapshot");
    let recent_files: serde_json::Value =
        serde_json::from_str(recent_files_json).expect("recent file index malformed");
    assert!(recent_files[0].get("sourcePath").is_none());
    assert_eq!(document["snapshot"]["modelAssets"].as_array().unwrap().len(), 1);

    let stored_name = document["snapshot"]["modelAssets"][0]["storedName"]
        .as_str()
        .expect("model asset name missing")
        .to_string();
    std::fs::write(backup.join("models").join(&stored_name), b"corrupt")
        .expect("corrupting model asset failed");
    let mut corrupted_document = document.clone();
    assert_eq!(
        super::local_backup::restore_local_backup_model_paths(&backup, &mut corrupted_document),
        0,
        "restore must not point recent files at an asset with invalid bytes"
    );
    super::local_backup::copy_local_backup_model_asset(&source, &backup, "Prepared.stl")
        .expect("model asset repair failed");

    assert_eq!(super::local_backup::restore_local_backup_model_paths(&backup, &mut document), 1);
    let restored_files: serde_json::Value = serde_json::from_str(
        document["snapshot"]["localStorage"]["app-recent-opened-files"]
            .as_str()
            .expect("restored recent file index missing"),
    )
    .expect("restored recent file index malformed");
    let restored_path = restored_files[0]["sourcePath"]
        .as_str()
        .expect("restored recent file path missing");
    assert_eq!(
        std::fs::read(restored_path).expect("restored asset unreadable"),
        b"prepared model bytes",
    );
    assert_eq!(restored_files[0]["sizeBytes"], b"prepared model bytes".len() as u64);

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn local_backup_model_library_indexes_assets_from_state_and_history() {
    let dir = unique_test_dir("local-backup-model-library");
    let source = dir.join("sample.stl");
    let backup = dir.join("backup");
    std::fs::create_dir_all(&dir).expect("test directory creation failed");
    std::fs::write(&source, b"prepared model bytes").expect("source write failed");
    let mut document = serde_json::json!({
        "updatedAt": "2026-11-18T00:00:00.000Z",
        "snapshot": {
            "localStorage": {
                "app-recent-opened-files": serde_json::json!([{
                    "id": "mesh-id",
                    "name": "sample.stl",
                    "kind": "mesh",
                    "sourcePath": source.to_string_lossy(),
                    "sizeBytes": 999,
                    "openedAt": 123,
                }]).to_string(),
            },
        },
    });
    assert_eq!(
        super::local_backup::sync_local_backup_model_assets(&backup, &mut document),
        (1, 0)
    );
    std::fs::create_dir_all(super::local_backup::local_backup_history_dir(&backup))
        .expect("history directory creation failed");
    let document_json = serde_json::to_string(&document).expect("document serialization failed");
    super::local_backup::write_local_backup_file_atomic(
        &super::local_backup::local_backup_state_path(&backup),
        document_json.as_bytes(),
    )
    .expect("state file write failed");
    super::local_backup::write_local_backup_file_atomic(
        &super::local_backup::local_backup_history_file_path(&backup, "1700000000000")
            .expect("history path invalid"),
        document_json.as_bytes(),
    )
    .expect("history file write failed");

    let library = super::local_backup::collect_local_backup_model_library(&backup)
        .expect("model library collection failed");
    assert_eq!(library.len(), 1);
    assert_eq!(library[0].name, "sample.stl");
    assert_eq!(library[0].kind, "mesh");
    assert_eq!(library[0].backup_count, 2);
    assert_eq!(
        std::fs::read(&library[0].path).expect("library item unreadable"),
        b"prepared model bytes",
    );

    let _ = std::fs::remove_dir_all(&dir);
}

/// Terminal failure must be strictly better than the old behaviour: the
/// previous good target survives, the temp is cleaned up, and the caller
/// gets an `Err` instead of a silently destroyed file.
#[test]
fn commit_atomic_leaves_target_intact_when_rename_fails() {
    let _guard = lock_writer_tests();
    let dir = unique_test_dir("atomic-fail");
    // A directory can never be replaced by a file rename on any platform.
    let target = dir.join("MyPrint.voxl");
    std::fs::create_dir_all(&target).expect("failed creating blocking directory");
    std::fs::write(target.join("sentinel.txt"), b"still here").expect("sentinel write failed");

    let temp = super::sibling_commit_temp_path(&target).expect("temp alloc failed");
    std::fs::write(&temp, b"new contents").expect("temp write failed");

    let result = super::commit_scene_file_atomic(&temp, &target);
    assert!(result.is_err(), "commit onto a directory should fail");
    assert_eq!(
        std::fs::read(target.join("sentinel.txt")).unwrap(),
        b"still here",
        "a failed commit damaged the previous target"
    );
    assert!(!temp.exists(), "a failed commit left its temp behind");

    let _ = std::fs::remove_dir_all(&dir);
}

/// Same collision geometry as the two allocator races already pinned below:
/// the commit temp is created with truncate, so two same-tick allocations
/// sharing a name would let one in-flight save overwrite another's staging
/// file and then rename the wrong bytes over the user's project.
#[test]
fn sibling_commit_temp_paths_are_unique_under_concurrent_allocation() {
    const THREADS: usize = 8;
    const ALLOCS_PER_THREAD: usize = 64;

    let dir = unique_test_dir("temp-uniqueness");
    let target = std::sync::Arc::new(dir.join("MyPrint.voxl"));
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(THREADS));
    let handles: Vec<_> = (0..THREADS)
        .map(|_| {
            let barrier = std::sync::Arc::clone(&barrier);
            let target = std::sync::Arc::clone(&target);
            std::thread::spawn(move || {
                barrier.wait();
                (0..ALLOCS_PER_THREAD)
                    .map(|_| {
                        super::sibling_commit_temp_path(&target)
                            .expect("commit temp allocation failed")
                    })
                    .collect::<Vec<_>>()
            })
        })
        .collect();

    let mut all_paths = std::collections::HashSet::new();
    for handle in handles {
        for path in handle.join().expect("allocator thread panicked") {
            assert_eq!(
                path.parent(),
                target.parent(),
                "commit temp must be a sibling of the target, or the rename is not atomic"
            );
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .expect("commit temp path has a UTF-8 file name")
                .to_string();
            assert!(
                name.starts_with("MyPrint.voxl.tmp-"),
                "commit temp name lost its contract: {name}"
            );
            assert!(
                super::is_scene_commit_temp_path(&path),
                "discard guard no longer recognizes its own temp: {name}"
            );
            assert!(all_paths.insert(path), "duplicate commit temp allocated");
        }
    }
    assert_eq!(all_paths.len(), THREADS * ALLOCS_PER_THREAD);

    let _ = std::fs::remove_dir_all(&dir);
}

/// **Finding N2.** Two chunked writes to different paths used to evict each
/// other from the single process-global appender and re-truncate on every
/// switch-back — writer A's committed chunks destroyed, its next chunk
/// landing at offset 0, both files corrupt, and no error anywhere.
#[test]
fn concurrent_stage_writes_error_instead_of_truncating() {
    let _guard = lock_writer_tests();
    let dir = unique_test_dir("stage-contention");
    let path_a = dir.join("a.bin").to_string_lossy().to_string();
    let path_b = dir.join("b.bin").to_string_lossy().to_string();

    // Writer A opens and writes its first chunk.
    super::stage_append_chunk(&path_a, &[0xAA; 512], true).expect("writer A chunk 0 failed");
    // Writer B interleaves with its own first chunk (evicts A's appender).
    super::stage_append_chunk(&path_b, &[0xBB; 512], true).expect("writer B chunk 0 failed");
    // A resumes mid-sequence. This is the corruption point.
    let resumed = super::stage_append_chunk(&path_a, &[0xAA; 512], false);

    assert!(
        resumed.is_err(),
        "an interleaved mid-sequence chunk was accepted — it silently re-truncated '{path_a}'"
    );
    let message = resumed.unwrap_err();
    assert!(
        message.contains("concurrent mesh-stage write detected"),
        "contention error lost its identity: {message}"
    );

    *super::staged_mesh_file_appender()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    let _ = std::fs::remove_dir_all(&dir);
}

/// Guard on the contention backstop itself: it must not fire on the ordinary
/// sequence of a *second* stage write.
///
/// `stage_mesh_file_path` flushes the appender but deliberately does not
/// close it, and an aborted slice never reaches that call at all — so the
/// previous stage file's appender is routinely still open when the next
/// slice's first chunk arrives. That chunk must truncate its own new file,
/// not be rejected as an interleave, or the second slice of every session
/// (and every slice after an abort) would fail.
///
/// This is what `sliceExportOrchestrator.handleMeshFileChunk`'s
/// `x-mesh-stage-offset` header buys: chunk 0 is identifiable.
#[test]
fn sequential_stage_writes_after_an_abandoned_one_still_succeed() {
    let _guard = lock_writer_tests();
    let dir = unique_test_dir("stage-sequential");
    let first = dir.join("stage-1.bin").to_string_lossy().to_string();
    let second = dir.join("stage-2.bin").to_string_lossy().to_string();

    // Slice 1 streams and is abandoned (aborted) — appender left open.
    super::stage_append_chunk(&first, &[0x11; 256], true).expect("stage 1 chunk 0 failed");
    super::stage_append_chunk(&first, &[0x11; 256], false).expect("stage 1 chunk 1 failed");

    // Slice 2 starts a brand-new stage file while that appender is open.
    super::stage_append_chunk(&second, &[0x22; 256], true).expect(
        "a new stage write was rejected as an interleave — the backstop is too aggressive",
    );
    super::stage_append_chunk(&second, &[0x22; 256], false).expect("stage 2 chunk 1 failed");
    super::finish_stage_write(&second).expect("stage 2 finish failed");

    assert_eq!(
        std::fs::read(&second).unwrap().len(),
        512,
        "chunk 0 of a new stage file must truncate, not append to stale bytes"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

/// **User invariant: autosave ALWAYS writes `.voxl`.** `is_scene_file_path`
/// also accepts the plugin scene extensions, so a project saved in a plugin
/// format used to be handed back verbatim as the autosave target — VOXL
/// bytes written into a file whose extension promises a foreign format.
#[test]
fn autosave_target_is_always_voxl_for_plugin_scene_extensions() {
    for ext in super::BUILTIN_PLUGIN_SCENE_EXTENSIONS {
        let candidate = std::path::PathBuf::from(format!("C:/projects/MyPrint.{ext}"));
        assert!(
            super::is_scene_file_path(&candidate),
            "test fixture is not a recognised scene file: {}",
            candidate.display()
        );
        assert!(
            !super::is_voxl_autosave_target(&candidate),
            "autosave would have written VOXL bytes into a .{ext} file"
        );
    }

    assert!(super::is_voxl_autosave_target(std::path::Path::new(
        "C:/projects/MyPrint.voxl"
    )));
    assert!(super::is_voxl_autosave_target(std::path::Path::new(
        "C:/projects/MyPrint.VOXL"
    )));
    assert!(!super::is_voxl_autosave_target(std::path::Path::new(
        "C:/projects/MyPrint.stl"
    )));
    assert!(!super::is_voxl_autosave_target(std::path::Path::new(
        "C:/projects/MyPrint"
    )));
}

/// **RED — NOT OWNED BY Ph0.1. DO NOT "FIX" BY LOOSENING TRUNCATE.**
///
/// Corollary of finding N2. `writeChunkedToNativePath`'s `finally` always
/// calls `finish_mesh_stage_write` (nativeSlicerBridge.ts:597-607), which
/// drops the appender, and every call restarts at offset 0 — so *every*
/// call re-opens with `truncate(true)`. `streamZipToNativePath`
/// (ExportManager.ts:655-706) makes three sequential calls to the same path
/// and its docstring (:642-654) asserts append-on-subsequent. That
/// assertion is false: native 3MF export emits only its postamble.
///
/// This test reproduces that call shape exactly and asserts the docstring's
/// contract, so it fails. It is `#[ignore]`d rather than deleted so the
/// suite stays green while the defect stays on the record.
///
/// Owner: the 3MF export team — fix in `streamZipToNativePath` (e.g. a
/// single write sequence, or an explicit append mode), NOT by weakening
/// `append_mesh_stage_chunk`'s truncate-on-fresh-appender semantics, which
/// mesh staging and Ph0.1's atomic commit both depend on.
#[test]
#[ignore = "RED: pins the known native-3MF truncation defect (N2 corollary); owned by the 3MF export team, not Ph0.1"]
fn native_3mf_sequential_writes_append_instead_of_truncating() {
    let _guard = lock_writer_tests();
    let dir = unique_test_dir("3mf-corollary");
    let path = dir.join("model.3mf").to_string_lossy().to_string();

    // Exactly what streamZipToNativePath does: three separate
    // writeChunkedToNativePath calls to one path, each starting at offset 0
    // and each closing the appender in its `finally`.
    for payload in [b"PREAMBLE".as_slice(), b"XMLXMLXML", b"POSTAMBLE"] {
        super::stage_append_chunk(&path, payload, true).expect("3mf chunk write failed");
        super::finish_stage_write(&path).expect("3mf finish failed");
    }

    let written = std::fs::read(&path).expect("3mf output unreadable");
    assert_eq!(
        written, b"PREAMBLEXMLXMLXMLPOSTAMBLE",
        "native 3MF export is emitting only its last write — the ZIP has no local headers and no model data"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

// -----------------------------------------------------------------------
// Ph0.1 sub-phase B â€” sidecar target policy + recovery-discovery parity
// -----------------------------------------------------------------------

/// Builds a project folder with a real scene file in it, plus a separate
/// recovery dir, mirroring the two real locations at runtime.
fn autosave_fixture(
    tag: &str,
    project_file: &str,
) -> (std::path::PathBuf, std::path::PathBuf, std::path::PathBuf) {
    let root = unique_test_dir(tag);
    let project_dir = root.join("projects");
    let recovery_dir = root.join("recovery");
    std::fs::create_dir_all(&project_dir).expect("failed creating project dir");
    std::fs::create_dir_all(&recovery_dir).expect("failed creating recovery dir");
    let project = project_dir.join(project_file);
    std::fs::write(&project, voxl_payload(b"project")).expect("failed seeding project file");
    (root, recovery_dir, project)
}

/// A minimally-valid VOXL payload: the 4-byte magic plus filler. The
/// recovery resolver magic-checks every candidate, so fixtures must carry it.
fn voxl_payload(tail: &[u8]) -> Vec<u8> {
    let mut bytes = b"VOXL".to_vec();
    bytes.extend_from_slice(tail);
    bytes
}

/// **User item 5, the lock.** An autosave tick must never target the file the
/// user saves to. Before sub-phase B `scene_autosave_get_paths` returned the
/// project path verbatim, so every tick overwrote the user's project with a
/// scene state they never asked to save.
#[test]
fn autosave_target_never_equals_the_project_path() {
    let (root, recovery_dir, project) = autosave_fixture("b-never-project", "MyPrint.voxl");
    let project_text = project.to_string_lossy().to_string();

    for candidate in [
        project_text.as_str(),
        // Already-sidecar-shaped names must not collapse onto themselves.
        root.join("projects/MyPrint_autosave.voxl")
            .to_string_lossy()
            .to_string()
            .as_str(),
    ] {
        let target = super::scene_autosave::resolve_scene_autosave_target(&recovery_dir, Some(candidate));
        assert_ne!(
            target.voxl_path,
            std::path::Path::new(candidate),
            "autosave targeted the user's own project file: {candidate}"
        );
    }

    let _ = std::fs::remove_dir_all(&root);
}

/// **Invariant (b).** Whatever the project's extension, the autosave target
/// ends in `.voxl` â€” autosave emits VOXL bytes and must never put them in a
/// file whose extension promises a foreign format.
#[test]
fn autosave_target_always_ends_in_voxl() {
    let root = unique_test_dir("b-always-voxl");
    let project_dir = root.join("projects");
    std::fs::create_dir_all(&project_dir).expect("failed creating project dir");

    let mut names: Vec<String> = vec!["MyPrint.voxl".to_string(), "MyPrint.VOXL".to_string()];
    names.extend(
        super::BUILTIN_PLUGIN_SCENE_EXTENSIONS
            .iter()
            .map(|ext| format!("MyPrint.{ext}")),
    );

    for name in names {
        let project = project_dir.join(&name);
        std::fs::write(&project, voxl_payload(b"p")).expect("seed failed");
        let target = super::scene_autosave::resolve_scene_autosave_target(
            &root.join("recovery"),
            Some(project.to_string_lossy().as_ref()),
        );
        let ext = target
            .voxl_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        assert_eq!(
            ext,
            "voxl",
            "autosave target for '{name}' does not end in .voxl: {}",
            target.voxl_path.display()
        );
    }

    let _ = std::fs::remove_dir_all(&root);
}

/// **Invariant (c).** The target always carries the `_autosave` marker, so a
/// recovery file is self-describing in Explorer and can never be mistaken for
/// a project. It is also what gates payload deletion
/// (`is_deletable_autosave_payload`).
#[test]
fn autosave_target_always_contains_the_autosave_marker() {
    let (root, recovery_dir, project) = autosave_fixture("b-marker", "MyPrint.voxl");

    for preferred in [
        Some(project.to_string_lossy().to_string()),
        Some("   ".to_string()),
        None,
    ] {
        let target = super::scene_autosave::resolve_scene_autosave_target(&recovery_dir, preferred.as_deref());
        let name = target
            .voxl_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string();
        assert!(
            name.contains("_autosave"),
            "autosave target is not self-describing: {name}"
        );
    }

    let _ = std::fs::remove_dir_all(&root);
}

/// **User item 5, the payoff.** A saved/opened project gets its recovery copy
/// beside it â€” local and obvious â€” not in a hidden app-data path.
#[test]
fn sidecar_lands_beside_the_project_as_stem_autosave_voxl() {
    let (root, recovery_dir, project) = autosave_fixture("b-sidecar", "MyPrint.voxl");

    let target = super::scene_autosave::resolve_scene_autosave_target(
        &recovery_dir,
        Some(project.to_string_lossy().as_ref()),
    );

    assert_eq!(target.origin, super::scene_autosave::SCENE_AUTOSAVE_ORIGIN_SIDECAR);
    assert_eq!(target.fallback_reason, None);
    assert_eq!(
        target.voxl_path,
        project.parent().unwrap().join("MyPrint_autosave.voxl"),
        "the sidecar did not land beside the project"
    );

    let _ = std::fs::remove_dir_all(&root);
}

/// A plugin-format project still gets a correctly-named VOXL sidecar in its
/// own folder rather than being exiled to the recovery dir.
#[test]
fn sidecar_is_derived_for_plugin_scene_extensions_too() {
    let ext = super::BUILTIN_PLUGIN_SCENE_EXTENSIONS
        .first()
        .expect("no plugin scene extensions registered");
    let (root, recovery_dir, project) =
        autosave_fixture("b-plugin-ext", &format!("MyPrint.{ext}"));

    let target = super::scene_autosave::resolve_scene_autosave_target(
        &recovery_dir,
        Some(project.to_string_lossy().as_ref()),
    );

    assert_eq!(target.origin, super::scene_autosave::SCENE_AUTOSAVE_ORIGIN_SIDECAR);
    assert_eq!(
        target.voxl_path,
        project.parent().unwrap().join("MyPrint_autosave.voxl"),
        "a plugin-format project did not get a .voxl sidecar beside it"
    );

    let _ = std::fs::remove_dir_all(&root);
}

/// **Binding user directive.** Any failure of the sidecar target falls back
/// to the default recovery location and says why â€” never fail an autosave
/// over a folder-permission question, and never lie about where it went.
#[test]
fn sidecar_falls_back_to_recovery_dir_when_the_project_folder_is_unusable() {
    let root = unique_test_dir("b-fallback");
    let recovery_dir = root.join("recovery");
    std::fs::create_dir_all(&recovery_dir).expect("failed creating recovery dir");
    let generic = recovery_dir.join(super::scene_autosave::SCENE_AUTOSAVE_VOXL_FILE);

    // Parent directory does not exist (deleted folder / unreachable share).
    let missing = root.join("gone/MyPrint.voxl");
    let target = super::scene_autosave::resolve_scene_autosave_target(
        &recovery_dir,
        Some(missing.to_string_lossy().as_ref()),
    );
    assert_eq!(target.voxl_path, generic);
    assert_eq!(target.origin, super::scene_autosave::SCENE_AUTOSAVE_ORIGIN_RECOVERY_DIR);
    assert_eq!(target.fallback_reason, Some("parent-missing"));

    // Not a scene file at all.
    let not_scene = root.join("notes.txt");
    std::fs::write(&not_scene, b"hi").expect("seed failed");
    let target = super::scene_autosave::resolve_scene_autosave_target(
        &recovery_dir,
        Some(not_scene.to_string_lossy().as_ref()),
    );
    assert_eq!(target.voxl_path, generic);
    assert_eq!(target.fallback_reason, Some("not-a-scene-file"));

    // No project at all (untitled scene) keeps today's behaviour exactly.
    let target = super::scene_autosave::resolve_scene_autosave_target(&recovery_dir, None);
    assert_eq!(target.voxl_path, generic);
    assert_eq!(target.fallback_reason, Some("no-project"));

    let _ = std::fs::remove_dir_all(&root);
}

/// The writability probe must use a real syscall â€” a metadata guess passes on
/// read-only volumes and on network shares that deny writes.
#[test]
fn writability_probe_rejects_a_directory_that_cannot_be_written() {
    let root = unique_test_dir("b-probe");
    let usable = root.join("usable");
    std::fs::create_dir_all(&usable).expect("failed creating dir");

    assert!(
        super::scene_autosave::probe_directory_writable(&usable.join("MyPrint_autosave.voxl")).is_none(),
        "a writable folder was reported unusable"
    );
    assert!(
        !usable.join("MyPrint_autosave.voxl").exists(),
        "the probe left its scratch file behind"
    );
    let residue: Vec<_> = std::fs::read_dir(&usable)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    assert!(residue.is_empty(), "the probe left residue: {residue:?}");

    assert_eq!(
        super::scene_autosave::probe_directory_writable(&root.join("absent/MyPrint_autosave.voxl")),
        Some("parent-missing"),
    );

    let _ = std::fs::remove_dir_all(&root);
}

/// **The parity requirement.** Path control without discovery is a
/// regression: a manifest would advertise a sidecar the reader could not
/// open. Resolution order is manifest â†’ sidecar-from-project â†’ legacy generic.
#[test]
fn recovery_discovery_prefers_manifest_then_sidecar_then_generic() {
    let (root, recovery_dir, project) = autosave_fixture("b-discovery", "MyPrint.voxl");
    let sidecar = project.parent().unwrap().join("MyPrint_autosave.voxl");
    let generic = recovery_dir.join(super::scene_autosave::SCENE_AUTOSAVE_VOXL_FILE);
    std::fs::write(&sidecar, voxl_payload(b"sidecar")).expect("sidecar seed failed");
    std::fs::write(&generic, voxl_payload(b"generic")).expect("generic seed failed");

    let manifest = super::scene_autosave::SceneAutosaveManifest {
        saved_at: "2026-07-26T00:00:00.000Z".to_string(),
        clean: false,
        voxl_path: Some(sidecar.to_string_lossy().to_string()),
        origin: Some(super::scene_autosave::SCENE_AUTOSAVE_ORIGIN_SIDECAR.to_string()),
        project_path: Some(project.to_string_lossy().to_string()),
        payload_bytes: None,
        fallback_reason: None,
        last_error: None,
    };

    // 1. The manifest is authoritative.
    let found = super::scene_autosave::resolve_scene_autosave_recovery(&recovery_dir, Some(&manifest))
        .expect("no recovery candidate found");
    assert_eq!(found.voxl_path, sidecar);
    assert_eq!(found.origin, super::scene_autosave::SCENE_AUTOSAVE_ORIGIN_SIDECAR);

    // 2. A manifest whose `voxlPath` no longer resolves falls through to the
    //    sidecar derived from `projectPath` (project moved, or an older build
    //    wrote no `voxlPath` at all).
    let mut stale = manifest.clone();
    stale.voxl_path = Some(
        root.join("gone/MyPrint_autosave.voxl")
            .to_string_lossy()
            .to_string(),
    );
    let found = super::scene_autosave::resolve_scene_autosave_recovery(&recovery_dir, Some(&stale))
        .expect("no recovery candidate found via project path");
    assert_eq!(found.voxl_path, sidecar);

    // 3. With neither, the legacy generic location still recovers.
    let mut legacy = manifest.clone();
    legacy.voxl_path = None;
    legacy.project_path = None;
    let found = super::scene_autosave::resolve_scene_autosave_recovery(&recovery_dir, Some(&legacy))
        .expect("no recovery candidate found in the legacy location");
    assert_eq!(found.voxl_path, generic);

    // 4. Nothing on disk â‡’ no prompt.
    std::fs::remove_file(&generic).expect("generic cleanup failed");
    assert!(super::scene_autosave::resolve_scene_autosave_recovery(&recovery_dir, Some(&legacy)).is_none());
    assert!(super::scene_autosave::resolve_scene_autosave_recovery(&recovery_dir, None).is_none());

    let _ = std::fs::remove_dir_all(&root);
}

/// Back-compat lock: a manifest written before sub-phase B has none of the
/// new fields and must still parse and still recover from the generic path.
#[test]
fn recovery_discovery_reads_a_legacy_pre_sidecar_manifest() {
    let root = unique_test_dir("b-legacy-manifest");
    let recovery_dir = root.join("recovery");
    std::fs::create_dir_all(&recovery_dir).expect("failed creating recovery dir");
    // The pre-Ph0.1 payload name, which is never written any more.
    let legacy = recovery_dir.join(super::scene_autosave::SCENE_AUTOSAVE_LEGACY_VOXL_FILE);
    std::fs::write(&legacy, voxl_payload(b"legacy")).expect("legacy seed failed");

    let legacy_json = r#"{"savedAt":"2026-07-01T12:00:00.000Z","clean":false}"#;
    let manifest: super::scene_autosave::SceneAutosaveManifest =
        serde_json::from_str(legacy_json).expect("a pre-Ph0.1 manifest no longer parses");
    assert_eq!(manifest.voxl_path, None);

    let found = super::scene_autosave::resolve_scene_autosave_recovery(&recovery_dir, Some(&manifest))
        .expect("a pre-Ph0.1 autosave became unrecoverable");
    assert_eq!(found.voxl_path, legacy);
    assert_eq!(found.origin, super::scene_autosave::SCENE_AUTOSAVE_ORIGIN_RECOVERY_DIR);
    assert_eq!(found.saved_at.as_deref(), Some("2026-07-01T12:00:00.000Z"));

    let _ = std::fs::remove_dir_all(&root);
}

/// A payload that is not VOXL (truncated, foreign, or a leftover of some
/// other tool) must not be advertised as recoverable.
#[test]
fn recovery_discovery_skips_candidates_that_are_not_voxl() {
    let (root, recovery_dir, project) = autosave_fixture("b-magic", "MyPrint.voxl");
    let sidecar = project.parent().unwrap().join("MyPrint_autosave.voxl");
    let generic = recovery_dir.join(super::scene_autosave::SCENE_AUTOSAVE_VOXL_FILE);
    std::fs::write(&sidecar, b"NOPE-not-a-voxl").expect("sidecar seed failed");
    std::fs::write(&generic, voxl_payload(b"generic")).expect("generic seed failed");

    let manifest = super::scene_autosave::SceneAutosaveManifest {
        saved_at: "2026-07-26T00:00:00.000Z".to_string(),
        clean: false,
        voxl_path: Some(sidecar.to_string_lossy().to_string()),
        origin: Some(super::scene_autosave::SCENE_AUTOSAVE_ORIGIN_SIDECAR.to_string()),
        project_path: Some(project.to_string_lossy().to_string()),
        payload_bytes: None,
        fallback_reason: None,
        last_error: None,
    };

    let found = super::scene_autosave::resolve_scene_autosave_recovery(&recovery_dir, Some(&manifest))
        .expect("recovery gave up instead of falling through a bad payload");
    assert_eq!(
        found.voxl_path, generic,
        "a non-VOXL payload was advertised as recoverable"
    );

    let _ = std::fs::remove_dir_all(&root);
}

/// The reader accepts only paths the resolver itself produced â€” never an
/// arbitrary caller-supplied path. Same discipline as
/// `scene_file_discard_atomic_temp`'s guard.
#[test]
fn recovery_read_rejects_paths_outside_the_candidate_list() {
    let (root, recovery_dir, project) = autosave_fixture("b-candidate-guard", "MyPrint.voxl");
    let sidecar = project.parent().unwrap().join("MyPrint_autosave.voxl");
    std::fs::write(&sidecar, voxl_payload(b"sidecar")).expect("sidecar seed failed");

    let manifest = super::scene_autosave::SceneAutosaveManifest {
        saved_at: "2026-07-26T00:00:00.000Z".to_string(),
        clean: false,
        voxl_path: Some(sidecar.to_string_lossy().to_string()),
        origin: Some(super::scene_autosave::SCENE_AUTOSAVE_ORIGIN_SIDECAR.to_string()),
        project_path: Some(project.to_string_lossy().to_string()),
        payload_bytes: None,
        fallback_reason: None,
        last_error: None,
    };

    let candidates = super::scene_autosave::scene_autosave_recovery_candidates(&recovery_dir, Some(&manifest));
    assert!(super::scene_autosave::is_allowed_recovery_read(&candidates, &sidecar));
    // The user's own project is never a recovery candidate.
    assert!(!super::scene_autosave::is_allowed_recovery_read(&candidates, &project));
    assert!(!super::scene_autosave::is_allowed_recovery_read(
        &candidates,
        std::path::Path::new("C:/Windows/System32/config/SAM")
    ));

    let _ = std::fs::remove_dir_all(&root);
}

/// Cleanup gate: only a file this policy could have produced may be deleted
/// through the payload-deletion seam.
#[test]
fn only_autosave_payloads_are_deletable() {
    let recovery_dir = std::path::Path::new("C:/appdata/autosave");
    assert!(super::scene_autosave::is_deletable_autosave_payload(
        recovery_dir,
        std::path::Path::new("C:/projects/MyPrint_autosave.voxl")
    ));
    assert!(super::scene_autosave::is_deletable_autosave_payload(
        recovery_dir,
        &recovery_dir.join(super::scene_autosave::SCENE_AUTOSAVE_VOXL_FILE)
    ));
    // The pre-Ph0.1 payload name has no marker; it is deletable only because
    // it sits at the one well-known legacy location.
    assert!(super::scene_autosave::is_deletable_autosave_payload(
        recovery_dir,
        &recovery_dir.join(super::scene_autosave::SCENE_AUTOSAVE_LEGACY_VOXL_FILE)
    ));
    assert!(!super::scene_autosave::is_deletable_autosave_payload(
        recovery_dir,
        std::path::Path::new("C:/projects/scene.voxl")
    ));
    // The user's project, and anything else, never.
    assert!(!super::scene_autosave::is_deletable_autosave_payload(
        recovery_dir,
        std::path::Path::new("C:/projects/MyPrint.voxl")
    ));
    assert!(!super::scene_autosave::is_deletable_autosave_payload(
        recovery_dir,
        std::path::Path::new("C:/projects/MyPrint_autosave.stl")
    ));
}

/// **Save-As cleanup (user item 6).** A sidecar left beside the *old* project
/// after Save As is an orphan that implies unsaved work which does not exist.
#[test]
fn sidecar_for_a_project_is_deleted_by_name_and_nothing_else_is() {
    let (root, _recovery, project) = autosave_fixture("b-saveas-cleanup", "MyPrint.voxl");
    let sidecar = project.parent().unwrap().join("MyPrint_autosave.voxl");
    let neighbour = project.parent().unwrap().join("OtherPrint_autosave.voxl");
    std::fs::write(&sidecar, voxl_payload(b"s")).expect("sidecar seed failed");
    std::fs::write(&neighbour, voxl_payload(b"n")).expect("neighbour seed failed");

    super::scene_autosave::delete_sidecar_for_project(&project).expect("sidecar deletion failed");

    assert!(!sidecar.exists(), "the orphaned sidecar was not deleted");
    assert!(project.exists(), "deletion touched the user's project");
    assert!(neighbour.exists(), "deletion touched an unrelated sidecar");

    // Idempotent: a project that never autosaved is not an error.
    super::scene_autosave::delete_sidecar_for_project(&project).expect("second deletion should be a no-op");

    let _ = std::fs::remove_dir_all(&root);
}

/// **Inherited from sub-phase A.** A crashed write leaves a
/// `<target>.tmp-<pid>-<seq>` sibling beside the user's project. Sweep them,
/// but only files matching A's exact pattern and only where we already write.
#[test]
fn stale_commit_temps_are_swept_conservatively() {
    let root = unique_test_dir("b-temp-sweep");
    let stale = root.join("MyPrint.voxl.tmp-424242-7");
    let ours = root.join(format!("MyPrint.voxl.tmp-{}-0", std::process::id()));
    let innocent = root.join("MyPrint.voxl");
    let lookalike = root.join("MyPrint.voxl.tmp-notapid-0");
    for path in [&stale, &ours, &innocent, &lookalike] {
        std::fs::write(path, b"x").expect("seed failed");
    }

    // Nothing is old enough yet, so a fresh crash residue is left alone â€”
    // an in-flight write from another instance must never be deleted.
    assert_eq!(super::scene_autosave::sweep_stale_scene_commit_temps(&root, 3600), 0);
    assert!(stale.exists());

    // With the age gate satisfied, only other processes' temps go.
    assert_eq!(super::scene_autosave::sweep_stale_scene_commit_temps(&root, 0), 1);
    assert!(!stale.exists(), "a stale foreign temp survived the sweep");
    assert!(
        ours.exists(),
        "the sweep deleted this process's own live temp"
    );
    assert!(innocent.exists(), "the sweep deleted a real scene file");
    assert!(lookalike.exists(), "the sweep deleted a non-matching file");

    let _ = std::fs::remove_dir_all(&root);
}

fn committed_manifest() -> super::scene_autosave::SceneAutosaveManifest {
    super::scene_autosave::SceneAutosaveManifest {
        saved_at: "2026-07-26T11:00:00.000Z".to_string(),
        clean: false,
        voxl_path: Some("C:/projects/MyPrint_autosave.voxl".to_string()),
        origin: Some("sidecar".to_string()),
        project_path: Some("C:/projects/MyPrint.voxl".to_string()),
        payload_bytes: Some(12345),
        fallback_reason: None,
        last_error: None,
    }
}

fn failure_write(error: &str) -> super::scene_autosave::SceneAutosaveManifestWrite {
    super::scene_autosave::SceneAutosaveManifestWrite {
        saved_at: "2026-07-26T12:00:00.000Z".to_string(),
        clean: false,
        voxl_path: None,
        origin: None,
        project_path: None,
        payload_bytes: None,
        fallback_reason: None,
        last_error: Some(error.to_string()),
        delete_payload: false,
    }
}

/// Failure honesty (sub-phase D3, finding N4): an error must be recorded without
/// advancing `saved_at` past what is actually on disk or dropping the pointer
/// to the last committed payload. A naive write that updated `saved_at` turned a
/// transient (antivirus on destination, share blinking) into a false recovery prompt
/// offering old work labeled with a fresh timestamp — turning a *reported* problem into
/// a real one.
#[test]
fn autosave_failure_is_recorded_without_disturbing_the_last_good_payload() {
    let previous = committed_manifest();
    let next = super::scene_autosave::build_scene_autosave_manifest(
        Some(&previous),
        failure_write("This scene is 4.3 GB compressed and exceeds the VOXL 4 GB limit."),
    );

    assert_eq!(
        next.last_error.as_deref(),
        Some("This scene is 4.3 GB compressed and exceeds the VOXL 4 GB limit.")
    );
    assert_eq!(
        next.saved_at, previous.saved_at,
        "a failed tick advanced the timestamp the recovery prompt shows"
    );
    assert_eq!(
        next.voxl_path, previous.voxl_path,
        "a failed tick erased the pointer to the last committed payload"
    );
    assert_eq!(next.origin, previous.origin);
    assert_eq!(next.project_path, previous.project_path);
    assert_eq!(next.payload_bytes, previous.payload_bytes);
}

#[test]
fn a_first_ever_failure_still_produces_a_readable_manifest() {
    let next = super::scene_autosave::build_scene_autosave_manifest(None, failure_write("disk full"));
    assert_eq!(next.last_error.as_deref(), Some("disk full"));
    assert_eq!(next.saved_at, "2026-07-26T12:00:00.000Z");
    assert_eq!(next.voxl_path, None);
}

#[test]
fn a_successful_write_clears_a_recorded_failure() {
    let mut previous = committed_manifest();
    previous.last_error = Some("disk full".to_string());

    let next = super::scene_autosave::build_scene_autosave_manifest(
        Some(&previous),
        super::scene_autosave::SceneAutosaveManifestWrite {
            saved_at: "2026-07-26T12:00:00.000Z".to_string(),
            clean: false,
            voxl_path: Some("C:/projects/MyPrint_autosave.voxl".to_string()),
            origin: Some("sidecar".to_string()),
            project_path: Some("C:/projects/MyPrint.voxl".to_string()),
            payload_bytes: Some(999),
            fallback_reason: None,
            last_error: None,
            delete_payload: false,
        },
    );

    assert_eq!(
        next.last_error, None,
        "a healthy autosave kept reporting a stale error"
    );
    assert_eq!(next.saved_at, "2026-07-26T12:00:00.000Z");
    assert_eq!(next.payload_bytes, Some(999));
}

#[test]
fn clearing_the_manifest_drops_the_payload_pointer_it_just_deleted() {
    let previous = committed_manifest();
    let next = super::scene_autosave::build_scene_autosave_manifest(
        Some(&previous),
        super::scene_autosave::SceneAutosaveManifestWrite {
            saved_at: "2026-07-26T12:00:00.000Z".to_string(),
            clean: true,
            voxl_path: previous.voxl_path.clone(),
            origin: previous.origin.clone(),
            project_path: previous.project_path.clone(),
            payload_bytes: None,
            fallback_reason: None,
            last_error: None,
            delete_payload: true,
        },
    );

    assert!(next.clean);
    assert_eq!(
        next.voxl_path, None,
        "a cleaned manifest advertised a file it had deleted"
    );
}

/// Candidate paths come from the frontend, which cannot resolve `~`; the
/// macOS candidate `~/Applications/UVtools.app` depends on this.
#[test]
fn expand_tilde_resolves_against_home() {
    let home = std::env::var("HOME").expect("HOME is set on the test hosts");

    assert_eq!(
        super::expand_tilde("~/Applications/UVtools.app"),
        std::path::PathBuf::from(&home).join("Applications/UVtools.app"),
    );
    assert_eq!(
        super::expand_tilde("/Applications/UVtools.app"),
        std::path::PathBuf::from("/Applications/UVtools.app"),
        "an absolute candidate must be left alone",
    );
    assert_eq!(
        super::expand_tilde("~backup/UVtools"),
        std::path::PathBuf::from("~backup/UVtools"),
        "only a leading `~/` is a home reference",
    );
}

/// UVTools ships on macOS as an `.app` bundle, which is a directory: the
/// `is_file()` check that discovery used before rejected every macOS
/// install (issue #604).
#[test]
fn app_bundles_count_as_uvtools_installs_on_macos() {
    let dir = unique_test_dir("uvtools-discovery");

    let bundle = dir.join("UVtools.app");
    std::fs::create_dir_all(bundle.join("Contents/MacOS")).expect("failed creating bundle");
    let binary = bundle.join("Contents/MacOS/UVtools");
    std::fs::write(&binary, b"").expect("failed writing bundle binary");
    let plain_dir = dir.join("UVtools");
    std::fs::create_dir_all(&plain_dir).expect("failed creating plain dir");

    assert!(
        super::is_uvtools_install(&binary),
        "a bare executable is an install on every platform",
    );
    assert!(!super::is_uvtools_install(&dir.join("missing.app")));
    assert!(
        !super::is_uvtools_install(&plain_dir),
        "a directory without the .app extension is not a bundle",
    );
    assert_eq!(
        super::is_uvtools_install(&bundle),
        cfg!(target_os = "macos"),
        "only macOS treats an .app directory as an install",
    );

    let _ = std::fs::remove_dir_all(&dir);
}

// -----------------------------------------------------------------------
// open_external_url validation
// -----------------------------------------------------------------------

#[test]
fn external_url_accepts_web_and_mailto() {
    assert_eq!(
        super::validate_external_url(" https://github.com/gilmardr/Rambutan-Slicer ").unwrap(),
        "https://github.com/gilmardr/Rambutan-Slicer"
    );
    assert!(super::validate_external_url("http://example.com/a?b=1&c=2").is_ok());
    assert!(super::validate_external_url("mailto:security@example.com").is_ok());
}

#[test]
fn external_url_rejects_local_and_unsafe_targets() {
    for bad in [
        "",
        "calc.exe",
        "C:\\Windows\\System32\\calc.exe",
        "file:///C:/Windows/System32/calc.exe",
        "javascript:alert(1)",
        "ms-settings:privacy",
        "https://example.com/\nfoo",
        "http://",
    ] {
        assert!(
            super::validate_external_url(bad).is_err(),
            "should reject {bad:?}"
        );
    }
}

#[test]
fn external_url_encodes_shell_metacharacters() {
    let url = super::validate_external_url("https://example.com/a b\"c").unwrap();
    assert!(!url.contains(' ') && !url.contains('"'), "{url}");
}
