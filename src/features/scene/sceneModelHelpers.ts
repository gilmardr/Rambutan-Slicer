/** Pure helpers on loaded models: cloning, transform comparison, colour and support bookkeeping. */
import * as THREE from 'three';
import { clearPaintToBase } from '@/components/analysis/MeshPainter';
import { getSnapshot, transformSupportsForModel } from '@/supports/state';
import type { ModelTransform } from '@/hooks/useModelTransform';
import type { SupportState } from '@/supports/types';
import type { ModelMeshModifiers } from '@/features/mesh-modifiers/types';
import { getSupportsForModel } from '@/supports/PlacementLogic/SupportModelLinker';
import { LoadedModel } from './loadedModel';

export function cloneTransform(transform: ModelTransform): ModelTransform {
  return {
    position: transform.position.clone(),
    rotation: transform.rotation.clone(),
    scale: transform.scale.clone(),
  };
}

export function transformsEqual(a: ModelTransform, b: ModelTransform): boolean {
  const EPSILON = 1e-5;
  return a.position.distanceToSquared(b.position) <= EPSILON
    && Math.abs(a.rotation.x - b.rotation.x) <= EPSILON
    && Math.abs(a.rotation.y - b.rotation.y) <= EPSILON
    && Math.abs(a.rotation.z - b.rotation.z) <= EPSILON
    && a.scale.distanceToSquared(b.scale) <= EPSILON;
}

export function cloneLoadedModel(model: LoadedModel): LoadedModel {
  return {
    ...model,
    transform: cloneTransform(model.transform),
    // meshModifiers are stored externally in meshModifierStoreRef — never on the model object.
    meshModifiers: undefined,
  };
}

/**
 * Lightweight shallow clone — avoids JSON round-trip through MB-scale
 * base64 strings (cavityPositionsBase64, holePunchSourcePositionsBase64)
 * that LYS imports carry in meshModifiers.
 *
 * NOTE: Since meshModifiers are now stored externally in
 * meshModifierStoreRef and stripped from model objects, this function is
 * only used during import to sanitize the payload before storing it in
 * the external store.
 */
export function cloneMeshModifiersShallow(modifiers: ModelMeshModifiers): ModelMeshModifiers {
  return {
    ...modifiers,
    hollowing: modifiers.hollowing ? { ...modifiers.hollowing } : undefined,
    holePunches: modifiers.holePunches ? modifiers.holePunches.map((p) => ({ ...p })) : undefined,
    holePunchAppliedPlacements: modifiers.holePunchAppliedPlacements
      ? modifiers.holePunchAppliedPlacements.map((p) => ({ ...p }))
      : undefined,
  };
}

export function cloneMeshModifiersForHistory(modifiers: ModelMeshModifiers | null | undefined): ModelMeshModifiers | undefined {
  if (!modifiers) return undefined;
  const hollowing = modifiers.hollowing;
  const clonePlacements = (placements: typeof modifiers.holePunches) => placements?.map((placement) => ({
    ...placement,
    centerNorm: placement.centerNorm.slice() as typeof placement.centerNorm,
    direction: placement.direction.slice() as typeof placement.direction,
  }));
  return {
    ...modifiers,
    hollowing: hollowing ? {
      ...hollowing,
      blockedVoxelIndices: hollowing.blockedVoxelIndices?.slice(),
      blockedVoxelRotationQuat: hollowing.blockedVoxelRotationQuat?.slice() as typeof hollowing.blockedVoxelRotationQuat,
    } : hollowing,
    holePunches: clonePlacements(modifiers.holePunches),
    holePunchAppliedPlacements: clonePlacements(modifiers.holePunchAppliedPlacements),
  };
}

// ── External Mesh Modifier Store ─────────────────────────────────────────
//
// Model mesh modifiers (especially the MB-scale cavityPositionsBase64 /
// sourcePositionsBase64 from LYS imports) are kept in a module-level Map in
// features/mesh-modifiers/meshModifierStore.ts instead of on model objects.
// This prevents React's state reconciliation from churning on large payloads
// during selection, copy, paste, and duplicate operations. Save/export/slice
// boundaries must resolve modifiers through that store (see
// resolveModelMeshModifiers) — model objects carry meshModifiers: undefined
// by design.

export function schedulePostPaint(callback: () => void): void {
  if (typeof window === 'undefined') {
    setTimeout(callback, 0);
    return;
  }
  window.setTimeout(callback, 0);
}

// ─────────────────────────────────────────────────────────────────────────

/** Repaints a model's vertex colours, when it has any, to a flat `color`. */
export function paintModelBaseColor(model: LoadedModel, color: string): void {
  if (!model.geometry.geometry.getAttribute('color')) return;
  try {
    clearPaintToBase(model.geometry.geometry, new THREE.Color(color));
  } catch (err) {
    console.error('[SceneCollection] Failed to apply mesh color to geometry:', err);
  }
}

/** Whether any support entity of any type belongs to this model. */
export function hasSupportsForModel(modelId: string, supportState: SupportState): boolean {
  const supportIds = getSupportsForModel(supportState, modelId);
  return Object.values(supportIds).some((ids) => ids.length > 0);
}

/**
 * Supports are kept in world space, apart from their model, so a relayout of the beds that
 * slides a model has to slide its supports by the same move, or they stay standing where the
 * bed used to be. A model the relayout left alone keeps its transform object, and is skipped.
 */
export function shiftSupportsWithModels(before: readonly LoadedModel[], after: readonly LoadedModel[]): void {
  if (before === after) return;
  const previous = new Map(before.map((model) => [model.id, model.transform]));
  for (const model of after) {
    const was = previous.get(model.id);
    if (was && was !== model.transform) transformSupportsForModel(model.id, was, model.transform);
  }
}

/** The support store, for a snapshot of `models`, when any of them has supports to restore. */
export function supportStateFor(models: readonly LoadedModel[]): SupportState | undefined {
  const supportState = getSnapshot();
  return models.some((model) => hasSupportsForModel(model.id, supportState)) ? supportState : undefined;
}
