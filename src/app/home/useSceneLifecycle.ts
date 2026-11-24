import React from 'react';
import type * as THREE from 'three';
import { msg } from '@lingui/core/macro';
import type { useLingui } from '@lingui/react';
import { resolveEntirePlateExportBaseName } from '@/features/export/logic/exportFileNaming';
import { ExportManager } from '@/features/export/logic/ExportManager';
import { getFileExtension, getFileNameFromPath, normalizeActiveVoxlScenePath } from '@/features/import-export/fileHandling';
import type { useImportExportManager } from '@/features/import-export/useImportExportManager';
import type { useEditorToasts } from '@/features/notifications/useEditorToasts';
import type { useSceneCollectionManager } from '@/features/scene/useSceneCollectionManager';
import { VoxlSizeLimitError } from '@/features/scene/voxl';
import type { getSceneAutosaveSettingsSnapshot } from '@/components/settings/sceneAutosavePreferences';
import {
  deleteAutosaveSidecarForProject,
  readAutosaveRecoveryBytes,
  resolveAutosaveRecovery,
  suppressSceneAutosave,
  type useSceneAutosave,
} from '@/hooks/useSceneAutosave';
import { formatCompressedModelSize } from './homeFormatters';

type SetState<T> = React.Dispatch<React.SetStateAction<T>>;
type HomeScene = ReturnType<typeof useSceneCollectionManager>;
type ImportExport = ReturnType<typeof useImportExportManager>;
type EditorToasts = ReturnType<typeof useEditorToasts>;
type SceneSaveChoice = 'overwrite' | 'save_as' | 'cancel';

export type AutosaveRecoveryCandidate = {
  savedAt: string;
  /** The payload discovery resolved — the restore reads this exact file. */
  voxlPath: string;
  origin: string;
};

export type SceneSaveErrorState = {
  title: string;
  message: string;
  detail?: string | null;
};

export type UseSceneLifecycleInput = {
  _: ReturnType<typeof useLingui>['_'];
  scene: HomeScene;
  importSceneFile: HomeScene['importSceneFile'];
  sceneAutosaveSettings: ReturnType<typeof getSceneAutosaveSettingsSnapshot>;
  supportsRef: React.RefObject<THREE.Group | null>;
  setIsSceneSaveInProgress: SetState<boolean>;
  activeSceneFilePath: string | null;
  setActiveSceneFilePath: SetState<string | null>;
  loadedSceneSaveSource: { name: string; path: string | null } | null;
  setLoadedSceneSaveSource: SetState<{ name: string; path: string | null } | null>;
  setSceneFormatChunked: SetState<boolean>;
  setShowSceneSaveChoiceModal: SetState<boolean>;
  setSceneSaveChoiceFileName: SetState<string | null>;
  setSceneSaveChoicePath: SetState<string | null>;
  autosaveRecovery: AutosaveRecoveryCandidate | null;
  setAutosaveRecovery: SetState<AutosaveRecoveryCandidate | null>;
  setShowCloseUnsavedChangesModal: SetState<boolean>;
  setCloseUnsavedChangesBusy: SetState<'none' | 'save_and_close' | 'discard_and_close'>;
  setShowNewSceneUnsavedChangesModal: SetState<boolean>;
  setNewSceneBusy: SetState<'none' | 'save_and_new' | 'discard_and_new'>;
  sceneSaveChoiceResolveRef: React.RefObject<((choice: SceneSaveChoice) => void) | null>;
  hasUnsavedSceneChangesRef: React.RefObject<boolean>;
  allowProgrammaticWindowCloseRef: React.RefObject<boolean>;
  sceneSaveKickoffTimerRef: React.RefObject<number | null>;
  sceneSaveInFlightRef: React.RefObject<boolean>;
  sceneSaveQueuedRef: React.RefObject<boolean>;
  queuedSceneSavePathOverrideRef: React.RefObject<string | null | undefined>;
  preferredOverwriteScenePathRef: React.RefObject<string | null>;
  desktopWindowRevealRequestedRef: React.RefObject<boolean>;
  clearAutosave: ReturnType<typeof useSceneAutosave>['clearAutosave'];
  setSceneSaveError: SetState<SceneSaveErrorState | null>;
  setIsTemporarilyDisablingCrossSectionForThumbnail: SetState<boolean>;
  promptSceneSaveChoice: (options: { fileName: string; scenePath: string | null }) => Promise<SceneSaveChoice>;
  markSceneSaveBaseline: () => void;
  setExportSuccessToast: EditorToasts['setExportSuccessToast'];
  setIsExportSuccessToastVisible: EditorToasts['setIsExportSuccessToastVisible'];
  exportSuccessToastFadeTimeoutRef: EditorToasts['exportSuccessToastFadeTimeoutRef'];
  exportThumbnailCaptureRunnerRef: ImportExport['exportThumbnailCaptureRunnerRef'];
  setNativePickerPreparationState: ImportExport['setNativePickerPreparationState'];
  pendingStartupSceneHandoff: ImportExport['pendingStartupSceneHandoff'];
};

