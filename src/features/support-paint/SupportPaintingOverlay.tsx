"use client";

import React, { useMemo } from 'react';
import * as THREE from 'three';
import {
  getSupportPaintingPreviewPoints,
  getSupportPaintingVersion,
  subscribeSupportPainting,
} from './supportPainting';

const PREVIEW_COLOR = '#a3e635';

export function SupportPaintingOverlay({
  geometry,
  modelId,
  centerOffset: centerOffsetOverride,
}: {
  geometry: THREE.BufferGeometry;
  modelId: string;
  centerOffset?: THREE.Vector3;
}) {
  const version = React.useSyncExternalStore(
    subscribeSupportPainting,
    getSupportPaintingVersion,
    getSupportPaintingVersion,
  );
  const centerOffset = useMemo(() => {
    const bounds = geometry.boundingBox ?? new THREE.Box3().setFromBufferAttribute(
      geometry.getAttribute('position') as THREE.BufferAttribute,
    );
    return centerOffsetOverride?.clone() ?? bounds.getCenter(new THREE.Vector3());
  }, [centerOffsetOverride, geometry]);
  const preview = useMemo(() => {
    const points = getSupportPaintingPreviewPoints(modelId);
    if (points.length === 0) return null;
    const positions = new Float32Array(points.length * 3);
    points.forEach((point, index) => {
      positions[index * 3] = point.x;
      positions[index * 3 + 1] = point.y;
      positions[index * 3 + 2] = point.z;
    });
    const previewGeometry = new THREE.BufferGeometry();
    previewGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return previewGeometry;
    // The hit list mutates in place; `version` is its invalidation signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, version]);

  React.useEffect(() => () => preview?.dispose(), [preview]);
  if (!preview) return null;

  return (
    <group position={[-centerOffset.x, -centerOffset.y, -centerOffset.z]}>
      <points geometry={preview} renderOrder={1003} raycast={() => null}>
        <pointsMaterial
          color={PREVIEW_COLOR}
          size={8}
          sizeAttenuation={false}
          transparent
          opacity={0.95}
          depthWrite={false}
          depthTest={false}
        />
      </points>
    </group>
  );
}
