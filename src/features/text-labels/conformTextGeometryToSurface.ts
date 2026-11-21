import * as THREE from 'three';
import type { ModelTransform } from '@/hooks/useModelTransform';

function subdivideGeometry(geometry: THREE.BufferGeometry, maxEdgeMm: number): THREE.BufferGeometry {
  const sourceGeometry = geometry.index ? geometry.toNonIndexed() : geometry;
  if (sourceGeometry !== geometry) geometry.dispose();
  const source = sourceGeometry.getAttribute('position');
  if (!source || source.count % 3 !== 0) {
    sourceGeometry.dispose();
    return new THREE.BufferGeometry();
  }

  const triangleCount = source.count / 3;
  let maxTriangleEdgeSq = 0;
  const edgeA = new THREE.Vector3();
  const edgeB = new THREE.Vector3();
  const edgeC = new THREE.Vector3();
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    edgeA.fromBufferAttribute(source, triangle * 3);
    edgeB.fromBufferAttribute(source, triangle * 3 + 1);
    edgeC.fromBufferAttribute(source, triangle * 3 + 2);
    maxTriangleEdgeSq = Math.max(
      maxTriangleEdgeSq,
      edgeA.distanceToSquared(edgeB),
      edgeB.distanceToSquared(edgeC),
      edgeC.distanceToSquared(edgeA),
    );
  }
  const divisions = Math.max(1, Math.min(24, Math.ceil(Math.sqrt(maxTriangleEdgeSq) / maxEdgeMm)));
  const triangleOutputCount = divisions * divisions;
  const output = new Float32Array(triangleCount * triangleOutputCount * 3 * 3);
  let cursor = 0;

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = new THREE.Vector3().fromBufferAttribute(source, triangle * 3);
    const b = new THREE.Vector3().fromBufferAttribute(source, triangle * 3 + 1);
    const c = new THREE.Vector3().fromBufferAttribute(source, triangle * 3 + 2);
    const points = new Map<string, THREE.Vector3>();
    const point = (i: number, j: number) => {
      const key = `${i}:${j}`;
      let value = points.get(key);
      if (!value) {
        value = a.clone().multiplyScalar((divisions - i - j) / divisions)
          .addScaledVector(b, i / divisions)
          .addScaledVector(c, j / divisions);
        points.set(key, value);
      }
      return value;
    };
    const writeTriangle = (v0: THREE.Vector3, v1: THREE.Vector3, v2: THREE.Vector3) => {
      for (const vertex of [v0, v1, v2]) {
        output[cursor] = vertex.x;
        output[cursor + 1] = vertex.y;
        output[cursor + 2] = vertex.z;
        cursor += 3;
      }
    };

    for (let i = 0; i < divisions; i += 1) {
      for (let j = 0; j < divisions - i; j += 1) {
        const upperLeft = point(i, j);
        const upperRight = point(i + 1, j);
        const lowerLeft = point(i, j + 1);
        writeTriangle(upperLeft, upperRight, lowerLeft);
        if (i + j < divisions - 1) {
          writeTriangle(upperRight, point(i + 1, j + 1), lowerLeft);
        }
      }
    }
  }

  sourceGeometry.dispose();
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.BufferAttribute(output, 3));
  return result;
}

/** Projects a centered engraving solid onto a picked model surface to make a Boolean cutter. */
export function conformEngravingGeometryToSurface(
  engravingGeometry: THREE.BufferGeometry,
  targetGeometry: THREE.BufferGeometry,
  targetCenter: THREE.Vector3,
  targetTransform: ModelTransform,
  anchor: THREE.Vector3,
  surfaceNormal: THREE.Vector3,
  heightMm: number,
  thicknessMm: number,
): { geometry: THREE.BufferGeometry; transform: ModelTransform } | null {
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
  if (!targetGeometry.boundingSphere) targetGeometry.computeBoundingSphere();
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
    const rayReach = Math.max(10, targetRadius * 2 + heightMm + thicknessMm);
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
          .addScaledVector(tangentX, x)
          .addScaledVector(tangentY, y)
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

      const cutDepth = position.getZ(index) - thicknessMm / 2 + 0.08;
      projectedPosition.copy(projected.point)
        .addScaledVector(projected.normal, cutDepth)
        .sub(anchor);
      position.setXYZ(index, projectedPosition.x, projectedPosition.y, projectedPosition.z);
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
