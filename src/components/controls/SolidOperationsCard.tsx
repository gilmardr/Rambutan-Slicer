"use client";

import React from 'react';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Button, Card, CardHeader } from '@/components/atoms';
import { PanelCollapseToggle } from '@/components/atoms/PanelCollapseToggle';
import { useFloatingPanelCollapse } from '@/components/layout/FloatingPanelStack';
import { useLocaleFormat } from '@/hooks/useLocaleFormat';
import type { useSceneCollectionManager } from '@/features/scene/useSceneCollectionManager';
import { solidMeshForModel, geometryFromSolidMesh, snapshotSolidOperationSource, solidMeshBackToModel } from '@/features/mesh-boolean/geometryAdapter';
import { runSolidMeshOperation } from '@/features/mesh-boolean/solidMeshOperationsClient';
import type { BooleanOperation } from '@/features/mesh-boolean/solidMeshOperations';

type Props = { scene: ReturnType<typeof useSceneCollectionManager> };

function hasUnappliedModifiers(modifiers: NonNullable<Props['scene']['activeModel']>['meshModifiers']): boolean {
  return !!(
    (modifiers?.hollowing?.enabled && !modifiers.hollowing.bakedIntoGeometry)
    || (modifiers?.holePunches?.length && !modifiers.holePunchesBakedIntoGeometry)
  );
}

export function SolidOperationsCard({ scene }: Props) {
  const { _ } = useLingui();
  const fmt = useLocaleFormat();
  const [expanded, setExpanded] = useFloatingPanelCollapse(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const selected = React.useMemo(() => scene.models.filter((model) =>
    scene.selectedModelIds.includes(model.id) && model.visible && !model.isSupportGeometry,
  ), [scene.models, scene.selectedModelIds]);
  const active = scene.activeModel;
  const sourcesReady = !selected.some((model) => hasUnappliedModifiers(scene.getModelMeshModifiers(model.id)));
  const activeReady = !!active && !hasUnappliedModifiers(scene.getModelMeshModifiers(active.id));
  const activeSelected = !!active && selected.some((model) => model.id === active.id);
  const lockedPlate = selected.some((model) => scene.isModelPlateLocked(model));
  const validPlate = selected.length >= 2
    && selected.every((model) => scene.resolveModelPlateId(model) === scene.resolveModelPlateId(selected[0]));
  const canBoolean = validPlate && !lockedPlate && sourcesReady && !selected.some((model) => model.geometry.nativePreview);
  const canSplit = activeSelected && !!active && active.visible && !active.isSupportGeometry && !lockedPlate && activeReady
    && !active.geometry.nativePreview;

  const apply = React.useCallback(async (operation: BooleanOperation | 'split') => {
    if (busy || (operation === 'split' ? !canSplit : !canBoolean)) return;
    const sources = operation === 'split'
      ? [active].filter((model): model is NonNullable<typeof model> => !!model && selected.some((item) => item.id === model.id))
      : [
        ...selected.filter((model) => model.id === active?.id),
        ...selected.filter((model) => model.id !== active?.id),
      ];
    if (sources.length < (operation === 'split' ? 1 : 2)) return;
    const snapshots = sources.map((model) => snapshotSolidOperationSource(
      model,
      scene.resolveModelPlateId(model),
      scene.getModelMeshModifiers(model.id),
    ));

    setBusy(true);
    setError('');
    try {
      const meshes = sources.map(solidMeshForModel);
      const result = await runSolidMeshOperation(operation, meshes);
      if (operation === 'split') {
        if (result.length < 2) {
          setError('single-part');
          return;
        }
        const parts = result.map((mesh) => solidMeshBackToModel(mesh, sources[0]));
        if (!scene.splitModelIntoParts(sources[0].id, parts, msg`Split model into parts`, snapshots[0])) {
          parts.forEach((geometry) => geometry.dispose());
          setError('stale-scene');
        }
        return;
      }
      const geometry = geometryFromSolidMesh(result[0]);
      if (!scene.commitSolidOperationResult(geometry, snapshots, operation)) {
        geometry.dispose();
        setError('stale-scene');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'operation-failed');
    } finally {
      setBusy(false);
    }
  }, [active, busy, canBoolean, canSplit, scene, selected]);

  const errorMessage = error === 'not-manifold'
    ? _(msg`Repair all selected meshes before applying a solid operation.`)
    : error === 'empty-result'
      ? _(msg`The operation produced an empty result. Check how the models overlap.`)
      : error === 'cavity-split'
        ? _(msg`This model has an internal cavity. Separate its parts with the cut tool instead.`)
        : error === 'invalid-input'
          ? _(msg`The selected model geometry could not be read.`)
          : error === 'single-part'
            ? _(msg`No disconnected parts were found in this model.`)
            : error === 'stale-scene'
              ? _(msg`A selected model changed while the operation was running. Run it again.`)
              : error
                ? _(msg`The solid operation failed. Repair the mesh and retry.`)
                : '';

  return (
    <Card>
      <CardHeader
        left={(
          <>
            <PanelCollapseToggle expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>
              {_(msg`Solid Operations`)}
            </h3>
          </>
        )}
      />
      {expanded && (
        <div className="space-y-2 px-2.5 pb-3">
          <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {validPlate
            ? activeSelected
              ? <Trans>Combine the selected solids on this build plate. The active model is the base for Difference.</Trans>
              : <Trans>Union and Intersection use the selected models. Select one of them as active to use Difference.</Trans>
          : <Trans>Select two models on one plate for Boolean operations, or select one active model to split its parts.</Trans>}
          </p>
          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {canBoolean
              ? <span>{fmt.number(selected.length)} <Trans>selected models</Trans></span>
              : lockedPlate
                ? <Trans>Unlock the build plate to change these models.</Trans>
                : validPlate
                  ? <Trans>Apply hollowing and hole changes, and refine reduced previews before continuing.</Trans>
                  : null}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <Button size="xs" disabled={busy || !canBoolean} onClick={() => void apply('union')}>
              {busy ? _(msg`Processing…`) : _(msg`Union`)}
            </Button>
            <Button size="xs" disabled={busy || !canBoolean || !activeSelected}
              onClick={() => void apply('difference')}>
              {_(msg`Difference`)}
            </Button>
            <Button size="xs" disabled={busy || !canBoolean} onClick={() => void apply('intersection')}>
              {_(msg`Intersection`)}
            </Button>
            <Button size="xs" disabled={busy || !canSplit}
              onClick={() => void apply('split')}>
              {_(msg`Split parts`)}
            </Button>
          </div>
          {errorMessage && <p role="alert" className="text-[10px] leading-relaxed text-[var(--status-danger)]">{errorMessage}</p>}
        </div>
      )}
    </Card>
  );
}
