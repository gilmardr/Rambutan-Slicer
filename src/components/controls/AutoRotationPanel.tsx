"use client";

import React from 'react';
import * as THREE from 'three';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Button, Card, CardHeader, Select } from '@/components/atoms';
import { PanelCollapseToggle } from '@/components/atoms/PanelCollapseToggle';
import { useFloatingPanelCollapse } from '@/components/layout/FloatingPanelStack';
import { quaternionFromGlobalEuler } from '@/utils/rotation';
import {
  suggestOrientationForGeometry,
  composeOrientationDelta,
  type OrientationObjective,
  type OrientationAlternative,
  type AdvisorOptions,
  type OrientationSuggestion,
} from '@/supports/autoSupport/orientationAdvisor';
import type { OrientationToastReport } from '@/features/notifications/useEditorToasts';
import {
  getSupportBlockedCount,
  clearSupportBlockers,
  getSupportBlockedTriangles,
  subscribeSupportBlockers,
  getSupportBlockersVersion,
  getSupportBlockerBrushSizeMm,
  setSupportBlockerBrushSizeMm,
  SUPPORT_BLOCKER_BRUSH_MIN_MM,
  SUPPORT_BLOCKER_BRUSH_MAX_MM,
} from '@/supports/autoSupport/supportBlockers';
import { useLocaleFormat } from '@/hooks/useLocaleFormat';

/** Set while an orient sweep runs. Page-level overlay reads this to show the
 *  "Orienting Model" modal. Module-level (not state) so the panel can flip it
 *  around the synchronous sweep; the page subscribes via the stable getter.
 *  Mirrors the auto-support busy chain in AutoSupportPanel. */
let _orientationBusy = false;
const _orientationBusyListeners = new Set<() => void>();

export function getOrientationBusy(): boolean { return _orientationBusy; }
export function subscribeOrientationBusy(fn: () => void): () => void {
  _orientationBusyListeners.add(fn);
  return () => _orientationBusyListeners.delete(fn);
}
export function setOrientationBusy(v: boolean): void {
  if (_orientationBusy !== v) {
    _orientationBusy = v;
    for (const fn of _orientationBusyListeners) fn();
  }
}

/** Elapsed timer for the orient busy modal. Mounts with the modal so the
 *  interval lifetime matches visibility exactly (same shape as the islands
 *  timer: 250 ms ticks, m:ss label). */
export function OrientElapsed() {
  const [sec, setSec] = React.useState(0);
  React.useEffect(() => {
    const startedAt = Date.now();
    const id = window.setInterval(() => setSec(Math.floor((Date.now() - startedAt) / 1000)), 250);
    return () => window.clearInterval(id);
  }, []);
  const minutes = Math.floor(sec / 60);
  const seconds = sec % 60;
  const elapsed = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  return <Trans>Elapsed: {elapsed}</Trans>;
}

/** Module-level labels (React Compiler must not rename Lingui locals). */
const TITLE = msg`Auto Orientation (Beta)`;
const ORIENT = msg`Compare orientations`;
const OPT_SUPPORTS = msg`Lowest support consumption`;
const OPT_SAFETY = msg`Highest print safety`;
const OPT_SCARRING = msg`Best surface quality`;
const RANK_REASON = {
  safety: msg`Ranks lower peel loads, smaller area jumps and fewer islands first.`,
  scarring: msg`Ranks poses that keep support contacts away from fine details and protected faces first.`,
  supports: msg`Ranks poses with less unsupported area and shorter gaps to support first.`,
  height: msg`Ranks shorter poses first.`,
};
const NO_MODEL = msg`Load a model to get an orientation suggestion.`;
const NO_GEOMETRY = msg`Active model has no readable geometry.`;
const ANALYSIS_FAILED = msg`Orientation analysis could not be completed.`;
const BLOCKERS = msg`Blockers`;
const CLEAR_BLOCKERS = msg`Clear`;
const DONE_BLOCKERS = msg`Done`;
const PAINT_LEAD = msg`Paint areas to keep support-free. Orientation avoids them.`;
const BLOCKERS_HINT = msg`Paint nogo areas for supports. Blocked contact is refused when generating supports and avoided when orienting.`;
const PAINT_TITLE = msg`Blocker Painting Mode`;
const BLOCKER_ACTION_TEXT = { color: 'var(--accent-secondary-action-color)', fontWeight: 600 } as const;
const BRUSH_SIZE = msg`Brush Size`;

