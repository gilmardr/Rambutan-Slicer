"use client";

import React from 'react';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { Plural, Trans } from '@lingui/react/macro';
import { AlertTriangle, Eye, ScanSearch, Trash2 } from 'lucide-react';
import { Button, Card, CardHeader } from '@/components/atoms';
import { PanelCollapseToggle } from '@/components/atoms/PanelCollapseToggle';
import { useFloatingPanelCollapse } from '@/components/layout/FloatingPanelStack';
import { useLocaleFormat } from '@/hooks/useLocaleFormat';
import { createCollisionInputs, collisionSceneKey } from '@/features/model-collision/collisionScene';
import { setSuctionCupHighlight } from '@/features/suction-cups/suctionCupHighlights';
import { setSuctionCupSummary } from '@/features/suction-cups/suctionCupReportStore';
import type { SuctionCupFinding, SuctionCupReport, SuctionCupWorkerResponse } from '@/features/suction-cups/suctionCupDetection';
import type { useSceneCollectionManager } from '@/features/scene/useSceneCollectionManager';

type Props = {
  scene: ReturnType<typeof useSceneCollectionManager>;
  active: boolean;
  onFocusFinding: (request: { center: [number, number, number]; radiusMm: number }) => void;
};

function noFindingsMessage(modelName: string) { return msg`No suction cup regions were found on ${modelName}.`; }
function analyzeModelMessage(modelName: string) { return msg`Analyze ${modelName}`; }

