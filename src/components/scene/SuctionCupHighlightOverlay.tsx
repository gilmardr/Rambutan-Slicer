import React from 'react';
import * as THREE from 'three';

export function SuctionCupHighlightOverlay({ surfacePoints }: { surfacePoints: Float32Array }) {
  const geometry = React.useMemo(() => {
    const next = new THREE.BufferGeometry();
    next.setAttribute('position', new THREE.BufferAttribute(surfacePoints, 3));
    return next;
  }, [surfacePoints]);
  const material = React.useMemo(() => new THREE.PointsMaterial({
    color: '#ffd43b',
    size: 8,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    depthWrite: false,
  }), []);

  React.useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={1000} />;
}
