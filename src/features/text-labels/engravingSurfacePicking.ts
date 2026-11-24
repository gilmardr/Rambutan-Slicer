import * as THREE from 'three';
import type { LoadedModel } from '@/features/scene/useSceneCollectionManager';

export type SurfacePick = { modelId: string; point: THREE.Vector3; normal: THREE.Vector3 };
type RayVector = readonly [number, number, number];

export function isRayVector(value: unknown): value is RayVector {
  return Array.isArray(value) && value.length === 3
    && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

export function makeSurfaceRaycastTarget(model: LoadedModel): { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial } {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(model.geometry.geometry, material);
  const matrix = new THREE.Matrix4().compose(
    model.transform.position,
    new THREE.Quaternion().setFromEuler(model.transform.rotation),
    model.transform.scale,
  ).multiply(new THREE.Matrix4().makeTranslation(
    -model.geometry.center.x,
    -model.geometry.center.y,
    -model.geometry.center.z,
  ));
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(matrix);
  mesh.matrixWorld.copy(matrix);
  return { mesh, material };
}

export function pickEngravingSurfaceFromRay(
  source: LoadedModel,
  targetMesh: THREE.Mesh,
  raycaster: THREE.Raycaster,
  rayOrigin: readonly number[],
  rayDirection: readonly number[],
): SurfacePick | null {
  raycaster.set(
    new THREE.Vector3(rayOrigin[0], rayOrigin[1], rayOrigin[2]),
    new THREE.Vector3(rayDirection[0], rayDirection[1], rayDirection[2]).normalize(),
  );
  const hit = raycaster.intersectObject(targetMesh, false)[0];
  if (!hit?.face) return null;
  const matrix = targetMesh.matrixWorld;
  const normal = hit.face.normal.clone()
    .applyMatrix3(new THREE.Matrix3().getNormalMatrix(matrix))
    .normalize();
  return { modelId: source.id, point: hit.point.clone(), normal };
}