export function SuctionCupDetectorPanel({ scene, active, onFocusFinding }: Props) {
  const { _ } = useLingui();
  const fmt = useLocaleFormat();
  const [expanded, setExpanded] = useFloatingPanelCollapse(true);
  const [report, setReport] = React.useState<SuctionCupReport | null>(null);
  const [reportSceneKey, setReportSceneKey] = React.useState<string | null>(null);
  const [selectedFindingId, setSelectedFindingId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const getModifiers = scene.getModelMeshModifiers;
  const activeModel = scene.activeModel;
  const sceneKey = collisionSceneKey(activeModel ? [activeModel] : [], scene.plateFrames, getModifiers);
  const workerRef = React.useRef<Worker | null>(null);
  const runIdRef = React.useRef(0);
  const stale = !!report && reportSceneKey !== sceneKey;
  const selectedFinding = report?.findings.find((finding) => finding.id === selectedFindingId) ?? null;

  React.useEffect(() => {
    if (!stale) return;
    setSuctionCupSummary({ modelId: activeModel?.id ?? null, status: 'stale', findingCount: 0 });
    setSelectedFindingId(null);
    setSuctionCupHighlight(null);
  }, [activeModel?.id, stale]);

  React.useEffect(() => {
    if (active) return;
    if (busy && activeModel) {
      setSuctionCupSummary({ modelId: activeModel.id, status: 'stale', findingCount: 0 });
    }
    runIdRef.current += 1;
    workerRef.current?.terminate();
    workerRef.current = null;
    setBusy(false);
    setSelectedFindingId(null);
    setSuctionCupHighlight(null);
  }, [active, activeModel, busy]);

  React.useEffect(() => () => {
    runIdRef.current += 1;
    workerRef.current?.terminate();
    workerRef.current = null;
    setSuctionCupHighlight(null);
  }, []);

  const runAnalysis = React.useCallback(() => {
    if (!activeModel) return;
    workerRef.current?.terminate();
    const worker = new Worker(new URL('../../../features/suction-cups/suctionCupDetection.worker.ts', import.meta.url), { type: 'module' });
    const requestId = ++runIdRef.current;
    workerRef.current = worker;
    setBusy(true);
    setFailed(false);
    setSuctionCupSummary({ modelId: activeModel.id, status: 'scanning', findingCount: 0 });
    setReport(null);
    setSelectedFindingId(null);
    setSuctionCupHighlight(null);
    setReportSceneKey(sceneKey);
    worker.onmessage = (event: MessageEvent<SuctionCupWorkerResponse>) => {
      if (requestId !== runIdRef.current) return;
      worker.terminate();
      workerRef.current = null;
      setBusy(false);
      if ('report' in event.data) {
        setReport(event.data.report);
        setSuctionCupSummary({ modelId: event.data.report.modelId, status: 'ready', findingCount: event.data.report.findings.length });
        setSelectedFindingId(null);
      } else {
        setFailed(true);
        setSuctionCupSummary({ modelId: activeModel.id, status: 'failed', findingCount: 0 });
      }
    };
    worker.onerror = () => {
      if (requestId !== runIdRef.current) return;
      worker.terminate();
      workerRef.current = null;
      setBusy(false);
      setFailed(true);
      setSuctionCupSummary({ modelId: activeModel.id, status: 'failed', findingCount: 0 });
    };

    const input = createCollisionInputs([activeModel], scene.plateFrames)[0];
    if (!input) {
      worker.terminate();
      workerRef.current = null;
      setBusy(false);
      setFailed(true);
      setSuctionCupSummary({ modelId: activeModel.id, status: 'failed', findingCount: 0 });
      return;
    }
    worker.postMessage(input, [input.positions.buffer, ...(input.indices ? [input.indices.buffer] : [])]);
  }, [activeModel, scene.plateFrames, sceneKey]);

  const showFinding = React.useCallback((finding: SuctionCupFinding) => {
    if (!report || stale) return;
    setSelectedFindingId(finding.id);
    setSuctionCupHighlight({ modelId: report.modelId, surfacePoints: finding.surfacePoints });
    scene.setActiveModelId(report.modelId);
    scene.setSelectedModelIds([report.modelId]);
    onFocusFinding({ center: finding.center, radiusMm: finding.radiusMm });
  }, [onFocusFinding, report, scene, stale]);

  const clearFinding = React.useCallback(() => {
    setSelectedFindingId(null);
    setSuctionCupHighlight(null);
  }, []);

  return (
    <Card>
      <CardHeader
        left={(
          <>
            <PanelCollapseToggle expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>
              {_(msg`Suction Cup Detector`)}
            </h3>
          </>
        )}
      />
      {expanded && (
        <div className="space-y-2 px-2.5 pb-3">
          <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            <Trans>Find concave air pockets that trap resin along the build Z axis. Select a result to highlight it and focus the camera.</Trans>
          </p>
          <Button size="xs" className="w-full" disabled={!activeModel || busy} onClick={runAnalysis}>
            <ScanSearch size={13} />
            {busy ? _(msg`Scanning model…`) : activeModel ? _(analyzeModelMessage(activeModel.name)) : _(msg`Select a model to scan`)}
          </Button>
          {!activeModel && (
            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}><Trans>Select a model before running the detector.</Trans></p>
          )}
          {failed && (
            <p role="alert" className="text-[10px] text-[var(--status-danger)]">
              <Trans>The suction cup scan failed. Try again with a simpler or lower-resolution model.</Trans>
            </p>
          )}
          {stale && (
            <p role="status" className="text-[10px]" style={{ color: 'var(--status-warning)' }}>
              <Trans>The model changed. Run the scan again to refresh these results.</Trans>
            </p>
          )}
          {report && !stale && (
            <>
              <div className="grid grid-cols-[1fr_auto] gap-x-2 text-[9px]" style={{ color: 'var(--text-muted)' }}>
                <span><Trans>Voxel size</Trans></span>
                <span className="text-right tabular-nums">{fmt.quantity(report.voxelSizeMm, 2, 'mm')}</span>
              </div>
              {report.findings.length === 0 ? (
                <div className="flex items-start gap-1.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {report.oddRayColumnRatio > 0.08 && <AlertTriangle size={13} className="shrink-0 text-[var(--status-warning)]" />}
                  <span>{_(noFindingsMessage(activeModel?.name ?? report.modelId))}</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--status-warning)' }}>
                  <AlertTriangle size={13} />
                  <Plural value={report.findings.length} one="# possible suction cup region found." other="# possible suction cup regions found." />
                </div>
              )}
              {report.oddRayColumnRatio > 0.08 && (
                <p className="text-[10px] leading-relaxed" style={{ color: 'var(--status-warning)' }}>
                  <Trans>Some scan rays crossed an odd number of surfaces. The mesh may be open, so review the highlighted regions manually.</Trans>
                </p>
              )}
              {report.reducedPreview && (
                <p className="text-[10px] leading-relaxed" style={{ color: 'var(--status-warning)' }}>
                  <Trans>This model uses reduced preview geometry. Results may miss smaller regions.</Trans>
                </p>
              )}
              {report.findings.map((finding, index) => (
                <div key={finding.id} className="rounded border p-1.5" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-medium" style={{ color: 'var(--text-strong)' }}>
                      <Trans>Region {index + 1}</Trans>
                    </span>
                      <Button size="xs" variant="secondary"
                      style={selectedFindingId === finding.id ? { borderColor: 'var(--accent)' } : undefined}
                      disabled={stale} onClick={() => showFinding(finding)}>
                      <Eye size={12} />
                      <Trans>Show</Trans>
                    </Button>
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-x-2 text-[9px]" style={{ color: 'var(--text-muted)' }}>
                    <span><Trans>Spill depth</Trans></span><span className="text-right tabular-nums">{fmt.quantity(finding.maxSpillDepthMm, 1, 'mm')}</span>
                    <span><Trans>Approx. volume</Trans></span><span className="text-right tabular-nums">{fmt.quantity(finding.estimatedVolumeMm3 / 1000, 2, 'cm3')}</span>
                    <span><Trans>Approx. surface area</Trans></span><span className="text-right tabular-nums">{fmt.quantity(finding.estimatedSurfaceAreaMm2, 1, 'mm2')}</span>
                  </div>
                </div>
              ))}
              {selectedFinding && (
                <Button size="xs" variant="secondary" className="w-full" onClick={clearFinding}>
                  <Trash2 size={12} />
                  <Trans>Clear highlight</Trans>
                </Button>
              )}
              <p className="text-[9px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                <Trans>Voxel estimates are approximate. Clearing a highlight only hides the overlay; it does not change the model.</Trans>
              </p>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
