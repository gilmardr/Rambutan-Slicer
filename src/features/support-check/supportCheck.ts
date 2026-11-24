import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { DetectedIsland } from '@/volumeAnalysis/Islands/types';

/**
 * Support check: slice the model *together with its supports* and report every
 * region that has nothing below it within a reach distance.
 *
 * The voxel island detector already marks, layer by layer, the pixels with no
 * material below them (after dilating the layer below by `supportBufferMm`) and
 * joins them into 3D clusters. Run on the model alone those clusters are the
 * islands that need supports; run on model + supports + raft, what survives is
 * what the current supports still leave hanging:
 * - regions with nothing under them at all (floating parts), and
 * - ceiling areas farther than the reach distance from the nearest support.
 */

export const SUPPORT_CHECK_REACH_MM = { min: 0.3, max: 5, step: 0.1, defaultValue: 0.5 } as const;

/** A floating area at one level gets one support contact per cell of this size. */
export const SUPPORT_CHECK_CELL_MM = 5;

export type SupportCheckClassification = {
  /** Unsupported regions on the model surface: strong candidates for supports. */
  modelIslands: DetectedIsland[];
  /** Regions that start on support geometry: disconnected or broken supports. */
  supportIslands: DetectedIsland[];
  /** Regions resting on the build plate or raft base, which need no support. */
  groundedCount: number;
};

export type SupportCheckClassifyOptions = {
  /** Lowest Z of the combined model + support geometry (the plate or raft base). */
  baseZ: number;
  layerHeightMm: number;
  pxMm: number;
  /** The reach the scan ran with; model regions carry it into auto-support. */
  reachMm: number;
  /** Coverage cell size for model regions (defaults to {@link SUPPORT_CHECK_CELL_MM}). */
  cellMm?: number;
};

/** Start at the build plate, while retaining geometry that crosses below it. */
export function supportCheckBounds(bounds: THREE.Box3): THREE.Box3 {
  const scanBounds = bounds.clone();
  scanBounds.min.z = Math.min(0, bounds.min.z);
  return scanBounds;
}

export function clampSupportCheckReach(value: number): number {
  if (!Number.isFinite(value)) return SUPPORT_CHECK_REACH_MM.defaultValue;
  return Math.min(SUPPORT_CHECK_REACH_MM.max, Math.max(SUPPORT_CHECK_REACH_MM.min, value));
}

/**
 * Splits raw voxel islands from a model + supports scan into model regions and
 * support regions, dropping the base layer that stands on the plate.
 */
export function classifySupportCheckIslands(
  islands: readonly DetectedIsland[],
  modelPositions: Float32Array,
  options: SupportCheckClassifyOptions,
): SupportCheckClassification {
  const result: SupportCheckClassification = { modelIslands: [], supportIslands: [], groundedCount: 0 };
  if (islands.length === 0) return result;

  // A contact is the centre of the lowest unsupported pixel, sliced at the top
  // of its layer: allow a couple of pixels and layers between it and the mesh.
  const surfaceToleranceMm = Math.max(0.25, options.pxMm * 2.5 + options.layerHeightMm * 2);
  const groundedCeilingZ = options.baseZ + options.layerHeightMm * 1.5;

  let bvh: MeshBVH | null = null;
  let geometry: THREE.BufferGeometry | null = null;
  if (modelPositions.length >= 9) {
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(modelPositions, 3));
    bvh = new MeshBVH(geometry);
  }

  try {
    const target = { point: new THREE.Vector3(), distance: Infinity, faceIndex: 0 };
    for (const island of islands) {
      if (island.contact.z <= groundedCeilingZ) {
        result.groundedCount += 1;
        continue;
      }
      target.distance = Infinity;
      const hit = bvh?.closestPointToPoint(island.contact, target, 0, surfaceToleranceMm);
      const onModel = !!hit && hit.distance <= surfaceToleranceMm;
      if (onModel) {
        result.modelIslands.push({
          ...island,
          supportCheck: { cellMm: options.cellMm ?? SUPPORT_CHECK_CELL_MM, reachMm: options.reachMm },
        });
      } else {
        result.supportIslands.push(island);
      }
    }
  } finally {
    geometry?.dispose();
  }
  return result;
}
