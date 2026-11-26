/** Scene undo history: snapshot capture and the bounded snapshot registry. */
import * as THREE from 'three';
import { getSnapshot } from '@/supports/state';
import { createTypedHistory } from '@/history/typedHistory';
import type { SupportState } from '@/supports/types';
import { SCENE_CHANGE_LABEL } from '@/features/scene/sceneHistoryLabels';
import { getActivePrinterProfile } from '@/features/profiles/profileStore';
import type { ModelMeshModifiers } from '@/features/mesh-modifiers/types';
import { clonePlainData } from '@/utils/plainDataClone';
import { cloneLoadedModel } from './sceneModelHelpers';
import { ScenePlate, LoadedModel } from './loadedModel';

export const SCENE_MODELS_SNAPSHOT_APPLY = 'scene_models_snapshot_apply' as const;
export const SCENE_HISTORY_MAX_SNAPSHOTS = 200;
// Belt-and-suspenders alongside the count cap above: a handful of
// full-resolution geometry swaps (e.g. repeated hollowing on a large model)
// can retain far more memory per snapshot than typical small edits, so the
// flat count cap alone can leave a lot of stale geometry pinned alive.
export const SCENE_HISTORY_MAX_ESTIMATED_GEOMETRY_BYTES = 300 * 1024 * 1024;
// Modifier edits of the same kind on the same model this close together are one
// step: the panels' number fields report every keystroke and every wheel notch.
export const MODIFIER_HISTORY_MERGE_WINDOW_MS = 1000;

export type SceneSnapshotPayload = { key: string; modelId?: string };

/** Action→payload map for the scene history domain. */
export type SceneHistoryPayloadMap = {
  [SCENE_MODELS_SNAPSHOT_APPLY]: SceneSnapshotPayload;
};
export const sceneHistory = createTypedHistory<SceneHistoryPayloadMap>({
  [SCENE_MODELS_SNAPSHOT_APPLY]: SCENE_CHANGE_LABEL,
});

export type SceneSnapshot = {
  models: LoadedModel[];
  activeModelId: string | null;
  selectedModelIds: string[];
  supportState?: SupportState;
  modifierRecord?: { modelId: string; modifiers: ModelMeshModifiers | undefined };
  /**
   * The beds, on the entries that add or remove one. Optional: a snapshot without
   * them leaves the plate list exactly as it is, which is what every entry that
   * only touches models wants.
   */
  plates?: ScenePlate[];
  activePlateId?: string;
  /**
   * The printer the scene was made under. On every snapshot, not only the ones that switch
   * it: the beds are spaced by the build volume, so an entry taken under one printer and
   * undone under another lands its models against frames that never applied to them.
   * `null` is no printer — "use without Printer" — and `undefined` is a snapshot taken
   * before this was recorded, which leaves the profile alone.
   */
  printerProfileId?: string | null;
};

export type SceneSnapshotCaptureOptions = {
  includeSupportState?: boolean;
  supportStateOverride?: SupportState;
  /** Record the plate list on this snapshot, for the entries that change it. */
  plates?: ScenePlate[];
  activePlateId?: string;
  /**
   * The printer this snapshot belongs to. Defaults to the active one, which is right for
   * every entry but the "before" of a printer switch: by the time that entry is pushed the
   * store already holds the new profile.
   */
  printerProfileId?: string | null;
};

export type TransformHistorySupportSnapshotOptions = {
  supportBefore?: SupportState;
  supportAfter?: SupportState;
  includeSupportState?: boolean;
};

export type SceneSnapshotPair = {
  before: SceneSnapshot;
  after: SceneSnapshot;
};

export const sceneSnapshotRegistry = new Map<string, SceneSnapshotPair>();
export const sceneSnapshotOrder: string[] = [];

export function captureSceneSnapshot(
  models: LoadedModel[],
  activeModelId: string | null,
  selectedModelIds: string[],
  options?: SceneSnapshotCaptureOptions,
): SceneSnapshot {
  const includeSupportState = options?.includeSupportState ?? false;
  const supportStateOverride = options?.supportStateOverride;
  const printerProfileId = options?.printerProfileId !== undefined
    ? options.printerProfileId
    : (getActivePrinterProfile()?.id ?? null);

  return {
    models: models.map(cloneLoadedModel),
    activeModelId,
    selectedModelIds: [...selectedModelIds],
    printerProfileId,
    ...(includeSupportState
      ? {
          supportState: clonePlainData(supportStateOverride ?? getSnapshot()),
        }
      : {}),
    ...(options?.plates
      ? {
          plates: options.plates.map((plate) => ({ ...plate })),
          activePlateId: options.activePlateId,
        }
      : {}),
  };
}

export function estimateGeometryBytes(geometry: THREE.BufferGeometry): number {
  let total = 0;
  for (const key in geometry.attributes) {
    const attribute = geometry.attributes[key];
    if (attribute?.array) {
      total += (attribute.array as ArrayBufferView).byteLength;
    }
  }
  if (geometry.index?.array) {
    total += (geometry.index.array as ArrayBufferView).byteLength;
  }
  return total;
}

// Counts each distinct BufferGeometry ONCE, because that is what the process
// actually holds: cloneLoadedModel is a shallow clone, so every snapshot that
// didn't change the mesh shares the same geometry object. A move stores two
// snapshots and allocates no mesh memory at all.
//
// Counting per snapshot instead treated that shared mesh as a fresh allocation
// each time, so the budget was exhausted after a handful of moves and eviction
// threw away undo entries that cost nothing -- their scene snapshots went with
// them, and undoing those actions was silently declined and discarded. Only
// geometry a step genuinely creates (a cut, a hollow) adds to the total now.
export function estimateSceneSnapshotRegistryBytes(): number {
  const counted = new Set<THREE.BufferGeometry>();
  let total = 0;
  const add = (model: LoadedModel) => {
    const geometry = model.geometry.geometry;
    if (counted.has(geometry)) return;
    counted.add(geometry);
    total += estimateGeometryBytes(geometry);
  };
  for (const pair of sceneSnapshotRegistry.values()) {
    pair.before.models.forEach(add);
    pair.after.models.forEach(add);
  }
  return total;
}

/**
 * The registry's geometry total, for the history debug panel. Same dedup rule as
 * the eviction budget above, so the panel reports the memory that is actually
 * held rather than a per-snapshot sum that counts one shared mesh many times.
 */
export function getSceneSnapshotRegistryBytes(): number {
  return estimateSceneSnapshotRegistryBytes();
}

export function storeSceneSnapshotPair(pair: SceneSnapshotPair): string {
  const key = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  sceneSnapshotRegistry.set(key, pair);
  sceneSnapshotOrder.push(key);

  while (sceneSnapshotOrder.length > SCENE_HISTORY_MAX_SNAPSHOTS) {
    const removed = sceneSnapshotOrder.shift();
    if (removed) sceneSnapshotRegistry.delete(removed);
  }

  // Always keep at least one snapshot so undo of the most recent action
  // still works, even if it alone exceeds the byte budget.
  while (
    sceneSnapshotOrder.length > 1
    && estimateSceneSnapshotRegistryBytes() > SCENE_HISTORY_MAX_ESTIMATED_GEOMETRY_BYTES
  ) {
    const removed = sceneSnapshotOrder.shift();
    if (removed) sceneSnapshotRegistry.delete(removed);
  }

  return key;
}
