"use client";

import React from 'react';
import { createPortal } from 'react-dom';
import { Settings, Settings2, X } from 'lucide-react';
import * as THREE from 'three';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Button, Card, CardHeader, IconButton } from '@/components/atoms';
import { PanelCollapseToggle } from '@/components/atoms/PanelCollapseToggle';
import { StructuredDialogModal } from '@/components/ui/StructuredDialogModal';
import { useEscapeToClose } from '@/hotkeys/useEscapeToClose';
import { useFloatingPanelCollapse } from '@/components/layout/FloatingPanelStack';
import { useLocaleFormat } from '@/hooks/useLocaleFormat';
import type { UseIslandsReturn } from '@/volumeAnalysis/Islands/useIslands';
import { deleteMagicPrepareWorkflow, forestReportToText, getMagicPrepareWorkflowsServerSnapshot, getMagicPrepareWorkflowsSnapshot, runAutoPlaceBatchSequenceInWorker, runAutoPlaceInWorker, runAutoPlaceSequenceInWorker, runAutoSupportOptimizationInWorker, saveMagicPrepareWorkflow, subscribeToMagicPrepareWorkflows } from '@/supports/autoSupport';
import type { AutoPlaceResult, MagicPrepareWorkflowConfig, SizingDebugInfo, ForestReport } from '@/supports/autoSupport';
import type { AutoPlaceBatchEntry, AutoPlaceSequenceConsolidation, AutoPlaceSequenceOptions } from '@/supports/autoSupport';
import { getModelMesh } from '@/supports/autoSupport/meshStore';
import { buildAutoSupportModelReports, getAutoSupportNoResultReason, type AutoSupportModelRunReport, type AutoSupportModelSkipReason } from '@/supports/autoSupport/autoSupportRunReports';
import { filterIslandsBySupportScope, type AutoSupportScope } from '@/supports/autoSupport/supportScope';
import { getSettings, saveSettingsToLocalStorage, subscribeToSettings, updateAutoSupportDiagnostic, updateAutoSupportSettings, updateDebugSimpleSupportRender } from '@/supports/Settings/state';
import {
  getActiveAutoSupportPresetId,
  getAutoSupportPresetsServerSnapshot,
  getAutoSupportPresetsSnapshot,
  subscribeToAutoSupportPresets,
} from '@/supports/Settings/autoSupportPresets';
import { getSnapshot, setSnapshot } from '@/supports/state';
import { runAutoBracing } from '@/supports/autoBracing/autoBrace';
import { getRaftSettings, getRaftSettingsForModel, updateRaftSettings } from '@/supports/Rafts/Crenelated/RaftState';
import { contactEndpointsFor, knotHostId, coneKnotHostType, SUPPORT_COLLECTION_KEYS, SUPPORT_TYPES, type SupportCollectionKey } from '@/supports/supportTypeRegistry';
import type { Knot } from '@/supports/types';
import type { LoadedModel } from '@/features/scene/useSceneCollectionManager';
import { annotateFilterFlags, applyFilter } from '@/volumeAnalysis/Islands/filtering';
import { scanModelIslands } from '@/volumeAnalysis/Islands/scanModelIslands';
import type { TipInfo } from '@/volumeAnalysis/Islands/types';
import { AutoSupportSettingsBody } from './autoSupport/AutoSupportSettingsBody';
import { AutoSupportRunDiagnostics } from './autoSupport/AutoSupportRunDiagnostics';
import { AutoSupportPresetRow } from './autoSupport/AutoSupportPresetRow';
import { selectAutoSupportPreset, useAutoSupportDialogChanges } from './autoSupport/AutoSupportPresets';
import { AUTO_SUPPORT_SECTION_CARD, TIER_HINTS } from './autoSupport/autoSupportPanelTabs';
/** Set to true while auto-support is busy (scanning or placing).
 *  Page-level overlay reads this to show the "Generating Supports"
 *  full-screen modal, matching the native island-scan modal style. */
let _autoSupportBusy = false;
const _busyListeners = new Set<() => void>();
// i18n-ignore-start — internal progress keys are localized by scanProgressMessages.ts.
const MAGIC_BRACING_PHASE = 'Bracing supports';
const MAGIC_OPTIMIZATION_PHASE = 'Optimizing supports';
// i18n-ignore-end

function AutoSupportModelReason({ reason }: { reason: AutoSupportModelSkipReason }) {
  switch (reason) {
    case 'model-unavailable': return <Trans>This model is no longer available.</Trans>;
    case 'scan-failed': return <Trans>The island scan failed for this model.</Trans>;
    case 'no-islands': return <Trans>No islands passed the current filters, so this model was skipped.</Trans>;
    case 'scope-no-matches': return <Trans>No islands matched the selected support scope.</Trans>;
    case 'run-failed': return <Trans>Support generation failed for this model.</Trans>;
    case 'no-candidates': return <Trans>No detected islands produced support points.</Trans>;
    case 'all-deduplicated': return <Trans>All support candidates were grouped as duplicates.</Trans>;
    case 'already-supported': return <Trans>Existing supports already cover the detected points.</Trans>;
    case 'collision': return <Trans>Every support candidate collided with the model.</Trans>;
    case 'no-attachment': return <Trans>No support candidate could reach the build plate.</Trans>;
    case 'build-error': return <Trans>The current settings could not build a valid support.</Trans>;
    case 'disabled': return <Trans>Automatic supports are disabled in the selected settings.</Trans>;
    case 'placement-rejected': return <Trans>All support candidates were rejected by placement rules.</Trans>;
  }
}

type SupportRunComparison = {
  id: number;
  label: string;
  scope: AutoSupportScope;
  supportCount: number;
  islandsCovered: number | null;
  islandsUncovered: number | null;
  areaCoverage: number | null;
  rejectedCandidates: number;
  rejectionReasons: Record<string, number>;
  positions: string[];
};

function collectSupportContactPositions(modelIds: readonly string[]): string[] {
  const wantedModels = new Set(modelIds);
  const snapshot = getSnapshot();
  const positions = new Set<string>();
  for (const descriptor of SUPPORT_TYPES) {
    const contacts = contactEndpointsFor(descriptor.id);
    if (contacts.length === 0) continue;
    const collection = snapshot[descriptor.location.key as SupportCollectionKey] as unknown as
      Record<string, { modelId?: string }>;
    for (const entity of Object.values(collection ?? {})) {
      if (!entity.modelId || !wantedModels.has(entity.modelId)) continue;
      for (const { field } of contacts) {
        const point = (entity as unknown as Record<string, { pos?: { x: number; y: number; z: number } }>)[field]?.pos;
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) continue;
        positions.add(`${entity.modelId}:${point.x.toFixed(1)},${point.y.toFixed(1)},${point.z.toFixed(1)}`);
      }
    }
  }
  return [...positions].sort();
}

export function getAutoSupportBusy(): boolean { return _autoSupportBusy; }
export function subscribeAutoSupportBusy(fn: () => void): () => void {
  _busyListeners.add(fn);
  return () => _busyListeners.delete(fn);
}
function setAutoSupportBusy(v: boolean) {
  if (_autoSupportBusy !== v) {
    _autoSupportBusy = v;
    // The progress belongs to the run, so it goes when the run does.
    if (!v) setAutoSupportProgress(null);
    for (const fn of _busyListeners) fn();
  }
}

/** What the worker last reported, for the modal's progress bar. `null` while
 *  nothing is known (before the run starts, or after it ends). */
export type AutoSupportProgress = { phase: string; done: number; total: number };
let _autoSupportProgress: AutoSupportProgress | null = null;
const _progressListeners = new Set<() => void>();

export function getAutoSupportProgress(): AutoSupportProgress | null { return _autoSupportProgress; }
export function subscribeAutoSupportProgress(fn: () => void): () => void {
  _progressListeners.add(fn);
  return () => _progressListeners.delete(fn);
}
export function setAutoSupportProgress(p: AutoSupportProgress | null) {
  _autoSupportProgress = p;
  for (const fn of _progressListeners) fn();
}

/** Set to true while auto-support is driving its own scan, so the
 *  native island-scan overlay can be suppressed. */
export let autoSupportDrivingScan = false;

