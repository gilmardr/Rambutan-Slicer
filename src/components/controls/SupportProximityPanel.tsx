"use client";

import React from 'react';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { Plural, Trans } from '@lingui/react/macro';
import { AlertTriangle, Check, ScanSearch } from 'lucide-react';
import { Button, Card, CardHeader } from '@/components/atoms';
import { NumberInput } from '@/components/ui/NumberInput';
import { PanelCollapseToggle } from '@/components/atoms/PanelCollapseToggle';
import { useFloatingPanelCollapse } from '@/components/layout/FloatingPanelStack';
import { useLocaleFormat } from '@/hooks/useLocaleFormat';
import type { useSceneCollectionManager } from '@/features/scene/useSceneCollectionManager';
import { collisionSceneKey } from '@/features/model-collision/collisionScene';
import { createSupportProximityInput } from '@/features/support-proximity/proximityScene';
import type { SupportProximityReport, SupportProximityWorkerResponse } from '@/features/support-proximity/supportProximity';
import { setSupportProximityHighlightedIds } from '@/features/support-proximity/supportProximityHighlights';
import { getSnapshot as getSupportSnapshot, setSelectedId, subscribe as subscribeSupportState } from '@/supports/state';
import type { SupportEntityAny } from '@/supports/types';

type Props = { scene: ReturnType<typeof useSceneCollectionManager> };

function checkedModelsMessage(count: number) { return msg`Checking supports on ${count} visible models.`; }
function noConcernsMessage(count: number) { return msg`No supports are too close across ${count} models.`; }
function skippedModelsMessage(count: number) { return msg`Could not check supports on ${count} models with unreadable geometry.`; }
function supportLabel(id: string) { return msg`Support ${id.slice(0, 8)}`; }

