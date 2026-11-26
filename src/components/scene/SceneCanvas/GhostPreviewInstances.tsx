/** Instanced translucent copies of a model, for paste and duplicate previews. */
import React from 'react';
import * as THREE from 'three';

export type GhostPreviewTransform = {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
};

export function GhostPreviewInstances({
  geometry,
  center,
  color,
  transforms,
  opacity = 0.22,
  renderOrder = 2,
}: {
  geometry: THREE.BufferGeometry;
  center: THREE.Vector3;
  color: string;
  transforms: GhostPreviewTransform[];
  opacity?: number;
  renderOrder?: number;
}) {
  const instancedRef = React.useRef<THREE.InstancedMesh>(null);
  const workMatrixRef = React.useRef(new THREE.Matrix4());
  const workQuaternionRef = React.useRef(new THREE.Quaternion());
  const workOffsetMatrixRef = React.useRef(new THREE.Matrix4());

  React.useLayoutEffect(() => {
    const instanced = instancedRef.current;
    if (!instanced) return;

    const workMatrix = workMatrixRef.current;
    const workQuaternion = workQuaternionRef.current;
    const offsetMatrix = workOffsetMatrixRef.current.makeTranslation(-center.x, -center.y, -center.z);

    for (let i = 0; i < transforms.length; i += 1) {
      const transform = transforms[i];
      workQuaternion.setFromEuler(transform.rotation);
      workMatrix.compose(transform.position, workQuaternion, transform.scale);
      workMatrix.multiply(offsetMatrix);
      instanced.setMatrixAt(i, workMatrix);
    }

    instanced.count = transforms.length;
    instanced.instanceMatrix.needsUpdate = true;
    instanced.computeBoundingSphere();
  }, [center.x, center.y, center.z, transforms]);

  if (transforms.length === 0) return null;

  return (
    <instancedMesh
      ref={instancedRef}
      args={[geometry, undefined, transforms.length]}
      renderOrder={renderOrder}
      raycast={() => null}
      frustumCulled={false}
    >
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        depthWrite={false}
        toneMapped={false}
      />
    </instancedMesh>
  );
}
