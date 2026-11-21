"use client";

import React from 'react';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { AlertTriangle, Check, ScanSearch } from 'lucide-react';
import { Button, Card, CardHeader } from '@/components/atoms';
import { PanelCollapseToggle } from '@/components/atoms/PanelCollapseToggle';
import { useFloatingPanelCollapse } from '@/components/layout/FloatingPanelStack';
import type { useSceneCollectionManager } from '@/features/scene/useSceneCollectionManager';
import { getUnappliedModifiers } from '@/features/mesh-modifiers/unappliedModifiers';
import { collisionSceneKey, createCollisionInputs } from '@/features/model-collision/collisionScene';
import type { CollisionReport, CollisionWorkerResponse } from '@/features/model-collision/modelCollision';

type Props = { scene: ReturnType<typeof useSceneCollectionManager> };

function checkedModelsMessage(count: number) { return msg`Checking ${count} visible models.`; }
function noIntersectionsMessage(count: number) { return msg`No intersections found across ${count} models.`; }
function openMeshesMessage(count: number) { return msg`Open meshes: ${count}`; }
function reducedPreviewsMessage(count: number) { return msg`Reduced previews checked: ${count}`; }
function skippedModelsMessage(count: number) { return msg`Could not check ${count} models with unreadable geometry.`; }

export function ModelCollisionPanel({ scene }: Props) {
  const { _ } = useLingui();
  const [expanded, setExpanded] = useFloatingPanelCollapse(true);
  const [report, setReport] = React.useState<CollisionReport | null>(null);
  const [reportSceneKey, setReportSceneKey] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [sceneChanged, setSceneChanged] = React.useState(false);
  const getModifiers = scene.getModelMeshModifiers;
  const collisionModels = React.useMemo(() => scene.models.filter((model) => {
    if (model.isSupportGeometry) return false;
    const unapplied = getUnappliedModifiers(getModifiers(model.id));
    return !unapplied.hollowing && !unapplied.holePunches;
  }), [getModifiers, scene.models]);
  const sceneKey = collisionSceneKey(scene.models, scene.plateFrames, getModifiers);
  const workerRef = React.useRef<Worker | null>(null);
  const runIdRef = React.useRef(0);

  React.useEffect(() => {
    if (report && reportSceneKey !== sceneKey) setSceneChanged(true);
  }, [report, reportSceneKey, sceneKey]);

  React.useEffect(() => () => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  const runScan = React.useCallback(() => {
    workerRef.current?.terminate();
    const worker = new Worker(new URL('../../features/model-collision/modelCollision.worker.ts', import.meta.url), { type: 'module' });
    const requestId = ++runIdRef.current;
    workerRef.current = worker;
    setBusy(true);
    setFailed(false);
    setSceneChanged(false);
    setReport(null);
    setReportSceneKey(sceneKey);
    worker.onmessage = (event: MessageEvent<CollisionWorkerResponse>) => {
      if (requestId !== runIdRef.current) return;
      worker.terminate();
      workerRef.current = null;
      setBusy(false);
      if ('report' in event.data) setReport(event.data.report);
      else setFailed(true);
    };
    worker.onerror = () => {
      if (requestId !== runIdRef.current) return;
      worker.terminate();
      workerRef.current = null;
      setBusy(false);
      setFailed(true);
    };
    const inputs = createCollisionInputs(collisionModels, scene.plateFrames);
    const transfers = inputs.flatMap((input) => [
      input.positions.buffer,
      ...(input.indices ? [input.indices.buffer] : []),
    ]);
    worker.postMessage(inputs, transfers);
  }, [collisionModels, scene.plateFrames, sceneKey]);

  const modelNames = React.useMemo(() => new Map(scene.models.map((model) => [model.id, model.name])), [scene.models]);
  const checkedCount = report?.checkedModelIds.length ?? 0;
  const hasConcerns = !!report && (
    report.pairs.length > 0 || report.skippedModelIds.length > 0
    || report.previewModelIds.length > 0 || report.openModelIds.length > 0
  );

  return (
    <Card>
      <CardHeader
        left={(
          <>
            <PanelCollapseToggle expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>
              {_(msg`Model Collision Check`)}
            </h3>
          </>
        )}
      />
      {expanded && (
        <div className="space-y-2 px-2.5 pb-3">
          <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            <Trans>Checks visible models on the same plate for surface intersections and one solid inside another.</Trans>
          </p>
          <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            <Trans>Open surfaces may be uncertain. Supports, rafts, and unapplied edits are excluded; reduced previews can miss details.</Trans>
          </p>
          <Button size="xs" className="w-full" disabled={busy} onClick={runScan}>
            <ScanSearch size={13} />
            {busy ? _(msg`Checking models…`) : _(msg`Check for collisions`)}
          </Button>
          {busy && (
            <p role="status" className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {_(checkedModelsMessage(collisionModels.filter((model) => model.visible).length))}
            </p>
          )}
          {failed && (
            <p role="alert" className="text-[10px] text-[var(--status-danger)]">
              <Trans>The model check failed. Try again after reducing the number of models.</Trans>
            </p>
          )}
          {sceneChanged && (
            <p role="status" className="text-[10px]" style={{ color: 'var(--status-warning)' }}>
              <Trans>The scene changed. Check again to refresh this report.</Trans>
            </p>
          )}
          {report && (
            <>
              <div className="flex items-center gap-1.5 text-[11px]" style={{ color: hasConcerns ? 'var(--status-warning)' : 'var(--status-success)' }}>
                {hasConcerns ? <AlertTriangle size={13} /> : <Check size={13} />}
                <span>
                  {hasConcerns
                    ? _(msg`Review this report before slicing.`)
                    : _(noIntersectionsMessage(checkedCount))}
                </span>
              </div>
              {report.pairs.map(({ modelIds, kind }) => {
                const label = kind === 'surface-contact'
                  ? _(msg`Surface intersection`)
                  : kind === 'containment'
                    ? _(msg`One solid is inside the other`)
                    : _(msg`Possible overlap; check these meshes`);
                return (
                  <Button key={modelIds.join(':')} size="xs" variant="secondary" className="w-full justify-between gap-2"
                    onClick={() => {
                      scene.setActiveModelId(modelIds[0]);
                      scene.setSelectedModelIds(modelIds);
                    }}>
                    <span>{modelNames.get(modelIds[0]) ?? modelIds[0]} · {modelNames.get(modelIds[1]) ?? modelIds[1]}</span>
                    <span className="shrink-0 text-[var(--text-muted)]">{label}</span>
                  </Button>
                );
              })}
              {report.openModelIds.length > 0 && (
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {_(openMeshesMessage(report.openModelIds.length))}
                </p>
              )}
              {report.previewModelIds.length > 0 && (
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {_(reducedPreviewsMessage(report.previewModelIds.length))}
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
