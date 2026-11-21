import * as THREE from 'three';
import type { LoadedModel } from '@/features/scene/useSceneCollectionManager';
import type { SolidMesh, SolidOperationSourceSnapshot } from './solidMeshOperations';

/** Copies a model mesh into printer-plate world coordinates for the boolean kernel. */
export function solidMeshForModel(model: LoadedModel): SolidMesh {
  const geometry = model.geometry.geometry;
  const position = geometry.getAttribute('position');
  if (!position || position.count < 4) throw new Error('invalid-input');
  const positions = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 1) {
    positions[i * 3] = position.getX(i);
    positions[i * 3 + 1] = position.getY(i);
    positions[i * 3 + 2] = position.getZ(i);
  }
  const matrix = new THREE.Matrix4().compose(
    model.transform.position,
    new THREE.Quaternion().setFromEuler(model.transform.rotation),
    model.transform.scale,
  ).multiply(new THREE.Matrix4().makeTranslation(
    -model.geometry.center.x,
    -model.geometry.center.y,
    -model.geometry.center.z,
  ));
  const point = new THREE.Vector3();
  for (let i = 0; i < positions.length; i += 3) {
    point.set(positions[i], positions[i + 1], positions[i + 2]).applyMatrix4(matrix);
    positions[i] = point.x;
    positions[i + 1] = point.y;
    positions[i + 2] = point.z;
  }
  let indices = geometry.index
    ? Uint32Array.from(geometry.index.array)
    : Uint32Array.from({ length: position.count }, (_, index) => index);
  if (matrix.determinant() < 0) {
    indices = indices.slice();
    for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  }
  return { positions, indices };
}

export function snapshotSolidOperationSource(
  model: LoadedModel,
  plateId: string,
  modifiers: unknown,
): SolidOperationSourceSnapshot {
  const geometry = model.geometry.geometry;
  const positionAttribute = geometry.getAttribute('position');
  const indexAttribute = geometry.index;
  return {
    id: model.id,
    geometry,
    positionAttribute,
    positionVersion: positionAttribute instanceof THREE.BufferAttribute
      ? positionAttribute.version
      : positionAttribute?.data.version ?? 0,
    indexAttribute,
    indexVersion: indexAttribute?.version ?? 0,
    position: model.transform.position.toArray(),
    rotation: [...model.transform.rotation.toArray()],
    scale: model.transform.scale.toArray(),
    plateId,
    modifiersFingerprint: JSON.stringify(modifiers ?? null),
  };
}

export function geometryFromSolidMesh(mesh: SolidMesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices!, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Restores plate-space output to the active model's original geometry coordinates for splits. */
export function solidMeshBackToModel(mesh: SolidMesh, model: LoadedModel): THREE.BufferGeometry {
  const geometry = geometryFromSolidMesh(mesh);
  const matrix = new THREE.Matrix4().compose(
    model.transform.position,
    new THREE.Quaternion().setFromEuler(model.transform.rotation),
    model.transform.scale,
  ).multiply(new THREE.Matrix4().makeTranslation(
    -model.geometry.center.x,
    -model.geometry.center.y,
    -model.geometry.center.z,
  )).invert();
  geometry.applyMatrix4(matrix);
  if (matrix.determinant() < 0) {
    const indices = geometry.getIndex()!;
    for (let i = 0; i < indices.count; i += 3) {
      const next = indices.getX(i + 1);
      indices.setX(i + 1, indices.getX(i + 2));
      indices.setX(i + 2, next);
    }
    indices.needsUpdate = true;
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
