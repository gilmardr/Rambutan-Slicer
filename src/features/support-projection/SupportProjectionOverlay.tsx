"use client";

import React, { useMemo } from 'react';
import * as THREE from 'three';
import {
  getSupportProjectionPreviewPoints,
  getSupportProjectionTriangles,
  getSupportProjectionVersion,
  subscribeSupportProjection,
} from './supportProjection';

const PROJECTION_COLOR = '#f59e0b';

export function SupportProjectionOverlay({
  geometry,
  modelId,
  centerOffset: centerOffsetOverride,
}: {
  geometry: THREE.BufferGeometry;
  modelId: string;
  centerOffset?: THREE.Vector3;
}) {
  const version = React.useSyncExternalStore(
    subscribeSupportProjection,
    getSupportProjectionVersion,
    getSupportProjectionVersion,
  );
  const centerOffset = useMemo(() => {
    const bounds = geometry.boundingBox ?? new THREE.Box3().setFromBufferAttribute(
      geometry.getAttribute('position') as THREE.BufferAttribute,
    );
    return centerOffsetOverride?.clone() ?? bounds.getCenter(new THREE.Vector3());
  }, [centerOffsetOverride, geometry]);
  const built = useMemo(() => {
    const selected = getSupportProjectionTriangles(modelId);
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    let overlay: THREE.BufferGeometry | null = null;
    if (positions && selected.size > 0) {
      const index = geometry.index;
      const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(positions.count / 3);
      const data = new Float32Array(selected.size * 9);
      let offset = 0;
      for (const triangleIndex of selected) {
        if (triangleIndex < 0 || triangleIndex >= triangleCount) continue;
        const a = index ? index.getX(triangleIndex * 3) : triangleIndex * 3;
        const b = index ? index.getX(triangleIndex * 3 + 1) : triangleIndex * 3 + 1;
        const c = index ? index.getX(triangleIndex * 3 + 2) : triangleIndex * 3 + 2;
        if (a >= positions.count || b >= positions.count || c >= positions.count) continue;
        for (const vertex of [a, b, c]) {
          data[offset++] = positions.getX(vertex);
          data[offset++] = positions.getY(vertex);
          data[offset++] = positions.getZ(vertex);
        }
      }
      if (offset > 0) {
        overlay = new THREE.BufferGeometry();
        overlay.setAttribute('position', new THREE.BufferAttribute(data.slice(0, offset), 3));
        overlay.computeVertexNormals();
      }
    }
    const previewPoints = getSupportProjectionPreviewPoints(modelId);
    let candidates: THREE.BufferGeometry | null = null;
    if (previewPoints.length > 0) {
      const data = new Float32Array(previewPoints.length * 3);
      previewPoints.forEach((point, index) => {
        data[index * 3] = point.x;
        data[index * 3 + 1] = point.y;
        data[index * 3 + 2] = point.z;
      });
      candidates = new THREE.BufferGeometry();
      candidates.setAttribute('position', new THREE.BufferAttribute(data, 3));
    }
    if (!overlay && !candidates) return null;
    return { overlay, candidates };
    // The selected mask mutates in place; `version` is its invalidation signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry, modelId, version]);

  React.useEffect(() => () => {
    built?.overlay?.dispose();
    built?.candidates?.dispose();
  }, [built]);
  if (!built) return null;

  return (
    <group position={[-centerOffset.x, -centerOffset.y, -centerOffset.z]}>
      {built.overlay && (
        <mesh geometry={built.overlay} renderOrder={1002} raycast={() => null}>
          <meshBasicMaterial
            color={PROJECTION_COLOR}
            transparent
            opacity={0.42}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
          />
        </mesh>
      )}
      {built.candidates && (
        <points geometry={built.candidates} renderOrder={1003} raycast={() => null}>
          <pointsMaterial
            color="#fb923c"
            size={8}
            sizeAttenuation={false}
            transparent
            opacity={0.95}
            depthWrite={false}
            depthTest={false}
          />
        </points>
      )}
    </group>
  );
}