function OrientationAreaProfile({ areas, peak }: { areas: readonly number[]; peak: number }) {
  const { _ } = useLingui();
  const bins = new Array<number>(Math.min(32, areas.length)).fill(0);
  for (let i = 0; i < areas.length; i += 1) {
    const bin = Math.floor(i * bins.length / areas.length);
    bins[bin] = Math.max(bins[bin], areas[i]);
  }
  if (peak <= 0) return null;
  return (
    <div role="img" aria-label={_(msg`Estimated cured area from the first layer to the last`)} className="flex h-5 items-end gap-px">
      {bins.map((area, index) => (
        <span key={index} aria-hidden="true" className="flex-1 rounded-t-sm bg-[var(--accent)]" style={{ height: `${100 * area / peak}%` }} />
      ))}
    </div>
  );
}

export interface AutoRotationPanelProps {
  activeModelId?: string;
  geometry?: THREE.BufferGeometry;
  scale?: THREE.Vector3;
  autoLift?: boolean;
  layerHeightMm?: number;
  /** Live scene rotation (world frame the suggestion is computed in). */
  currentRotation?: THREE.Euler;
  /** Applies the optional tilt and arranges the plate, possibly after confirmation. */
  onApplyRotation?: (modelId: string, rotation: THREE.Euler | undefined, onComplete: (applied: boolean) => void) => void;
  /** Display name for the toast receipt; falls back to the model id. */
  activeModelName?: string;
  /** Shell-toast receipt for the orient run (data only — the stack renders it). */
  onOrientationReport?: (report: Omit<OrientationToastReport, 'id'>) => void;
  /** Whether the scene is in support-blocker paint mode. */
  blockersActive?: boolean;
  /** Toggles support-blocker paint mode in the scene. */
  onToggleBlockers?: () => void;
}

export type AutomaticOrientationSuggestion = { status: 'unavailable' } | (
  ({ status: 'already-optimal' } | { status: 'suggested'; rotation: THREE.Euler })
  & { alternatives?: OrientationAlternative[] }
);

/** Resolve the current model's best support-oriented rotation without mutating the scene. */
export async function getAutomaticOrientationSuggestion(
  activeModelId: string,
  geometry: THREE.BufferGeometry | undefined,
  currentRotation?: THREE.Euler,
  objective: OrientationObjective = 'supports',
  scale?: THREE.Vector3,
  autoLift = false,
  layerHeightMm?: number,
): Promise<AutomaticOrientationSuggestion> {
  const position = geometry?.getAttribute('position');
  if (!position || position.count < 3) return { status: 'unavailable' };

  const baked = new Float32Array(position.count * 3);
  const quaternion = quaternionFromGlobalEuler(currentRotation);
  const vertex = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    vertex.fromBufferAttribute(position, i);
    if (scale) vertex.multiply(scale);
    vertex.applyQuaternion(quaternion).toArray(baked, i * 3);
  }

  const sourceIndex = geometry?.getIndex()?.array;
  const index = sourceIndex ? Uint32Array.from(sourceIndex) : null;
  const blocked = getSupportBlockedTriangles(activeModelId);
  const options: AdvisorOptions = { objective, avoidParallelFaces: autoLift, layerHeightMm, blockedTriangleIndices: blocked };
  const result = typeof Worker === 'undefined'
    ? suggestOrientationForGeometry({ attributes: { position: { array: baked } }, index }, options)
    : await new Promise<OrientationSuggestion>((resolve, reject) => {
      const worker = new Worker(new URL('../../supports/autoSupport/orientationAdvisor.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }: MessageEvent<{ result?: OrientationSuggestion; error?: string }>) => {
        worker.terminate();
        if (data.result) resolve(data.result);
        else reject(new Error(data.error ?? 'Orientation worker returned no result'));
      };
      worker.onerror = (event) => {
        worker.terminate();
        reject(new Error(event.message));
      };
      worker.postMessage({ mesh: { positions: baked, index }, options }, index ? [baked.buffer, index.buffer] : [baked.buffer]);
    });
  if (!result) return { status: 'unavailable' };

  if (result.rotXDeg === 0 && result.rotYDeg === 0) return { status: 'already-optimal', alternatives: result.alternatives };

  return {
    status: 'suggested',
    rotation: composeOrientationDelta(currentRotation, result.rotXDeg, result.rotYDeg),
    alternatives: result.alternatives,
  };
}

