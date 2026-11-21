"use client";

import React from 'react';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Button, Card, CardHeader } from '@/components/atoms';
import { PanelCollapseToggle } from '@/components/atoms/PanelCollapseToggle';
import { useFloatingPanelCollapse } from '@/components/layout/FloatingPanelStack';
import { NumberInput } from '@/components/ui/NumberInput';
import { useLocaleFormat } from '@/hooks/useLocaleFormat';
import { calculateMeasurement } from '@/features/measurement/distanceMeasurementMath';
import {
  clearDistanceMeasurement,
  getDistanceMeasurementServerSnapshot,
  getDistanceMeasurementSnapshot,
  startDistanceMeasurement,
  setDistanceMeasurementMode,
  stopDistanceMeasurement,
  subscribeToDistanceMeasurement,
} from '@/features/measurement/distanceMeasurementStore';

type DistanceMeasurementCardProps = {
  activeModelId: string | null;
  selectedModelIds: readonly string[];
  onScaleByFactor: (factor: number) => void;
};

export function DistanceMeasurementCard({
  activeModelId,
  selectedModelIds,
  onScaleByFactor,
}: DistanceMeasurementCardProps) {
  const { _ } = useLingui();
  const fmt = useLocaleFormat();
  const [expanded, setExpanded] = useFloatingPanelCollapse(true);
  const [targetDistanceMm, setTargetDistanceMm] = React.useState(0);
  const measurement = React.useSyncExternalStore(
    subscribeToDistanceMeasurement,
    getDistanceMeasurementSnapshot,
    getDistanceMeasurementServerSnapshot,
  );
  const points = measurement.points;
  React.useEffect(() => {
    setTargetDistanceMm(0);
  }, [points]);
  const measurementResult = calculateMeasurement(measurement.mode, points);
  const distance = measurementResult?.distance ?? null;
  const isPointToPoint = measurement.mode === 'point-to-point';
  const requiredPoints = isPointToPoint ? 2 : measurement.mode === 'point-to-plane' ? 4 : 6;
  const measuredModelId = isPointToPoint && points.length === 2 && points[0].modelId === points[1].modelId
    ? points[0].modelId
    : null;
  const canScaleMeasuredModel = measuredModelId != null
    && activeModelId === measuredModelId
    && selectedModelIds.length === 1
    && selectedModelIds[0] === measuredModelId;
  const canApplyTargetDistance = isPointToPoint
    && canScaleMeasuredModel
    && distance != null
    && distance > 0
    && targetDistanceMm > 0
    && Number.isFinite(targetDistanceMm);

  return (
    <Card>
      <CardHeader
        left={(
          <>
            <PanelCollapseToggle expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>
              {measurement.mode === 'point-to-point'
                ? _(msg`Two-Point Distance`)
                : measurement.mode === 'point-to-plane'
                  ? _(msg`Point-to-Plane Distance (experimental)`)
                  : _(msg`Parallel-Plane Distance (experimental)`)}
            </h3>
          </>
        )}
      />

      {expanded && (
        <div className="px-2.5 pb-3 space-y-2">
          <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              {measurement.enabled ? (
                points.length >= requiredPoints && measurementResult == null
                  ? measurement.mode === 'plane-to-plane'
                    ? <Trans>These points do not define parallel planes. Click again to start over.</Trans>
                    : <Trans>These points do not define a valid plane. Click again to start over.</Trans>
                  : measurement.mode === 'point-to-point'
                    ? points.length === 0
                      ? <Trans>Click a point on a model to begin.</Trans>
                      : points.length === 1
                        ? <Trans>First point marked. Click the second point.</Trans>
                        : <Trans>Distance measured. Set a target size below or click again to measure another pair.</Trans>
                    : measurement.mode === 'point-to-plane'
                      ? points.length === 0
                        ? <Trans>Click the point to measure from.</Trans>
                        : points.length === 1
                          ? <Trans>Point marked. Click three points on the plane.</Trans>
                          : <Trans>Click three non-collinear points to define the plane.</Trans>
                      : points.length < 3
                        ? <Trans>Click three non-collinear points on the first plane.</Trans>
                        : <Trans>First plane marked. Click three non-collinear points on a parallel plane.</Trans>
              ) : measurement.mode === 'point-to-point' ? (
                <Trans>Measure the straight-line distance between two points on a model.</Trans>
              ) : measurement.mode === 'point-to-plane' ? (
                <Trans>Measure the perpendicular distance from one point to a plane defined by three clicks.</Trans>
              ) : (
                <Trans>Measure the perpendicular distance between two parallel planes, each defined by three clicks.</Trans>
              )}
          </p>

            <div className="grid grid-cols-3 gap-1" role="group" aria-label={_(msg`Measurement type`)}>
              <Button size="xs" variant={measurement.mode === 'point-to-point' ? 'tinted-accent' : 'secondary'} onClick={() => setDistanceMeasurementMode('point-to-point')}>
                {_(msg`Point to point`)}
              </Button>
              <Button size="xs" variant={measurement.mode === 'point-to-plane' ? 'tinted-accent' : 'secondary'} onClick={() => setDistanceMeasurementMode('point-to-plane')}>
                {_(msg`Point to plane (experimental)`)}
              </Button>
              <Button size="xs" variant={measurement.mode === 'plane-to-plane' ? 'tinted-accent' : 'secondary'} onClick={() => setDistanceMeasurementMode('plane-to-plane')}>
                {_(msg`Parallel planes (experimental)`)}
              </Button>
            </div>

          {distance != null && (
            <div className="flex items-center justify-between rounded px-2 py-1.5" style={{ background: 'var(--surface-2)' }}>
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}><Trans>Distance</Trans></span>
              <strong className="text-xs tabular-nums" style={{ color: 'var(--text-strong)' }}>
                {fmt.quantity(distance, 2, 'mm')}
              </strong>
            </div>
          )}

          {isPointToPoint && distance != null && (
            <>
              <label className="grid grid-cols-[minmax(0,1fr)_5rem_auto] items-center gap-2 text-[11px]" htmlFor="measurement-target-distance">
                <span style={{ color: 'var(--text-muted)' }}><Trans>Target distance</Trans></span>
                <NumberInput
                  id="measurement-target-distance"
                  value={targetDistanceMm}
                  onChange={setTargetDistanceMm}
                  min={0}
                  step={0.1}
                  showStepper={false}
                  aria-label={_(msg`Target distance`)}
                  className="w-full rounded border px-1.5 py-1 text-right text-[11px] tabular-nums"
                  style={{ background: 'var(--surface-2)', borderColor: 'var(--border-default)', color: 'var(--text-strong)' }}
                />
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{fmt.unit('mm', '').trim()}</span>
              </label>
              {measuredModelId == null ? (
                <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  <Trans>Mark both points on the same model to scale it.</Trans>
                </p>
              ) : !canScaleMeasuredModel ? (
                <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  <Trans>Select only the measured model to scale it.</Trans>
                </p>
              ) : null}
              <Button
                size="xs"
                variant="tinted-accent"
                className="w-full"
                disabled={!canApplyTargetDistance || distance == null}
                onClick={() => {
                  if (distance == null || distance <= 0) return;
                  onScaleByFactor(targetDistanceMm / distance);
                }}
              >
                {_(msg`Scale to target distance`)}
              </Button>
            </>
          )}

          <div className="flex gap-1.5">
            <Button
              size="xs"
              variant={measurement.enabled ? 'tinted-warning' : 'tinted-accent'}
              className="flex-1"
              onClick={() => (measurement.enabled ? stopDistanceMeasurement() : startDistanceMeasurement(measurement.mode))}
            >
              {measurement.enabled
                ? _(msg`Stop measuring`)
                : distance != null
                  ? _(msg`Measure again`)
                  : _(msg`Measure distance`)}
            </Button>
            <Button size="xs" variant="secondary" disabled={points.length === 0} onClick={clearDistanceMeasurement}>
              {_(msg`Clear`)}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
