import * as THREE from 'three';
import { quaternionFromGlobalEuler } from '@/utils/rotation';
import type { ModelTransform } from '@/hooks/useModelTransform';

export type ModelAlignment = 'center-x' | 'center-y' | 'center-z' | 'bottom-z';

type AlignableModel = {
  id: string;
  transform: ModelTransform;
  geometry: {
    center: THREE.Vector3;
    geometry: THREE.BufferGeometry;
  };
};

type WorldBounds = { min: THREE.Vector3; max: THREE.Vector3 };

function getWorldBounds(model: AlignableModel): WorldBounds | null {
  const geometry = model.geometry.geometry;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds) return null;

  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(),
    quaternionFromGlobalEuler({
      x: model.transform.rotation.x,
      y: model.transform.rotation.y,
      z: model.transform.rotation.z,
    }),
    model.transform.scale,
  );
  const center = model.geometry.center;
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const point = new THREE.Vector3(x - center.x, y - center.y, z - center.z)
          .applyMatrix4(matrix)
          .add(model.transform.position);
        min.min(point);
        max.max(point);
      }
    }
  }

  return { min, max };
}

/** Aligns selected models to the active model's world-space bounds. */
export function computeAlignedModelTransforms(
  models: readonly AlignableModel[],
  referenceModelId: string,
  alignment: ModelAlignment,
): Array<{ id: string; transform: ModelTransform }> {
  const reference = models.find((model) => model.id === referenceModelId);
  if (!reference || models.length < 2) return [];
  const referenceBounds = getWorldBounds(reference);
  if (!referenceBounds) return [];

  const axis = alignment === 'center-x' ? 'x'
    : alignment === 'center-y' ? 'y'
      : 'z';
  const isBottom = alignment === 'bottom-z';
  const target = isBottom
    ? referenceBounds.min.z
    : (referenceBounds.min[axis] + referenceBounds.max[axis]) * 0.5;

  return models
    .filter((model) => model.id !== referenceModelId)
    .flatMap((model) => {
      const bounds = getWorldBounds(model);
      if (!bounds) return [];
      const current = isBottom ? bounds.min.z : (bounds.min[axis] + bounds.max[axis]) * 0.5;
      const transform: ModelTransform = {
        position: model.transform.position.clone(),
        rotation: model.transform.rotation.clone(),
        scale: model.transform.scale.clone(),
      };
      transform.position[axis] += target - current;
      return [{ id: model.id, transform }];
    });
}
