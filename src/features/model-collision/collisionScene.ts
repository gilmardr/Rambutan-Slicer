import * as THREE from 'three';
import type { LoadedModel } from '@/features/scene/useSceneCollectionManager';
import { resolveModelPlateId, type PlateFrame } from '@/features/scene/plates/plateLayout';
import { getUnappliedModifiers } from '@/features/mesh-modifiers/unappliedModifiers';
import type { ModelMeshModifiers } from '@/features/mesh-modifiers/types';
import type { CollisionMeshInput } from './modelCollision';

const identities = new WeakMap<object, number>();
let nextIdentity = 0;
function identity(value: object | null | undefined) {
  if (!value) return 0;
  let id = identities.get(value);
  if (id === undefined) { id = ++nextIdentity; identities.set(value, id); }
  return id;
}

/** Cheap invalidation token; edits must mark changed position buffers needsUpdate. */
export function collisionSceneKey(
  models: readonly LoadedModel[],
  frames: readonly PlateFrame[],
  getModifiers?: (modelId: string) => ModelMeshModifiers | undefined,
): string {
  return JSON.stringify(models.map((model) => {
    const geometry = model.geometry.geometry;
    const position = geometry.getAttribute('position');
    const unapplied = getUnappliedModifiers(getModifiers?.(model.id) ?? model.meshModifiers);
    return [model.id, model.visible, resolveModelPlateId(model, frames), identity(geometry),
      identity(position), position instanceof THREE.BufferAttribute ? position.version : position?.data.version,
      identity(geometry.index), geometry.index?.version,
      model.geometry.center.toArray(), model.transform.position.toArray(),
      model.transform.rotation.toArray(), model.transform.scale.toArray(),
      model.geometry.nativePreview, unapplied.hollowing, unapplied.holePunches];
  }));
}

/** Hidden models are excluded; plates use the same positional rule as slicing. */
export function createCollisionInputs(models: readonly LoadedModel[], frames: readonly PlateFrame[]): CollisionMeshInput[] {
  return models.filter((model) => model.visible).map((model) => {
    const geometry = model.geometry.geometry;
    const attribute = geometry.getAttribute('position');
    const positions = new Float32Array((attribute?.count ?? 0) * 3);
    for (let i = 0; i < (attribute?.count ?? 0); i += 1) {
      positions[i * 3] = attribute.getX(i);
      positions[i * 3 + 1] = attribute.getY(i);
      positions[i * 3 + 2] = attribute.getZ(i);
    }
    const matrix = new THREE.Matrix4().compose(model.transform.position,
      new THREE.Quaternion().setFromEuler(model.transform.rotation), model.transform.scale);
    matrix.multiply(new THREE.Matrix4().makeTranslation(
      -model.geometry.center.x, -model.geometry.center.y, -model.geometry.center.z,
    ));
    return {
      id: model.id,
      plateId: resolveModelPlateId(model, frames),
      positions,
      indices: geometry.index ? Uint32Array.from(geometry.index.array) : undefined,
      worldMatrix: matrix.toArray(),
      reducedPreview: !!model.geometry.nativePreview,
    };
  });
}
