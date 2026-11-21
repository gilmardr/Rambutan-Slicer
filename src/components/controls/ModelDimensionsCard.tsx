"use client";

import React from 'react';
import * as THREE from 'three';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Card, CardHeader } from '@/components/atoms';
import { PanelCollapseToggle } from '@/components/atoms/PanelCollapseToggle';
import { useFloatingPanelCollapse } from '@/components/layout/FloatingPanelStack';
import type { LoadedModel } from '@/features/scene/useSceneCollectionManager';
import { useLocaleFormat } from '@/hooks/useLocaleFormat';

type ModelDimensionsCardProps = {
  model: LoadedModel | null;
};

export function ModelDimensionsCard({ model }: ModelDimensionsCardProps) {
  const { _ } = useLingui();
  const fmt = useLocaleFormat();
  const [expanded, setExpanded] = useFloatingPanelCollapse(true);
  const size = React.useMemo(() => {
    if (!model || model.geometry.bbox.isEmpty()) return null;

    const { position, rotation, scale } = model.transform;
    const matrix = new THREE.Matrix4().compose(
      position,
      new THREE.Quaternion().setFromEuler(rotation),
      scale,
    );
    const bounds = model.geometry.bbox.clone().applyMatrix4(matrix);
    const dimensions = bounds.getSize(new THREE.Vector3());
    return [dimensions.x, dimensions.y, dimensions.z].every(Number.isFinite) ? dimensions : null;
  }, [model]);

  return (
    <Card>
      <CardHeader
        left={(
          <>
            <PanelCollapseToggle expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>
              {_(msg`Model Size`)}
            </h3>
          </>
        )}
      />

      {expanded && (
        <div className="px-2.5 pb-3 space-y-2">
          {size ? (
            <>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-[11px]">
                <span style={{ color: 'var(--text-muted)' }}><Trans>Width (X)</Trans></span>
                <span className="tabular-nums" style={{ color: 'var(--text-strong)' }}>{fmt.quantity(size.x, 2, 'mm')}</span>
                <span style={{ color: 'var(--text-muted)' }}><Trans>Depth (Y)</Trans></span>
                <span className="tabular-nums" style={{ color: 'var(--text-strong)' }}>{fmt.quantity(size.y, 2, 'mm')}</span>
                <span style={{ color: 'var(--text-muted)' }}><Trans>Height (Z)</Trans></span>
                <span className="tabular-nums" style={{ color: 'var(--text-strong)' }}>{fmt.quantity(size.z, 2, 'mm')}</span>
              </div>
              <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                <Trans>Axis-aligned bounds use the current rotation and scale.</Trans>
              </p>
            </>
          ) : (
            <p className="text-[10px] italic text-center" style={{ color: 'var(--text-muted)' }}>
              <Trans>Select a model with readable geometry to view its size.</Trans>
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