export function AutoRotationPanel({ activeModelId, activeModelName, geometry, scale, autoLift, layerHeightMm = 0.05, currentRotation, onApplyRotation, onOrientationReport, blockersActive, onToggleBlockers }: AutoRotationPanelProps) {
  const { _ } = useLingui();
  const fmt = useLocaleFormat();
  // Named exactly as the ICU placeholders in the blocker hint below: the Trans
  // macro takes the placeholder names from these identifiers.
  const clearLabel = _(CLEAR_BLOCKERS);
  const doneLabel = _(DONE_BLOCKERS);
  const [expanded, setExpanded] = useFloatingPanelCollapse(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const brushSizeMm = getSupportBlockerBrushSizeMm();
  const [objective, setObjective] = React.useState<OrientationObjective>('safety');
  const [alternatives, setAlternatives] = React.useState<OrientationAlternative[]>([]);
  const analysisRevision = React.useRef(0);
  const profilePeak = Math.max(0, ...alternatives.map(({ layers }) => layers.peakAreaMm2));
  // Support-blocker mask version for the active model (drives Clear).
  const blockersVersion = React.useSyncExternalStore(subscribeSupportBlockers, getSupportBlockersVersion, getSupportBlockersVersion);
  const blockedCount = activeModelId ? getSupportBlockedCount(activeModelId) : 0;

  // A new model or goal clears a stale error.
  React.useEffect(() => {
    setError(null);
    setAlternatives([]);
    return () => { analysisRevision.current += 1; };
  }, [activeModelId, geometry, currentRotation, scale, objective, layerHeightMm, autoLift, blockersVersion]);

  const applyAlternative = (alternative: OrientationAlternative) => {
    if (!activeModelId || !onApplyRotation) return;
    const { rotXDeg, rotYDeg } = alternative;
    const rotation = rotXDeg || rotYDeg ? composeOrientationDelta(currentRotation, rotXDeg, rotYDeg) : undefined;
    onApplyRotation(activeModelId, rotation, (applied) => {
      if (!applied) return;
      setAlternatives([]);
      onOrientationReport?.({ status: rotation ? 'applied' : 'already-optimal', modelName: activeModelName ?? activeModelId });
    });
  };

  const handleOrient = React.useCallback(() => {
    setError(null);
    if (!activeModelId) {
      setError(_(NO_MODEL));
      return;
    }
    if (!onApplyRotation || getOrientationBusy()) return;
    const revision = analysisRevision.current;
    setAlternatives([]);
    setBusy(true);
    setOrientationBusy(true);
    requestAnimationFrame(() => {
      void (async () => {
        try {
          const suggestion = await getAutomaticOrientationSuggestion(activeModelId, geometry, currentRotation, objective, scale, autoLift, layerHeightMm);
          if (analysisRevision.current !== revision) return;
          if (suggestion.status === 'unavailable') {
            setError(_(NO_GEOMETRY));
            return;
          }
          if (suggestion.alternatives?.length) setAlternatives(suggestion.alternatives);
          else setError(_(ANALYSIS_FAILED));
        } catch (error) {
          console.error('[AutoOrientation] analysis failed:', error);
          if (analysisRevision.current === revision) setError(_(ANALYSIS_FAILED));
        } finally {
          setBusy(false);
          setOrientationBusy(false);
        }
      })();
    });
  }, [activeModelId, geometry, scale, autoLift, layerHeightMm, currentRotation, objective, onApplyRotation, _]);

  return (
    <Card>
      <CardHeader
        left={(
          <>
            <PanelCollapseToggle expanded={expanded} onToggle={() => setExpanded((prev) => !prev)} />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>{_(TITLE)}</h3>
          </>
        )}
      />

      {expanded && (
        <div className="px-2.5 pb-3 space-y-2.5">
          {blockersActive ? (
            <div
              className="rounded-md border p-2 space-y-1.5 text-center min-h-[4.5rem] box-border"
              style={{
                borderColor: 'var(--accent-secondary-action-border)',
                background: 'var(--accent-secondary-action-bg-92)',
              }}
            >
              <div className="ui-meta font-semibold" style={BLOCKER_ACTION_TEXT}>{_(PAINT_TITLE)}</div>
              <div className="flex items-start justify-center min-h-8">
                <p className="text-[10px] leading-snug line-clamp-2" style={{ color: 'var(--text-muted)' }}>
                  {_(PAINT_LEAD)}<br />
                  <Trans comment="Sits under the Blocker Painting Mode heading. {clearLabel} and {doneLabel} are the Clear and Done button labels; keep them as placeholders so the two always match the buttons.">
                    Press <span style={BLOCKER_ACTION_TEXT}>{clearLabel}</span> to reset all, or <span style={BLOCKER_ACTION_TEXT}>{doneLabel}</span> to apply.
                  </Trans>
                </p>
              </div>
            </div>
          ) : (
            <div className="flex gap-1.5">
              <Button
                type="button"
                onClick={() => { void handleOrient(); }}
                disabled={busy || !activeModelId}
                size="auto"
                className="flex-1 !h-8 text-[11px] disabled:opacity-50"
                style={{
                  borderColor: 'var(--accent)',
                  background: 'color-mix(in srgb, var(--accent), var(--surface-0) 86%)',
                  color: 'var(--accent)',
                }}
              >
                {busy ? _(msg`Analyzing…`) : _(ORIENT)}
              </Button>
              <Button
                type="button"
                onClick={() => { onToggleBlockers?.(); }}
                disabled={busy || !activeModelId || !onToggleBlockers}
                variant="secondary"
                size="auto"
                className="flex-1 !h-8 text-[11px] disabled:opacity-50"
                title={_(BLOCKERS_HINT)}
              >
                {_(BLOCKERS)}
              </Button>
            </div>
          )}
          {blockersActive ? (
            <div className="flex flex-col gap-1">
              <label className="ui-meta flex justify-between">
                <span>{_(BRUSH_SIZE)}</span>
                <span>{fmt.quantity(brushSizeMm, 1, 'mm')}</span>
              </label>
              <input
                type="range"
                min={SUPPORT_BLOCKER_BRUSH_MIN_MM}
                max={SUPPORT_BLOCKER_BRUSH_MAX_MM}
                step={0.5}
                value={brushSizeMm}
                onChange={(e) => setSupportBlockerBrushSizeMm(parseFloat(e.target.value))}
                disabled={busy || !activeModelId}
                className="ui-range"
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <Select
                aria-label={_(msg`Orientation objective`)}
                style={{ textAlign: 'center', background: 'var(--surface-1)' }}
                value={objective}
                onChange={(e) => setObjective(e.target.value as OrientationObjective)}
                disabled={busy || !activeModelId}
              >
                <option value="supports">{_(OPT_SUPPORTS)}</option>
                <option value="safety">{_(OPT_SAFETY)}</option>
                <option value="scarring">{_(OPT_SCARRING)}</option>
              </Select>
            </div>
          )}
          {!blockersActive && alternatives.length > 0 && (
            <div className="space-y-2" aria-live="polite">
              <p className="ui-meta"><Trans>Estimated from sampled layers (Experimental)</Trans></p>
              <p className="ui-meta">{_(RANK_REASON[objective])}</p>
              {alternatives.map((alternative, index) => {
                const { cost, layers, rotXDeg, rotYDeg } = alternative;
                const area = (value: number) => fmt.quantity(value, 1, 'mm2');
                return (
                  <div key={`${rotXDeg}/${rotYDeg}`} className="rounded-md border border-[var(--border-subtle)] p-2 text-xs space-y-1">
                    <div className="font-semibold">{index + 1}. X {fmt.quantity(rotXDeg, 1, 'degree')} · Y {fmt.quantity(rotYDeg, 1, 'degree')}</div>
                    <OrientationAreaProfile areas={layers.layerAreasMm2} peak={profilePeak} />
                    <dl className="grid grid-cols-[1fr_auto] gap-x-2">
                      <dt><Trans>Peak layer area</Trans></dt><dd>{area(layers.peakAreaMm2)}</dd>
                      <dt><Trans>Peel load vs. current pose</Trans></dt><dd>{alternative.relativePeelLoadPercent > 0 ? fmt.quantity(alternative.relativePeelLoadPercent, 0, 'percent') : '—'}</dd>
                      <dt><Trans>Largest layer area increase</Trans></dt><dd>{area(layers.peakAreaIncreaseMm2)}</dd>
                      <dt><Trans>Potential suction area</Trans></dt><dd>{area(layers.peakTrappedAreaMm2)}</dd>
                      <dt><Trans>Unsupported islands</Trans></dt><dd>{fmt.fixed(layers.unsupportedIslands, 0)}</dd>
                      <dt><Trans>Overhang area</Trans></dt><dd>{area(cost.overhangAreaMm2)}</dd>
                      <dt><Trans>Support demand index</Trans></dt><dd>{fmt.fixed(layers.supportDemandMm3, 1)}</dd>
                      <dt><Trans>Scarring score</Trans></dt><dd>{fmt.fixed(cost.scarAreaMm2, 1)}</dd>
                      {blockedCount > 0 && <><dt><Trans>Contact on protected faces</Trans></dt><dd>{area(cost.blockedAreaMm2)}</dd></>}
                    </dl>
                    <Button type="button" size="auto" onClick={() => applyAlternative(alternative)}><Trans>Apply orientation</Trans></Button>
                  </div>
                );
              })}
            </div>
          )}
          {blockersActive && (
            <div className="flex gap-1.5">
              <Button
                type="button"
                onClick={() => { if (activeModelId) clearSupportBlockers(activeModelId); }}
                disabled={busy || blockedCount === 0}
                variant="secondary"
                size="auto"
                className="flex-1 !h-8 text-[11px] disabled:opacity-50"
              >
                {_(CLEAR_BLOCKERS)}
              </Button>
              <Button
                type="button"
                onClick={() => { onToggleBlockers?.(); }}
                disabled={busy}
                variant="accent"
                size="auto"
                className="flex-1 !h-8 text-[11px] disabled:opacity-50"
              >
                {_(DONE_BLOCKERS)}
              </Button>
            </div>
          )}

          {error && (
            <p className="text-[11px]" style={{ color: '#f87171' }}>{error}</p>
          )}
        </div>
      )}
    </Card>
  );
}