/**
 * The scene's save and exit lifecycle on the Home page: save and save as with
 * their queue, autosave recovery, closing the program, starting a new scene,
 * and revealing the desktop window at startup. Moved verbatim out of
 * src/app/page.tsx; the state it reads and writes stays in Home, because the
 * modals render from it.
 */

export function useSceneLifecycle({
  _,
  scene,
  importSceneFile,
  sceneAutosaveSettings,
  supportsRef,
  setIsSceneSaveInProgress,
  activeSceneFilePath,
  setActiveSceneFilePath,
  loadedSceneSaveSource,
  setLoadedSceneSaveSource,
  setSceneFormatChunked,
  setShowSceneSaveChoiceModal,
  setSceneSaveChoiceFileName,
  setSceneSaveChoicePath,
  autosaveRecovery,
  setAutosaveRecovery,
  setShowCloseUnsavedChangesModal,
  setCloseUnsavedChangesBusy,
  setShowNewSceneUnsavedChangesModal,
  setNewSceneBusy,
  sceneSaveChoiceResolveRef,
  hasUnsavedSceneChangesRef,
  allowProgrammaticWindowCloseRef,
  sceneSaveKickoffTimerRef,
  sceneSaveInFlightRef,
  sceneSaveQueuedRef,
  queuedSceneSavePathOverrideRef,
  preferredOverwriteScenePathRef,
  desktopWindowRevealRequestedRef,
  clearAutosave,
  setSceneSaveError,
  setIsTemporarilyDisablingCrossSectionForThumbnail,
  promptSceneSaveChoice,
  markSceneSaveBaseline,
  setExportSuccessToast,
  setIsExportSuccessToastVisible,
  exportSuccessToastFadeTimeoutRef,
  exportThumbnailCaptureRunnerRef,
  setNativePickerPreparationState,
  pendingStartupSceneHandoff,
}: UseSceneLifecycleInput) {
  // Home is not compiled by the React Compiler (it bails out on it), and this
  // code ran there with its useMemo/useCallback dependency lists honoured as
  // written. Compiled, a memo keeps only what its body reads and drops a
  // dependency listed to force a refresh (the resin estimate stopped updating
  // in the Support tab). Opting out keeps the behaviour it had inside Home.
  'use no memo';
  const performTopBarSaveScene = React.useCallback(async (options?: { nativePathOverride?: string | null }) => {
    // Captured before the save so a Save As can clean up the sidecar beside the
    // project the user just moved away from.
    const previousScenePath = activeSceneFilePath;
    const visibleModels = scene.models.filter((model) => model.visible);
    const scopeModels = visibleModels.length > 0 ? visibleModels : scene.models;
    const resolvedNativePath = options?.nativePathOverride !== undefined
      ? options.nativePathOverride
      : activeSceneFilePath;
    const resolvedSceneFilename = resolvedNativePath
      ? (getFileNameFromPath(resolvedNativePath).replace(/\.voxl$/i, '').trim() || 'Scene')
      : resolveEntirePlateExportBaseName(scene.models);

    // Capture a thumbnail from the live scene canvas — same path as the export panel.
    let exportThumbnailPng: Uint8Array | null = null;
    try {
      // Temporarily disable cross-section clipping while taking the scene thumbnail.
      setIsTemporarilyDisablingCrossSectionForThumbnail(true);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const runCapture = exportThumbnailCaptureRunnerRef.current;
      if (runCapture) exportThumbnailPng = await runCapture();
    } catch {
      // Non-fatal: save proceeds without thumbnail.
    } finally {
      setIsTemporarilyDisablingCrossSectionForThumbnail(false);
    }

    const savedPath = await ExportManager.exportScene(
      null,
      supportsRef.current || null,
      {
        filename: resolvedSceneFilename,
        format: 'voxl',
        binary: true,
        separateFiles: false,
        includeRaft: false,
        includeSupports: true,
        includeModel: true,
      },
      {
        models: scopeModels,
        activeModelId: scene.activeModelId,
        selectedModelIds: scene.selectedModelIds,
        plates: scene.plates,
        activePlateId: scene.activePlateId,
        plateName: scene.plateName,
        printer: scene.voxlPrinterBundle ?? undefined,
        plateOrdering: scene.plateOrdering,
        exportThumbnailPng: exportThumbnailPng ?? undefined,
      },
      {
        nativePath: resolvedNativePath,
      },
    );
    const nextActiveScenePath = normalizeActiveVoxlScenePath(savedPath);
    if (nextActiveScenePath) {
      setActiveSceneFilePath(nextActiveScenePath);
      setLoadedSceneSaveSource({
        name: getFileNameFromPath(nextActiveScenePath),
        path: nextActiveScenePath,
      });
      // Once a scene has been successfully saved to a concrete VOXL path,
      // future Ctrl+S should keep saving in-place without prompting again.
      preferredOverwriteScenePathRef.current = nextActiveScenePath;

      // Save As moved the project. The recovery file beside the old one is now
      // an orphan that implies unsaved work which does not exist — and the new
      // sidecar is about to be written beside the new project. Safe to remove
      // here specifically because the save above succeeded.
      if (previousScenePath && previousScenePath !== nextActiveScenePath) {
        void deleteAutosaveSidecarForProject(previousScenePath).catch((error) => {
          console.warn('[SceneAutosave] Failed removing the sidecar beside the previous project.', error);
        });
      }
    }
    if (savedPath) {
      setExportSuccessToast({ id: Date.now(), path: savedPath });
      setIsExportSuccessToastVisible(true);
      if (exportSuccessToastFadeTimeoutRef.current !== null) {
        window.clearTimeout(exportSuccessToastFadeTimeoutRef.current);
      }
      exportSuccessToastFadeTimeoutRef.current = window.setTimeout(() => {
        setIsExportSuccessToastVisible(false);
        exportSuccessToastFadeTimeoutRef.current = null;
      }, 3800);

      // Manual save always writes the newest (3.1) layout, so the scene is now
      // 3.1 on disk — latch it so autosave keeps it there instead of trying to
      // preserve a stale inline format and downgrading it.
      setSceneFormatChunked(true);
      markSceneSaveBaseline();
      void clearAutosave();
    }

    return savedPath;
  }, [activeSceneFilePath, clearAutosave, markSceneSaveBaseline, scene.activeModelId, scene.models, scene.selectedModelIds]);

  const handleAutosaveRestore = React.useCallback(async () => {
    const recoverySnapshot = autosaveRecovery;
    setAutosaveRecovery(null);
    setNativePickerPreparationState({
      active: true,
      label: _(msg`Loading Scene…`),
      detail: _(msg`Reading autosaved scene…`),
      progress: null,
    });

    // Let React commit the modal dismissal/loading UI before native file IO begins.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    try {
      // Read exactly the payload discovery resolved — the sidecar beside the
      // project, or the generic location if that is where the tick fell back to.
      // The backend re-validates the path against its own candidate list.
      const bytes = await readAutosaveRecoveryBytes(recoverySnapshot?.voxlPath ?? null);
      const uint8 = new Uint8Array(bytes);
      if (uint8.byteLength === 0) {
        throw new Error('Autosaved VOXL file is empty.');
      }
      const file = new File([uint8], 'autosave.voxl', { type: 'application/octet-stream' });
      suppressSceneAutosave(60_000);
      setNativePickerPreparationState({
        active: false,
        label: '',
        detail: '',
        progress: null,
      });
      const restored = await importSceneFile(file, { suppressRecentTracking: true, suppressPlacementPrompt: true, suppressRepair: true });
      if (restored) {
        await clearAutosave();
      } else {
        setSceneSaveError({
          title: _(msg`Restore Failed`),
          message: _(msg`The autosaved recovery file is corrupted or unreadable.`),
          detail: _(msg`The scene importer rejected or could not parse the autosave data.`),
        });
        await clearAutosave();
      }
    } catch (error) {
      console.error('[Autosave] Failed to restore autosaved scene.', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isMissing = errorMessage.includes('No autosaved scene file found') || errorMessage.includes('does not exist');
      setSceneSaveError({
        title: _(msg`Restore Failed`),
        message: isMissing
          ? _(msg`The autosave recovery file could not be found.`)
          : _(msg`The autosaved recovery file is corrupted or unreadable.`),
        detail: errorMessage,
      });
      await clearAutosave();
    } finally {
      setNativePickerPreparationState({
        active: false,
        label: '',
        detail: '',
        progress: null,
      });
    }
  }, [autosaveRecovery, clearAutosave, importSceneFile, setSceneSaveError, _]);

  const handleAutosaveDiscard = React.useCallback(async () => {
    setAutosaveRecovery(null);
    await clearAutosave();
  }, [clearAutosave]);

  const queueTopBarSaveScene = React.useCallback((nativePathOverride?: string | null) => {
    queuedSceneSavePathOverrideRef.current = nativePathOverride;

    if (typeof window === 'undefined') {
      if (sceneSaveInFlightRef.current) {
        sceneSaveQueuedRef.current = true;
        setIsSceneSaveInProgress(true);
        return;
      }
      sceneSaveInFlightRef.current = true;
      setIsSceneSaveInProgress(true);
      const queuedNativePathOverride = queuedSceneSavePathOverrideRef.current;
      queuedSceneSavePathOverrideRef.current = undefined;
      void performTopBarSaveScene({ nativePathOverride: queuedNativePathOverride }).finally(() => {
        sceneSaveInFlightRef.current = false;
        setIsSceneSaveInProgress(sceneSaveQueuedRef.current);
      });
      return;
    }

    if (sceneSaveInFlightRef.current) {
      sceneSaveQueuedRef.current = true;
      setIsSceneSaveInProgress(true);
      return;
    }

    const runSaveTask = () => {
      if (sceneSaveInFlightRef.current) {
        sceneSaveQueuedRef.current = true;
        return;
      }

      sceneSaveInFlightRef.current = true;
      setIsSceneSaveInProgress(true);
      const queuedNativePathOverride = queuedSceneSavePathOverrideRef.current;
      queuedSceneSavePathOverrideRef.current = undefined;
      void performTopBarSaveScene({ nativePathOverride: queuedNativePathOverride })
        .catch((error) => {
          console.error('[SceneSave] Save operation failed.', error);
          // The 4 GiB ceiling is the case that must never be silent: without a
          // guard the writer wrapped its u32 offsets and wrote a file that
          // parsed and was wrong. The typed error carries the measured size and
          // the per-model breakdown, so the message can say what to remove.
          setSceneSaveError(
            error instanceof VoxlSizeLimitError
              ? {
                  title: _(msg`Scene is too large to save`),
                  message: error.userMessage,
                  detail: error.perModelBreakdown
                    .slice(0, 5)
                    .map((row) => formatCompressedModelSize(_, row.name, (row.compressedBytes / (1024 * 1024)).toFixed(0)))
                    .join('\n'),
                }
              : {
                  title: _(msg`Could not save the scene`),
                  message: error instanceof Error ? error.message : String(error),
                  detail: null,
                },
          );
        })
        .finally(() => {
          sceneSaveInFlightRef.current = false;
          if (sceneSaveQueuedRef.current) {
            sceneSaveQueuedRef.current = false;
            queueKickoff();
            setIsSceneSaveInProgress(true);
            return;
          }
          setIsSceneSaveInProgress(false);
        });
    };

    const queueKickoff = () => {
      if (sceneSaveKickoffTimerRef.current !== null) return;
      setIsSceneSaveInProgress(true);
      sceneSaveKickoffTimerRef.current = window.setTimeout(() => {
        sceneSaveKickoffTimerRef.current = null;
        runSaveTask();
      }, 0);
    };

    if (sceneSaveKickoffTimerRef.current !== null) {
      sceneSaveQueuedRef.current = true;
      return;
    }

    queueKickoff();
  }, [_, performTopBarSaveScene]);

  const resolveSceneSaveNativePath = React.useCallback(async (): Promise<{
    cancelled: boolean;
    nativePathOverride?: string | null;
  }> => {
    const loadedScenePath = normalizeActiveVoxlScenePath(
      activeSceneFilePath ?? loadedSceneSaveSource?.path ?? null,
    );
    const loadedSceneFileName = (() => {
      if (loadedSceneSaveSource && getFileExtension(loadedSceneSaveSource.name) === '.voxl') {
        return loadedSceneSaveSource.name;
      }
      if (loadedScenePath) {
        return getFileNameFromPath(loadedScenePath);
      }
      return null;
    })();

    if (!loadedSceneFileName) {
      return { cancelled: false, nativePathOverride: undefined };
    }

    // We know this came from a VOXL scene, but we cannot overwrite if the
    // originating native path is unavailable (e.g. recent-reopen blob cache).
    // In that case, skip the modal and go straight to Save As.
    if (!loadedScenePath) {
      preferredOverwriteScenePathRef.current = null;
      return { cancelled: false, nativePathOverride: null };
    }

    if (preferredOverwriteScenePathRef.current === loadedScenePath) {
      return { cancelled: false, nativePathOverride: loadedScenePath };
    }

    const choice = await promptSceneSaveChoice({
      fileName: loadedSceneFileName,
      scenePath: loadedScenePath,
    });
    if (choice === 'cancel') {
      return { cancelled: true };
    }

    if (choice === 'save_as') {
      preferredOverwriteScenePathRef.current = null;
      return { cancelled: false, nativePathOverride: null };
    }

    preferredOverwriteScenePathRef.current = loadedScenePath;
    return { cancelled: false, nativePathOverride: loadedScenePath };
  }, [activeSceneFilePath, loadedSceneSaveSource, promptSceneSaveChoice]);

  const saveCurrentSceneNow = React.useCallback(async (): Promise<boolean> => {
    const resolution = await resolveSceneSaveNativePath();
    if (resolution.cancelled) return false;

    const savedPath = await performTopBarSaveScene({
      nativePathOverride: resolution.nativePathOverride,
    });
    return Boolean(savedPath);
  }, [performTopBarSaveScene, resolveSceneSaveNativePath]);

  const handleTopBarSaveScene = React.useCallback(() => {
    void (async () => {
      const resolution = await resolveSceneSaveNativePath();
      if (resolution.cancelled) return;
      queueTopBarSaveScene(resolution.nativePathOverride);
    })();
  }, [queueTopBarSaveScene, resolveSceneSaveNativePath]);

  const handleTopBarSaveSceneAs = React.useCallback(() => {
    // Save As: always route through the native save dialog (a null override
    // suppresses any remembered path), skipping the overwrite/save-as choice
    // modal. A successful save re-points the scene's save target — and future
    // Ctrl+S overwrites — at the newly chosen file.
    queueTopBarSaveScene(null);
  }, [queueTopBarSaveScene]);

  React.useEffect(() => {
    if (scene.models.length !== 0) return;

    preferredOverwriteScenePathRef.current = null;
    setActiveSceneFilePath(null);
    setLoadedSceneSaveSource(null);
    setSceneFormatChunked(true);
    setShowCloseUnsavedChangesModal(false);
    setCloseUnsavedChangesBusy('none');
    setShowNewSceneUnsavedChangesModal(false);
    setNewSceneBusy('none');
    if (sceneSaveChoiceResolveRef.current) {
      sceneSaveChoiceResolveRef.current('cancel');
      sceneSaveChoiceResolveRef.current = null;
    }
    setShowSceneSaveChoiceModal(false);
    setSceneSaveChoiceFileName(null);
    setSceneSaveChoicePath(null);
    markSceneSaveBaseline();
  }, [markSceneSaveBaseline, scene.models.length]);

  React.useEffect(() => {
    return () => {
      if (sceneSaveKickoffTimerRef.current !== null) {
        window.clearTimeout(sceneSaveKickoffTimerRef.current);
        sceneSaveKickoffTimerRef.current = null;
      }
      sceneSaveQueuedRef.current = false;
      queuedSceneSavePathOverrideRef.current = undefined;
      preferredOverwriteScenePathRef.current = null;
      setIsSceneSaveInProgress(false);
    };
  }, []);

  React.useEffect(() => {
    if (!sceneAutosaveSettings.recoveryPromptEnabled) {
      setAutosaveRecovery(null);
      return;
    }
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    // Don't show recovery when the app was launched with a scene file (double-click VOXL etc.).
    // In that case Rambutan Slicer is already in a loading state (pendingStartupSceneHandoff).
    if (pendingStartupSceneHandoff) {
      setAutosaveRecovery(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        // If launched with a file, suppress recovery even if the pending flag wasn't yet set
        // when this effect first ran (race between launch-file fetch and recovery fetch).
        try {
          const core = await import('@tauri-apps/api/core');
          const launchEntries = await core.invoke<unknown[]>('get_launch_scene_files');
          if (Array.isArray(launchEntries) && launchEntries.length > 0) {
            if (!cancelled) setAutosaveRecovery(null);
            return;
          }
        } catch {
          // Non-Tauri or invoke not available — fall through to normal recovery check.
        }

        // Discovery, not a bare manifest read: the payload may be a sidecar
        // beside the project, the generic location, or a legacy `scene.voxl`
        // from before Ph0.1. `resolveAutosaveRecovery` validates that whichever
        // it finds actually exists and really is a VOXL file, so the prompt is
        // never offered for a payload that cannot be restored.
        const candidate = await resolveAutosaveRecovery();
        if (!cancelled && candidate && !candidate.clean) {
          // Re-check pending handoff after async fetch — it may have become pending while we were fetching.
          if (pendingStartupSceneHandoff) {
            setAutosaveRecovery(null);
            return;
          }
          setAutosaveRecovery({
            savedAt: candidate.savedAt ?? new Date().toISOString(),
            voxlPath: candidate.voxlPath,
            origin: candidate.origin,
          });
        }
      } catch {
        // Non-fatal: no autosave recovery available.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sceneAutosaveSettings.recoveryPromptEnabled, pendingStartupSceneHandoff]);

  // If a launch file arrives after the recovery prompt is already shown, dismiss it
  // — the app is already loading a scene, so recovery would be a confusing fork.
  React.useEffect(() => {
    if (pendingStartupSceneHandoff && autosaveRecovery) {
      setAutosaveRecovery(null);
    }
  }, [pendingStartupSceneHandoff, autosaveRecovery]);

  const isDesktopRuntime = React.useCallback(() => {
    if (typeof window === 'undefined') return false;
    return window.location.protocol === 'tauri:'
      || window.location.protocol === 'file:'
      || window.location.hostname === 'tauri.localhost'
      || typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined';
  }, []);

  const closeDesktopWindowNow = React.useCallback(async () => {
    if (!isDesktopRuntime()) return;

    allowProgrammaticWindowCloseRef.current = true;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
    } catch {
      allowProgrammaticWindowCloseRef.current = false;
    }
  }, [isDesktopRuntime]);

  /**
   * Clean exit. The recovery file is deleted **only** when there is nothing left
   * to recover.
   *
   * The unsaved-changes branch deliberately keeps the sidecar: a user who closes
   * the app and declines to save has still, on the next launch, a right to the
   * autosaved copy. Deleting it here would turn "don't save" into "destroy my
   * recovery too". `handleDiscardAndCloseProgram` retains it for the same
   * reason; `handleSaveAndCloseProgram` deletes it via `clearAutosave`, but only
   * after the save has actually succeeded.
   */
  const handleRequestProgramClose = React.useCallback(() => {
    if (hasUnsavedSceneChangesRef.current) {
      setShowCloseUnsavedChangesModal(true);
      return;
    }
    void (async () => {
      await clearAutosave();
      await closeDesktopWindowNow();
    })();
  }, [clearAutosave, closeDesktopWindowNow]);

  const handleDiscardAndCloseProgram = React.useCallback(() => {
    void (async () => {
      setCloseUnsavedChangesBusy('discard_and_close');
      try {
        setShowCloseUnsavedChangesModal(false);
        await closeDesktopWindowNow();
      } finally {
        setCloseUnsavedChangesBusy('none');
      }
    })();
  }, [closeDesktopWindowNow]);

  const handleSaveAndCloseProgram = React.useCallback(() => {
    void (async () => {
      setCloseUnsavedChangesBusy('save_and_close');
      try {
        const saved = await saveCurrentSceneNow();
        if (!saved) return;
        setShowCloseUnsavedChangesModal(false);
        await closeDesktopWindowNow();
      } catch (error) {
        console.error('[SceneSave] Save-and-close failed.', error);
      } finally {
        setCloseUnsavedChangesBusy('none');
      }
    })();
  }, [closeDesktopWindowNow, saveCurrentSceneNow]);

  /**
   * Start a fresh scene. Deleting every model is what the editor already treats
   * as "no scene": the empty-scene effect above drops the save target, the
   * autosave sidecar and the save baseline, and the viewport falls back to the
   * empty state. It goes through `deleteModels`, so the wipe is a single
   * undoable history entry rather than an unrecoverable one.
   */
  const startNewScene = React.useCallback(() => {
    const ids = scene.models.map((model) => model.id);
    if (ids.length === 0) return;
    void scene.deleteModels(ids);
  }, [scene.deleteModels, scene.models]);

  const handleRequestNewScene = React.useCallback(() => {
    if (hasUnsavedSceneChangesRef.current) {
      setShowNewSceneUnsavedChangesModal(true);
      return;
    }
    startNewScene();
  }, [startNewScene]);

  const handleDiscardAndNewScene = React.useCallback(() => {
    setNewSceneBusy('discard_and_new');
    try {
      setShowNewSceneUnsavedChangesModal(false);
      startNewScene();
    } finally {
      setNewSceneBusy('none');
    }
  }, [startNewScene]);

  const handleSaveAndNewScene = React.useCallback(() => {
    void (async () => {
      setNewSceneBusy('save_and_new');
      try {
        const saved = await saveCurrentSceneNow();
        if (!saved) return;
        setShowNewSceneUnsavedChangesModal(false);
        startNewScene();
      } catch (error) {
        console.error('[SceneSave] Save-and-new-scene failed.', error);
      } finally {
        setNewSceneBusy('none');
      }
    })();
  }, [saveCurrentSceneNow, startNewScene]);

  // Web runtime only. The desktop build has its own close flow (the
  // onCloseRequested effect below), which can actually save rather than just
  // warn. Registering both is what produces Chromium's "Leave site?" prompt on
  // exit: wry never implemented the beforeunload panel, so this handler was
  // invisible under WebKitGTK/WKWebView, but CEF shows it — and it fires after
  // the user already chose Discard, because closeDesktopWindowNow() tears the
  // webview down with hasUnsavedSceneChangesRef still set.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isDesktopRuntime()) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedSceneChangesRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isDesktopRuntime]);

  React.useEffect(() => {
    if (!isDesktopRuntime()) return;

    let unlisten: (() => void) | null = null;
    let disposed = false;

    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const currentWindow = getCurrentWindow();
        unlisten = await currentWindow.onCloseRequested((event) => {
          if (allowProgrammaticWindowCloseRef.current) {
            allowProgrammaticWindowCloseRef.current = false;
            return;
          }

          if (!hasUnsavedSceneChangesRef.current) {
            // Clean exit with nothing outstanding: take the close over so the
            // recovery file is actually gone before the process ends. A
            // fire-and-forget delete here would race the window teardown and
            // leave a `_autosave.voxl` beside a fully-saved project.
            event.preventDefault();
            void (async () => {
              await clearAutosave();
              await closeDesktopWindowNow();
            })();
            return;
          }

          event.preventDefault();
          setShowCloseUnsavedChangesModal(true);
        });

        if (disposed && unlisten) {
          unlisten();
          unlisten = null;
        }
      } catch {
        // Non-fatal in web runtime or restricted capability mode.
      }
    })();

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [clearAutosave, closeDesktopWindowNow, isDesktopRuntime]);

  React.useEffect(() => {
    if (!isDesktopRuntime()) return;
    if (desktopWindowRevealRequestedRef.current) return;

    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const revealWindow = async () => {
      try {
        const core = await import('@tauri-apps/api/core');
        // Use reveal_main_window_command (show only, no set_focus) to avoid
        // triggering Windows' focus-stealing prevention error sound.
        await core.invoke('reveal_main_window_command');
      } catch (error) {
        if (!cancelled) {
          console.warn('[StartupWindow] Failed to reveal main window after startup.', error);
        }
      }
    };

    // Wait for the React tree to finish its initial paint before revealing.
    // Two RAF frames (~33ms) is not enough for this app's heavy component tree;
    // a short setTimeout gives the browser time to commit the first full frame.
    timerId = setTimeout(() => {
      if (!cancelled) {
        // Claim the reveal only once it actually fires: StrictMode runs this
        // effect, cleans it up and runs it again with refs intact, so a claim
        // taken up front would make the second run bail out and the splash
        // would never close.
        desktopWindowRevealRequestedRef.current = true;
        // Signal the splashscreen to fade out gracefully before revealing.
        import('@tauri-apps/api/event').then(({ emit }) => {
          emit('splash-fade-out').catch(() => {});
        });
        setTimeout(() => {
          if (!cancelled) void revealWindow();
        }, 180);
      }
    }, 350);

    return () => {
      cancelled = true;
      if (timerId !== null) {
        clearTimeout(timerId);
      }
    };
  }, [isDesktopRuntime]);

  return {
    performTopBarSaveScene,
    handleAutosaveRestore,
    handleAutosaveDiscard,
    handleTopBarSaveScene,
    handleTopBarSaveSceneAs,
    isDesktopRuntime,
    handleRequestProgramClose,
    handleDiscardAndCloseProgram,
    handleSaveAndCloseProgram,
    handleRequestNewScene,
    handleDiscardAndNewScene,
    handleSaveAndNewScene,
  };
}