interface AutoSupportPanelProps {
  islands: UseIslandsReturn;
  hasGeometry: boolean;
  activeModelId?: string;
  models?: readonly LoadedModel[];
  selectedModelIds?: readonly string[];
  /** Auto-lift: the app's one flag for holding the model clear of the plate, so a
   *  support can stand under it. Owned by the transform manager and shared with
   *  the Prepare panel's own toggle (see `useTransformManager`). */
  autoLift: boolean;
  onAutoLiftChange: (enabled: boolean) => void;
  /** Resolve unapplied hollowing / hole punches before generating. Resolves
   *  false when the user went off to apply them first — the run is abandoned. */
  onBeforeRun?: () => Promise<boolean>;
  /** Apply a suggested orientation before a Magic support run. The callback
   *  continues only after a confirmed orientation and reports whether it changed. */
  onOrientForMagic?: (continueWithSupportRun: (orientationChanged: boolean) => void) => void;
}

function supportTipsForModel(modelId: string): TipInfo[] {
  const snapshot = getSnapshot();
  const tips: TipInfo[] = [];
  for (const descriptor of SUPPORT_TYPES) {
    const collection = snapshot[descriptor.location.key] as unknown as Record<string, Record<string, unknown> & { modelId?: string }>;
    for (const entity of Object.values(collection ?? {})) {
      if (entity.modelId !== modelId) continue;
      for (const { field, kind } of contactEndpointsFor(descriptor.id)) {
        if (!field) continue;
        const primitive = entity[field] as {
          pos?: { x: number; y: number; z: number };
          diameterMm?: number;
          contactDiameterMm?: number;
          profile?: { contactDiameterMm?: number };
        } | undefined;
        const pos = primitive?.pos;
        if (!pos) continue;
        const diameterMm = kind === 'disk'
          ? primitive.contactDiameterMm ?? primitive.diameterMm ?? 0.4
          : primitive.profile?.contactDiameterMm ?? 0.4;
        tips.push({ pos: new THREE.Vector3(pos.x, pos.y, pos.z), diameterMm });
      }
    }
  }
  return tips;
}

