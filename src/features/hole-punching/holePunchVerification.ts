import * as THREE from 'three';
import type { ModelTransform } from '@/hooks/useModelTransform';
import { quaternionFromGlobalEuler } from '@/utils/rotation';
import { accelerateGeometry } from '@/utils/bvh';
import type { HolePunchPlacementState } from './holePunchGeometry';

export type HolePunchVerificationStatus = 'confirmed' | 'too-shallow' | 'uncertain';

export type HolePunchVerificationResult = {
  placementId: string;
  status: HolePunchVerificationStatus;
  distinctSurfaceCount: number;
};

const RAY_START_OFFSET_MM = 1;
const SURFACE_MERGE_TOLERANCE_MM = 0.05;
const MAX_FIRST_SURFACE_DISTANCE_MM = 2.5;

/**
 * Checks whether each hole axis reaches a hollow cavity in the supplied source
 * geometry. The source must be hollowed but must not include these punches.
 */
export function verifyHolePunchPlacements(
  geometry: THREE.BufferGeometry,
  geometryCenter: THREE.Vector3,
  transform: ModelTransform,
  placements: HolePunchPlacementState[],
): HolePunchVerificationResult[] {
  if (placements.length === 0) return [];
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  if (!geometry.boundsTree) accelerateGeometry(geometry);

  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.quaternion.copy(quaternionFromGlobalEuler(transform.rotation));
  mesh.scale.copy(transform.scale);
  mesh.position.copy(transform.position).sub(
    geometryCenter.clone().multiply(transform.scale).applyQuaternion(mesh.quaternion),
  );
  mesh.updateMatrixWorld(true);

  const localSize = geometry.boundingBox?.getSize(new THREE.Vector3()) ?? new THREE.Vector3();
  const maxScale = Math.max(Math.abs(transform.scale.x), Math.abs(transform.scale.y), Math.abs(transform.scale.z));
  const maxRayLength = Math.max(10, localSize.length() * maxScale * 2 + RAY_START_OFFSET_MM * 2);
  const raycaster = new THREE.Raycaster();
  raycaster.near = 0;
  raycaster.far = maxRayLength;
  const direction = new THREE.Vector3();
  const origin = new THREE.Vector3();

  try {
    return placements.map((placement) => {
      direction.copy(placement.worldNormal).normalize();
      origin.copy(placement.worldPoint).addScaledVector(direction, -RAY_START_OFFSET_MM);
      raycaster.set(origin, direction);
      const hits = raycaster.intersectObject(mesh, false);
      const distances: number[] = [];
      for (const hit of hits) {
        if (distances.length === 0 || Math.abs(hit.distance - distances[distances.length - 1]) > SURFACE_MERGE_TOLERANCE_MM) {
          distances.push(hit.distance);
        }
      }

      const firstSurfaceIsNearPlacement = distances.length > 0
        && distances[0] <= MAX_FIRST_SURFACE_DISTANCE_MM;
      const cavityWallDistance = distances[1] !== undefined
        ? Math.max(0, distances[1] - RAY_START_OFFSET_MM)
        : Number.POSITIVE_INFINITY;
      const reachesCavityWall = cavityWallDistance <= placement.depthMm + SURFACE_MERGE_TOLERANCE_MM;
      const status: HolePunchVerificationStatus = firstSurfaceIsNearPlacement && distances.length >= 4
        ? (reachesCavityWall ? 'confirmed' : 'too-shallow')
        : 'uncertain';

      return {
        placementId: placement.id,
        status,
        distinctSurfaceCount: distances.length,
      };
    });
  } finally {
    material.dispose();
  }
}
