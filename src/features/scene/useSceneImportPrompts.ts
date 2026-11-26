'use no memo';
/**
 * The import feedback the scene shows: the toast report, the placement,
 * hollowing and repair prompts an import waits on, the obsolete-scene and
 * printer-mismatch prompts, and the mesh repair report dialog. Part of
 * useSceneCollectionManager, which returns these unchanged.
 */
import { useCallback, useEffect, useState, useRef } from 'react';
import type { MeshAnalysisJson, MeshHealthReport } from '@/utils/meshRepair';
import type { VoxlPrinterBundle } from '@/features/scene/voxl/types';
import { importPrinterBundle, setActivePrinterProfile } from '@/features/profiles/profileStore';
import type { LoadedModel } from './loadedModel';

export type SceneImportReportTone = 'success' | 'warning' | 'error';

export type SceneImportReport = {
  id: number;
  text: string;
  tone: SceneImportReportTone;
  durationMs?: number;
  clickAction?: 'openMeshRepairReport';
};

export type MeshRepairReportEntry = {
  id: string;
  modelName: string;
  report: MeshHealthReport;
};

export type MeshRepairReportPresentation = 'default' | 'optimistic';

export type SceneImportPlacementChoice = 'auto_arrange' | 'load_as_is';

export type SceneImportPlacementPrompt = {
  source: string;
  fileName: string;
  modelCount: number;
  offPlateModelCount: number;
};

export type SceneImportHollowingChoice = 'bake' | 'keep_solid';

export type SceneImportHollowingPrompt = {
  source: string;
  fileName: string;
  modelCount: number;
  hollowedModelCount: number;
};

export type MeshRepairConfirmPrompt = {
  fileName: string;
  analysis: MeshAnalysisJson;
  /**
   * Whether the file can be repaired part by part. A plate imports as one model with many
   * components, and repairing it whole returns one verdict for all of them; the parts flow returns
   * a verdict per object instead. Offered only when the import has a file behind it, since the
   * parts flow reads the source.
   */
  canRepairParts: boolean;
};

/** A scene refused because it was saved by a VOXL generation we no longer read. */
export type ObsoleteVoxlScenePrompt = {
  fileName: string;
  detected: 'v1-json' | 'v1-binary';
};

/**
 * A scene written for a printer other than the one selected. Raised on import so
 * the user can switch before the scene is dropped into a machine its beds were
 * not laid out for: the plate pitch comes from the build volume, so a scene
 * packed for another printer lands on the wrong ones, and if that printer is the
 * bigger the plates do not fit here at all.
 */
export type PrinterMismatchPrompt = {
  /** The printer the scene carries, whole, so switching can add it when it is missing here. */
  bundle: VoxlPrinterBundle;
  /** The printer's name as the bundle carries it; absent when it has none. */
  recordedName?: string;
  recordedBuildVolumeMm: { width: number; depth: number; height: number };
  /** The selected profile at the moment of the import. */
  currentName: string;
  currentBuildVolumeMm: { width: number; depth: number; height: number };
  /**
   * The installed profile the scene's printer resolves to, or null when this
   * machine has none and switching will add it from the bundle.
   */
  installedProfileId: string | null;
  /** Whether the selected printer is smaller on some axis, so nothing fits as packed. */
  currentIsSmaller: boolean;
};

export type MeshRepairConfirmChoice = 'repair' | 'repair_parts' | 'load_as_is' | 'cancel_import';