export function AutoSupportPanel({ islands, hasGeometry, activeModelId, models = [], selectedModelIds = [], autoLift, onAutoLiftChange, onBeforeRun, onOrientForMagic }: AutoSupportPanelProps) {
  const { _ } = useLingui();
  const fmt = useLocaleFormat();
  const [expanded, setExpanded] = useFloatingPanelCollapse(true);
  const [busy, setBusy] = React.useState(false);
  const [showSettings, setShowSettings] = React.useState(false);
  const [showDiscardSettingsDialog, setShowDiscardSettingsDialog] = React.useState(false);
  const [showReplaceDialog, setShowReplaceDialog] = React.useState(false);
  const [autoSupportRunResult, setAutoSupportRunResult] = React.useState<AutoPlaceResult | null>(null);
  const [modelRunReports, setModelRunReports] = React.useState<AutoSupportModelRunReport[]>([]);
  const [runComparisons, setRunComparisons] = React.useState<SupportRunComparison[]>([]);
  const comparisonRunNumberRef = React.useRef(0);
  const [replaceRunMagic, setReplaceRunMagic] = React.useState(false);
  const [replaceRunConsolidation, setReplaceRunConsolidation] = React.useState<AutoPlaceSequenceConsolidation>('each-pass');
  const [replaceRunBracing, setReplaceRunBracing] = React.useState(true);
  const [replaceRunRaft, setReplaceRunRaft] = React.useState(false);
  const [replaceRunScope, setReplaceRunScope] = React.useState<AutoSupportScope>('combined');
  const [scopeHasNoMatches, setScopeHasNoMatches] = React.useState(false);
  const [magicOrientationEnabled, setMagicOrientationEnabled] = React.useState(true);
  const [magicSupportsEnabled, setMagicSupportsEnabled] = React.useState(true);
  const [magicOptimizeEnabled, setMagicOptimizeEnabled] = React.useState(true);
  const [magicBracingEnabled, setMagicBracingEnabled] = React.useState(true);
  const [magicRaftEnabled, setMagicRaftEnabled] = React.useState(true);
  const [selectedMagicWorkflowId, setSelectedMagicWorkflowId] = React.useState<string | null>(null);
  const [magicWorkflowName, setMagicWorkflowName] = React.useState('');
  // The last run's diagnostics are a view switch, not a setting: Debug mode in
  // the settings dialog is what shows them here, where a run is started. Panel
  // state, like the Debug button that used to sit in the debug row.
  const [debugMode, setDebugMode] = React.useState(false);
  const [sizingDebug, setSizingDebugState] = React.useState<SizingDebugInfo | null>(null);
  const [showForestReport, setShowForestReport] = React.useState(false);
  const [forestReport, setForestReportState] = React.useState<ForestReport | null>(null);
  // The active preset is the store's fact, not one derived from the settings: a
  // block that happens to equal a built-in's is not a preset the user picked, and
  // guessing it was would put a name on settings nobody tied to it.
  //
  // Both facts are subscribed rather than read once: React Compiler treats a bare
  // call to an imported function as pure and evaluates it once, which would freeze
  // the selector at whatever the store held when the panel mounted.
  const presets = React.useSyncExternalStore(
    subscribeToAutoSupportPresets,
    getAutoSupportPresetsSnapshot,
    getAutoSupportPresetsServerSnapshot,
  );
  const activePresetId = React.useSyncExternalStore(
    subscribeToAutoSupportPresets,
    getActiveAutoSupportPresetId,
    getActiveAutoSupportPresetId,
  );
  const magicPrepareWorkflows = React.useSyncExternalStore(
    subscribeToMagicPrepareWorkflows,
    getMagicPrepareWorkflowsSnapshot,
    getMagicPrepareWorkflowsServerSnapshot,
  );
  // Whether the selection is a built-in — the dialog locks its policy fields for one,
  // because the store refuses to save over a built-in, so an edit made on it could
  // never be kept. Derived from the subscribed snapshot, not read once, so it follows
  // a selection the way the selector does.
  const presetLocked = presets.find((preset) => preset.id === activePresetId)?.isBuiltIn === true;
  const magicSupportSequence = React.useMemo(
    () => ['light', 'medium', 'heavy']
      .flatMap((id) => {
        const preset = presets.find((entry) => entry.id === id);
        return preset?.settings.enabled ? [preset.settings] : [];
      }),
    [presets],
  );
  const canRunAutoSupportPolicy = React.useCallback(
    (magic: boolean) => magic ? magicSupportSequence.length > 0 : getSettings().autoSupport.enabled,
    [magicSupportSequence],
  );
  const supportSettings = React.useSyncExternalStore(subscribeToSettings, getSettings, getSettings);
  const supportScope = supportSettings.autoSupport.supportScope;
  const selectedMagicWorkflow = magicPrepareWorkflows.find((workflow) => workflow.id === selectedMagicWorkflowId) ?? null;
  const magicWorkflowConfig = React.useMemo<MagicPrepareWorkflowConfig>(() => ({
    orientationEnabled: magicOrientationEnabled,
    supportsEnabled: magicSupportsEnabled,
    optimizeEnabled: magicOptimizeEnabled,
    bracingEnabled: magicBracingEnabled,
    raftEnabled: magicRaftEnabled,
    supportScope,
  }), [magicOrientationEnabled, magicSupportsEnabled, magicOptimizeEnabled, magicBracingEnabled, magicRaftEnabled, supportScope]);
  const handleSaveMagicWorkflow = React.useCallback(() => {
    const id = saveMagicPrepareWorkflow(magicWorkflowName, magicWorkflowConfig);
    if (id) setSelectedMagicWorkflowId(id);
  }, [magicWorkflowName, magicWorkflowConfig]);
  const handleApplyMagicWorkflow = React.useCallback(() => {
    if (!selectedMagicWorkflow) return;
    setMagicOrientationEnabled(selectedMagicWorkflow.orientationEnabled);
    setMagicSupportsEnabled(selectedMagicWorkflow.supportsEnabled);
    setMagicOptimizeEnabled(selectedMagicWorkflow.optimizeEnabled);
    setMagicBracingEnabled(selectedMagicWorkflow.bracingEnabled);
    setMagicRaftEnabled(selectedMagicWorkflow.raftEnabled);
    setMagicWorkflowName(selectedMagicWorkflow.name);
    updateAutoSupportSettings({ supportScope: selectedMagicWorkflow.supportScope });
    saveSettingsToLocalStorage();
  }, [selectedMagicWorkflow]);
  const handleDeleteMagicWorkflow = React.useCallback(() => {
    if (!selectedMagicWorkflowId) return;
    deleteMagicPrepareWorkflow(selectedMagicWorkflowId);
    setSelectedMagicWorkflowId(null);
    setMagicWorkflowName('');
  }, [selectedMagicWorkflowId]);
  const debugSimpleRender = supportSettings.debugSimpleSupportRender;
  const lastRunSupportCount = autoSupportRunResult
    ? Object.values(autoSupportRunResult.placed).reduce((total, count) => total + count, 0)
    : null;
  const noSupportReason = autoSupportRunResult && lastRunSupportCount === 0
    ? getAutoSupportNoResultReason(autoSupportRunResult)
    : null;

  const settings = getSettings().autoSupport;
  const [draft, setDraft] = React.useState(settings);

  const openSettings = React.useCallback(() => {
    setDraft(getSettings().autoSupport);
    setShowSettings(true);
  }, []);

  // Closing the dialog throws the draft away, so a dirty one asks first — the
  // same fact the footer's Save and Reset key off. The footer's Save does not come
  // through here: it does not close at all (the preset list behind the dialog is
  // where a save shows), so Escape, the backdrop and the ✕ are the whole of the
  // ask-first path.
  const settingsHaveChanges = useAutoSupportDialogChanges(draft);
  const closeSettings = React.useCallback(() => {
    if (settingsHaveChanges) {
      setShowDiscardSettingsDialog(true);
      return;
    }
    setShowSettings(false);
  }, [settingsHaveChanges]);
  // The dialog is the panel's own overlay, so it registers for Escape itself.
  useEscapeToClose(showSettings, closeSettings);


  const pendingRef = React.useRef(false);
  const pendingMagicRef = React.useRef(false);
  const pendingMagicConsolidationRef = React.useRef<AutoPlaceSequenceConsolidation>('each-pass');
  const pendingMagicBracingRef = React.useRef(true);
  const pendingMagicRaftRef = React.useRef(false);
  const pendingSupportScopeRef = React.useRef<AutoSupportScope>('combined');
  const islandsRef = React.useRef(islands);
  islandsRef.current = islands;
  const targetModelIds = React.useMemo(
    () => selectedModelIds.length > 0
      ? [...new Set(selectedModelIds)]
      : activeModelId ? [activeModelId] : [],
    [activeModelId, selectedModelIds],
  );

  // Runs on a worker thread: the plan is seconds of work on a big model, and
  // the panel used to block the main thread (and the modal) for all of it.
  const runAutoSupports = React.useCallback(async (
    list: UseIslandsReturn['filteredIslands'],
    magic = false,
    consolidation: AutoPlaceSequenceOptions['consolidation'] = 'each-pass',
    autoBracing = true,
    scope: AutoSupportScope = 'combined',
  ) => {
    if (targetModelIds.length === 0) return;
    setAutoSupportRunResult(null);
    setModelRunReports([]);
    const entries: AutoPlaceBatchEntry[] = [];
    const reports: AutoSupportModelRunReport[] = [];
    let foundIslands = false;

    for (const modelId of targetModelIds) {
      const model = models.find((entry) => entry.id === modelId);
      const report: AutoSupportModelRunReport = {
        modelId,
        modelName: model?.name ?? modelId,
        supportCount: 0,
      };
      reports.push(report);
      if (!model) {
        report.skipReason = 'model-unavailable';
        continue;
      }
      let modelIslands: UseIslandsReturn['filteredIslands'];
      try {
        if (modelId === activeModelId) {
          modelIslands = list;
        } else {
          const scannedIslands = await scanModelIslands({
            geom: model.geometry,
            transform: model.transform,
            layerHeightMm: islands.layerHeightMm,
            pxMm: islands.pxMm,
            supportBufferMm: islands.supportBufMm,
            connectivity: islands.connectivity,
            minAreaMm2: islands.minAreaMm2,
            minimaK: islands.minimaK,
            hasRaft: getRaftSettingsForModel(modelId).bottomMode !== 'off',
            onProgress: setAutoSupportProgress,
          });
          const annotatedIslands = annotateFilterFlags(scannedIslands, {
            supportTips: supportTipsForModel(modelId),
            plateZ: 0,
            layerHeightMm: islands.layerHeightMm,
          });
          modelIslands = applyFilter(annotatedIslands, islands.filterToggles);
        }
      } catch (error) {
        console.error(`[AutoSupport] island scan failed for model ${modelId}:`, error);
        report.skipReason = 'scan-failed';
        continue;
      }

      foundIslands ||= modelIslands.length > 0;
      const scopedList = filterIslandsBySupportScope(modelIslands, getModelMesh(modelId), scope);
      if (scopedList.length > 0) {
        entries.push({ modelId, islands: scopedList });
      } else if (scope !== 'combined' && modelIslands.length > 0) {
        report.skipReason = 'scope-no-matches';
      } else {
        report.skipReason = 'no-islands';
      }
    }

    setScopeHasNoMatches(scope !== 'combined' && foundIslands && entries.length === 0);
    if (entries.length === 0) {
      setModelRunReports(reports);
      return;
    }
    try {
      const result = entries.length > 1
        ? await runAutoPlaceBatchSequenceInWorker(
          entries,
          magic ? magicSupportSequence : [getSettings().autoSupport],
          setAutoSupportProgress,
          { consolidation: magic ? consolidation : 'each-pass', autoBracing },
        )
        : magic
          ? await runAutoPlaceSequenceInWorker(
            entries[0].islands,
            entries[0].modelId,
            magicSupportSequence,
            setAutoSupportProgress,
            { consolidation, autoBracing },
          )
          : await runAutoPlaceInWorker(entries[0].islands, entries[0].modelId, getSettings().autoSupport, setAutoSupportProgress);
      setAutoSupportRunResult(result);
      setModelRunReports(buildAutoSupportModelReports(reports, entries, result));
      const analytics = result.analytics;
      const summary: SupportRunComparison = {
        id: ++comparisonRunNumberRef.current,
        label: new Date().toLocaleTimeString(),
        scope: getSettings().autoSupport.supportScope,
        supportCount: Object.values(result.placed).reduce((total, count) => total + count, 0),
        islandsCovered: analytics?.islandsCovered ?? null,
        islandsUncovered: analytics?.islandsUncovered ?? null,
        areaCoverage: analytics ? analytics.areaCoverage * 100 : null,
        rejectedCandidates: result.rejectedCandidates,
        rejectionReasons: { ...(analytics?.rejectionReasons ?? {}) },
        positions: collectSupportContactPositions(entries.map((entry) => entry.modelId)),
      };
      setRunComparisons((previous) => [...previous.slice(-1), summary]);
      if (result.analytics?.sizingDebug) setSizingDebugState(result.analytics.sizingDebug);
      if (result.analytics?.forestReport) setForestReportState(result.analytics.forestReport);
    } catch (e) {
      console.error('[AutoSupport] runAutoPlace failed:', e);
      setModelRunReports(reports.map((report) => ({ ...report, skipReason: report.skipReason ?? 'run-failed' })));
    }
  }, [activeModelId, targetModelIds, models, islands, magicSupportSequence]);

  // Deferred run: fires after React flushes state changes (scan complete
  // or snapshot clear).  Incrementing deferredRunRef triggers a re-render,
  // which gives us fresh islands.filteredIslands.
  React.useEffect(() => {
    if (!pendingRef.current) return;
    if (islands.scanning) return;
    pendingRef.current = false;
    const magic = pendingMagicRef.current;
    pendingMagicRef.current = false;
    const consolidation = pendingMagicConsolidationRef.current;
    pendingMagicConsolidationRef.current = 'each-pass';
    const autoBracing = pendingMagicBracingRef.current;
    pendingMagicBracingRef.current = true;
    const enableRaft = pendingMagicRaftRef.current;
    pendingMagicRaftRef.current = false;
    const scope = pendingSupportScopeRef.current;
    pendingSupportScopeRef.current = 'combined';
    autoSupportDrivingScan = false;
    const list = islands.filteredIslands;
    if (enableRaft && getRaftSettings().bottomMode === 'off') {
      updateRaftSettings({ bottomMode: 'solid' });
    }
    if (targetModelIds.length > 0 && canRunAutoSupportPolicy(magic)) {
      void runAutoSupports(list, magic, consolidation, autoBracing, scope).finally(() => {
        setAutoSupportBusy(false);
        setBusy(false);
      });
    } else {
      setAutoSupportBusy(false);
      setBusy(false);
    }
  }, [islands.scanning, islands.filteredIslands, activeModelId, targetModelIds, runAutoSupports, canRunAutoSupportPolicy]);

  const doRun = React.useCallback((
    replace: boolean,
    magic = false,
    consolidation: AutoPlaceSequenceConsolidation = 'each-pass',
    autoBracing = true,
    autoRaft = false,
    scope: AutoSupportScope = supportScope,
  ) => {
    if (targetModelIds.length === 0) return;
    setAutoSupportRunResult(null);
    const targetModelIdSet = new Set(targetModelIds);
    pendingSupportScopeRef.current = scope;
    if (autoRaft && getRaftSettings().bottomMode === 'off') {
      updateRaftSettings({ bottomMode: 'solid' });
    }
    pendingMagicRef.current = magic;
    pendingMagicConsolidationRef.current = consolidation;
    pendingMagicBracingRef.current = autoBracing;
    if (replace) {
      const snap = getSnapshot();
      // Every collection copied, from the registry: a hand-written list left
      // kickstands aliasing the live snapshot, so deleting from it mutated state.
      const next = { ...snap };
      for (const key of SUPPORT_COLLECTION_KEYS as readonly SupportCollectionKey[]) {
        (next as unknown as Record<string, Record<string, unknown>>)[key] = {
          ...(snap[key] as unknown as Record<string, unknown>),
        };
      }
      for (const id of Object.keys(snap.trunks)) {
        if (targetModelIdSet.has(snap.trunks[id].modelId)) {
          delete next.trunks[id];
          delete next.roots[snap.trunks[id].rootId];
        }
      }
      for (const id of Object.keys(snap.branches)) {
        if (targetModelIdSet.has(snap.branches[id].modelId)) delete next.branches[id];
      }
      for (const id of Object.keys(snap.leaves)) {
        if (targetModelIdSet.has(snap.leaves[id].modelId)) delete next.leaves[id];
      }
      for (const id of Object.keys(snap.stumps)) {
        if (targetModelIdSet.has(snap.stumps[id].modelId)) delete next.stumps[id];
      }
      // Delete only this model's braces: those carrying its modelId, or whose
      // knots hang off its segments (legacy braces without modelId). Other
      // models' braces survive.
      const modelSegments = new Set<string>();
      for (const t of Object.values(snap.trunks)) {
        if (targetModelIdSet.has(t.modelId)) for (const s of t.segments) modelSegments.add(s.id);
      }
      for (const b of Object.values(snap.branches)) {
        if (targetModelIdSet.has(b.modelId)) for (const s of b.segments) modelSegments.add(s.id);
      }
      const removedBraceIds = new Set<string>();
      for (const [id, brace] of Object.entries(snap.braces)) {
        const knotA = brace.startKnotId ? snap.knots[brace.startKnotId] : undefined;
        const knotB = brace.endKnotId ? snap.knots[brace.endKnotId] : undefined;
        const belongsToModel =
          targetModelIdSet.has(brace.modelId ?? '') ||
          (knotA ? modelSegments.has(knotA.parentShaftId) : false) ||
          (knotB ? modelSegments.has(knotB.parentShaftId) : false);
        if (belongsToModel) {
          removedBraceIds.add(id);
          delete next.braces[id];
        }
      }
      // Rebuild knots: keep those referenced by surviving entities (other
      // models' trunks/branches/braces/leaf cones) or by the kickstand store;
      // drop orphans left by this model's deleted supports.
      //
      // Every shaft still standing, across every type that has one.
      const survivingSegmentIds = new Set<string>();
      for (const descriptor of SUPPORT_TYPES) {
        const collection = next[descriptor.location.key] as unknown as Record<string, { id: string; segments?: { id: string }[] }>;
        for (const entity of Object.values(collection ?? {})) {
          // This model's own supports are being replaced, so their shafts do
          // not survive -- `next` still holds the ones removed above only for
          // collections cleaned later in this function.
          if (targetModelIdSet.has((entity as { modelId?: string }).modelId ?? '')) continue;
          if (descriptor.segmentSelectionPrefix) {
            survivingSegmentIds.add(`${descriptor.segmentSelectionPrefix}${entity.id}`);
            continue;
          }
          for (const s of entity.segments ?? []) survivingSegmentIds.add(s.id);
        }
      }
      // A leaf's cone is addressable as a shaft too, but the prefix is not on
      // the descriptor: leaf has no segments, so declaring it there changes how
      // six other consumers treat leaves. Kept explicit until that is a
      // deliberate change of its own.
      for (const l of Object.values(next.leaves)) {
        survivingSegmentIds.add(knotHostId(coneKnotHostType(), l.id));
      }
      // The model's kickstands are supports too — drop them from the
      // kickstand store. They used to leak into the next run: stale roots
      // occupied grid nodes and their axes fed the axis-mixing, which
      // flipped a regenerated kickstand between the two sides of its axis.
      for (const kickstand of Object.values(next.kickstands)) {
        if (!targetModelIdSet.has(kickstand.modelId)) continue;
        // Delete the root and host knot too: writing back a filtered set left
        // them behind, and stale roots occupy grid nodes on the next run.
        delete next.kickstands[kickstand.id];
        delete next.roots[kickstand.rootId];
        delete next.knots[kickstand.hostKnotId];
      }
      const kickstandKnotIds = new Set<string>();
      for (const k of Object.values(next.kickstands)) {
        kickstandKnotIds.add(k.hostKnotId);
        for (const s of k.segments) survivingSegmentIds.add(s.id);
      }
      const nextKnots: Record<string, Knot> = {};
      for (const [id, knot] of Object.entries(snap.knots)) {
        if (survivingSegmentIds.has(knot.parentShaftId) || kickstandKnotIds.has(id)) {
          nextKnots[id] = knot;
        }
      }
      next.knots = nextKnots;
      // Clean up twigs and sticks if they reference this model.
      for (const id of Object.keys(snap.twigs)) {
        if (targetModelIdSet.has(snap.twigs[id].modelId)) delete next.twigs[id];
      }
      for (const id of Object.keys(snap.sticks)) {
        if (targetModelIdSet.has(snap.sticks[id].modelId)) delete next.sticks[id];
      }
      setSnapshot(next);
      // rAF fires after React flushes the snapshot, giving us
      // fresh islands.filteredIslands with updated supported flags.
      requestAnimationFrame(() => {
        setBusy(true);
        setAutoSupportBusy(true);
        requestAnimationFrame(() => {
          setTimeout(() => {
            try {
              const list = islandsRef.current.filteredIslands;
              const cur = islandsRef.current;
              if (list.length === 0 && cur.voxelIslands.length === 0 && cur.minimaIslands.length === 0) {
                pendingRef.current = true;
                pendingMagicRaftRef.current = autoRaft;
                autoSupportDrivingScan = true;
                void cur.onRunScan();
                return;
              }
              if (targetModelIds.length > 0 && canRunAutoSupportPolicy(magic)) {
                void runAutoSupports(list, magic, consolidation, autoBracing, scope).finally(() => {
                  if (!pendingRef.current) {
                    setAutoSupportBusy(false);
                    setBusy(false);
                  }
                });
              } else {
                setAutoSupportBusy(false);
                setBusy(false);
              }
            } catch (e) {
              console.error('[AutoSupport] run failed:', e);
              setAutoSupportBusy(false);
              setBusy(false);
            }
          }, 0);
        });
      });
      return;
    }
    setBusy(true);
    setAutoSupportBusy(true);
    const currentIslands = islandsRef.current;
    const list = currentIslands.filteredIslands;
    // Need to scan first?
    if (list.length === 0 && currentIslands.voxelIslands.length === 0 && currentIslands.minimaIslands.length === 0) {
      pendingRef.current = true;
      pendingMagicRaftRef.current = autoRaft;
      autoSupportDrivingScan = true;
      void currentIslands.onRunScan();
      return;
    }
    // Let React flush the busy state and the browser paint the modal
    // before the heavy synchronous work blocks the main thread.
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (targetModelIds.length > 0 && canRunAutoSupportPolicy(magic)) {
          void runAutoSupports(list, magic, consolidation, autoBracing, scope).finally(() => {
            setAutoSupportBusy(false);
            setBusy(false);
          });
        } else {
          setAutoSupportBusy(false);
          setBusy(false);
        }
      }, 0);
    });
  }, [targetModelIds, runAutoSupports, canRunAutoSupportPolicy, supportScope]);

  const handleRun = React.useCallback((
    magic = false,
    modifierDecisionComplete = false,
    forceRescan = false,
    consolidation: AutoPlaceSequenceConsolidation = 'each-pass',
    autoBracing = true,
    autoRaft = false,
    scope: AutoSupportScope = supportScope,
  ) => {
    if (targetModelIds.length === 0 || busy || (magic && magicSupportSequence.length === 0)) return;
    void (async () => {
      // Unapplied holes / hollowing change the mesh a support run is about to
      // be placed against — ask before generating, not after.
      if (!modifierDecisionComplete && onBeforeRun && !(await onBeforeRun())) return;
      if (forceRescan) {
        const currentIslands = islandsRef.current;
        setBusy(true);
        setAutoSupportBusy(true);
        pendingRef.current = true;
        pendingMagicRef.current = magic;
        pendingMagicConsolidationRef.current = consolidation;
        pendingMagicBracingRef.current = autoBracing;
        pendingMagicRaftRef.current = autoRaft;
        pendingSupportScopeRef.current = scope;
        autoSupportDrivingScan = true;
        if (!currentIslands.scanning) void currentIslands.onRunScan();
        return;
      }
      // Check for existing supports.
      const snap = getSnapshot();
      const targetModelIdSet = new Set(targetModelIds);
      let hasSupports = false;
      for (const t of Object.values(snap.trunks)) {
        if (targetModelIdSet.has(t.modelId)) { hasSupports = true; break; }
      }
      if (!hasSupports) {
        for (const b of Object.values(snap.branches)) {
          if (targetModelIdSet.has(b.modelId)) { hasSupports = true; break; }
        }
      }
      if (hasSupports) {
        setReplaceRunMagic(magic);
        setReplaceRunConsolidation(consolidation);
        setReplaceRunBracing(autoBracing);
        setReplaceRunRaft(autoRaft);
        setReplaceRunScope(scope);
        setShowReplaceDialog(true);
        return;
      }
      doRun(false, magic, consolidation, autoBracing, autoRaft, scope);
    })();
  }, [targetModelIds, busy, doRun, onBeforeRun, magicSupportSequence.length, supportScope]);

  const handleMagicPrepare = React.useCallback(() => {
    if (!activeModelId || targetModelIds.length > 1 || busy
      || (!magicOrientationEnabled && !magicSupportsEnabled && !magicOptimizeEnabled && !magicBracingEnabled && !magicRaftEnabled)
      || (magicSupportsEnabled && magicSupportSequence.length === 0)) return;
    void (async () => {
      if ((magicOrientationEnabled || magicSupportsEnabled || magicBracingEnabled || magicOptimizeEnabled)
        && onBeforeRun && !(await onBeforeRun())) return;
      const continueWithStages = (orientationChanged: boolean) => {
        if (magicSupportsEnabled) {
          handleRun(true, true, orientationChanged, magicOptimizeEnabled ? 'after-sequence' : 'skip', magicBracingEnabled, magicRaftEnabled, supportScope);
          return;
        }
        if (magicRaftEnabled && getRaftSettings().bottomMode === 'off') {
          updateRaftSettings({ bottomMode: 'solid' });
        }
        if (!magicBracingEnabled && !magicOptimizeEnabled) return;

        setBusy(true);
        setAutoSupportBusy(true);
        const stageCount = Number(magicBracingEnabled) + Number(magicOptimizeEnabled);
        setAutoSupportProgress({
          phase: magicOptimizeEnabled ? MAGIC_OPTIMIZATION_PHASE : MAGIC_BRACING_PHASE,
          done: 0,
          total: stageCount,
        });
        requestAnimationFrame(() => setTimeout(async () => {
          let completedStages = 0;
          try {
            if (magicOptimizeEnabled) {
              await runAutoSupportOptimizationInWorker(activeModelId, (progress) => {
                setAutoSupportProgress({ ...progress, done: completedStages + progress.done, total: stageCount });
              });
              completedStages += 1;
              setAutoSupportProgress({ phase: MAGIC_OPTIMIZATION_PHASE, done: completedStages, total: stageCount });
            }
            if (magicBracingEnabled) {
              runAutoBracing();
              completedStages += 1;
              setAutoSupportProgress({ phase: MAGIC_BRACING_PHASE, done: completedStages, total: stageCount });
            }
          } catch (error) {
            console.error('[AutoSupport] Magic stage failed:', error);
          } finally {
            setAutoSupportBusy(false);
            setBusy(false);
          }
        }, 0));
      };
      if (magicOrientationEnabled && onOrientForMagic) {
        onOrientForMagic(continueWithStages);
      } else {
        continueWithStages(false);
      }
    })();
  }, [
    activeModelId,
    targetModelIds,
    busy,
    magicSupportSequence.length,
    magicOrientationEnabled,
    magicSupportsEnabled,
    magicOptimizeEnabled,
    magicBracingEnabled,
    magicRaftEnabled,
    supportScope,
    onBeforeRun,
    onOrientForMagic,
    handleRun,
  ]);

  const canRun = hasGeometry && targetModelIds.length > 0 && !busy && !islands.scanning;
  const hasMagicStage = magicOrientationEnabled || magicSupportsEnabled || magicOptimizeEnabled || magicBracingEnabled || magicRaftEnabled;
  const previousComparison = runComparisons.length > 1 ? runComparisons[runComparisons.length - 2] : null;
  const latestComparison = runComparisons.length > 0 ? runComparisons[runComparisons.length - 1] : null;
  const changedContactCount = previousComparison && latestComparison
    ? [...new Set([...previousComparison.positions, ...latestComparison.positions])]
      .filter((position) => previousComparison.positions.includes(position) !== latestComparison.positions.includes(position)).length
    : null;
  const previousOnlyPositions = previousComparison && latestComparison
    ? previousComparison.positions.filter((position) => !latestComparison.positions.includes(position))
    : [];
  const latestOnlyPositions = previousComparison && latestComparison
    ? latestComparison.positions.filter((position) => !previousComparison.positions.includes(position))
    : [];
  const rejectionReasonKeys = previousComparison && latestComparison
    ? [...new Set([...Object.keys(previousComparison.rejectionReasons), ...Object.keys(latestComparison.rejectionReasons)])].sort()
    : [];
  const rejectionReasonLabel = (reason: string) => {
    switch (reason) {
      case 'grid_reject_collision': return _(msg`Collision`);
      case 'grid_reject_no_attachment': return _(msg`No build plate attachment`);
      case 'trunk_build_error': return _(msg`Support could not be built`);
      case 'already_supported': return _(msg`Already supported`);
      case 'grid_reject_other': return _(msg`Other placement restriction`);
      case 'exception': return _(msg`Placement error`);
      default: return reason;
    }
  };

  return (
    <>
      <Card>
        <CardHeader
          left={(
            <>
              <PanelCollapseToggle expanded={expanded} onToggle={() => setExpanded(!expanded)} />
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>{_(msg`Auto Supports (Beta)`)}</h3>
            </>
          )}
          right={(
            <IconButton onClick={openSettings} className="!p-1.5" title={_(msg`Auto-support settings`)}>
              <Settings className="h-3.5 w-3.5" style={{ color: 'var(--text-muted)' }} />
            </IconButton>
          )}
        />


        {expanded && (
          <div className="px-2.5 pb-3 space-y-2.5">
            {/* Run button — always at top */}
            <Button
              onClick={() => { void handleRun(false); }}
              disabled={!canRun}
              title={_(msg`Scan for islands if needed, then place automatic supports on the selected models`)}
              variant="secondary"
              size="auto"
              className="w-full !h-8 text-[11px] disabled:opacity-50"
              style={{
                borderColor: 'var(--accent)',
                background: 'color-mix(in srgb, var(--accent), var(--surface-0) 86%)',
                color: 'var(--accent)',
              }}
            >
              {busy ? _(msg`Running…`) : _(msg`Generate Supports`)}
            </Button>

            <Button
              onClick={() => { void handleRun(true); }}
              disabled={!canRun || magicSupportSequence.length === 0}
              variant="secondary"
              size="auto"
              className="w-full !h-8 text-[11px] disabled:opacity-50"
            >
              <Trans>Magic Support · 3 passes</Trans>
            </Button>

            <Button
              onClick={handleMagicPrepare}
              disabled={!canRun || targetModelIds.length > 1 || !hasMagicStage || (magicSupportsEnabled && magicSupportSequence.length === 0)}
              title={targetModelIds.length > 1
                ? _(msg`Magic Prepare currently runs on one model at a time`)
                : _(msg`Run the selected preparation stages`)}
              variant="secondary"
              size="auto"
              className="w-full !h-8 text-[11px] disabled:opacity-50"
            >
              <Trans>Magic Prepare</Trans>
            </Button>

            <details open className="rounded-md border px-2 py-1.5" style={AUTO_SUPPORT_SECTION_CARD}>
              <summary className="cursor-pointer text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>
                <Trans>Customize Magic stages</Trans>
              </summary>
              <div className="mt-1.5 space-y-1.5">
                <label className="flex items-center gap-1.5 cursor-pointer text-[10px]" style={{ color: 'var(--text-strong)' }}>
                  <input
                    type="checkbox"
                    checked={magicOrientationEnabled}
                    onChange={(event) => setMagicOrientationEnabled(event.target.checked)}
                    className="ui-checkbox !w-3.5 !h-3.5"
                  />
                  <Trans>Automatic orientation</Trans>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-[10px]" style={{ color: 'var(--text-strong)' }}>
                  <input
                    type="checkbox"
                    checked={magicSupportsEnabled}
                    onChange={(event) => setMagicSupportsEnabled(event.target.checked)}
                    className="ui-checkbox !w-3.5 !h-3.5"
                  />
                  <Trans>Automatic supports · Light, Medium, Heavy</Trans>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-[10px]" style={{ color: 'var(--text-strong)' }}>
                  <input
                    type="checkbox"
                    checked={magicOptimizeEnabled}
                    onChange={(event) => setMagicOptimizeEnabled(event.target.checked)}
                    className="ui-checkbox !w-3.5 !h-3.5"
                  />
                  <Trans>Optimize supports</Trans>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-[10px]" style={{ color: 'var(--text-strong)' }}>
                  <input
                    type="checkbox"
                    checked={magicBracingEnabled}
                    onChange={(event) => setMagicBracingEnabled(event.target.checked)}
                    className="ui-checkbox !w-3.5 !h-3.5"
                  />
                  <Trans>Automatic bracing</Trans>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-[10px]" style={{ color: 'var(--text-strong)' }}>
                  <input
                    type="checkbox"
                    checked={magicRaftEnabled}
                    onChange={(event) => setMagicRaftEnabled(event.target.checked)}
                    className="ui-checkbox !w-3.5 !h-3.5"
                  />
                  <Trans>Enable raft</Trans>
                </label>
              </div>
              <div className="mt-2 space-y-1.5 border-t pt-2" style={{ borderColor: 'var(--border-subtle)' }}>
                <label htmlFor="magic-prepare-saved-workflow" className="block text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>
                  <Trans>Saved workflows</Trans>
                </label>
                <div className="grid grid-cols-[1fr_auto] gap-1.5">
                  <select
                    id="magic-prepare-saved-workflow"
                    value={selectedMagicWorkflowId ?? ''}
                    onChange={(event) => {
                      const id = event.target.value || null;
                      setSelectedMagicWorkflowId(id);
                      const workflow = magicPrepareWorkflows.find((entry) => entry.id === id);
                      setMagicWorkflowName(workflow?.name ?? '');
                    }}
                    className="min-w-0 rounded border px-1.5 py-1 text-[10px]"
                    style={{ background: 'var(--surface-0)', color: 'var(--text-strong)', borderColor: 'var(--border-subtle)' }}
                  >
                    <option value="">{_(msg`Choose a workflow`)}</option>
                    {magicPrepareWorkflows.map((workflow) => (
                      <option key={workflow.id} value={workflow.id}>{workflow.name}</option>
                    ))}
                  </select>
                  <Button
                    onClick={handleApplyMagicWorkflow}
                    disabled={!selectedMagicWorkflow}
                    variant="secondary"
                    size="auto"
                    className="!h-7 px-2 text-[10px] disabled:opacity-50"
                  >
                    <Trans>Apply</Trans>
                  </Button>
                </div>
                <div className="grid grid-cols-[1fr_auto_auto] gap-1.5">
                  <input
                    value={magicWorkflowName}
                    onChange={(event) => setMagicWorkflowName(event.target.value)}
                    placeholder={_(msg`Workflow name`)}
                    maxLength={80}
                    className="min-w-0 rounded border px-1.5 py-1 text-[10px]"
                    style={{ background: 'var(--surface-0)', color: 'var(--text-strong)', borderColor: 'var(--border-subtle)' }}
                  />
                  <Button
                    onClick={handleSaveMagicWorkflow}
                    disabled={!magicWorkflowName.trim()}
                    variant="secondary"
                    size="auto"
                    className="!h-7 px-2 text-[10px] disabled:opacity-50"
                  >
                    <Trans>Save</Trans>
                  </Button>
                  <Button
                    onClick={handleDeleteMagicWorkflow}
                    disabled={!selectedMagicWorkflow}
                    variant="secondary"
                    size="auto"
                    className="!h-7 px-2 text-[10px] disabled:opacity-50"
                  >
                    <Trans>Delete</Trans>
                  </Button>
                </div>
                <p className="text-[9px] leading-snug" style={{ color: 'var(--text-muted)' }}>
                  <Trans>Workflows are saved on this device and include stage selection and support scope.</Trans>
                </p>
              </div>
            </details>

            <div className="space-y-1">
              <label htmlFor="auto-support-scope" className="block text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>
                <Trans>Support scope</Trans>
              </label>
              <select
                id="auto-support-scope"
                value={supportScope}
                disabled={!canRun}
                onChange={(event) => {
                  updateAutoSupportSettings({ supportScope: event.target.value as AutoSupportScope });
                  saveSettingsToLocalStorage();
                  setScopeHasNoMatches(false);
                }}
                className="w-full rounded border px-2 py-1 text-[10px] disabled:opacity-50"
                style={{ background: 'var(--surface-0)', color: 'var(--text-strong)', borderColor: 'var(--border-subtle)' }}
              >
                <option value="combined">{_(msg`Interior and exterior`)}</option>
                <option value="exterior">{_(msg`Exterior only`)}</option>
                <option value="interior">{_(msg`Interior only`)}</option>
              </select>
              {supportScope !== 'combined' && (
                <p className="text-[9px] leading-snug" style={{ color: 'var(--text-muted)' }}>
                  <Trans>Interior classification uses surrounding mesh geometry; ambiguous open cavities are skipped.</Trans>
                </p>
              )}
              {scopeHasNoMatches && (
                <p className="text-[9px] leading-snug" role="status" style={{ color: 'var(--text-muted)' }}>
                  <Trans>No islands were classified for this support scope. Try another scope.</Trans>
                </p>
              )}
            </div>

            {/* Island counts */}
            <div className="rounded-md border p-2" style={AUTO_SUPPORT_SECTION_CARD}>
              <div className="grid grid-cols-3 gap-2 text-center">
                {([
                  { id: 'voxel', label: _(msg`Voxel`), count: islands.voxelIslands.length },
                  { id: 'minima', label: _(msg`Minima`), count: islands.minimaIslands.length },
                  { id: 'total', label: _(msg`Total`), count: islands.filteredIslands.length },
                ]).map((s) => (
                  <div key={s.id}>
                    <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{s.label}</div>
                    <div className="text-sm font-bold" style={{ color: s.id === 'total' ? 'var(--accent)' : 'var(--text-strong)' }}>
                      {islands.scanning ? '…' : s.count}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {autoSupportRunResult && lastRunSupportCount != null && (
              <div className="rounded-md border p-2 text-[10px]" role="status" style={AUTO_SUPPORT_SECTION_CARD}>
                <p className="font-semibold" style={{ color: 'var(--text-strong)' }}>
                  <Trans>Supports created: {lastRunSupportCount}</Trans>
                </p>
                {noSupportReason === 'no-candidates' && (
                  <p className="mt-1 leading-snug" style={{ color: 'var(--text-muted)' }}>
                    <Trans>No supports were created because the detected islands produced no support points. Reduce the minimum island area or change the model orientation, then scan again.</Trans>
                  </p>
                )}
                {noSupportReason === 'all-deduplicated' && (
                  <p className="mt-1 leading-snug" style={{ color: 'var(--text-muted)' }}>
                    <Trans>No supports were created because all candidate points were grouped as duplicates. Adjust the support influence radius or model orientation, then scan again.</Trans>
                  </p>
                )}
                {noSupportReason === 'already-supported' && (
                  <p className="mt-1 leading-snug" style={{ color: 'var(--text-muted)' }}>
                    <Trans>No supports were created because existing supports already cover the detected points.</Trans>
                  </p>
                )}
                {noSupportReason === 'collision' && (
                  <p className="mt-1 leading-snug" style={{ color: 'var(--text-muted)' }}>
                    <Trans>No supports were created because every candidate collided with the model. Try another orientation or adjust the contact clearance.</Trans>
                  </p>
                )}
                {noSupportReason === 'no-attachment' && (
                  <p className="mt-1 leading-snug" style={{ color: 'var(--text-muted)' }}>
                    <Trans>No supports were created because no candidate could reach the build plate. Check the model height and Auto-Lift.</Trans>
                  </p>
                )}
                {noSupportReason === 'build-error' && (
                  <p className="mt-1 leading-snug" style={{ color: 'var(--text-muted)' }}>
                    <Trans>No supports were created because the current settings could not build a valid support. Review the support dimensions and profile.</Trans>
                  </p>
                )}
                {noSupportReason === 'placement-rejected' && (
                  <p className="mt-1 leading-snug" style={{ color: 'var(--text-muted)' }}>
                    <Trans>No supports were placed. Review the support diagnostics, island filters, and model orientation before trying again.</Trans>
                  </p>
                )}
                {noSupportReason === 'disabled' && (
                  <p className="mt-1 leading-snug" style={{ color: 'var(--text-muted)' }}>
                    <Trans>Automatic supports are disabled in the selected settings.</Trans>
                  </p>
                )}
              </div>
            )}

            {modelRunReports.length > 0 && (
              <div className="rounded-md border p-2 text-[10px]" role="status" style={AUTO_SUPPORT_SECTION_CARD}>
                <p className="mb-1 font-semibold" style={{ color: 'var(--text-strong)' }}><Trans>Results by model</Trans></p>
                <ul className="space-y-1.5">
                  {modelRunReports.map((report) => (
                    <li key={report.modelId} className="border-t pt-1.5 first:border-0 first:pt-0" style={{ borderColor: 'var(--border-subtle)' }}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate font-medium" title={report.modelName} style={{ color: 'var(--text-strong)' }}>{report.modelName}</span>
                        <span className="shrink-0" style={{ color: 'var(--text-muted)' }}><Trans>Supports created: {fmt.fixed(report.supportCount, 0)}</Trans></span>
                      </div>
                      {report.skipReason && (
                        <p className="mt-0.5 leading-snug" style={{ color: 'var(--text-muted)' }}>
                          <AutoSupportModelReason reason={report.skipReason} />
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {latestComparison && (
              <section className="rounded-md border p-2 space-y-1.5" style={AUTO_SUPPORT_SECTION_CARD} aria-label={_(msg`Compare support runs`)}>
                <h4 className="text-[11px] font-semibold" style={{ color: 'var(--text-strong)' }}><Trans>Compare support runs</Trans></h4>
                {!previousComparison ? (
                  <p className="text-[10px] leading-snug" style={{ color: 'var(--text-muted)' }}><Trans>Run auto-support again after changing settings to compare two runs.</Trans></p>
                ) : (
                  <>
                    <div className="grid grid-cols-[1fr_auto_auto] gap-x-2 gap-y-1 text-[10px]">
                      <span style={{ color: 'var(--text-muted)' }}></span>
                      <span className="font-medium" style={{ color: 'var(--text-muted)' }}>{previousComparison.label}</span>
                      <span className="font-medium" style={{ color: 'var(--text-strong)' }}>{latestComparison.label}</span>
                      <span><Trans>Scope</Trans></span>
                      <span>{previousComparison.scope === 'combined' ? _(msg`Combined`) : previousComparison.scope === 'interior' ? _(msg`Interior`) : _(msg`Exterior`)}</span>
                      <span>{latestComparison.scope === 'combined' ? _(msg`Combined`) : latestComparison.scope === 'interior' ? _(msg`Interior`) : _(msg`Exterior`)}</span>
                      <span><Trans>Supports created</Trans></span>
                      <span>{fmt.fixed(previousComparison.supportCount, 0)}</span>
                      <span>{fmt.fixed(latestComparison.supportCount, 0)}</span>
                      <span><Trans>Islands covered</Trans></span>
                      <span>{previousComparison.islandsCovered == null ? '—' : fmt.fixed(previousComparison.islandsCovered, 0)}</span>
                      <span>{latestComparison.islandsCovered == null ? '—' : fmt.fixed(latestComparison.islandsCovered, 0)}</span>
                      <span><Trans>Islands uncovered</Trans></span>
                      <span>{previousComparison.islandsUncovered == null ? '—' : fmt.fixed(previousComparison.islandsUncovered, 0)}</span>
                      <span>{latestComparison.islandsUncovered == null ? '—' : fmt.fixed(latestComparison.islandsUncovered, 0)}</span>
                      <span><Trans>Area coverage</Trans></span>
                      <span>{previousComparison.areaCoverage == null ? '—' : `${fmt.fixed(previousComparison.areaCoverage, 1)}%`}</span>
                      <span>{latestComparison.areaCoverage == null ? '—' : `${fmt.fixed(latestComparison.areaCoverage, 1)}%`}</span>
                      <span><Trans>Rejected candidates</Trans></span>
                      <span>{fmt.fixed(previousComparison.rejectedCandidates, 0)}</span>
                      <span>{fmt.fixed(latestComparison.rejectedCandidates, 0)}</span>
                    </div>
                    <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}><Trans>Changed contact positions: {changedContactCount ?? 0}</Trans></p>
                    {changedContactCount != null && changedContactCount > 0 && (
                      <details className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        <summary className="cursor-pointer"><Trans>View changed contact positions</Trans></summary>
                        <div className="mt-1 grid grid-cols-2 gap-2">
                          {[{ label: _(msg`Only in earlier run`), positions: previousOnlyPositions }, { label: _(msg`Only in latest run`), positions: latestOnlyPositions }].map((group) => (
                            <div key={group.label} className="min-w-0">
                              <p className="font-medium">{group.label}</p>
                              <ul className="max-h-24 overflow-auto font-mono text-[9px]">
                                {group.positions.slice(0, 20).map((position) => <li key={position} className="truncate" title={position}>{position}</li>)}
                              </ul>
                              {group.positions.length > 20 && <p>+{fmt.fixed(group.positions.length - 20, 0)}</p>}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                    {rejectionReasonKeys.length > 0 && (
                      <div className="space-y-0.5 border-t pt-1 text-[10px]" style={{ borderColor: 'var(--border-subtle)' }}>
                        <p className="font-medium" style={{ color: 'var(--text-muted)' }}><Trans>Rejections by reason</Trans></p>
                        {rejectionReasonKeys.map((reason) => (
                          <div key={reason} className="grid grid-cols-[1fr_auto_auto] gap-x-2">
                            <span>{rejectionReasonLabel(reason)}</span>
                            <span>{fmt.fixed(previousComparison.rejectionReasons[reason] ?? 0, 0)}</span>
                            <span>{fmt.fixed(latestComparison.rejectionReasons[reason] ?? 0, 0)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </section>
            )}

            {/* Run-policy selector: every preset the store holds, built-in and
                custom alike, so a profile a user saved is pickable from the panel
                rather than only from the dialog. Selecting one applies the whole
                block (the store's contract) and copies it into the dialog's draft;
                the trunk preset (manual placement) is deliberately not touched.
                Beside it, the Auto-Lift flag the run's clearance depends on. */}
            <AutoSupportPresetRow
              presets={presets}
              activeId={activePresetId}
              onSelect={(id) => {
                selectAutoSupportPreset(id, setDraft);
                setScopeHasNoMatches(false);
              }}
              activeHint={activePresetId ? TIER_HINTS[activePresetId] : undefined}
              autoLift={autoLift}
              onAutoLiftChange={onAutoLiftChange}
            />

            {/* The last run's diagnostics, behind Debug mode in the settings
                dialog: the panel is where a run is started, so it is where its
                report is read. */}
            {debugMode && (
              <AutoSupportRunDiagnostics
                sizingDebug={sizingDebug}
                forestReport={forestReport}
                onShowForestReport={() => setShowForestReport(true)}
              />
            )}

            {!hasGeometry && (
              <div className="text-[10px] italic text-center" style={{ color: 'var(--text-muted)' }}>
                {_(msg`Load a model and scan for islands.`)}
              </div>
            )}
          </div>
        )}
      </Card>

      <StructuredDialogModal
        open={showForestReport}
        ariaLabel={_(msg`Forest Report`)}
        title={_(msg`Forest Report`)}
        subtitle={_(msg`Every placed support with its size and fan-out groups`)}
        iconTone="neutral"
        maxWidthClassName="max-w-[72rem]"
        onClose={() => setShowForestReport(false)}
        onBackdropClick={() => setShowForestReport(false)}
        actions={
          <>
            <Button
              onClick={() => {
                if (forestReport) {
                  void navigator.clipboard?.writeText(forestReportToText(forestReport));
                }
              }}
              variant="secondary"
              size="md"
              title={_(msg`Copy the whole report to the clipboard`)}
            >
              {_(msg`Copy`)}
            </Button>
            <Button
              onClick={() => setShowForestReport(false)}
              variant="secondary"
              size="md"
              title={_(msg`Close the report`)}
            >
              {_(msg`Close`)}
            </Button>
          </>
        }
      >
        {forestReport && (
          <div className="rounded-md border overflow-hidden" style={AUTO_SUPPORT_SECTION_CARD}>
            <pre
              className="px-3 py-2 text-[10px] leading-relaxed whitespace-pre-wrap break-words tabular-nums overflow-y-auto"
              style={{ color: 'var(--text-muted)', maxHeight: '70vh' }}
            >
              {forestReportToText(forestReport)}
            </pre>
          </div>
        )}
      </StructuredDialogModal>

      {showSettings && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/58 backdrop-blur-sm p-5 ui-modal-backdrop-enter"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeSettings();
          }}
        >
          <div
            className="w-full max-w-[1120px] h-full flex flex-col rounded-xl border shadow-2xl overflow-hidden ui-modal-panel-enter"
            style={{ background: 'var(--surface-0)', borderColor: 'var(--border-strong)' }}
            role="dialog"
            aria-modal="true"
            aria-label={_(msg`Auto-support settings`)}
          >
            <div className="flex items-center justify-between gap-4 px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border"
                  style={{
                    borderColor: 'var(--border-subtle)',
                    background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent), var(--surface-1) 84%), color-mix(in srgb, var(--accent-secondary), var(--surface-1) 90%))',
                  }}
                >
                  <Settings2 className="h-4 w-4" style={{ color: 'var(--accent)' }} />
                </span>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold" style={{ color: 'var(--text-strong)' }}>
                    {_(msg`Auto Supports (Beta) Settings`)}
                  </h2>
                  <p className="mt-0.5 text-xs leading-snug" style={{ color: 'var(--text-muted)' }}>
                    {_(msg`Detected surfaces, density and sizing, stability, and the saved presets a run follows`)}
                  </p>
                </div>
              </div>
              <IconButton
                variant="solid"
                size="sm"
                onClick={closeSettings}
                className="inline-flex shrink-0 items-center justify-center leading-none !p-0"
                aria-label={_(msg`Close dialog`)}
                title={_(msg`Close without applying the edits made in this dialog`)}
              >
                <X className="h-4 w-4" />
              </IconButton>
            </div>

            <AutoSupportSettingsBody
              draft={draft}
              setDraft={setDraft}
              debugSimpleRender={debugSimpleRender}
              onToggleDebugSimpleRender={() => updateDebugSimpleSupportRender(!debugSimpleRender)}
              diagnostics={{
                debugSupportOriginColors: supportSettings.autoSupport.debugSupportOriginColors,
                debugSkipAutoBracing: supportSettings.autoSupport.debugSkipAutoBracing,
              }}
              onToggleDiagnostic={(key, enabled) => {
                // Applied at once, so closing the dialog does not ask whether to
                // discard a view switch. The draft follows, or a later Save would
                // write the value the toggle just replaced.
                updateAutoSupportDiagnostic(key, enabled);
                setDraft((current) => ({ ...current, [key]: enabled }));
              }}
              debugMode={debugMode}
              onToggleDebugMode={() => setDebugMode((current) => !current)}
              presetLocked={presetLocked}
            />
          </div>
        </div>,
        document.body,
      )}

      <StructuredDialogModal
        open={showDiscardSettingsDialog}
        ariaLabel={_(msg`Discard auto-support settings changes`)}
        title={_(msg`Discard Changes?`)}
        subtitle={_(msg`The edits made in this dialog have not been saved.`)}
        iconTone="warning"
        zIndexClassName="z-[120]"
        onClose={() => setShowDiscardSettingsDialog(false)}
        onBackdropClick={() => setShowDiscardSettingsDialog(false)}
        actions={
          <>
            <Button
              onClick={() => setShowDiscardSettingsDialog(false)}
              variant="secondary"
              size="md"
              title={_(msg`Go back to the settings dialog`)}
            >
              {_(msg`Keep Editing`)}
            </Button>
            <Button
              onClick={() => {
                setShowDiscardSettingsDialog(false);
                setDraft(getSettings().autoSupport);
                setShowSettings(false);
              }}
              size="md"
              style={{
                borderColor: 'color-mix(in srgb, var(--danger), var(--border-subtle) 45%)',
                background: 'color-mix(in srgb, var(--danger), var(--surface-1) 88%)',
                color: 'var(--danger)',
              }}
              title={_(msg`Close the dialog and discard the edits`)}
            >
              {_(msg`Discard`)}
            </Button>
          </>
        }
      >
        <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {_(msg`Closing now leaves the auto-support settings as they are. Save in the dialog's footer writes them.`)}
        </p>
      </StructuredDialogModal>

      <StructuredDialogModal
        open={showReplaceDialog}
        ariaLabel={_(msg`Existing Supports Detected`)}
        title={_(msg`Existing Supports Detected`)}
        subtitle={_(msg`This model already has supports. How would you like to proceed?`)}
        iconTone="neutral"
        onClose={() => setShowReplaceDialog(false)}
        onBackdropClick={() => setShowReplaceDialog(false)}
        actions={
          <>
            <Button
              onClick={() => setShowReplaceDialog(false)}
              variant="secondary"
              size="md"
              title={_(msg`Keep the existing supports and do nothing`)}
            >
              {_(msg`Cancel`)}
            </Button>
            <Button
              onClick={() => { setShowReplaceDialog(false); doRun(false, replaceRunMagic, replaceRunConsolidation, replaceRunBracing, replaceRunRaft, replaceRunScope); }}
              variant="secondary"
              size="md"
              title={_(msg`Keep the existing supports and place the new ones around them`)}
            >
              {_(msg`Add to existing`)}
            </Button>
            <Button
              onClick={() => { setShowReplaceDialog(false); doRun(true, replaceRunMagic, replaceRunConsolidation, replaceRunBracing, replaceRunRaft, replaceRunScope); }}
              variant="tinted-accent"
              size="md"
              className="inline-flex items-center justify-center gap-1.5"
              title={_(msg`Delete this model's existing supports and place the new ones`)}
            >
              {_(msg`Replace all`)}
            </Button>
          </>
        }
      >
        <div className="rounded-md border p-3" style={AUTO_SUPPORT_SECTION_CARD}>
          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            {_(msg`You can replace all existing supports with auto-placed ones, or incorporate your existing supports and fill in the gaps.`)}
          </p>
        </div>
      </StructuredDialogModal>
    </>
  );
}
