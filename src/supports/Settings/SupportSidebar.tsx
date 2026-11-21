"use client";


import React, { useState, useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import ReactDOM from 'react-dom';
import { Check, Save, RotateCcw, Sparkles, Wrench, WandSparkles, Sailboat, Grid3X3, Pickaxe, Eye, EyeOff, Copy, ClipboardPaste } from 'lucide-react';
import { usePresetHotkeys } from '@/hotkeys/usePresetHotkeys';
import { useLingui } from '@lingui/react';
import { formatAutoBraceStatus, formatBracesCleared } from '../autoBracing/autoBraceMessages';
import { msg } from '@lingui/core/macro';
import {
    getSettings,
    subscribeToSettings,
    saveSettingsToLocalStorage,
    loadSettingsFromLocalStorage,
    setSettings,
    updateTipProfile,
    updateShaftProfile,
    updateRootsProfile,
    updateGridSettings,
    updateAutoBracingSettings,
    updateAutoSupportSettings,
    updateDevToolsEnabled,
} from './state';
import {
    subscribe as subscribeToSupportState,
    getSnapshot as getSupportSnapshot,
    resolveEditableSupportTarget,
    getSupportSettingsForTarget,
    type EditableSupportTarget,
} from '../state';
import { checkPresetDrift, findMatchingPresetIdForSettings, getPresetById, getPresetList, subscribeToPresets } from './presets';
import { createDefaultSettings, type SupportSettings } from './types';
import { SUPPORT_PROFILE_LIMITS } from './defaults';
import {
    applyRelativeSupportScaleToSelectedSupports,
    applySettingsToSelectedSupports,
    type RelativeSupportScaleGroup,
} from './applySettingsToSelectedSupports';
import { areSupportGeometrySettingsEqual } from './supportSettingsCodec';
import { captureSupportEditSnapshot, pushSupportEditHistory, type SupportEditHistorySnapshot } from '../history/supportEditHistory';
import { selectSupportIds } from '../interaction/shared/selection/selectionController';
import {
    getEmptySelectedSupportIdsSnapshot,
    getSelectedSupportIds,
    subscribeSupportMultiSelection,
} from '../interaction/supportMultiSelection';
import {
    PresetSelector,
    RaftSettingsCard,
    GridSettingsCard,
    SidebarPanelTabs,
} from './components';
import { Card, CardHeader, IconButton, BlockingOverlay } from '@/components/atoms';
import { PanelCollapseToggle } from '@/components/atoms/PanelCollapseToggle';
import { NumberInput } from '@/components/ui/NumberInput';
import { SelectDropdown } from '@/components/ui/SelectDropdown';
import { SupportAnatomyPreviewSlot } from './AnatomyPreview/SupportAnatomyPreviewSlot';
import { AutoBracingSettingsCard } from '../autoBracing/AutoBracingSettingsCard';
import { CurveSettingsCard, getCurveSettingsSelection } from '../Curves/CurveSettingsCard';
import { clearBracesForModel, runAutoBracing } from '../autoBracing/autoBrace';
import { shouldRunAutoBracingHotkey } from '../autoBracing/autoBracingHotkey';
import { useActionActive } from '@/hotkeys/hotkeyStore';
import { setAnatomyPreviewActiveSettingKey, subscribeToAnatomyPreviewState, getAnatomyPreviewState } from './AnatomyPreview/previewState';
import {
    DEFAULT_SIDEBAR_PANEL,
    getSidebarPanelSnapshot,
    isSidebarPanel,
    panelHas,
    SIDEBAR_PANELS,
    setActiveSidebarPanel,
    subscribeToSidebarPanel,
    panelForTab,
    tabPanelFor,
} from './sidebarPanels';
import {
    getRaftSettings,
    subscribeToRaftStore,
    setRaftSettings,
    updateRaftSettings,
    wasRaftSettingsManuallyModified,
    resetRaftSessionModificationFlag,
} from '../Rafts/Crenelated/RaftState';
import { DEFAULT_RAFT_SETTINGS } from '../Rafts/Crenelated/RaftDefaults';
import type { SidebarPanel } from './sidebarPanels';
import { resetSupportSettingsScrollForTabChange } from './supportSidebarScroll';
import { Trans } from '@lingui/react/macro';
import { adjustSupportSettingsLabel } from '@/supports/history/supportHistoryLabels';
import { useEscapeToClose } from '@/hotkeys/useEscapeToClose';
import {
    getSupportPaintingSettings,
    loadSupportPaintingSettings,
    setSupportPaintingSettings,
    subscribeSupportPainting,
} from '@/features/support-paint/supportPainting';
import {
    applySupportProjectionPreset,
  applySupportProjectionPreview,
  cancelSupportProjectionPreview,
    createSupportProjectionTag,
    deleteSupportProjectionPreset,
  isSupportProjectionPreviewReady,
    getSupportProjectionSettings,
    getSupportProjectionPresets,
    loadSupportProjectionSettings,
    saveSupportProjectionPreset,
    setSupportProjectionSettings,
    subscribeSupportProjection,
    type SupportProjectionPattern,
    type SupportProjectionSymmetryAxis,
} from '@/features/support-projection/supportProjection';
import {
    getHiddenSupportTagsSnapshot,
    getHiddenSupportTagsServerSnapshot,
    retainVisibleSupportTags,
    setSupportTagVisible,
    subscribeToSupportTagVisibility,
} from '../supportTagVisibility';

const INPUT_CLASS = 'ui-input h-8 w-full px-2.5 text-xs sm:text-sm text-center no-spinners !bg-[var(--surface-0)]';
const SECTION_CARD_STYLE: React.CSSProperties = {
    borderColor: 'var(--border-subtle)',
    background: 'var(--surface-1)',
};
const ACCENT_CARD_STYLE: React.CSSProperties = {
    borderColor: 'color-mix(in srgb, var(--accent), var(--border-subtle) 76%)',
    background: 'color-mix(in srgb, var(--accent), var(--surface-1) 95%)',
};
const RELATIVE_SCALE_GROUPS = [
    { id: 'tip', label: msg`Tip` },
    { id: 'shaft', label: msg`Shaft` },
    { id: 'base', label: msg`Base` },
    { id: 'all', label: msg`All` },
] as const satisfies ReadonlyArray<{ id: RelativeSupportScaleGroup; label: ReturnType<typeof msg> }>;

/**
 * The panels that swap to the compact layout when their content overflows.
 *
 * These are the panels the sidebar opens by opening THEIR tab -- the one that
 * declares it rather than another sharing it, which leaves out the extra panels
 * riding the support-info page (leaf, branch, twig). `auto` is reached from the
 * mode rather than a tab, so it is its own page too.
 */
const OVERFLOW_COMPACT_KIND_SET = new Set<SidebarPanel>(
    SIDEBAR_PANELS.filter((panel) => {
        const tab = tabPanelFor(panel);
        return tab === 'auto' || panelForTab(tab) === panel;
    }),
);

/**
 * The panel whose preview floats in a popup when the sidebar is too short to
 * show it -- the default panel, which is the one shown on opening.
 */
const POPUP_PREVIEW_KIND_SET = new Set<SidebarPanel>([DEFAULT_SIDEBAR_PANEL]);

function hasMeaningfulSupportEditChange(
    before: SupportEditHistorySnapshot,
    after: SupportEditHistorySnapshot,
): boolean {
    const beforeSupport = {
        ...before.support,
        selectedId: null,
        selectedCategory: null,
        hoveredId: null,
        hoveredCategory: 'none' as const,
    };
    const afterSupport = {
        ...after.support,
        selectedId: null,
        selectedCategory: null,
        hoveredId: null,
        hoveredCategory: 'none' as const,
    };

    // Kickstands, their roots and their knots all live on SupportState, so
    // this comparison covers them.
    return JSON.stringify(beforeSupport) !== JSON.stringify(afterSupport);
}

function Section({
    title,
    children,
    accent = false,
    className,
}: {
    title: string;
    children: React.ReactNode;
    accent?: boolean;
    className?: string;
}) {
    return (
        <div className={`rounded-md border p-2 ${className ?? ''}`} style={accent ? ACCENT_CARD_STYLE : SECTION_CARD_STYLE}>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function fieldFocusProps(
    key: string,
    onFocus?: () => void,
    onBlur?: (e: React.FocusEvent<HTMLDivElement>) => void,
) {
    return {
        onFocusCapture: onFocus,
        onBlurCapture: onBlur,
        'data-setting-key': key,
    };
}

/**
 * SupportSidebar
 * 
 * Main settings panel for support mode.
 * Displays presets and editable settings for tip, shaft, roots, base flare, and grid.
 */
export function SupportSidebar({
    activeModelId = null,
    supportPaintingActive = false,
    onSupportPaintingChange,
    supportInlineActive = false,
    onSupportInlineChange,
    supportProjectionActive = false,
    onSupportProjectionChange,
    showSupportModelColorMap = false,
    onSupportModelColorMapChange,
}: {
    activeModelId?: string | null;
    supportPaintingActive?: boolean;
    onSupportPaintingChange?: (active: boolean) => void;
    supportInlineActive?: boolean;
    onSupportInlineChange?: (active: boolean) => void;
    supportProjectionActive?: boolean;
    onSupportProjectionChange?: (active: boolean) => void;
    showSupportModelColorMap?: boolean;
    onSupportModelColorMapChange?: (enabled: boolean) => void;
}) {
    const { _ } = useLingui();
    usePresetHotkeys();
    const autoBracingHotkeyActive = useActionActive('SUPPORTS', 'AUTO_BRACING');
    const settings = useSyncExternalStore(subscribeToSettings, getSettings, getSettings);
    const [supportPresets, setSupportPresets] = useState(() => getPresetList());
    useEffect(() => subscribeToPresets(() => setSupportPresets(getPresetList())), []);
    const paintSettings = useSyncExternalStore(
        subscribeSupportPainting,
        getSupportPaintingSettings,
        getSupportPaintingSettings,
    );
    const projectionSettings = useSyncExternalStore(
        subscribeSupportProjection,
        getSupportProjectionSettings,
        getSupportProjectionSettings,
    );
    const projectionPresets = useSyncExternalStore(
        subscribeSupportProjection,
        getSupportProjectionPresets,
        getSupportProjectionPresets,
    );
    const supportProjectionPreviewReady = useSyncExternalStore(
        subscribeSupportProjection,
        isSupportProjectionPreviewReady,
        isSupportProjectionPreviewReady,
    );
    const [selectedProjectionPresetId, setSelectedProjectionPresetId] = useState('');
    const [projectionPresetName, setProjectionPresetName] = useState('');
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
    const [copiedSupportSettings, setCopiedSupportSettings] = useState<SupportSettings | null>(null);
    const [relativeScaleGroup, setRelativeScaleGroup] = useState<RelativeSupportScaleGroup>('all');
    const [relativeScalePercent, setRelativeScalePercent] = useState(100);
    const [presetSaveTrigger, setPresetSaveTrigger] = useState(0);
    const [autoBraceStatus, setAutoBraceStatus] = useState<{ kind: 'success' | 'warning' | 'error'; message: string } | null>(null);
    const [clearingBraces, setClearingBraces] = useState(false);
    const [defaultsAnimating, setDefaultsAnimating] = useState(false);
    const [expanded, setExpanded] = React.useState(true);
    const [devToolsOpen, setDevToolsOpen] = useState(false);
    const saveStatusTimeoutRef = React.useRef<number | null>(null);
    const autoBraceStatusTimeoutRef = React.useRef<number | null>(null);
    const autoBracingHotkeyWasActiveRef = React.useRef(false);
    const clearingBracesRef = React.useRef(false);
    const isAdaptiveConeAngle = (settings.tip.coneAngleMode ?? 'normal') === 'adaptive';
    const sidebarPanelState = React.useSyncExternalStore(subscribeToSidebarPanel, getSidebarPanelSnapshot, getSidebarPanelSnapshot);
    const activePanel = sidebarPanelState.panel;
    const useAdaptiveIconCompactDisplay = isAdaptiveConeAngle && activePanel === DEFAULT_SIDEBAR_PANEL;
    const tabKind = tabPanelFor(activePanel);
    const raftSettings = React.useSyncExternalStore(subscribeToRaftStore, getRaftSettings, getRaftSettings);
    const supportState = React.useSyncExternalStore(subscribeToSupportState, getSupportSnapshot, getSupportSnapshot);
    const selectedSupportIds = useSyncExternalStore(
        subscribeSupportMultiSelection,
        getSelectedSupportIds,
        getEmptySelectedSupportIdsSnapshot,
    );
    const supportTagGroups = React.useMemo(() => {
        const byTag = new Map<string, string[]>();
        for (const entity of Object.values(supportState.supports ?? {})) {
            for (const tag of entity.supportTags ?? []) {
                const ids = byTag.get(tag) ?? [];
                ids.push(entity.id);
                byTag.set(tag, ids);
            }
        }
        return Array.from(byTag, ([name, ids]) => ({ name, ids })).sort((a, b) => a.name.localeCompare(b.name));
    }, [supportState]);
    const hiddenSupportTags = useSyncExternalStore(
        subscribeToSupportTagVisibility,
        getHiddenSupportTagsSnapshot,
        getHiddenSupportTagsServerSnapshot,
    );
    const activeSupportTags = React.useMemo(
        () => new Set(supportTagGroups.map(({ name }) => name)),
        [supportTagGroups],
    );
    useEffect(() => {
        retainVisibleSupportTags(activeSupportTags);
    }, [activeSupportTags]);
    const previewState = React.useSyncExternalStore(subscribeToAnatomyPreviewState, getAnatomyPreviewState, getAnatomyPreviewState);
    const activeKey = previewState.activeSettingKey;
    const curveSelection = getCurveSettingsSelection(supportState);
    const showCurvePage = curveSelection !== null;
    const selectedCategory = supportState.selectedCategory ?? undefined;
    // Keyed on what it resolves from, not on the whole snapshot: the target is
    // a fresh object each call, so re-running it on every store write gives an
    // effect that depends on it a new value every time.
    const resolvedTarget = React.useMemo(
        () => resolveEditableSupportTarget(supportState.selectedId, selectedCategory),
        [supportState.selectedId, selectedCategory],
    );
    const editableTargetKey = resolvedTarget ? `${resolvedTarget.kind}:${resolvedTarget.id}` : null;
    const editableTarget = React.useMemo(
        () => resolvedTarget,
        // eslint-disable-next-line react-hooks/exhaustive-deps -- identity follows the key
        [editableTargetKey],
    );
    const selectedSupportSettings = React.useMemo(() => {
        if (!editableTarget) return null;
        return getSupportSettingsForTarget(editableTarget);
    }, [editableTarget, supportState]);

    const pasteCopiedSupportSettings = React.useCallback(() => {
        if (!copiedSupportSettings || selectedSupportIds.length < 2) return;
        const before = captureSupportEditSnapshot();
        applySettingsToSelectedSupports(copiedSupportSettings);
        const after = captureSupportEditSnapshot();
        if (hasMeaningfulSupportEditChange(before, after)) {
            pushSupportEditHistory(msg`Apply copied support settings`, before, after);
        }
    }, [copiedSupportSettings, selectedSupportIds.length]);
    const hasSelectedSupport = selectedSupportIds.length > 0 || Boolean(supportState.selectedId);
    const applyRelativeSupportScale = React.useCallback(() => {
        if (relativeScalePercent === 100) return;
        const before = captureSupportEditSnapshot();
        const updated = applyRelativeSupportScaleToSelectedSupports(relativeScalePercent / 100, relativeScaleGroup);
        if (updated === 0) return;
        const after = captureSupportEditSnapshot();
        if (hasMeaningfulSupportEditChange(before, after)) {
            pushSupportEditHistory(msg`Scale selected supports`, before, after);
        }
    }, [relativeScaleGroup, relativeScalePercent]);
    const selectedPresetIdOverride = React.useMemo(() => {
        if (!editableTarget || !selectedSupportSettings) return undefined;
        return findMatchingPresetIdForSettings(selectedSupportSettings);
    }, [editableTarget, selectedSupportSettings]);
    const [optimisticPresetId, setOptimisticPresetId] = React.useState<string | null>(null);
    const effectivePresetIdOverride = optimisticPresetId ?? selectedPresetIdOverride;
    const isHydratingSelectedSupportRef = React.useRef(false);
    const lastEditableTargetKeyRef = React.useRef<string | null>(null);
    const skipFirstApplyForTargetKeyRef = React.useRef<string | null>(null);
    const latestSettingsRef = React.useRef(settings);
    const editSessionTargetRef = React.useRef<EditableSupportTarget | null>(null);
    const editSessionTargetKeyRef = React.useRef<string | null>(null);
    const editSessionBeforeSnapshotRef = React.useRef<SupportEditHistorySnapshot | null>(null);
    const editSessionLatestSettingsRef = React.useRef<SupportSettings | null>(null);
    const globalSettingsBeforeSupportEditRef = React.useRef<SupportSettings | null>(null);
    const supportEditSessionDirtyRef = React.useRef(false);
    const scrollViewportRef = React.useRef<HTMLDivElement | null>(null);
    const scrollContentRef = React.useRef<HTMLDivElement | null>(null);
    const supportSidebarAnchorRef = React.useRef<HTMLDivElement | null>(null);
    const [trunkCompactByOverflow, setTrunkCompactByOverflow] = React.useState(false);
    const [floatingTrunkPreviewPlacement, setFloatingTrunkPreviewPlacement] = React.useState<{ top: number; left: number; width: number; height: number } | null>(null);
    const floatingTrunkPreviewHideTimeoutRef = React.useRef<number | null>(null);
    const floatingTrunkPreviewFadeTimeoutRef = React.useRef<number | null>(null);
    const [floatingTrunkPreviewHeldOpen, setFloatingTrunkPreviewHeldOpen] = React.useState(false);
    const [floatingTrunkPreviewFadingOut, setFloatingTrunkPreviewFadingOut] = React.useState(false);
    const compactEnteredWindowHeightRef = React.useRef<number | null>(null);

    useEffect(() => {
        if (!OVERFLOW_COMPACT_KIND_SET.has(activePanel) || !trunkCompactByOverflow) {
            compactEnteredWindowHeightRef.current = null;
            return;
        }

        compactEnteredWindowHeightRef.current = window.innerHeight;
    }, [activePanel, trunkCompactByOverflow]);

    useLayoutEffect(() => {
        if (!expanded || showCurvePage || !OVERFLOW_COMPACT_KIND_SET.has(activePanel)) return;
        const viewport = scrollViewportRef.current;
        if (!viewport) return;

        const OVERFLOW_EPSILON = 1;
        const PREVIEW_RESTORE_HEADROOM_PX = 8;
        const PREVIEW_RESTORE_WINDOW_GROWTH_PX = 24;
        let rafId: number | null = null;

        const evaluate = () => {
            rafId = null;
            const contentHeight = Math.ceil(
                scrollContentRef.current?.getBoundingClientRect().height
                ?? viewport.scrollHeight,
            );
            const wouldOverflow = (contentHeight - viewport.clientHeight) > OVERFLOW_EPSILON;

            setTrunkCompactByOverflow((prev) => {
                if (!prev) {
                    return wouldOverflow;
                }

                if (wouldOverflow) {
                    return true;
                }

                const compactHeadroom = viewport.clientHeight - contentHeight;
                if (compactHeadroom >= PREVIEW_RESTORE_HEADROOM_PX) {
                    return false;
                }

                const compactEnteredWindowHeight = compactEnteredWindowHeightRef.current;
                if (
                    compactEnteredWindowHeight !== null
                    && window.innerHeight >= compactEnteredWindowHeight + PREVIEW_RESTORE_WINDOW_GROWTH_PX
                ) {
                    return false;
                }

                return true;
            });
        };

        const scheduleEvaluate = () => {
            if (rafId !== null) {
                window.cancelAnimationFrame(rafId);
            }
            rafId = window.requestAnimationFrame(evaluate);
        };

        scheduleEvaluate();

        const observer = new ResizeObserver(() => {
            scheduleEvaluate();
        });
        observer.observe(viewport);
        if (scrollContentRef.current) {
            observer.observe(scrollContentRef.current);
        }
        window.addEventListener('resize', scheduleEvaluate);

        return () => {
            observer.disconnect();
            window.removeEventListener('resize', scheduleEvaluate);
            if (rafId !== null) {
                window.cancelAnimationFrame(rafId);
            }
        };
    }, [expanded, showCurvePage, activePanel]);

    useEffect(() => {
        if (!OVERFLOW_COMPACT_KIND_SET.has(activePanel) && trunkCompactByOverflow) {
            setTrunkCompactByOverflow(false);
        }
    }, [activePanel, trunkCompactByOverflow]);

    const makeRowFocusHandlers = React.useCallback((key: string) => {
        return {
            onFocusCapture: () => {
                setAnatomyPreviewActiveSettingKey(key);
            },
            onBlurCapture: (e: React.FocusEvent<HTMLDivElement>) => {
                const next = e.relatedTarget as Node | null;
                if (next && e.currentTarget.contains(next)) return;
                setAnatomyPreviewActiveSettingKey(null);
            },
        };
    }, []);

    useEffect(() => {
        loadSupportPaintingSettings();
        loadSupportProjectionSettings();
        const RAFT_STORAGE_KEY = 'raft-settings';

        loadSettingsFromLocalStorage();
        
        // Skip loading localStorage raft settings if the user already manually modified them in this session.
        // This preserves manual changes when reopening Support Studio and respects import defaults.
        if (!wasRaftSettingsManuallyModified()) {
            try {
                const storedRaft = localStorage.getItem(RAFT_STORAGE_KEY);
                if (storedRaft) {
                    const parsed = JSON.parse(storedRaft);
                    setRaftSettings(parsed);
                }
            } catch (err) {
                console.error('[SupportSidebar] Failed to load raft settings:', err);
            }
        }

        checkPresetDrift(getSettings());

        const unsubscribeSettings = subscribeToSettings(() => {
            checkPresetDrift(getSettings());
        });
        return () => {
            unsubscribeSettings();
        };
    }, []);

    React.useEffect(() => {
        latestSettingsRef.current = settings;
    }, [settings]);

    const commitPendingSettingsSession = React.useCallback((target: EditableSupportTarget | null) => {
        if (!target) return;

        const before = editSessionBeforeSnapshotRef.current;

        if (!supportEditSessionDirtyRef.current) {
            editSessionBeforeSnapshotRef.current = null;
            editSessionLatestSettingsRef.current = null;
            return;
        }

        const latestSettings = editSessionLatestSettingsRef.current ?? getSettings();
        const persisted = getSupportSettingsForTarget(target);
        if (!persisted || !areSupportGeometrySettingsEqual(persisted, latestSettings)) {
            applySettingsToSelectedSupports(latestSettings);
        }

        if (before) {
            const after = captureSupportEditSnapshot();
            if (hasMeaningfulSupportEditChange(before, after)) {
                pushSupportEditHistory(
                    adjustSupportSettingsLabel(target.kind),
                    before,
                    after,
                );
            }
        }

        editSessionBeforeSnapshotRef.current = null;
        editSessionLatestSettingsRef.current = null;
        supportEditSessionDirtyRef.current = false;
    }, []);

    React.useEffect(() => {
        const nextTarget = editableTarget;
        const nextKey = nextTarget ? `${nextTarget.kind}:${nextTarget.id}` : null;
        const prevTarget = editSessionTargetRef.current;
        const prevKey = editSessionTargetKeyRef.current;

        const enteringSupportEdit = !prevTarget && !!nextTarget;
        const leavingSupportEdit = !!prevTarget && !nextTarget;

        if (enteringSupportEdit && globalSettingsBeforeSupportEditRef.current === null) {
            globalSettingsBeforeSupportEditRef.current = getSettings();
        }

        if (prevTarget && prevKey !== nextKey) {
            commitPendingSettingsSession(prevTarget);
        }

        if (nextTarget && prevKey !== nextKey) {
            editSessionBeforeSnapshotRef.current = captureSupportEditSnapshot();
            supportEditSessionDirtyRef.current = false;
            editSessionLatestSettingsRef.current = getSupportSettingsForTarget(nextTarget) ?? getSettings();
        }

        editSessionTargetRef.current = nextTarget;
        editSessionTargetKeyRef.current = nextKey;

        if (leavingSupportEdit && globalSettingsBeforeSupportEditRef.current) {
            setSettings(globalSettingsBeforeSupportEditRef.current);
            globalSettingsBeforeSupportEditRef.current = null;
        }

        if (leavingSupportEdit && activePanel !== DEFAULT_SIDEBAR_PANEL) {
            setActiveSidebarPanel(DEFAULT_SIDEBAR_PANEL);
        }
    }, [editableTarget, commitPendingSettingsSession]);

    React.useEffect(() => {
        return () => {
            if (saveStatusTimeoutRef.current !== null) {
                window.clearTimeout(saveStatusTimeoutRef.current);
                saveStatusTimeoutRef.current = null;
            }
            if (autoBraceStatusTimeoutRef.current !== null) {
                window.clearTimeout(autoBraceStatusTimeoutRef.current);
                autoBraceStatusTimeoutRef.current = null;
            }

            commitPendingSettingsSession(editSessionTargetRef.current);

            if (globalSettingsBeforeSupportEditRef.current) {
                setSettings(globalSettingsBeforeSupportEditRef.current);
                globalSettingsBeforeSupportEditRef.current = null;
            }
        };
    }, [commitPendingSettingsSession]);

    React.useEffect(() => {
        const targetKey = editableTarget ? `${editableTarget.kind}:${editableTarget.id}` : null;

        if (!editableTarget) {
            lastEditableTargetKeyRef.current = null;
            return;
        }

        if (!selectedSupportSettings) {
            return;
        }

        const selectionChanged = targetKey !== lastEditableTargetKeyRef.current;
        const geometryDiffers = !areSupportGeometrySettingsEqual(settings, selectedSupportSettings);

        if (!selectionChanged) {
            return;
        }

        skipFirstApplyForTargetKeyRef.current = targetKey;

        if (geometryDiffers) {
            isHydratingSelectedSupportRef.current = true;
            setSettings({
                ...settings,
                tip: { ...settings.tip, ...selectedSupportSettings.tip },
                shaft: { ...settings.shaft, ...selectedSupportSettings.shaft },
                roots: { ...settings.roots, ...selectedSupportSettings.roots },
                baseFlare: { ...settings.baseFlare, ...selectedSupportSettings.baseFlare },
            });
        }

        // Not every editable type has a sidebar tool, so only follow the
        // selection when one exists.
        if (selectionChanged && activePanel !== editableTarget.kind && isSidebarPanel(editableTarget.kind)) {
            setActiveSidebarPanel(editableTarget.kind);
        }

        lastEditableTargetKeyRef.current = targetKey;
    }, [editableTarget, selectedSupportSettings, settings, activePanel]);

    React.useEffect(() => {
        if (!editableTarget) return;

        const targetKey = `${editableTarget.kind}:${editableTarget.id}`;
        if (skipFirstApplyForTargetKeyRef.current === targetKey) {
            skipFirstApplyForTargetKeyRef.current = null;
            return;
        }

        const persistedSelectionSettings = getSupportSettingsForTarget(editableTarget);

        if (!persistedSelectionSettings) return;

        if (isHydratingSelectedSupportRef.current) {
            // Only swallow the cycle when hydration has already converged.
            // If settings diverge (e.g. quick preset click right after selection),
            // allow apply so we don't lose that edit.
            if (areSupportGeometrySettingsEqual(persistedSelectionSettings, settings)) {
                isHydratingSelectedSupportRef.current = false;
                return;
            }
            isHydratingSelectedSupportRef.current = false;
        }
        if (areSupportGeometrySettingsEqual(persistedSelectionSettings, settings)) return;

        supportEditSessionDirtyRef.current = true;
        editSessionLatestSettingsRef.current = settings;
        applySettingsToSelectedSupports(settings);
    }, [editableTarget, settings]);

    React.useEffect(() => {
        if (!editableTarget) {
            if (optimisticPresetId !== null) {
                setOptimisticPresetId(null);
            }
            return;
        }

        if (optimisticPresetId === null) return;

        // Clear optimistic selection only when support-derived matching catches up
        // to the same preset id. This avoids dropping the visible active tile
        // back to a stale preset during in-flight store updates.
        if (selectedPresetIdOverride === optimisticPresetId) {
            setOptimisticPresetId(null);
        }
    }, [editableTarget, optimisticPresetId, selectedPresetIdOverride]);

    const handleSave = React.useCallback(() => {
        const RAFT_STORAGE_KEY = 'raft-settings';
        setSaveStatus('idle');

        try {
            saveSettingsToLocalStorage();
            localStorage.setItem(RAFT_STORAGE_KEY, JSON.stringify(getRaftSettings()));

            // Trigger PresetSelector to save any dirty preset from within its
            // own component scope, matching the context-menu "Save Changes" path.
            setPresetSaveTrigger((n) => n + 1);

            setSaveStatus('saved');
        } catch (err) {
            console.error('[SupportSidebar] Failed to save settings:', err);
            setSaveStatus('error');
        }

        if (saveStatusTimeoutRef.current !== null) {
            window.clearTimeout(saveStatusTimeoutRef.current);
        }
        saveStatusTimeoutRef.current = window.setTimeout(() => {
            setSaveStatus('idle');
            saveStatusTimeoutRef.current = null;
        }, 2000);
    }, [settings]);

    const handleRestoreDefaults = React.useCallback(() => {
        const RAFT_STORAGE_KEY = 'raft-settings';
        try {
            localStorage.removeItem('support-settings');
            localStorage.removeItem(RAFT_STORAGE_KEY);
        } catch (err) {
            console.error('[SupportSidebar] Failed to clear saved settings:', err);
        }

        setSettings(createDefaultSettings());
        setRaftSettings(DEFAULT_RAFT_SETTINGS);
        setAnatomyPreviewActiveSettingKey(null);

        // Trigger spin animation
        setDefaultsAnimating(true);
        setTimeout(() => setDefaultsAnimating(false), 600);
    }, []);

    const handleAutoBrace = React.useCallback(() => {
        try {
            const result = runAutoBracing();
            const message = formatAutoBraceStatus(result, _);
            if (!result.changed || result.skippedSupportCount > 0) {
                setAutoBraceStatus({ kind: 'warning', message });
            } else {
                setAutoBraceStatus({ kind: 'success', message });
            }
        } catch (err) {
            console.error('[SupportSidebar] Auto Brace failed:', err);
            setAutoBraceStatus({ kind: 'error', message: _(msg`Auto Brace failed. Check console for details.`) });
        }

        if (autoBraceStatusTimeoutRef.current !== null) {
            window.clearTimeout(autoBraceStatusTimeoutRef.current);
        }
        autoBraceStatusTimeoutRef.current = window.setTimeout(() => {
            setAutoBraceStatus(null);
            autoBraceStatusTimeoutRef.current = null;
        }, 2800);
    }, [_]);

    const handleClearBraces = React.useCallback(() => {
        let message: string;
        let kind: 'success' | 'warning' | 'error' = 'success';
        try {
            const removed = clearBracesForModel(activeModelId);
            message = formatBracesCleared(removed, _);
            if (removed === 0) kind = 'warning';
        } catch (err) {
            console.error('[SupportSidebar] Clear braces failed:', err);
            message = _(msg`Clear All failed. Check console for details.`);
            kind = 'error';
        }

        setAutoBraceStatus({ kind, message });
        if (autoBraceStatusTimeoutRef.current !== null) {
            window.clearTimeout(autoBraceStatusTimeoutRef.current);
        }
        autoBraceStatusTimeoutRef.current = window.setTimeout(() => {
            setAutoBraceStatus(null);
            autoBraceStatusTimeoutRef.current = null;
        }, 2800);
    }, [activeModelId, _]);

    useEffect(() => {
        if (shouldRunAutoBracingHotkey({
            active: autoBracingHotkeyActive,
            wasActive: autoBracingHotkeyWasActiveRef.current,
            sidebarExpanded: expanded,
            activeSupportKind: activePanel,
            curvePageVisible: showCurvePage,
            modalOpen: document.querySelector('[role="dialog"][aria-modal="true"]') !== null,
        })) {
            // This effect translates the centralized hotkey's rising edge into
            // the same UI action as clicking the Auto Brace button.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            handleAutoBrace();
        }

        autoBracingHotkeyWasActiveRef.current = autoBracingHotkeyActive;
    }, [activePanel, autoBracingHotkeyActive, expanded, handleAutoBrace, showCurvePage]);

    const getInputProps = React.useCallback((key: string, baseClass: string) => {
        const isActive = activeKey === key;
        if (isActive) {
            return {
                className: `${baseClass} ring-2`,
                style: {
                    borderColor: 'var(--accent)',
                    boxShadow: '0 0 0 1px color-mix(in srgb, var(--accent), white 8%) inset, 0 0 0 2px color-mix(in srgb, var(--accent), transparent 72%)',
                } as React.CSSProperties
            };
        }
        return { className: baseClass };
    }, [activeKey]);

    const compactInputClass = INPUT_CLASS;

    const renderPreviewBox = (heightClass: string, widthClass: string = 'w-full') => (
        <div
            data-no-drag="true"
            className={`relative ${widthClass} ${heightClass} rounded-md border overflow-hidden`}
            style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
        >
            <SupportAnatomyPreviewSlot />
        </div>
    );

    const sectionScrollClass = 'flex-1 min-h-0 overflow-y-auto custom-scrollbar';
    const shouldUseOverflowCompactMode = OVERFLOW_COMPACT_KIND_SET.has(activePanel) && trunkCompactByOverflow;
    const shouldUseCompactTrunkLayout = activePanel === DEFAULT_SIDEBAR_PANEL && shouldUseOverflowCompactMode;
    const hasFloatingTrunkPreviewTrigger = POPUP_PREVIEW_KIND_SET.has(activePanel)
        && (Boolean(activeKey) || Boolean(previewState.hoveredPresetSettings));
    const shouldShowFloatingTrunkPreview = expanded
        && POPUP_PREVIEW_KIND_SET.has(activePanel)
        && shouldUseOverflowCompactMode
        && floatingTrunkPreviewHeldOpen;

    useEffect(() => {
        const supportsFloatingPreview = expanded
            && POPUP_PREVIEW_KIND_SET.has(activePanel)
            && shouldUseOverflowCompactMode;
        if (!supportsFloatingPreview) {
            if (floatingTrunkPreviewHideTimeoutRef.current !== null) {
                window.clearTimeout(floatingTrunkPreviewHideTimeoutRef.current);
                floatingTrunkPreviewHideTimeoutRef.current = null;
            }
            if (floatingTrunkPreviewFadeTimeoutRef.current !== null) {
                window.clearTimeout(floatingTrunkPreviewFadeTimeoutRef.current);
                floatingTrunkPreviewFadeTimeoutRef.current = null;
            }
            setFloatingTrunkPreviewFadingOut(false);
            setFloatingTrunkPreviewHeldOpen(false);
            return;
        }

        if (hasFloatingTrunkPreviewTrigger) {
            if (floatingTrunkPreviewHideTimeoutRef.current !== null) {
                window.clearTimeout(floatingTrunkPreviewHideTimeoutRef.current);
                floatingTrunkPreviewHideTimeoutRef.current = null;
            }
            if (floatingTrunkPreviewFadeTimeoutRef.current !== null) {
                window.clearTimeout(floatingTrunkPreviewFadeTimeoutRef.current);
                floatingTrunkPreviewFadeTimeoutRef.current = null;
            }
            setFloatingTrunkPreviewFadingOut(false);
            setFloatingTrunkPreviewHeldOpen(true);
            return;
        }

        if (!floatingTrunkPreviewHeldOpen) {
            return;
        }

        if (floatingTrunkPreviewHideTimeoutRef.current !== null || floatingTrunkPreviewFadeTimeoutRef.current !== null) {
            return;
        }

        floatingTrunkPreviewHideTimeoutRef.current = window.setTimeout(() => {
            floatingTrunkPreviewHideTimeoutRef.current = null;
            setFloatingTrunkPreviewFadingOut(true);

            floatingTrunkPreviewFadeTimeoutRef.current = window.setTimeout(() => {
                floatingTrunkPreviewFadeTimeoutRef.current = null;
                setFloatingTrunkPreviewHeldOpen(false);
                setFloatingTrunkPreviewFadingOut(false);
            }, 240);
        }, 2000);
    }, [expanded, activePanel, shouldUseOverflowCompactMode, hasFloatingTrunkPreviewTrigger, floatingTrunkPreviewHeldOpen]);

    useEffect(() => {
        return () => {
            if (floatingTrunkPreviewHideTimeoutRef.current !== null) {
                window.clearTimeout(floatingTrunkPreviewHideTimeoutRef.current);
                floatingTrunkPreviewHideTimeoutRef.current = null;
            }
            if (floatingTrunkPreviewFadeTimeoutRef.current !== null) {
                window.clearTimeout(floatingTrunkPreviewFadeTimeoutRef.current);
                floatingTrunkPreviewFadeTimeoutRef.current = null;
            }
        };
    }, []);

    useLayoutEffect(() => {
        if (!shouldShowFloatingTrunkPreview) {
            setFloatingTrunkPreviewPlacement(null);
            return;
        }

        const anchor = supportSidebarAnchorRef.current;
        if (!anchor) return;

        const MARGIN = 12;
        const GAP = 10;
        let rafId: number | null = null;

        const updatePlacement = () => {
            rafId = null;
            const rect = anchor.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            const MIN_PREVIEW_HEIGHT = 220;
            const preferredTop = rect.top + 2;
            const top = Math.max(MARGIN, Math.min(preferredTop, viewportHeight - MARGIN - MIN_PREVIEW_HEIGHT));

            const maxHeightForTop = Math.max(MIN_PREVIEW_HEIGHT, viewportHeight - top - MARGIN);
            const height = Math.max(MIN_PREVIEW_HEIGHT, Math.min(Math.floor(rect.height), maxHeightForTop));

            const desiredWidth = Math.floor(height * 0.30);
            const width = Math.max(150, Math.min(230, desiredWidth));

            const rightLeft = rect.right + GAP;
            const leftLeft = rect.left - GAP - width;
            const fitsRight = rightLeft + width <= (viewportWidth - MARGIN);
            const fitsLeft = leftLeft >= MARGIN;

            let left = rightLeft;
            if (!fitsRight && fitsLeft) {
                left = leftLeft;
            } else if (!fitsRight && !fitsLeft) {
                left = Math.max(MARGIN, viewportWidth - width - MARGIN);
            }

            setFloatingTrunkPreviewPlacement((prev) => {
                if (
                    prev
                    && prev.top === top
                    && prev.left === left
                    && prev.width === width
                    && prev.height === height
                ) {
                    return prev;
                }
                return { top, left, width, height };
            });
        };

        const schedulePlacement = () => {
            if (rafId !== null) {
                window.cancelAnimationFrame(rafId);
            }
            rafId = window.requestAnimationFrame(updatePlacement);
        };

        schedulePlacement();

        const observer = new ResizeObserver(() => {
            schedulePlacement();
        });
        observer.observe(anchor);

        window.addEventListener('resize', schedulePlacement);
        window.addEventListener('scroll', schedulePlacement, true);

        return () => {
            observer.disconnect();
            window.removeEventListener('resize', schedulePlacement);
            window.removeEventListener('scroll', schedulePlacement, true);
            if (rafId !== null) {
                window.cancelAnimationFrame(rafId);
            }
        };
    }, [shouldShowFloatingTrunkPreview]);

    const compactFieldLabelClass = shouldUseCompactTrunkLayout
        ? 'text-[11px] font-medium leading-tight truncate whitespace-nowrap'
        : 'text-[11px] font-medium leading-tight';
    const compactTrunkPairClass = 'grid grid-cols-2 gap-1.5 items-start';

    const unitHint = (unit: string) => (
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>{unit}</span>
    );

    const supportGeometryFieldsDefault = (
        <div className="space-y-2.5">
            <div className="space-y-1 min-w-0" {...makeRowFocusHandlers('tip.contactDiameterMm')}>
                <div className={compactFieldLabelClass} style={{ color: 'var(--text-muted)' }} title={_(msg`Contact Diameter`)}>{_(msg`Contact Diameter`)}</div>
                <div className="relative">
                    <NumberInput
                        value={settings.tip.contactDiameterMm}
                        onChange={(val) => updateTipProfile({ contactDiameterMm: val })}
                        step={0.1}
                        showStepper={false}
                        {...SUPPORT_PROFILE_LIMITS.tip.contactDiameterMm}
                        {...getInputProps('tip.contactDiameterMm', compactInputClass)}
                    />
                    {unitHint('mm')}
                </div>
            </div>

            {panelHas(activePanel, 'tip') && (
                <div className="space-y-1 min-w-0" {...makeRowFocusHandlers('tip.lengthMm')}>
                    <div className={compactFieldLabelClass} style={{ color: 'var(--text-muted)' }} title={_(msg`Contact Cone Length`)}>{_(msg`Contact Cone Length`)}</div>
                    <div className="relative">
                        <NumberInput
                            value={settings.tip.lengthMm}
                            onChange={(val) => updateTipProfile({ lengthMm: val })}
                            step={0.1}
                            showStepper={false}
                            {...SUPPORT_PROFILE_LIMITS.tip.lengthMm}
                            {...getInputProps('tip.lengthMm', compactInputClass)}
                        />
                        {unitHint('mm')}
                    </div>
                </div>
            )}

            {panelHas(activePanel, 'tip') && (
                <div className="space-y-1 min-w-0" {...fieldFocusProps('tip.coneAngleMode', () => setAnatomyPreviewActiveSettingKey('tip.coneAngleMode'), (e) => {
                    const next = e.relatedTarget as Node | null;
                    if (next && e.currentTarget.contains(next)) return;
                    setAnatomyPreviewActiveSettingKey(null);
                })}>
                    <div
                        className={isAdaptiveConeAngle ? 'grid grid-cols-2 gap-1.5 items-center' : 'flex items-center'}
                    >
                        <div className={`${compactFieldLabelClass} text-center`} style={{ color: 'var(--text-muted)' }} title={_(msg`Cone Angle`)}>{_(msg`Cone Angle`)}</div>
                        {isAdaptiveConeAngle && (
                            <div className={`${compactFieldLabelClass} text-center`} style={{ color: 'var(--text-muted)' }} title={_(msg`Offset`)}>{_(msg`Offset`)}</div>
                        )}
                    </div>
                    <div
                        className={isAdaptiveConeAngle ? 'grid grid-cols-2 gap-1.5 items-center' : 'flex items-center gap-1'}
                    >
                        <SelectDropdown
                            value={settings.tip.coneAngleMode ?? 'normal'}
                            onChange={(value) => updateTipProfile({ coneAngleMode: value as 'normal' | 'locked' | 'adaptive' })}
                            options={[
                                { value: 'normal', label: _(msg`Normal`) },
                                { value: 'locked', label: _(msg`Locked`) },
                                { value: 'adaptive', label: _(msg`Adaptive`) },
                            ]}
                            className={`${isAdaptiveConeAngle ? 'w-full' : 'flex-1'} min-w-0 space-y-0 h-8`}
                            selectClassName={`${isAdaptiveConeAngle ? 'w-full' : 'flex-1'} min-w-0 h-8 px-2.5 pr-10 text-xs sm:text-sm truncate`}
                            menuClassName="!min-w-[9.5rem]"
                            selectedDisplay={useAdaptiveIconCompactDisplay ? <WandSparkles className="h-3.5 w-3.5" style={{ color: 'var(--text-muted)' }} aria-label={_(msg`Adaptive mode`)} /> : undefined}
                            hideSelectedText={useAdaptiveIconCompactDisplay}
                            selectedDisplayAlignment={useAdaptiveIconCompactDisplay ? 'center' : 'left'}
                            selectedDisplayOffsetX={useAdaptiveIconCompactDisplay ? -7 : 0}
                            selectStyle={activeKey === 'tip.coneAngleMode'
                                ? {
                                    borderColor: 'var(--accent)',
                                    boxShadow: '0 0 0 1px color-mix(in srgb, var(--accent), white 8%) inset, 0 0 0 2px color-mix(in srgb, var(--accent), transparent 72%)',
                                }
                                : undefined}

                        />

                        {isAdaptiveConeAngle && (
                            <div className="relative h-8">
                                <NumberInput
                                    value={settings.tip.adaptiveConeAngleOffsetDeg ?? 30}
                                    onChange={(val) => updateTipProfile({ adaptiveConeAngleOffsetDeg: val })}
                                    aria-label={_(msg`Adaptive offset`)}
                                    title={_(msg`Adaptive offset`)}
                                    showStepper={false}
                                    {...SUPPORT_PROFILE_LIMITS.tip.adaptiveConeAngleOffsetDeg}
                                    {...getInputProps('tip.adaptiveConeAngleOffsetDeg', compactInputClass)}
                                />
                                {unitHint('°')}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {panelHas(activePanel, 'shaft') && (
                <div className="space-y-1 min-w-0" {...makeRowFocusHandlers('shaft.diameterMm')}>
                    <div className={compactFieldLabelClass} style={{ color: 'var(--text-muted)' }} title={_(msg`Trunk Diameter`)}>{_(msg`Trunk Diameter`)}</div>
                    <div className="relative">
                        <NumberInput
                            value={settings.shaft.diameterMm}
                            onChange={(val) => updateShaftProfile({ diameterMm: val })}
                            step={0.1}
                            showStepper={false}
                            {...SUPPORT_PROFILE_LIMITS.shaft.diameterMm}
                            {...getInputProps('shaft.diameterMm', compactInputClass)}
                        />
                        {unitHint('mm')}
                    </div>
                </div>
            )}

            {panelHas(activePanel, 'roots') && (
                <>
                    <div className="h-px" style={{ background: 'var(--border-subtle)' }} />

                    <div className="space-y-1 min-w-0" {...makeRowFocusHandlers('roots.diameterMm')}>
                        <div className={compactFieldLabelClass} style={{ color: 'var(--text-muted)' }} title={_(msg`Roots Diameter`)}>{_(msg`Roots Diameter`)}</div>
                        <div className="relative">
                            <NumberInput
                                value={settings.roots.diameterMm}
                                onChange={(val) => updateRootsProfile({ diameterMm: val })}
                                step={0.1}
                                showStepper={false}
                                {...SUPPORT_PROFILE_LIMITS.roots.diameterMm}
                                {...getInputProps('roots.diameterMm', compactInputClass)}
                            />
                            {unitHint('mm')}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="space-y-1 min-w-0" {...makeRowFocusHandlers('roots.diskHeightMm')}>
                            <div className={compactFieldLabelClass} style={{ color: 'var(--text-muted)' }}><Trans>Root Disk Height</Trans></div>
                            <div className="relative">
                                <NumberInput
                                    value={settings.roots.diskHeightMm}
                                    onChange={(val) => updateRootsProfile({ diskHeightMm: val })}
                                    step={0.1}
                                    showStepper={false}
                                    {...SUPPORT_PROFILE_LIMITS.roots.diskHeightMm}
                                    {...getInputProps('roots.diskHeightMm', compactInputClass)}
                                />
                                {unitHint('mm')}
                            </div>
                        </div>

                        <div className="space-y-1 min-w-0" {...makeRowFocusHandlers('roots.coneHeightMm')}>
                            <div className={compactFieldLabelClass} style={{ color: 'var(--text-muted)' }}><Trans>Cone Height</Trans></div>
                            <div className="relative">
                                <NumberInput
                                    value={settings.roots.coneHeightMm}
                                    onChange={(val) => updateRootsProfile({ coneHeightMm: val })}
                                    step={0.1}
                                    showStepper={false}
                                    {...SUPPORT_PROFILE_LIMITS.roots.coneHeightMm}
                                    {...getInputProps('roots.coneHeightMm', compactInputClass)}
                                />
                                {unitHint('mm')}
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );

    const supportGeometryFieldsCompactTrunk = (
        <div className="space-y-2.5">
            <div className={compactTrunkPairClass}>
                <div className="space-y-1 min-w-0" {...makeRowFocusHandlers('tip.contactDiameterMm')}>
                    <div className={compactFieldLabelClass} style={{ color: 'var(--text-muted)' }} title={_(msg`Contact Diameter`)}>{_(msg`Contact Diameter`)}</div>
                    <div className="relative">
                        <NumberInput
                            value={settings.tip.contactDiameterMm}
                            onChange={(val) => updateTipProfile({ contactDiameterMm: val })}
                            step={0.1}
                            showStepper={false}
                            {...SUPPORT_PROFILE_LIMITS.tip.contactDiameterMm}
                            {...getInputProps('tip.contactDiameterMm', compactInputClass)}
                        />
                        {unitHint('mm')}
                    </div>
                </div>

                <div className="space-y-1 min-w-0" {...makeRowFocusHandlers('tip.lengthMm')}>
                    <div className={compactFieldLabelClass} style={{ color: 'var(--text-muted)' }} title={_(msg`Contact Cone Length`)}>{_(msg`Contact Cone Length`)}</div>
                    <div className="relative">
                        <NumberInput
                            value={settings.tip.lengthMm}
                            onChange={(val) => updateTipProfile({ lengthMm: val })}
                            step={0.1}
                            showStepper={false}
                            {...SUPPORT_PROFILE_LIMITS.tip.lengthMm}
                            {...getInputProps('tip.lengthMm', compactInputClass)}
                        />
                        {unitHint('mm')}
                    </div>
                </div>
            </div>

            <div className="space-y-1 min-w-0" {...fieldFocusProps('tip.coneAngleMode', () => setAnatomyPreviewActiveSettingKey('tip.coneAngleMode'), (e) => {
                const next = e.relatedTarget as Node | null;
                if (next && e.currentTarget.contains(next)) return;
                setAnatomyPreviewActiveSettingKey(null);
            })}>
                <div
                    className={isAdaptiveConeAngle ? 'grid grid-cols-2 gap-1.5 items-center' : 'flex items-center'}
                >
                    <div className={`${compactFieldLabelClass} text-center`} style={{ color: 'var(--text-muted)' }} title={_(msg`Cone Angle`)}>{_(msg`Cone Angle`)}</div>
                    {isAdaptiveConeAngle && (
                        <div className={`${compactFieldLabelClass} text-center`} style={{ color: 'var(--text-muted)' }} title={_(msg`Offset`)}>{_(msg`Offset`)}</div>
                    )}
                </div>
                <div
                    className={isAdaptiveConeAngle ? 'grid grid-cols-2 gap-1.5 items-center' : 'flex items-center gap-1'}
                >
                    <SelectDropdown
                        value={settings.tip.coneAngleMode ?? 'normal'}
                        onChange={(value) => updateTipProfile({ coneAngleMode: value as 'normal' | 'locked' | 'adaptive' })}
                        options={[
                            { value: 'normal', label: _(msg`Normal`) },
                            { value: 'locked', label: _(msg`Locked`) },
                            { value: 'adaptive', label: _(msg`Adaptive`) },
                        ]}
                        className={`${isAdaptiveConeAngle ? 'w-full' : 'flex-1'} min-w-0 space-y-0`}
                        selectClassName={`${isAdaptiveConeAngle ? 'w-full' : 'flex-1'} min-w-0 h-8 px-2.5 pr-10 text-xs sm:text-sm truncate`}
                        menuClassName="!min-w-[9.5rem]"
                        selectedDisplay={useAdaptiveIconCompactDisplay ? <WandSparkles className="h-3.5 w-3.5" style={{ color: 'var(--text-muted)' }} aria-label={_(msg`Adaptive mode`)} /> : undefined}
                        hideSelectedText={useAdaptiveIconCompactDisplay}
                        selectedDisplayAlignment={useAdaptiveIconCompactDisplay ? 'center' : 'left'}
                        selectedDisplayOffsetX={useAdaptiveIconCompactDisplay ? -7 : 0}
                        selectStyle={activeKey === 'tip.coneAngleMode'
                            ? {
                                borderColor: 'var(--accent)',
                                boxShadow: '0 0 0 1px color-mix(in srgb, var(--accent), white 8%) inset, 0 0 0 2px color-mix(in srgb, var(--accent), transparent 72%)',
                            }
                            : undefined}
                    />

                    {isAdaptiveConeAngle && (
                        <div className="relative">
                            <NumberInput
                                value={settings.tip.adaptiveConeAngleOffsetDeg ?? 30}
                                onChange={(val) => updateTipProfile({ adaptiveConeAngleOffsetDeg: val })}
                                aria-label={_(msg`Adaptive offset`)}
                                title={_(msg`Adaptive offset`)}
                                showStepper={false}
                                {...SUPPORT_PROFILE_LIMITS.tip.adaptiveConeAngleOffsetDeg}
                                {...getInputProps('tip.adaptiveConeAngleOffsetDeg', compactInputClass)}
                            />
                            {unitHint('°')}
                        </div>
                    )}
                </div>
            </div>

            <div className={compactTrunkPairClass}>
                <div className="space-y-1 min-w-0" {...makeRowFocusHandlers('shaft.diameterMm')}>
                    <div className={compactFieldLabelClass} style={{ color: 'var(--text-muted)' }} title={_(msg`Trunk Diameter`)}>{_(msg`Trunk Diameter`)}</div>
                    <div className="relative">
                        <NumberInput
                            value={settings.shaft.diameterMm}
                            onChange={(val) => updateShaftProfile({ diameterMm: val })}
                            step={0.1}
                            showStepper={false}
                            {...SUPPORT_PROFILE_LIMITS.shaft.diameterMm}
                            {...getInputProps('shaft.diameterMm', compactInputClass)}
                        />
                        {unitHint('mm')}
                    </div>
                </div>

                <div className="space-y-1 min-w-0" {...makeRowFocusHandlers('roots.diameterMm')}>
                    <div className={compactFieldLabelClass} style={{ color: 'var(--text-muted)' }} title={_(msg`Roots Diameter`)}>{_(msg`Roots Diameter`)}</div>
                    <div className="relative">
                        <NumberInput
                            value={settings.roots.diameterMm}
                            onChange={(val) => updateRootsProfile({ diameterMm: val })}
                            step={0.1}
                            showStepper={false}
                            {...SUPPORT_PROFILE_LIMITS.roots.diameterMm}
                            {...getInputProps('roots.diameterMm', compactInputClass)}
                        />
                        {unitHint('mm')}
                    </div>
                </div>
            </div>

            <div className={compactTrunkPairClass}>
                <div className="space-y-1 min-w-0" {...makeRowFocusHandlers('roots.diskHeightMm')}>
                    <div className={compactFieldLabelClass} style={{ color: 'var(--text-muted)' }} title={_(msg`Root Disk Height`)}>{_(msg`Root Disk Height`)}</div>
                    <div className="relative">
                        <NumberInput
                            value={settings.roots.diskHeightMm}
                            onChange={(val) => updateRootsProfile({ diskHeightMm: val })}
                            step={0.1}
                            showStepper={false}
                            {...SUPPORT_PROFILE_LIMITS.roots.diskHeightMm}
                            {...getInputProps('roots.diskHeightMm', compactInputClass)}
                        />
                        {unitHint('mm')}
                    </div>
                </div>

                <div className="space-y-1 min-w-0" {...makeRowFocusHandlers('roots.coneHeightMm')}>
                    <div className={compactFieldLabelClass} style={{ color: 'var(--text-muted)' }} title={_(msg`Cone Height`)}>{_(msg`Cone Height`)}</div>
                    <div className="relative">
                        <NumberInput
                            value={settings.roots.coneHeightMm}
                            onChange={(val) => updateRootsProfile({ coneHeightMm: val })}
                            step={0.1}
                            showStepper={false}
                            {...SUPPORT_PROFILE_LIMITS.roots.coneHeightMm}
                            {...getInputProps('roots.coneHeightMm', compactInputClass)}
                        />
                        {unitHint('mm')}
                    </div>
                </div>
            </div>
        </div>
    );

    const supportGeometryFields = shouldUseCompactTrunkLayout
        ? supportGeometryFieldsCompactTrunk
        : supportGeometryFieldsDefault;

    return (
        <>


        {/* `data-support-studio-panel` is the boundary the preset rail's
            drag-off-to-delete gesture reads: outside it a drop means delete. */}
        <div ref={supportSidebarAnchorRef} data-support-studio-panel>
        <Card className={expanded ? 'max-h-[calc(100dvh-var(--topbar-height)-24px)] overflow-hidden flex flex-col' : undefined}>
            <CardHeader
                left={(
                    <>
                        <PanelCollapseToggle expanded={expanded} onToggle={() => setExpanded((prev) => !prev)} />
                        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>{_(msg`Support Studio`)}</h3>
                    </>
                )}
                right={(
                    <div className="inline-flex items-center gap-1">
                        <IconButton
                            onClick={handleSave}
                            className={`!p-0.5 transition-colors ${saveStatus === 'saved' ? '!bg-green-600/30 !text-green-400' : saveStatus === 'error' ? '!bg-red-600/30 !text-red-400' : '!text-green-400/70 hover:!text-green-400 hover:!bg-green-600/15'}`}
                            title={saveStatus !== 'idle' ? (saveStatus === 'saved' ? _(msg`Saved`) : _(msg`Save failed`)) : _(msg`Save settings`)}
                        >
                            {saveStatus === 'saved' ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                        </IconButton>
                        <IconButton
                            onClick={handleRestoreDefaults}
                            className={`!p-0.5 transition-colors ${defaultsAnimating ? '' : '!text-red-400/70 hover:!text-red-400 hover:!bg-red-600/15'}`}
                            title={_(msg`Restore defaults`)}
                        >
                            <RotateCcw className={`h-3.5 w-3.5 ${defaultsAnimating ? 'animate-spin-once text-orange-400' : ''}`} />
                        </IconButton>
                    </div>
                )}
            />

            {expanded && (
                <label className="mx-2 mb-2 flex cursor-pointer items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <input
                        type="checkbox"
                        checked={showSupportModelColorMap}
                        onChange={(event) => onSupportModelColorMapChange?.(event.target.checked)}
                        aria-label={_(msg`Show vertex colors and heatmap`)}
                    />
                    <span><Trans>Show vertex colors and heatmap</Trans></span>
                </label>
            )}

            {expanded && (
                <div className="px-2 pb-2 space-y-2 sm:px-2.5 sm:pb-2.5 flex flex-col flex-1 min-h-0">
                    <div ref={scrollViewportRef} className={sectionScrollClass}>
                        <div ref={scrollContentRef} className="space-y-2">
                            {showCurvePage ? (
                                <>
                                    <Section title={_(msg`Curves`)} accent>
                                        <CurveSettingsCard embedded />
                                    </Section>
                                </>
                            ) : (
                                <>
                                    <Section title={_(msg`Paint supports`)} accent>
                                        <button
                                            type="button"
                                            aria-pressed={supportPaintingActive}
                                            onClick={() => onSupportPaintingChange?.(!supportPaintingActive)}
                                            className="ui-input w-full px-2.5 py-2 text-xs font-semibold transition-colors"
                                            style={supportPaintingActive
                                                ? {
                                                    borderColor: 'color-mix(in srgb, var(--accent), var(--border-subtle) 36%)',
                                                    background: 'color-mix(in srgb, var(--accent), var(--surface-1) 88%)',
                                                    color: 'var(--text-strong)',
                                                }
                                                : { background: 'var(--surface-1)', color: 'var(--text-muted)' }}
                                        >
                                            {supportPaintingActive ? _(msg`Stop painting`) : _(msg`Start painting`)}
                                        </button>
                                        <div className="mt-2 grid grid-cols-2 gap-2">
                                            <label className="min-w-0 text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>
                                                <span className="mb-1 block">{_(msg`Interval (mm)`)}</span>
                                                <NumberInput
                                                    value={paintSettings.intervalMm}
                                                    min={0.5}
                                                    max={10}
                                                    step={0.5}
                                                    showStepper={false}
                                                    onChange={(intervalMm) => setSupportPaintingSettings({ ...paintSettings, intervalMm })}
                                                    className={INPUT_CLASS}
                                                />
                                            </label>
                                            <label className="min-w-0 text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>
                                                <span className="mb-1 block">{_(msg`Maximum angle (°)`)}</span>
                                                <NumberInput
                                                    value={paintSettings.maxAngleDeg}
                                                    min={0}
                                                    max={90}
                                                    step={5}
                                                    showStepper={false}
                                                    onChange={(maxAngleDeg) => setSupportPaintingSettings({ ...paintSettings, maxAngleDeg })}
                                                    className={INPUT_CLASS}
                                                />
                                            </label>
                                        </div>
                                        <label className="mt-2 inline-flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                            <input
                                                type="checkbox"
                                                className="ui-checkbox !w-3.5 !h-3.5"
                                                checked={paintSettings.avoidExistingEnabled}
                                                onChange={(event) => setSupportPaintingSettings({
                                                    ...paintSettings,
                                                    avoidExistingEnabled: event.currentTarget.checked,
                                                })}
                                            />
                                            <span><Trans>Avoid existing support contacts</Trans></span>
                                        </label>
                                        <p className="mt-2 text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                                            <Trans>Preview points as you paint. Supports are placed when you release.</Trans>
                                        </p>
                                    </Section>
                                    <Section title={_(msg`Inline supports`)} accent>
                                        <button
                                            type="button"
                                            aria-pressed={supportInlineActive}
                                            onClick={() => onSupportInlineChange?.(!supportInlineActive)}
                                            className="ui-input w-full px-2.5 py-2 text-xs font-semibold transition-colors"
                                            style={supportInlineActive
                                                ? {
                                                    borderColor: 'color-mix(in srgb, var(--accent), var(--border-subtle) 36%)',
                                                    background: 'color-mix(in srgb, var(--accent), var(--surface-1) 88%)',
                                                    color: 'var(--text-strong)',
                                                }
                                                : { background: 'var(--surface-1)', color: 'var(--text-muted)' }}
                                        >
                                            {supportInlineActive ? _(msg`Stop inline supports`) : _(msg`Start inline supports`)}
                                        </button>
                                        <p className="mt-2 text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                                            <Trans>Click a start point, move to preview evenly spaced contacts, then click a second point to place them. Spacing and surface filters use the settings above.</Trans>
                                        </p>
                                    </Section>
                                    <Section title={_(msg`Projection supports (experimental)`)} accent>
                                        <button
                                            type="button"
                                            aria-pressed={supportProjectionActive}
                                            disabled={supportProjectionPreviewReady}
                                            onClick={() => onSupportProjectionChange?.(!supportProjectionActive)}
                                            className="ui-input w-full px-2.5 py-2 text-xs font-semibold transition-colors disabled:opacity-45"
                                            style={supportProjectionActive
                                                ? {
                                                    borderColor: 'color-mix(in srgb, var(--accent), var(--border-subtle) 36%)',
                                                    background: 'color-mix(in srgb, var(--accent), var(--surface-1) 88%)',
                                                    color: 'var(--text-strong)',
                                                }
                                                : { background: 'var(--surface-1)', color: 'var(--text-muted)' }}
                                        >
                                            {supportProjectionActive ? _(msg`Stop projection`) : _(msg`Start projection`)}
                                        </button>
                                        <p className="mt-2 text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                                            <Trans>Paint a surface on the active model, then review the projected contacts before adding supports.</Trans>
                                        </p>
                                        {supportProjectionPreviewReady && (
                                            <div className="mt-2 rounded-md border p-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}>
                                                <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                                                    <Trans>Review the highlighted contacts. Apply to add supports or cancel to discard this projection.</Trans>
                                                </p>
                                                <div className="mt-2 grid grid-cols-2 gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={applySupportProjectionPreview}
                                                        className="ui-input h-8 px-2.5 text-xs font-semibold"
                                                        style={{ color: 'var(--text-strong)', borderColor: 'var(--accent)' }}
                                                    >
                                                        <Trans>Add supports</Trans>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={cancelSupportProjectionPreview}
                                                        className="ui-input h-8 px-2.5 text-xs"
                                                    >
                                                        <Trans>Cancel preview</Trans>
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                        <fieldset disabled={supportProjectionPreviewReady} className="mt-2 disabled:opacity-45">
                                        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                                            <select
                                                aria-label={_(msg`Saved projection preset`)}
                                                value={selectedProjectionPresetId}
                                                onChange={(event) => setSelectedProjectionPresetId(event.currentTarget.value)}
                                                className={INPUT_CLASS}
                                            >
                                                <option value="">{_(msg`Select a preset`)}</option>
                                                {projectionPresets.map((preset) => (
                                                    <option key={preset.id} value={preset.id}>{preset.name}</option>
                                                ))}
                                            </select>
                                            <button
                                                type="button"
                                                disabled={!selectedProjectionPresetId}
                                                onClick={() => applySupportProjectionPreset(selectedProjectionPresetId)}
                                                className="ui-input h-8 px-2.5 text-xs disabled:opacity-45"
                                            >
                                                <Trans>Apply</Trans>
                                            </button>
                                        </div>
                                        <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-1.5">
                                            <input
                                                type="text"
                                                value={projectionPresetName}
                                                onChange={(event) => setProjectionPresetName(event.currentTarget.value)}
                                                aria-label={_(msg`Projection preset name`)}
                                                placeholder={_(msg`Preset name`)}
                                                className={INPUT_CLASS}
                                            />
                                            <button
                                                type="button"
                                                disabled={!projectionPresetName.trim()}
                                                onClick={() => {
                                                    const savedId = saveSupportProjectionPreset(projectionPresetName);
                                                    if (savedId) {
                                                        setSelectedProjectionPresetId(savedId);
                                                        setProjectionPresetName('');
                                                    }
                                                }}
                                                className="ui-input h-8 px-2 text-xs disabled:opacity-45"
                                            >
                                                <Trans>Save preset</Trans>
                                            </button>
                                            <button
                                                type="button"
                                                disabled={!selectedProjectionPresetId}
                                                onClick={() => {
                                                    deleteSupportProjectionPreset(selectedProjectionPresetId);
                                                    setSelectedProjectionPresetId('');
                                                }}
                                                className="ui-input h-8 px-2 text-xs disabled:opacity-45"
                                            >
                                                <Trans>Delete</Trans>
                                            </button>
                                        </div>
                                        <div className="mt-2 grid grid-cols-2 gap-2">
                                            <label className="min-w-0 text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>
                                                <span className="mb-1 block">{_(msg`Border support preset`)}</span>
                                                <select
                                                    aria-label={_(msg`Border support preset`)}
                                                    value={projectionSettings.borderSupportPresetId ?? ''}
                                                    onChange={(event) => setSupportProjectionSettings({
                                                        ...projectionSettings,
                                                        borderSupportPresetId: event.currentTarget.value || null,
                                                    })}
                                                    className={INPUT_CLASS}
                                                >
                                                    <option value="">{_(msg`Use active support preset`)}</option>
                                                    {supportPresets.map((preset) => (
                                                        <option key={preset.id} value={preset.id}>{preset.name}</option>
                                                    ))}
                                                </select>
                                            </label>
                                            <label className="min-w-0 text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>
                                                <span className="mb-1 block">{_(msg`Infill support preset`)}</span>
                                                <select
                                                    aria-label={_(msg`Infill support preset`)}
                                                    value={projectionSettings.infillSupportPresetId ?? ''}
                                                    onChange={(event) => setSupportProjectionSettings({
                                                        ...projectionSettings,
                                                        infillSupportPresetId: event.currentTarget.value || null,
                                                    })}
                                                    className={INPUT_CLASS}
                                                >
                                                    <option value="">{_(msg`Use active support preset`)}</option>
                                                    {supportPresets.map((preset) => (
                                                        <option key={preset.id} value={preset.id}>{preset.name}</option>
                                                    ))}
                                                </select>
                                            </label>
                                        </div>
                                        <div className="mt-2 grid grid-cols-2 gap-2">
                                            <label className="min-w-0 text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>
                                                <span className="mb-1 block">{_(msg`Border tag`)}</span>
                                                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
                                                    <select
                                                        aria-label={_(msg`Border tag`)}
                                                        value={projectionSettings.borderTag ?? ''}
                                                        onChange={(event) => setSupportProjectionSettings({
                                                            ...projectionSettings,
                                                            borderTag: event.currentTarget.value || null,
                                                        })}
                                                        className={INPUT_CLASS}
                                                    >
                                                        <option value="">{_(msg`No tag`)}</option>
                                                        {supportTagGroups.map(({ name }) => <option key={name} value={name}>{name}</option>)}
                                                        {projectionSettings.borderTag && !supportTagGroups.some(({ name }) => name === projectionSettings.borderTag) && (
                                                            <option value={projectionSettings.borderTag}>{projectionSettings.borderTag}</option>
                                                        )}
                                                    </select>
                                                    <button
                                                        type="button"
                                                        onClick={() => setSupportProjectionSettings({
                                                            ...projectionSettings,
                                                            borderTag: createSupportProjectionTag('border'),
                                                        })}
                                                        className="ui-input h-8 px-2 text-[10px]"
                                                    >
                                                        <Trans>New</Trans>
                                                    </button>
                                                </div>
                                            </label>
                                            <label className="min-w-0 text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>
                                                <span className="mb-1 block">{_(msg`Infill tag`)}</span>
                                                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
                                                    <select
                                                        aria-label={_(msg`Infill tag`)}
                                                        value={projectionSettings.infillTag ?? ''}
                                                        onChange={(event) => setSupportProjectionSettings({
                                                            ...projectionSettings,
                                                            infillTag: event.currentTarget.value || null,
                                                        })}
                                                        className={INPUT_CLASS}
                                                    >
                                                        <option value="">{_(msg`No tag`)}</option>
                                                        {supportTagGroups.map(({ name }) => <option key={name} value={name}>{name}</option>)}
                                                        {projectionSettings.infillTag && !supportTagGroups.some(({ name }) => name === projectionSettings.infillTag) && (
                                                            <option value={projectionSettings.infillTag}>{projectionSettings.infillTag}</option>
                                                        )}
                                                    </select>
                                                    <button
                                                        type="button"
                                                        onClick={() => setSupportProjectionSettings({
                                                            ...projectionSettings,
                                                            infillTag: createSupportProjectionTag('infill'),
                                                        })}
                                                        className="ui-input h-8 px-2 text-[10px]"
                                                    >
                                                        <Trans>New</Trans>
                                                    </button>
                                                </div>
                                            </label>
                                        </div>
                                        <div className="mt-2 grid grid-cols-2 gap-2">
                                            <label className="min-w-0 text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>
                                                <span className="mb-1 block">{_(msg`Brush (mm)`)}</span>
                                                <NumberInput
                                                    value={projectionSettings.brushRadiusMm}
                                                    min={1}
                                                    max={20}
                                                    step={1}
                                                    showStepper={false}
                                                    onChange={(brushRadiusMm) => setSupportProjectionSettings({ ...projectionSettings, brushRadiusMm })}
                                                    className={INPUT_CLASS}
                                                />
                                            </label>
                                            <label className="min-w-0 text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>
                                                <span className="mb-1 block">{_(msg`Max angle (°)`)}</span>
                                                <NumberInput
                                                    value={projectionSettings.maxAngleDeg}
                                                    min={0}
                                                    max={90}
                                                    step={5}
                                                    showStepper={false}
                                                    onChange={(maxAngleDeg) => setSupportProjectionSettings({ ...projectionSettings, maxAngleDeg })}
                                                    className={INPUT_CLASS}
                                                />
                                            </label>
                                        </div>
                                        <div className="mt-2 grid grid-cols-2 gap-2">
                                            <label className="min-w-0 text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>
                                                <span className="mb-1 block">{_(msg`Border interval (mm)`)}</span>
                                                <NumberInput
                                                    value={projectionSettings.borderIntervalMm}
                                                    min={1}
                                                    max={20}
                                                    step={1}
                                                    showStepper={false}
                                                    onChange={(borderIntervalMm) => setSupportProjectionSettings({ ...projectionSettings, borderIntervalMm })}
                                                    className={INPUT_CLASS}
                                                />
                                            </label>
                                            <label className="min-w-0 text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>
                                                <span className="mb-1 block">{_(msg`Infill interval (mm)`)}</span>
                                                <NumberInput
                                                    value={projectionSettings.infillIntervalMm}
                                                    min={1}
                                                    max={20}
                                                    step={1}
                                                    showStepper={false}
                                                    onChange={(infillIntervalMm) => setSupportProjectionSettings({ ...projectionSettings, infillIntervalMm })}
                                                    className={INPUT_CLASS}
                                                />
                                            </label>
                                        </div>
                                        <div className="mt-2 grid grid-cols-3 items-center gap-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                            <label className="inline-flex items-center gap-1.5">
                                                <input
                                                    type="checkbox"
                                                    checked={projectionSettings.borderEnabled}
                                                    onChange={(event) => setSupportProjectionSettings({ ...projectionSettings, borderEnabled: event.currentTarget.checked })}
                                                />
                                                <Trans>Border</Trans>
                                            </label>
                                            <label className="inline-flex items-center gap-1.5">
                                                <input
                                                    type="checkbox"
                                                    checked={projectionSettings.infillEnabled}
                                                    onChange={(event) => setSupportProjectionSettings({ ...projectionSettings, infillEnabled: event.currentTarget.checked })}
                                                />
                                                <Trans>Infill</Trans>
                                            </label>
                                            <label className="min-w-0">
                                                <span className="mb-1 block">{_(msg`Pattern`)}</span>
                                                <select
                                                    value={projectionSettings.pattern}
                                                    onChange={(event) => setSupportProjectionSettings({
                                                        ...projectionSettings,
                                                        pattern: event.currentTarget.value as SupportProjectionPattern,
                                                    })}
                                                    className={INPUT_CLASS}
                                                >
                                                    <option value="grid">{_(msg`Grid`)}</option>
                                                    <option value="concentric">{_(msg`Concentric`)}</option>
                                                    <option value="random">{_(msg`Random`)}</option>
                                                    <option value="contour">{_(msg`Contour`)}</option>
                                                </select>
                                            </label>
                                        </div>
                                        <label className="mt-2 block max-w-[calc(50%-4px)] text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>
                                            <span className="mb-1 block">{_(msg`Symmetry`)}</span>
                                            <select
                                                aria-label={_(msg`Symmetry`)}
                                                value={projectionSettings.symmetryAxis}
                                                onChange={(event) => setSupportProjectionSettings({
                                                    ...projectionSettings,
                                                    symmetryAxis: event.currentTarget.value as SupportProjectionSymmetryAxis,
                                                })}
                                                className={INPUT_CLASS}
                                            >
                                                <option value="none">{_(msg`Off`)}</option>
                                                <option value="x">{_(msg`Mirror across X`)}</option>
                                                <option value="y">{_(msg`Mirror across Y`)}</option>
                                            </select>
                                        </label>
                                        <div className="mt-2 grid grid-cols-2 items-end gap-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                            <label className="inline-flex items-center gap-1.5" title={_(msg`Add a second support row just inside the outer border.`)}>
                                                <input
                                                    type="checkbox"
                                                    checked={projectionSettings.doubleBorderEnabled}
                                                    onChange={(event) => setSupportProjectionSettings({ ...projectionSettings, doubleBorderEnabled: event.currentTarget.checked })}
                                                />
                                                <Trans>Double border</Trans>
                                            </label>
                                            {projectionSettings.doubleBorderEnabled && (
                                                <label className="min-w-0 text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>
                                                    <span className="mb-1 block">{_(msg`Border row offset (mm)`)}</span>
                                                    <NumberInput
                                                        value={projectionSettings.doubleBorderOffsetMm}
                                                        min={1}
                                                        max={20}
                                                        step={1}
                                                        showStepper={false}
                                                        onChange={(doubleBorderOffsetMm) => setSupportProjectionSettings({ ...projectionSettings, doubleBorderOffsetMm })}
                                                        className={INPUT_CLASS}
                                                    />
                                                </label>
                                            )}
                                        </div>
                                        <div className="mt-2 grid grid-cols-2 items-center gap-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                            <label className="inline-flex items-center gap-1.5" title={_(msg`Move a nearby projected contact onto a detected island.`)}>
                                                <input
                                                    type="checkbox"
                                                    checked={projectionSettings.islandInfluenceEnabled}
                                                    onChange={(event) => setSupportProjectionSettings({
                                                        ...projectionSettings,
                                                        islandInfluenceEnabled: event.currentTarget.checked,
                                                    })}
                                                />
                                                <Trans>Snap to islands</Trans>
                                            </label>
                                            {projectionSettings.islandInfluenceEnabled && (
                                                <label className="min-w-0 text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>
                                                    <span className="mb-1 block">{_(msg`Island influence (mm)`)}</span>
                                                    <NumberInput
                                                        value={projectionSettings.islandInfluenceMm}
                                                        min={1}
                                                        max={20}
                                                        step={1}
                                                        showStepper={false}
                                                        onChange={(islandInfluenceMm) => setSupportProjectionSettings({ ...projectionSettings, islandInfluenceMm })}
                                                        className={INPUT_CLASS}
                                                    />
                                                </label>
                                            )}
                                        </div>
                                        </fieldset>
                                        {supportTagGroups.length > 0 && (
                                            <div className="mt-2 rounded-md border p-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}>
                                                <p className="mb-1 text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>
                                                    <Trans>Tagged supports</Trans>
                                                </p>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {supportTagGroups.map(({ name, ids }) => {
                                                        const isHidden = hiddenSupportTags.has(name);
                                                        return (
                                                            <div key={name} className="inline-flex items-center rounded-md border" style={{ borderColor: 'var(--border-subtle)' }}>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => selectSupportIds(ids)}
                                                                    className="ui-input h-7 rounded-r-none border-0 px-2 text-[10px]"
                                                                    title={_(msg`Select all supports in this tag`)}
                                                                    style={{ opacity: isHidden ? 0.55 : 1 }}
                                                                >
                                                                    {name} · {ids.length}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setSupportTagVisible(name, isHidden)}
                                                                    aria-label={isHidden ? _(msg`Show tag`) : _(msg`Hide tag`)}
                                                                    aria-pressed={!isHidden}
                                                                    title={isHidden ? _(msg`Show tag`) : _(msg`Hide tag`)}
                                                                    className="grid h-7 w-7 place-items-center border-l"
                                                                    style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
                                                                >
                                                                    {isHidden ? <EyeOff size={12} aria-hidden="true" /> : <Eye size={12} aria-hidden="true" />}
                                                                </button>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </Section>
                                    <SidebarPanelTabs
                                        value={tabKind}
                                        onChange={(tab) => {
                                            resetSupportSettingsScrollForTabChange(
                                                scrollViewportRef.current,
                                                tabKind,
                                                tab,
                                            );
                                            setAnatomyPreviewActiveSettingKey(null);
                                            setActiveSidebarPanel(panelForTab(tab));
                                        }}
                                    />

                                    {activePanel === 'raft' ? (
                                        <>
                                            {!shouldUseOverflowCompactMode ? (
                                                renderPreviewBox('h-[220px]')
                                            ) : null}
                                            <div className="rounded-md border p-2" style={SECTION_CARD_STYLE}>
                                                <RaftSettingsCard
                                                    settings={raftSettings}
                                                    onChange={(partial) => updateRaftSettings(partial)}
                                                />
                                            </div>
                                        </>
                                    ) : activePanel === 'grid' ? (
                                        <>
                                            {!shouldUseOverflowCompactMode ? (
                                                renderPreviewBox('h-[220px]')
                                            ) : null}
                                            <div className="rounded-md border p-2" style={SECTION_CARD_STYLE}>
                                                <GridSettingsCard
                                                    grid={settings.grid}
                                                    onChange={(partial) => updateGridSettings(partial)}
                                                />
                                            </div>
                                        </>
                                    ) : tabKind === 'bracing' ? (
                                        <>
                                            {!shouldUseOverflowCompactMode ? (
                                                renderPreviewBox('h-[220px]')
                                            ) : null}
                                            <div className="rounded-md border p-2" style={SECTION_CARD_STYLE}>
                                                <AutoBracingSettingsCard
                                                    settings={settings.autoBracing}
                                                    onChange={(partial) => updateAutoBracingSettings(partial)}
                                                    onAutoBrace={handleAutoBrace}
                                                    onClearBraces={handleClearBraces}
                                                    status={autoBraceStatus}
                                                />
                                            </div>
                                        </>
                                    ) : activePanel === DEFAULT_SIDEBAR_PANEL ? (
                                        <>
                                            {shouldUseCompactTrunkLayout ? (
                                                <div className="rounded-md border p-2" style={SECTION_CARD_STYLE}>
                                                    {supportGeometryFields}
                                                </div>
                                            ) : (
                                                <div className="flex gap-2 items-stretch">
                                                    <div className="w-1/2 min-w-0 flex flex-col">
                                                        {renderPreviewBox('flex-1 min-h-[340px]')}
                                                    </div>

                                                    <div className="w-1/2 min-w-0 rounded-md border p-2" style={SECTION_CARD_STYLE}>
                                                        {supportGeometryFields}
                                                    </div>
                                                </div>
                                            )}

                                            <div className="rounded-md border p-2" style={SECTION_CARD_STYLE}>
                                                <PresetSelector
                                                    selectedPresetIdOverride={effectivePresetIdOverride}
                                                    disableGlobalPresetActivation={Boolean(editableTarget)}
                                                    saveTrigger={presetSaveTrigger}
                                                    onPresetSelected={(presetId) => {
                                                        const preset = getPresetById(presetId);
                                                        if (!preset) return;

                                                        const current = getSettings();

                                                        supportEditSessionDirtyRef.current = true;
                                                        const nextSettings: SupportSettings = {
                                                            ...preset.settings,
                                                            grid: {
                                                                ...current.grid,
                                                            },
                                                            tip: {
                                                                ...preset.settings.tip,
                                                                coneAngleMode: current.tip.coneAngleMode,
                                                                adaptiveConeAngleOffsetDeg: current.tip.adaptiveConeAngleOffsetDeg,
                                                                coneAngleDeg: current.tip.coneAngleDeg,
                                                            },
                                                            autoBracing: {
                                                                ...current.autoBracing,
                                                            },
                                                            autoSupport: {
                                                                ...current.autoSupport,
                                                            },
                                                            // The navigation view is how the user is looking
                                                            // at the forest, not part of a preset.
                                                            navigationDiscsOnly: current.navigationDiscsOnly,
                                                        };
                                                        editSessionLatestSettingsRef.current = nextSettings;
                                                        setSettings(nextSettings);
                                                        applySettingsToSelectedSupports(nextSettings);
                                                        setOptimisticPresetId(presetId);
                                                    }}
                                                />
                                            </div>
                                            {editableTarget && (
                                                <div className="rounded-md border p-2" style={SECTION_CARD_STYLE}>
                                                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                                                        <Trans>Support settings</Trans>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => setCopiedSupportSettings(structuredClone(settings))}
                                                            className="ui-input inline-flex min-h-8 items-center justify-center gap-1.5 px-2 text-[10px]"
                                                            title={_(msg`Copy settings from this support`)}
                                                        >
                                                            <Copy size={12} aria-hidden="true" />
                                                            <Trans>Copy settings</Trans>
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={pasteCopiedSupportSettings}
                                                            disabled={!copiedSupportSettings || selectedSupportIds.length < 2}
                                                            className="ui-input inline-flex min-h-8 items-center justify-center gap-1.5 px-2 text-[10px] disabled:cursor-not-allowed disabled:opacity-50"
                                                            title={_(msg`Apply copied settings to the selected supports`)}
                                                        >
                                                            <ClipboardPaste size={12} aria-hidden="true" />
                                                            <Trans>Paste to selected</Trans>
                                                        </button>
                                                    </div>
                                                    <div className="mt-2 border-t pt-2" style={{ borderColor: 'var(--border-subtle)' }}>
                                                        <div className="mb-1.5 text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>
                                                            <Trans>Relative scaling</Trans>
                                                        </div>
                                                        <div className="grid grid-cols-4 gap-1" role="group" aria-label={_(msg`Support parameters to scale`)}>
                                                            {RELATIVE_SCALE_GROUPS.map((group) => (
                                                                <button
                                                                    key={group.id}
                                                                    type="button"
                                                                    onClick={() => setRelativeScaleGroup(group.id)}
                                                                    aria-pressed={relativeScaleGroup === group.id}
                                                                    className="ui-input min-h-7 px-1 text-[10px]"
                                                                    style={relativeScaleGroup === group.id ? {
                                                                        borderColor: 'var(--accent)',
                                                                        color: 'var(--text-primary)',
                                                                    } : undefined}
                                                                >
                                                                    {_(group.label)}
                                                                </button>
                                                            ))}
                                                        </div>
                                                        <div className="mt-1.5 grid grid-cols-[1fr_auto] gap-2">
                                                            <label className="flex min-w-0 items-center gap-1.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                                                <span><Trans>Scale</Trans></span>
                                                                <NumberInput
                                                                    value={relativeScalePercent}
                                                                    onChange={setRelativeScalePercent}
                                                                    min={10}
                                                                    max={300}
                                                                    step={5}
                                                                    showStepper={false}
                                                                    aria-label={_(msg`Scale percentage`)}
                                                                    className={`${INPUT_CLASS} max-w-20`}
                                                                />
                                                                <span aria-hidden="true">%</span>
                                                            </label>
                                                            <button
                                                                type="button"
                                                                onClick={applyRelativeSupportScale}
                                                                disabled={!hasSelectedSupport || relativeScalePercent === 100}
                                                                title={_(msg`Scale the selected support geometry by this percentage`)}
                                                                className="ui-input min-h-8 px-2 text-[10px] disabled:cursor-not-allowed disabled:opacity-50"
                                                            >
                                                                <Trans>Apply scale</Trans>
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            {renderPreviewBox('h-[250px]')}

                                            <div className="rounded-md border p-2" style={SECTION_CARD_STYLE}>
                                                {supportGeometryFields}
                                            </div>
                                        </>
                                    )}
                                </>
                            )}

                        </div>
                    </div>

                </div>
            )}
        </Card>
        </div>

        {shouldShowFloatingTrunkPreview && floatingTrunkPreviewPlacement && typeof document !== 'undefined' && ReactDOM.createPortal(
            <div
                className="fixed z-[115] pointer-events-none rounded-lg border p-2 shadow-2xl flex flex-col"
                style={{
                    top: floatingTrunkPreviewPlacement.top,
                    left: floatingTrunkPreviewPlacement.left,
                    width: floatingTrunkPreviewPlacement.width,
                    height: floatingTrunkPreviewPlacement.height,
                    opacity: floatingTrunkPreviewFadingOut ? 0 : 1,
                    transform: floatingTrunkPreviewFadingOut ? 'translateY(6px)' : 'translateY(0px)',
                    transition: 'opacity 240ms ease, transform 240ms ease',
                    borderColor: 'color-mix(in srgb, var(--accent), var(--border-subtle) 70%)',
                    background: 'color-mix(in srgb, var(--surface-0), #000 12%)',
                    boxShadow: '0 18px 34px color-mix(in srgb, var(--surface-0), black 44%)',
                }}
                aria-hidden="true"
            >
                <div
                    className="w-full flex-1 min-h-0 rounded-md border overflow-hidden"
                    style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
                >
                    <SupportAnatomyPreviewSlot />
                </div>
            </div>,
            document.body,
        )}
        </>
    );
}
