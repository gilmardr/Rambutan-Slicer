import { getSelectedSupportIds } from '@/supports/interaction/supportMultiSelection';
import {
    applySettingsToSupportTarget,
    beginSupportStateBatch,
    endSupportStateBatch,
    getSnapshot,
    getSupportSettingsForTarget,
    resolveEditableSupportTarget,
    type EditableSupportTarget,
} from '@/supports/state';
import { EDITABLE_SUPPORT_TYPES } from '@/supports/supportTypeRegistry';
import { SUPPORT_PROFILE_LIMITS } from './defaults';
import type { SupportSettings } from './types';

export type RelativeSupportScaleGroup = 'tip' | 'shaft' | 'base' | 'all';

function scaleDimension(value: number | undefined, factor: number, min = 0, max = 100): number | undefined {
    if (value === undefined || !Number.isFinite(value)) return value;
    return Number(Math.max(min, Math.min(max, value * factor)).toFixed(3));
}

function scaleSupportSettings(
    settings: SupportSettings,
    group: RelativeSupportScaleGroup,
    factor: number,
): SupportSettings {
    const scaleTip = group === 'tip' || group === 'all';
    const scaleShaft = group === 'shaft' || group === 'all';
    const scaleBase = group === 'base' || group === 'all';

    return {
        ...settings,
        tip: scaleTip ? {
            ...settings.tip,
            contactDiameterMm: scaleDimension(settings.tip.contactDiameterMm, factor, SUPPORT_PROFILE_LIMITS.tip.contactDiameterMm.min, SUPPORT_PROFILE_LIMITS.tip.contactDiameterMm.max)!,
            bodyDiameterMm: scaleDimension(settings.tip.bodyDiameterMm, factor, 0.05, 50)!,
            lengthMm: scaleDimension(settings.tip.lengthMm, factor, SUPPORT_PROFILE_LIMITS.tip.lengthMm.min, SUPPORT_PROFILE_LIMITS.tip.lengthMm.max)!,
            penetrationMm: scaleDimension(settings.tip.penetrationMm, factor, 0, 10)!,
            breakpointMm: scaleDimension(settings.tip.breakpointMm, factor, 0, 50),
            diskThicknessMm: scaleDimension(settings.tip.diskThicknessMm, factor, 0, 20),
            maxStandoffMm: scaleDimension(settings.tip.maxStandoffMm, factor, 0, 50),
        } : settings.tip,
        shaft: scaleShaft ? {
            ...settings.shaft,
            diameterMm: scaleDimension(settings.shaft.diameterMm, factor, SUPPORT_PROFILE_LIMITS.shaft.diameterMm.min, SUPPORT_PROFILE_LIMITS.shaft.diameterMm.max)!,
            secondaryDiameterMm: scaleDimension(settings.shaft.secondaryDiameterMm, factor, SUPPORT_PROFILE_LIMITS.shaft.diameterMm.min, SUPPORT_PROFILE_LIMITS.shaft.diameterMm.max),
        } : settings.shaft,
        roots: scaleBase ? {
            ...settings.roots,
            diameterMm: scaleDimension(settings.roots.diameterMm, factor, SUPPORT_PROFILE_LIMITS.roots.diameterMm.min, SUPPORT_PROFILE_LIMITS.roots.diameterMm.max)!,
            diskHeightMm: scaleDimension(settings.roots.diskHeightMm, factor, SUPPORT_PROFILE_LIMITS.roots.diskHeightMm.min, SUPPORT_PROFILE_LIMITS.roots.diskHeightMm.max)!,
            coneHeightMm: scaleDimension(settings.roots.coneHeightMm, factor, SUPPORT_PROFILE_LIMITS.roots.coneHeightMm.min, SUPPORT_PROFILE_LIMITS.roots.coneHeightMm.max)!,
            neckDiameterMm: scaleDimension(settings.roots.neckDiameterMm, factor, 0.05, 50)!,
        } : settings.roots,
        baseFlare: scaleBase ? {
            ...settings.baseFlare,
            diameterMm: scaleDimension(settings.baseFlare.diameterMm, factor, 0.05, 50)!,
            heightMm: scaleDimension(settings.baseFlare.heightMm, factor, 0, 20)!,
        } : settings.baseFlare,
    };
}

/** Apply a percentage multiplier to the chosen geometry group on each selected support. */
export function applyRelativeSupportScaleToSelectedSupports(
    factor: number,
    group: RelativeSupportScaleGroup,
): number {
    if (!Number.isFinite(factor) || factor <= 0) return 0;

    const snapshot = getSnapshot();
    const selectedIds = getSelectedSupportIds();
    const idsToApply = selectedIds.length > 0
        ? selectedIds
        : (snapshot.selectedId ? [snapshot.selectedId] : []);
    const targets = new Map<string, EditableSupportTarget>();

    for (const id of idsToApply) {
        const direct = EDITABLE_SUPPORT_TYPES.find(
            (descriptor) => (snapshot[descriptor.location.key] as Record<string, unknown>)[id],
        );
        const target = direct
            ? { kind: direct.id, id }
            : resolveEditableSupportTarget(id, snapshot.selectedCategory ?? undefined);
        if (target) targets.set(`${target.kind}:${target.id}`, target);
    }

    if (targets.size === 0) return 0;

    let updated = 0;
    beginSupportStateBatch();
    try {
        for (const target of targets.values()) {
            const settings = getSupportSettingsForTarget(target);
            if (settings && applySettingsToSupportTarget(target, scaleSupportSettings(settings, group, factor))) {
                updated += 1;
            }
        }
    } finally {
        endSupportStateBatch();
    }

    return updated;
}

export function applySettingsToSelectedSupports(settings: SupportSettings): void {
    const snapshot = getSnapshot();
    const selectedIds = getSelectedSupportIds();
    const idsToApply = selectedIds.length > 0
        ? selectedIds
        : (snapshot.selectedId ? [snapshot.selectedId] : []);

    if (idsToApply.length === 0) return;

    beginSupportStateBatch();
    try {
        for (const id of idsToApply) {
            // A selected id may be an editable entity directly. The resolver
            // only takes that path when the snapshot's category matches, which
            // it cannot for every id in a multi-selection.
            const direct = EDITABLE_SUPPORT_TYPES.find(
                (descriptor) => (snapshot[descriptor.location.key] as Record<string, unknown>)[id],
            );
            const target: EditableSupportTarget | null = direct
                ? { kind: direct.id, id }
                : resolveEditableSupportTarget(id, snapshot.selectedCategory ?? undefined);
            if (target) {
                applySettingsToSupportTarget(target, settings);
            }
        }
    } finally {
        endSupportStateBatch();
    }
}
