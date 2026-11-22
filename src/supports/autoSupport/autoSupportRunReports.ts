import type { AutoPlaceResult } from './types';

export type AutoSupportNoResultReason =
    | 'no-candidates'
    | 'all-deduplicated'
    | 'already-supported'
    | 'disabled'
    | 'collision'
    | 'no-attachment'
    | 'build-error'
    | 'placement-rejected';

export type AutoSupportModelSkipReason =
    | 'model-unavailable'
    | 'scan-failed'
    | 'no-islands'
    | 'scope-no-matches'
    | AutoSupportNoResultReason
    | 'run-failed';

export type AutoSupportModelRunReport = {
    modelId: string;
    modelName: string;
    supportCount: number;
    skipReason?: AutoSupportModelSkipReason;
    /** Candidates the run could not place for this model; known once the run has a result. */
    rejectedCandidates?: number;
    /** Islands still without a nearby support after the run, when the run reported coverage. */
    islandsUncovered?: number;
};

export type AutoSupportModelEntry = { modelId: string };

export function getAutoSupportNoResultReason(
    result: AutoPlaceResult,
    rejectionReasons = result.analytics?.rejectionReasons,
): AutoSupportNoResultReason {
    if (result.status !== 'placed') return result.status;

    if ((rejectionReasons?.grid_reject_collision ?? 0) >= result.rejectedCandidates && result.rejectedCandidates > 0) return 'collision';
    if ((rejectionReasons?.grid_reject_no_attachment ?? 0) >= result.rejectedCandidates && result.rejectedCandidates > 0) return 'no-attachment';
    if ((rejectionReasons?.trunk_build_error ?? 0) >= result.rejectedCandidates && result.rejectedCandidates > 0) return 'build-error';
    if ((rejectionReasons?.already_supported ?? 0) >= result.rejectedCandidates && result.rejectedCandidates > 0) return 'already-supported';
    return 'placement-rejected';
}

export function buildAutoSupportModelReports(
    reports: readonly AutoSupportModelRunReport[],
    entries: readonly AutoSupportModelEntry[],
    result: AutoPlaceResult,
): AutoSupportModelRunReport[] {
    const resultByModel = new Map(entries.map((entry) => [entry.modelId, result.byModel?.[entry.modelId]]));
    return reports.map((report) => {
        const perModel = resultByModel.get(report.modelId);
        if (report.skipReason) return report;
        const placed = perModel?.placed ?? (entries.length === 1 ? result.placed : null);
        if (!placed) return { ...report, skipReason: 'run-failed' };

        const supportCount = Object.values(placed).reduce((total, count) => total + count, 0);
        const rejectedCandidates = perModel?.rejectedCandidates ?? (entries.length === 1 ? result.rejectedCandidates : undefined);
        const islandsUncovered = perModel?.islandsUncovered ?? (entries.length === 1 ? result.analytics?.islandsUncovered : undefined);
        const outcome = {
            ...(rejectedCandidates !== undefined ? { rejectedCandidates } : {}),
            ...(islandsUncovered !== undefined ? { islandsUncovered } : {}),
        };
        if (supportCount > 0) return { ...report, supportCount, ...outcome };

        const reasonResult: AutoPlaceResult = {
            ...result,
            placed,
            rejectedCandidates: perModel?.rejectedCandidates ?? result.rejectedCandidates,
            status: perModel?.status ?? result.status,
        };
        return {
            ...report,
            supportCount,
            ...outcome,
            skipReason: getAutoSupportNoResultReason(reasonResult, perModel?.rejectionReasons),
        };
    });
}
