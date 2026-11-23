import * as THREE from 'three';
import type { ModelTransform } from '@/hooks/useModelTransform';
import { accelerateGeometry } from '@/utils/bvh';

const WELD_TOLERANCE_MM = 1e-5;
const BOOLEAN_SURFACE_OVERLAP_MM = 0.08;
const MAX_REFINEMENT_PASSES = 10;
const MAX_REFINED_TRIANGLES = 1_500_000;

/**
 * Welds the cutter into a shared-vertex mesh, then splits every edge longer than
 * `maxEdgeMm` at its midpoint until none remain (or a pass/size cap is hit).
 * Neighbouring triangles split a shared edge at the same vertex, so the closed
 * cutter stays watertight, and only triangles with long edges gain detail.
 */
export function subdivideGeometry(geometry: THREE.BufferGeometry, maxEdgeMm: number): THREE.BufferGeometry {
  const source = geometry.getAttribute('position');
  const sourceIndex = geometry.getIndex();
  const sourceCount = sourceIndex ? sourceIndex.count : source?.count ?? 0;
  if (!source || sourceCount === 0 || sourceCount % 3 !== 0) {
    geometry.dispose();
    return new THREE.BufferGeometry();
  }

  const positions: number[] = [];
  const welded = new Map<string, number>();
  let indices: number[] = [];
  for (let corner = 0; corner < sourceCount; corner += 1) {
    const vertex = sourceIndex ? sourceIndex.getX(corner) : corner;
    const x = source.getX(vertex);
    const y = source.getY(vertex);
    const z = source.getZ(vertex);
    const key = `${Math.round(x / WELD_TOLERANCE_MM)}:${Math.round(y / WELD_TOLERANCE_MM)}:${Math.round(z / WELD_TOLERANCE_MM)}`;
    let index = welded.get(key);
    if (index === undefined) {
      index = positions.length / 3;
      positions.push(x, y, z);
      welded.set(key, index);
    }
    indices.push(index);
  }
  geometry.dispose();

  const maxEdgeSq = maxEdgeMm * maxEdgeMm;
  const edgeKey = (p: number, q: number) => (p < q ? `${p}:${q}` : `${q}:${p}`);
  const edgeLengthSq = (p: number, q: number) => {
    const dx = positions[p * 3] - positions[q * 3];
    const dy = positions[p * 3 + 1] - positions[q * 3 + 1];
    const dz = positions[p * 3 + 2] - positions[q * 3 + 2];
    return dx * dx + dy * dy + dz * dz;
  };

  for (let pass = 0; pass < MAX_REFINEMENT_PASSES && indices.length / 3 < MAX_REFINED_TRIANGLES; pass += 1) {
    const midpoints = new Map<string, number>();
    for (let i = 0; i < indices.length; i += 3) {
      for (let edge = 0; edge < 3; edge += 1) {
        const p = indices[i + edge];
        const q = indices[i + ((edge + 1) % 3)];
        const key = edgeKey(p, q);
        if (midpoints.has(key) || edgeLengthSq(p, q) <= maxEdgeSq) continue;
        midpoints.set(key, positions.length / 3);
        positions.push(
          (positions[p * 3] + positions[q * 3]) / 2,
          (positions[p * 3 + 1] + positions[q * 3 + 1]) / 2,
          (positions[p * 3 + 2] + positions[q * 3 + 2]) / 2,
        );
      }
    }
    if (midpoints.size === 0) break;

    const next: number[] = [];
    for (let i = 0; i < indices.length; i += 3) {
      const v = [indices[i], indices[i + 1], indices[i + 2]];
      // m[k] is the midpoint of edge v[k] → v[k + 1], when that edge is split.
      const m = [0, 1, 2].map((k) => midpoints.get(edgeKey(v[k], v[(k + 1) % 3])));
      const split = m.filter((value) => value !== undefined).length;
      if (split === 0) {
        next.push(v[0], v[1], v[2]);
      } else if (split === 3) {
        const [m0, m1, m2] = m as number[];
        next.push(v[0], m0, m2, m0, v[1], m1, m2, m1, v[2], m0, m1, m2);
      } else if (split === 1) {
        const k = m.findIndex((value) => value !== undefined);
        const [a, b, c] = [v[k], v[(k + 1) % 3], v[(k + 2) % 3]];
        const mid = m[k] as number;
        next.push(a, mid, c, mid, b, c);
      } else {
        // Two split edges: rotate so edges k and k + 1 are split, k + 2 is not.
        const k = [0, 1, 2].find((j) => m[j] !== undefined && m[(j + 1) % 3] !== undefined) as number;
        const [a, b, c] = [v[k], v[(k + 1) % 3], v[(k + 2) % 3]];
        const mAB = m[k] as number;
        const mBC = m[(k + 1) % 3] as number;
        next.push(mAB, b, mBC, a, mAB, mBC, a, mBC, c);
      }
    }
    indices = next;
  }

  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.setIndex(indices);
  return result;
}


