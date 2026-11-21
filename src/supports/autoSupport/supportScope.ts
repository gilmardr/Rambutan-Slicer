import * as THREE from 'three';
import type { DetectedIsland } from '@/volumeAnalysis/Islands/types';
import type { AutoSupportScope } from './settings';

export type { AutoSupportScope } from './settings';

type SurfaceScope = 'exterior' | 'interior' | 'unknown';

const INTERIOR_RAY_HIT_THRESHOLD = 2;
const NORMAL_SAMPLE_DISTANCE_MM = 2;
const SURFACE_OFFSET_MM = 0.08;

function islandSurfaceNormal(island: DetectedIsland, mesh: THREE.Mesh): THREE.Vector3 | null {
  if (island.surfaceNormal) {
    const normal = new THREE.Vector3(
      island.surfaceNormal.x,
      island.surfaceNormal.y,
      island.surfaceNormal.z,
    );
    if (normal.lengthSq() > 1e-6) return normal.normalize();
  }

  const point = island.contact;
  const raycaster = new THREE.Raycaster();
  const verticalHits: THREE.Intersection[] = [];
  raycaster.far = NORMAL_SAMPLE_DISTANCE_MM * 2;
  raycaster.set(
    new THREE.Vector3(point.x, point.y, point.z - NORMAL_SAMPLE_DISTANCE_MM),
    new THREE.Vector3(0, 0, 1),
  );
  verticalHits.push(...raycaster.intersectObject(mesh, false));
  raycaster.set(
    new THREE.Vector3(point.x, point.y, point.z + NORMAL_SAMPLE_DISTANCE_MM),
    new THREE.Vector3(0, 0, -1),
  );
  verticalHits.push(...raycaster.intersectObject(mesh, false));

  const closest = verticalHits
    .filter((hit) => hit.face && hit.point.distanceTo(point) <= NORMAL_SAMPLE_DISTANCE_MM + 0.5)
    .sort((a, b) => a.point.distanceToSquared(point) - b.point.distanceToSquared(point))[0];
  if (!closest?.face) return null;

  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  return closest.face.normal.clone().applyMatrix3(normalMatrix).normalize();
}

function classifyIslandSurface(island: DetectedIsland, mesh: THREE.Mesh, maxDistanceMm: number): SurfaceScope {
  const normal = islandSurfaceNormal(island, mesh);
  if (!normal) return 'unknown';

  const tangentAxis = Math.abs(normal.z) < 0.85
    ? new THREE.Vector3(0, 0, 1)
    : new THREE.Vector3(1, 0, 0);
  const tangent = new THREE.Vector3().crossVectors(normal, tangentAxis).normalize();
  const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
  const tilt = 0.65;
  const directions = [
    normal,
    normal.clone().addScaledVector(tangent, tilt).normalize(),
    normal.clone().addScaledVector(tangent, -tilt).normalize(),
    normal.clone().addScaledVector(bitangent, tilt).normalize(),
    normal.clone().addScaledVector(bitangent, -tilt).normalize(),
  ];

  const origin = island.contact.clone().addScaledVector(normal, SURFACE_OFFSET_MM);
  const raycaster = new THREE.Raycaster();
  raycaster.near = 0.03;
  raycaster.far = maxDistanceMm;
  (raycaster as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;

  let blockedDirections = 0;
  for (const direction of directions) {
    raycaster.set(origin, direction);
    const hit = raycaster.intersectObject(mesh, false)[0];
    if (hit && hit.distance > SURFACE_OFFSET_MM * 2) blockedDirections += 1;
  }

  if (blockedDirections >= INTERIOR_RAY_HIT_THRESHOLD) return 'interior';
  if (blockedDirections === 0) return 'exterior';
  return 'unknown';
}

export function filterIslandsBySupportScope(
  islands: readonly DetectedIsland[],
  mesh: THREE.Mesh | null,
  scope: AutoSupportScope,
): DetectedIsland[] {
  if (scope === 'combined') return [...islands];
  if (!mesh || islands.length === 0) return [];

  mesh.updateWorldMatrix(true, false);
  const bounds = new THREE.Box3().setFromObject(mesh);
  const maxDistanceMm = Math.max(1, bounds.getSize(new THREE.Vector3()).length() * 2);
  const classifications = new Map<string, SurfaceScope>();

  return islands.filter((island) => {
    const surfaceScope = classifications.get(island.id)
      ?? classifyIslandSurface(island, mesh, maxDistanceMm);
    classifications.set(island.id, surfaceScope);
    return surfaceScope === scope;
  });
}