export function SupportProximityPanel({ scene }: Props) {
  const { _ } = useLingui();
  const fmt = useLocaleFormat();
  const [expanded, setExpanded] = useFloatingPanelCollapse(true);
  const [thresholdMm, setThresholdMm] = React.useState(0.5);
  const [report, setReport] = React.useState<SupportProximityReport | null>(null);
  const [reportSceneKey, setReportSceneKey] = React.useState<string | null>(null);
  const [reportSupportMap, setReportSupportMap] = React.useState<Record<string, SupportEntityAny> | null>(null);
  const [reportThresholdMm, setReportThresholdMm] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [sceneChanged, setSceneChanged] = React.useState(false);
  const supportState = React.useSyncExternalStore(subscribeSupportState, getSupportSnapshot, getSupportSnapshot);
  const getModifiers = scene.getModelMeshModifiers;
  const sceneKey = collisionSceneKey(scene.models, scene.plateFrames, getModifiers);
  const workerRef = React.useRef<Worker | null>(null);
  const runIdRef = React.useRef(0);
  const stale = !!report && (
    reportSceneKey !== sceneKey
    || reportSupportMap !== (supportState.supports ?? null)
    || reportThresholdMm !== thresholdMm
  );

  React.useEffect(() => {
    if (stale) {
      setSceneChanged(true);
      setSupportProximityHighlightedIds([]);
    }
  }, [stale]);

  React.useEffect(() => () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setSupportProximityHighlightedIds([]);
  }, []);

  const runScan = React.useCallback(() => {
    workerRef.current?.terminate();
    const worker = new Worker(new URL('../../features/support-proximity/supportProximity.worker.ts', import.meta.url), { type: 'module' });
    const requestId = ++runIdRef.current;
    workerRef.current = worker;
    setBusy(true);
    setFailed(false);
    setSceneChanged(false);
    setReport(null);
    setSupportProximityHighlightedIds([]);
    setReportSceneKey(sceneKey);
    setReportSupportMap(supportState.supports ?? null);
    setReportThresholdMm(thresholdMm);
    worker.onmessage = (event: MessageEvent<SupportProximityWorkerResponse>) => {
      if (requestId !== runIdRef.current) return;
      worker.terminate();
      workerRef.current = null;
      setBusy(false);
      if ('report' in event.data) {
        setReport(event.data.report);
        setSupportProximityHighlightedIds(event.data.report.issues.map((issue) => issue.supportId));
      } else {
        setFailed(true);
        setSupportProximityHighlightedIds([]);
      }
    };
    worker.onerror = () => {
      if (requestId !== runIdRef.current) return;
      worker.terminate();
      workerRef.current = null;
      setBusy(false);
      setFailed(true);
      setSupportProximityHighlightedIds([]);
    };

    const input = createSupportProximityInput(scene.models, scene.plateFrames, supportState, thresholdMm, getModifiers);
    const transfers = input.models.flatMap((model) => [
      model.positions.buffer,
      ...(model.indices ? [model.indices.buffer] : []),
    ]);
    worker.postMessage(input, transfers);
  }, [getModifiers, scene.models, scene.plateFrames, sceneKey, supportState, thresholdMm]);

  const modelNames = React.useMemo(() => new Map(scene.models.map((model) => [model.id, model.name])), [scene.models]);
  const checkedCount = report?.checkedModelIds.length ?? 0;

  return (
    <Card>
      <CardHeader
        left={(
          <>
            <PanelCollapseToggle expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>
              {_(msg`Support Proximity`)}
            </h3>
          </>
        )}
      />
      {expanded && (
        <div className="space-y-2 px-2.5 pb-3">
          <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            <Trans>Find support shafts whose surface is closer to a model than the clearance threshold. The contact area is ignored.</Trans>
          </p>
          <label className="grid grid-cols-[minmax(0,1fr)_5rem_auto] items-center gap-2 text-[11px]" htmlFor="support-proximity-threshold">
            <span style={{ color: 'var(--text-muted)' }}><Trans>Clearance threshold</Trans></span>
            <NumberInput
              id="support-proximity-threshold"
              value={thresholdMm}
              onChange={(value) => setThresholdMm(Math.max(0.1, Math.min(3, value)))}
              min={0.1}
              max={3}
              step={0.1}
              showStepper={false}
              aria-label={_(msg`Clearance threshold`)}
              className="w-full rounded border px-1.5 py-1 text-right text-[11px] tabular-nums"
              style={{ background: 'var(--surface-2)', borderColor: 'var(--border-default)', color: 'var(--text-strong)' }}
            />
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{fmt.unit('mm', '').trim()}</span>
          </label>
          <Button size="xs" className="w-full" disabled={busy} onClick={runScan}>
            <ScanSearch size={13} />
            {busy ? _(msg`Checking supports…`) : _(msg`Check support proximity`)}
          </Button>
          {busy && (
            <p role="status" className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {_(checkedModelsMessage(scene.models.filter((model) => model.visible && !model.isSupportGeometry).length))}
            </p>
          )}
          {failed && (
            <p role="alert" className="text-[10px] text-[var(--status-danger)]">
              <Trans>The support proximity check failed. Try again after reducing the number of models.</Trans>
            </p>
          )}
          {sceneChanged && (
            <p role="status" className="text-[10px]" style={{ color: 'var(--status-warning)' }}>
              <Trans>The scene or supports changed. Check again to refresh this report.</Trans>
            </p>
          )}
          {report && (
            <>
              <div className="flex items-center gap-1.5 text-[11px]" style={{ color: report.issues.length || report.skippedModelIds.length ? 'var(--status-warning)' : 'var(--status-success)' }}>
                {report.issues.length || report.skippedModelIds.length ? <AlertTriangle size={13} /> : <Check size={13} />}
                <span>
                  {report.issues.length === 0 && report.skippedModelIds.length === 0
                    ? _(noConcernsMessage(checkedCount))
                    : <Plural value={report.issues.length} one="# support needs review." other="# supports need review." />}
                </span>
              </div>
              {report.issues.map((issue) => (
                <Button key={issue.supportId} size="xs" variant="secondary" className="w-full justify-between gap-2"
                  onClick={() => {
                    scene.setActiveModelId(issue.modelId);
                    scene.setSelectedModelIds([issue.modelId]);
                    setSelectedId(issue.supportId);
                  }}>
                  <span>{modelNames.get(issue.modelId) ?? issue.modelId} · {_(supportLabel(issue.supportId))}</span>
                  <span className="shrink-0 tabular-nums text-[var(--status-warning)]">{fmt.quantity(issue.clearanceMm, 2, 'mm')}</span>
                </Button>
              ))}
              {report.issues.length > 0 && !stale && (
                <p className="text-[10px] leading-relaxed" style={{ color: 'var(--status-danger)' }}>
                  <Trans>Supports in this report are highlighted red in the viewport.</Trans>
                </p>
              )}
              {report.skippedModelIds.length > 0 && (
                <p className="text-[10px]" style={{ color: 'var(--status-warning)' }}>
                  {_(skippedModelsMessage(report.skippedModelIds.length))}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}