/** Projects centered text or image geometry onto a picked model surface for Difference or Union. */
export function conformEngravingGeometryToSurface(
  engravingGeometry: THREE.BufferGeometry,
  targetGeometry: THREE.BufferGeometry,
  targetCenter: THREE.Vector3,
  targetTransform: ModelTransform,
  anchor: THREE.Vector3,
  surfaceNormal: THREE.Vector3,
  heightMm: number,
  thicknessMm: number,
  rotationDegrees = 0,
  mode: 'engraving' | 'relief' = 'engraving',
): { geometry: THREE.BufferGeometry; transform: ModelTransform } | null {
  const projectionThicknessMm = mode === 'relief' ? thicknessMm + BOOLEAN_SURFACE_OVERLAP_MM : thicknessMm;
  if (mode === 'relief') {
    engravingGeometry.scale(1, 1, projectionThicknessMm / thicknessMm);
  }
  const tessellated = subdivideGeometry(engravingGeometry, Math.max(0.25, Math.min(1, heightMm / 4)));
  const position = tessellated.getAttribute('position');
  if (!position || position.count === 0) {
    tessellated.dispose();
    return null;
  }

  const normal = surfaceNormal.clone().normalize();
  const tangentReference = Math.abs(normal.x) < 0.9
    ? new THREE.Vector3(1, 0, 0)
    : new THREE.Vector3(0, 1, 0);
  const tangentX = tangentReference.addScaledVector(normal, -tangentReference.dot(normal)).normalize();
  const tangentY = normal.clone().cross(tangentX).normalize();
  const rotationRadians = THREE.MathUtils.degToRad(rotationDegrees);
  const cosine = Math.cos(rotationRadians);
  const sine = Math.sin(rotationRadians);
  const rotatedTangentX = tangentX.clone().multiplyScalar(cosine).addScaledVector(tangentY, sine);
  const rotatedTangentY = tangentY.clone().multiplyScalar(cosine).addScaledVector(tangentX, -sine);
  if (!targetGeometry.boundingSphere) targetGeometry.computeBoundingSphere();
  // One ray per cutter vertex: without a BVH each ray tests every model triangle.
  if (!targetGeometry.boundsTree) accelerateGeometry(targetGeometry);
  const worldMatrix = new THREE.Matrix4().compose(
    targetTransform.position,
    new THREE.Quaternion().setFromEuler(targetTransform.rotation),
    targetTransform.scale,
  ).multiply(new THREE.Matrix4().makeTranslation(-targetCenter.x, -targetCenter.y, -targetCenter.z));
  const targetMesh = new THREE.Mesh(targetGeometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  targetMesh.matrixAutoUpdate = false;
  targetMesh.matrix.copy(worldMatrix);
  targetMesh.matrixWorld.copy(worldMatrix);

  try {
    const targetRadius = (targetGeometry.boundingSphere?.radius ?? 0)
      * Math.max(Math.abs(targetTransform.scale.x), Math.abs(targetTransform.scale.y), Math.abs(targetTransform.scale.z));
    const rayReach = Math.max(10, targetRadius * 2 + heightMm + projectionThicknessMm);
    const raycaster = new THREE.Raycaster();
    raycaster.near = 0;
    raycaster.far = rayReach * 2;
    raycaster.ray.direction.copy(normal).negate();
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(worldMatrix);
    const pointCache = new Map<string, { point: THREE.Vector3; normal: THREE.Vector3 }>();
    const projectedNormal = new THREE.Vector3();
    const projectedPosition = new THREE.Vector3();

    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const y = position.getY(index);
      const cacheKey = `${x.toFixed(4)}:${y.toFixed(4)}`;
      let projected = pointCache.get(cacheKey);
      if (!projected) {
        raycaster.ray.origin.copy(anchor)
          .addScaledVector(rotatedTangentX, x)
          .addScaledVector(rotatedTangentY, y)
          .addScaledVector(normal, rayReach);
        const hit = raycaster.intersectObject(targetMesh, false)[0];
        if (!hit?.face) {
          tessellated.dispose();
          return null;
        }
        projectedNormal.copy(hit.face.normal).applyMatrix3(normalMatrix).normalize();
        projected = { point: hit.point.clone(), normal: projectedNormal.clone() };
        pointCache.set(cacheKey, projected);
      }

      const surfaceDepth = mode === 'relief'
        ? projectionThicknessMm / 2 - position.getZ(index) - BOOLEAN_SURFACE_OVERLAP_MM
        : position.getZ(index) - projectionThicknessMm / 2 + BOOLEAN_SURFACE_OVERLAP_MM;
      projectedPosition.copy(projected.point)
        .addScaledVector(projected.normal, surfaceDepth)
        .sub(anchor);
      position.setXYZ(index, projectedPosition.x, projectedPosition.y, projectedPosition.z);
    }

    if (mode === 'relief') {
      const index = tessellated.getIndex();
      if (index) {
        for (let triangle = 0; triangle < index.count; triangle += 3) {
          const second = index.getX(triangle + 1);
          index.setX(triangle + 1, index.getX(triangle + 2));
          index.setX(triangle + 2, second);
        }
        index.needsUpdate = true;
      }
    }

    position.needsUpdate = true;
    tessellated.computeVertexNormals();
    tessellated.computeBoundingBox();
    tessellated.computeBoundingSphere();
    const geometryCenter = tessellated.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
    return {
      geometry: tessellated,
      transform: {
        position: anchor.clone().add(geometryCenter),
        rotation: new THREE.Euler(),
        scale: new THREE.Vector3(1, 1, 1),
      },
    };
  } catch (error) {
    tessellated.dispose();
    throw error;
  } finally {
    targetMesh.material.dispose();
  }
}