export function useSceneImportPrompts(models: LoadedModel[]) {
  const [sceneImportReport, setSceneImportReport] = useState<SceneImportReport | null>(null);
  const [sceneImportPlacementPrompt, setSceneImportPlacementPrompt] = useState<SceneImportPlacementPrompt | null>(null);
  const [obsoleteVoxlScene, setObsoleteVoxlScene] = useState<ObsoleteVoxlScenePrompt | null>(null);
  const [printerMismatch, setPrinterMismatch] = useState<PrinterMismatchPrompt | null>(null);
  const [sceneImportHollowingPrompt, setSceneImportHollowingPrompt] = useState<SceneImportHollowingPrompt | null>(null);
  const [meshRepairConfirmPrompt, setMeshRepairConfirmPrompt] = useState<MeshRepairConfirmPrompt | null>(null);
  const [meshRepairReports, setMeshRepairReports] = useState<MeshRepairReportEntry[]>([]);
  const [meshRepairReportPresentation, setMeshRepairReportPresentation] = useState<MeshRepairReportPresentation>('default');
  const [pendingMeshRepairReports, setPendingMeshRepairReports] = useState<MeshRepairReportEntry[]>([]);
  const sceneImportReportTimeoutRef = useRef<number | null>(null);
  const sceneImportPlacementResolveRef = useRef<((choice: SceneImportPlacementChoice) => void) | null>(null);
  const sceneImportHollowingResolveRef = useRef<((choice: SceneImportHollowingChoice) => void) | null>(null);
  const meshRepairConfirmResolveRef = useRef<((choice: MeshRepairConfirmChoice) => void) | null>(null);

  const emitSceneImportReport = useCallback((
    text: string,
    tone: SceneImportReportTone = 'success',
    options?: { durationMs?: number; clickAction?: SceneImportReport['clickAction'] },
  ) => {
    const durationMs = options?.durationMs ?? 4200;
    setSceneImportReport({
      id: Date.now(),
      text,
      tone,
      durationMs,
      clickAction: options?.clickAction,
    });

    if (typeof window !== 'undefined') {
      if (sceneImportReportTimeoutRef.current !== null) {
        window.clearTimeout(sceneImportReportTimeoutRef.current);
      }

      sceneImportReportTimeoutRef.current = window.setTimeout(() => {
        setSceneImportReport(null);
        setPendingMeshRepairReports([]);
        sceneImportReportTimeoutRef.current = null;
      }, durationMs);
    }
  }, []);

  const clearSceneImportReport = useCallback(() => {
    setSceneImportReport(null);

    if (typeof window !== 'undefined' && sceneImportReportTimeoutRef.current !== null) {
      window.clearTimeout(sceneImportReportTimeoutRef.current);
      sceneImportReportTimeoutRef.current = null;
    }
  }, []);

  const dismissMeshRepairReports = useCallback(() => {
    setMeshRepairReports([]);
    setMeshRepairReportPresentation('default');
  }, []);

  const dismissObsoleteVoxlScene = useCallback(() => {
    setObsoleteVoxlScene(null);
  }, []);

  /**
   * Answer the printer-mismatch prompt. Switching selects the scene's printer
   * when this machine already has it, and otherwise adds it from the bundle the
   * scene carries, which is the point of shipping it whole.
   */
  const resolvePrinterMismatch = useCallback((choice: 'switch' | 'keep') => {
    if (choice === 'switch' && printerMismatch) {
      const installedId = printerMismatch.installedProfileId;
      if (installedId) setActivePrinterProfile(installedId);
      else setActivePrinterProfile(importPrinterBundle(printerMismatch.bundle));
    }
    setPrinterMismatch(null);
  }, [printerMismatch]);

  /**
   * Show the report a model already carries, from its recorded repair.
   *
   * The record lives on the model (`meshDefects.nativeRepairReport`) and survives everything the
   * scene does to it, so a model repaired earlier in the session can still say what was done.
   */
  const openMeshRepairReportForModel = useCallback((modelId: string) => {
    const model = models.find((entry) => entry.id === modelId);
    const report = model?.geometry.meshDefects?.nativeRepairReport;
    if (!model || !report) return;
    // The same dialog a repair just showed: the wins, the follow-up notes and the technical details.
    setMeshRepairReportPresentation('optimistic');
    setMeshRepairReports([{ id: `model-${modelId}`, modelName: model.name, report }]);
  }, [models]);

  const openPendingMeshRepairReports = useCallback(() => {
    if (pendingMeshRepairReports.length === 0) {
      return;
    }
    setMeshRepairReportPresentation('default');
    setMeshRepairReports(pendingMeshRepairReports);
    setPendingMeshRepairReports([]);
    clearSceneImportReport();
  }, [clearSceneImportReport, pendingMeshRepairReports]);

  const resolveSceneImportPlacementPrompt = useCallback((choice: SceneImportPlacementChoice) => {
    const resolve = sceneImportPlacementResolveRef.current;
    sceneImportPlacementResolveRef.current = null;
    setSceneImportPlacementPrompt(null);
    resolve?.(choice);
  }, []);

  const resolveSceneImportHollowingPrompt = useCallback((choice: SceneImportHollowingChoice) => {
    const resolve = sceneImportHollowingResolveRef.current;
    sceneImportHollowingResolveRef.current = null;
    setSceneImportHollowingPrompt(null);
    resolve?.(choice);
  }, []);

  const resolveMeshRepairConfirmPrompt = useCallback((choice: MeshRepairConfirmChoice) => {
    const resolve = meshRepairConfirmResolveRef.current;
    meshRepairConfirmResolveRef.current = null;
    setMeshRepairConfirmPrompt(null);
    resolve?.(choice);
  }, []);

  const requestMeshRepairConfirmation = useCallback(async (
    prompt: MeshRepairConfirmPrompt,
  ): Promise<MeshRepairConfirmChoice> => {
    if (typeof window === 'undefined') return 'repair';

    if (meshRepairConfirmResolveRef.current) {
      // Fail-safe: resolve a stale unresolved prompt so imports never deadlock.
      meshRepairConfirmResolveRef.current('repair');
      meshRepairConfirmResolveRef.current = null;
    }

    setMeshRepairConfirmPrompt(prompt);

    return new Promise<MeshRepairConfirmChoice>((resolve) => {
      meshRepairConfirmResolveRef.current = resolve;
    });
  }, []);

  const requestSceneImportPlacementChoice = useCallback(async (
    prompt: SceneImportPlacementPrompt,
  ): Promise<SceneImportPlacementChoice> => {
    if (typeof window === 'undefined') {
      return 'auto_arrange';
    }

    if (sceneImportPlacementResolveRef.current) {
      // Fail-safe: resolve previous unresolved prompt so imports never deadlock.
      sceneImportPlacementResolveRef.current('load_as_is');
      sceneImportPlacementResolveRef.current = null;
    }

    setSceneImportPlacementPrompt(prompt);

    return await new Promise<SceneImportPlacementChoice>((resolve) => {
      sceneImportPlacementResolveRef.current = resolve;
    });
  }, []);

  const requestSceneImportHollowingChoice = useCallback(async (
    prompt: SceneImportHollowingPrompt,
  ): Promise<SceneImportHollowingChoice> => {
    // Headless: take the file at its word and keep the authored hollow.
    if (typeof window === 'undefined') {
      return 'bake';
    }

    if (sceneImportHollowingResolveRef.current) {
      // Fail-safe: resolve previous unresolved prompt so imports never deadlock.
      sceneImportHollowingResolveRef.current('bake');
      sceneImportHollowingResolveRef.current = null;
    }

    setSceneImportHollowingPrompt(prompt);

    return await new Promise<SceneImportHollowingChoice>((resolve) => {
      sceneImportHollowingResolveRef.current = resolve;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (sceneImportPlacementResolveRef.current) {
        const resolve = sceneImportPlacementResolveRef.current;
        sceneImportPlacementResolveRef.current = null;
        resolve('load_as_is');
      }
      if (sceneImportHollowingResolveRef.current) {
        const resolve = sceneImportHollowingResolveRef.current;
        sceneImportHollowingResolveRef.current = null;
        resolve('bake');
      }
    };
  }, []);

  return {
    sceneImportReport,
    sceneImportPlacementPrompt,
    obsoleteVoxlScene,
    setObsoleteVoxlScene,
    printerMismatch,
    setPrinterMismatch,
    sceneImportHollowingPrompt,
    meshRepairConfirmPrompt,
    meshRepairReports,
    setMeshRepairReports,
    meshRepairReportPresentation,
    setMeshRepairReportPresentation,
    setPendingMeshRepairReports,
    emitSceneImportReport,
    clearSceneImportReport,
    dismissMeshRepairReports,
    dismissObsoleteVoxlScene,
    resolvePrinterMismatch,
    openMeshRepairReportForModel,
    openPendingMeshRepairReports,
    resolveSceneImportPlacementPrompt,
    resolveSceneImportHollowingPrompt,
    resolveMeshRepairConfirmPrompt,
    requestMeshRepairConfirmation,
    requestSceneImportPlacementChoice,
    requestSceneImportHollowingChoice,
    sceneImportReportTimeoutRef,
  };
}
