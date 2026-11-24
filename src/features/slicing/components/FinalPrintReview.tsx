'use client';

import React, { useState } from 'react';
import type { Vector3 } from 'three';
import { Trans } from '@lingui/react/macro';
import { Button } from '@/components/atoms';
import { ModelCollisionPanel } from '@/components/controls/ModelCollisionPanel';
import { collisionSceneKey } from '@/features/model-collision/collisionScene';
import type { LoadedModel, useSceneCollectionManager } from '@/features/scene/useSceneCollectionManager';
import type { UseIslandsReturn } from '@/volumeAnalysis/Islands/useIslands';
import { checkFinalPrintRegions } from '@/features/support-check/checkFinalPrintRegions';
import type { HolePunchPlacementState } from '@/features/hole-punching/holePunchGeometry';
import type { HolePunchVerificationResult } from '@/features/hole-punching/holePunchVerification';

type Props = {
  scene: ReturnType<typeof useSceneCollectionManager>;
  islands: UseIslandsReturn;
  model: LoadedModel;
  placements: readonly HolePunchPlacementState[];
  holes: readonly HolePunchVerificationResult[];
  verifyHoles: () => void;
  canVerifyHoles: boolean;
  supportState: object;
  raftState: object;
  onLocate: (point: [number, number, number]) => void;
};

function Locations({ points, onLocate }: { points: Vector3[]; onLocate: Props['onLocate'] }) {
  const [limit, setLimit] = useState(20);
  return <div className="max-h-40 overflow-y-auto space-y-1">
    {points.slice(0, limit).map((p, index) => <Button key={index} size="xs" variant="secondary" onClick={() => onLocate(p.toArray())}>
      #{index + 1} · {p.toArray().map(n => n.toFixed(1)).join(', ')} mm
    </Button>)}
    {points.length > limit && <Button size="xs" onClick={() => setLimit(limit + 20)}><Trans>Show more</Trans></Button>}
  </div>;
}

export function FinalPrintReview(props: Props) {
  const { scene, model, islands, onLocate } = props;
  const signature = collisionSceneKey([model], scene.plateFrames, scene.getModelMeshModifiers);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [islandError, setIslandError] = useState(false);
  const [floating, setFloating] = useState<{
    signature: string; supports: object; raft: object; points: Vector3[];
  } | null>(null);
  const key = [signature, islands.layerHeightMm, islands.pxMm, islands.minAreaMm2, islands.connectivity].join('|');
  const current = floating?.signature === key && floating.supports === props.supportState && floating.raft === props.raftState ? floating : null;
  async function checkFloating() {
    setBusy(true);
    setFloating(null);
    setError(false);
    try {
      await new Promise(resolve => setTimeout(resolve, 0));
      const points = await checkFinalPrintRegions(model, islands);
      setFloating({ signature: key, supports: props.supportState, raft: props.raftState,
        points });
    } catch (cause) {
      console.error("[FinalPrintReview] Floating region scan failed", cause);
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  const open = islands.annotatedIslands.filter(i => !i.supported && !i.grounded);
  return <div className="space-y-2 text-xs">
    <strong><Trans>Final review</Trans> · {model.name}</strong>
    <div><Button size="xs" disabled={busy || islands.scanning} onClick={() => void islands.onRunScan().catch(cause => {
      console.error("[FinalPrintReview] Island scan failed", cause);
      setIslandError(true);
    })}><Trans>Scan islands</Trans></Button>
      <div role="status">{islands.scanning ? <Trans>Checking…</Trans> : islands.islandScanComplete ? <><Trans>Unsupported islands</Trans> · {open.length}</> : islandError ? <Trans>Scan failed</Trans> : <Trans>Not analyzed</Trans>}</div>
      <Locations points={open.map(i => i.contact)} onLocate={onLocate} />
    </div>
    <div><Button size="xs" disabled={busy || islands.scanning} onClick={() => void checkFloating()}><Trans>Check for floating regions</Trans></Button>
      <div role="status">{busy ? <Trans>Checking…</Trans> : error ? <Trans>Scan failed</Trans> : current ? <><Trans>Floating regions</Trans> · {current.points.length}</> : <Trans>Not analyzed</Trans>}</div>
      {current && <Locations points={current.points} onLocate={onLocate} />}
    </div>
    <div><Button size="xs" disabled={!props.canVerifyHoles} onClick={props.verifyHoles}><Trans>Verify drain holes</Trans></Button>
      <div role="status">{!props.placements.length ? <Trans>No drain holes placed</Trans> : !props.holes.length ? <Trans>Not analyzed</Trans> : <><Trans>Confirmed drain holes</Trans> · {props.holes.filter(hole => hole.status === "confirmed").length} / {props.placements.length}</>}</div>
      {props.holes.map((hole, i) => {
        if (hole.status === 'confirmed') return null;
        const placement = props.placements.find(p => p.id === hole.placementId && p.modelId === model.id);
        return <Button size="xs" key={hole.placementId} disabled={!placement} onClick={() => placement && onLocate(placement.worldPoint.toArray())}>
          #{i + 1} · {hole.status === 'too-shallow' ? <Trans>Too shallow</Trans> : <Trans>Uncertain</Trans>}
        </Button>;
      })}
    </div>
    <ModelCollisionPanel scene={scene} onLocate={onLocate} />
  </div>;
}
