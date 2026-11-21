import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { CollisionMeshInput } from '@/features/model-collision/modelCollision';

export type SuctionCupFinding = {
  id: string;
  voxelCount: number;
  estimatedVolumeMm3: number;
  estimatedSurfaceAreaMm2: number;
  maxSpillDepthMm: number;
  center: [number, number, number];
  radiusMm: number;
  surfacePoints: Float32Array;
};

export type SuctionCupReport = {
  modelId: string;
  voxelSizeMm: number;
  findings: SuctionCupFinding[];
  oddRayColumnRatio: number;
  reducedPreview: boolean;
};

export type SuctionCupWorkerResponse = { report: SuctionCupReport } | { error: true };

const MAX_GRID_AXIS = 120;
const MIN_VOXEL_SIZE_MM = 0.35;
const MIN_REGION_VOXELS = 8;
const MIN_SPILL_DEPTH_CELLS = 2;
const MAX_SURFACE_POINTS = 320;
const NO_SPILL = 0xffff;

function createGeometry(input: CollisionMeshInput): THREE.BufferGeometry | null {
  const vertexCount = input.positions.length / 3;
  const indexCount = input.indices?.length ?? vertexCount;
  if (!Number.isInteger(vertexCount) || vertexCount < 3 || input.positions.length % 3 !== 0
    || indexCount < 3 || indexCount % 3 !== 0
    || !input.positions.every(Number.isFinite)
    || input.indices?.some((index) => index >= vertexCount)
    || input.worldMatrix.length !== 16 || !input.worldMatrix.every(Number.isFinite)) return null;

  const matrix = new THREE.Matrix4().fromArray(input.worldMatrix);
  if (Math.abs(matrix.determinant()) < 1e-15) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(input.positions.slice(), 3));
  if (input.indices) geometry.setIndex(new THREE.BufferAttribute(input.indices.slice(), 1));
  geometry.applyMatrix4(matrix);
  geometry.computeBoundingBox();
  return geometry;
}

/** Finds air pockets whose lowest path to the outside must rise along build Z. */
export function detectSuctionCups(input: CollisionMeshInput): SuctionCupReport | null {
  const geometry = createGeometry(input);
  if (!geometry?.boundingBox) {
    geometry?.dispose();
    return null;
  }

  try {
    const bounds = geometry.boundingBox;
    const size = bounds.getSize(new THREE.Vector3());
    const largestSpan = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(largestSpan) || largestSpan <= 0) return null;

    const voxelSizeMm = Math.max(MIN_VOXEL_SIZE_MM, largestSpan / MAX_GRID_AXIS);
    const nx = Math.ceil(size.x / voxelSizeMm) + 2;
    const ny = Math.ceil(size.y / voxelSizeMm) + 2;
    const nz = Math.ceil(size.z / voxelSizeMm) + 2;
    const cellCount = nx * ny * nz;
    const originX = bounds.min.x - voxelSizeMm;
    const originY = bounds.min.y - voxelSizeMm;
    const originZ = bounds.min.z - voxelSizeMm;
    const indexOf = (x: number, y: number, z: number) => (z * ny + y) * nx + x;
    const solid = new Uint8Array(cellCount);
    const spill = new Uint16Array(cellCount);
    spill.fill(NO_SPILL);
    const bvh = new MeshBVH(geometry, { maxLeafTris: 10 });
    const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, 0, 1));
    const hitEpsilon = voxelSizeMm * 0.08;
    let oddRayColumns = 0;
    const columnCount = (nx - 2) * (ny - 2);

    for (let y = 1; y < ny - 1; y += 1) {
      for (let x = 1; x < nx - 1; x += 1) {
        ray.origin.set(originX + (x + 0.5) * voxelSizeMm, originY + (y + 0.5) * voxelSizeMm, originZ);
        const hits = bvh.raycast(ray, THREE.DoubleSide)
          .map((hit) => hit.point.z)
          .sort((a, b) => a - b);
        const crossings: number[] = [];
        for (const z of hits) {
          if (crossings.length === 0 || z - crossings[crossings.length - 1] > hitEpsilon) crossings.push(z);
        }
        if (crossings.length % 2 !== 0) oddRayColumns += 1;

        for (let crossing = 0; crossing + 1 < crossings.length; crossing += 2) {
          const start = Math.max(0, Math.ceil((crossings[crossing] - originZ) / voxelSizeMm - 0.5));
          const end = Math.min(nz, Math.ceil((crossings[crossing + 1] - originZ) / voxelSizeMm - 0.5));
          for (let z = start; z < end; z += 1) solid[indexOf(x, y, z)] = 1;
        }
      }
    }

    // A bucketed minimax flood records the lowest Z level at which each air
    // voxel can reach the outside. The cost is an integer grid layer.
    const queues: number[][] = Array.from({ length: nz }, () => []);
    const visitExterior = (x: number, y: number, z: number) => {
      const index = indexOf(x, y, z);
      if (solid[index] || spill[index] <= z) return;
      spill[index] = z;
      queues[z].push(index);
    };
    for (let z = 0; z < nz; z += 1) {
      for (let y = 0; y < ny; y += 1) {
        visitExterior(0, y, z);
        visitExterior(nx - 1, y, z);
      }
      for (let x = 1; x < nx - 1; x += 1) {
        visitExterior(x, 0, z);
        visitExterior(x, ny - 1, z);
      }
    }
    for (let y = 1; y < ny - 1; y += 1) {
      for (let x = 1; x < nx - 1; x += 1) {
        visitExterior(x, y, 0);
        visitExterior(x, y, nz - 1);
      }
    }

    const visitNeighbor = (index: number, level: number, x: number, y: number, z: number) => {
      const neighbor = indexOf(x, y, z);
      if (solid[neighbor]) return;
      const nextLevel = Math.max(level, z);
      if (nextLevel >= spill[neighbor]) return;
      spill[neighbor] = nextLevel;
      queues[nextLevel].push(neighbor);
    };
    for (let level = 0; level < nz; level += 1) {
      const queue = queues[level];
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const index = queue[cursor];
        if (spill[index] !== level) continue;
        const x = index % nx;
        const y = Math.floor(index / nx) % ny;
        const z = Math.floor(index / (nx * ny));
        if (x > 0) visitNeighbor(index, level, x - 1, y, z);
        if (x + 1 < nx) visitNeighbor(index, level, x + 1, y, z);
        if (y > 0) visitNeighbor(index, level, x, y - 1, z);
        if (y + 1 < ny) visitNeighbor(index, level, x, y + 1, z);
        if (z > 0) visitNeighbor(index, level, x, y, z - 1);
        if (z + 1 < nz) visitNeighbor(index, level, x, y, z + 1);
      }
    }

    const suspected = new Uint8Array(cellCount);
    for (let z = 1; z < nz - 1; z += 1) {
      for (let y = 1; y < ny - 1; y += 1) {
        for (let x = 1; x < nx - 1; x += 1) {
          const index = indexOf(x, y, z);
          if (solid[index]) continue;
          const spillZ = spill[index] === NO_SPILL ? nz - 1 : spill[index];
          if (spillZ - z >= MIN_SPILL_DEPTH_CELLS) suspected[index] = 1;
        }
      }
    }

    const visited = new Uint8Array(cellCount);
    const floodQueue = new Uint32Array(cellCount);
    const findings: SuctionCupFinding[] = [];
    const pitchSquared = voxelSizeMm * voxelSizeMm;
    for (let z = 1; z < nz - 1; z += 1) {
      for (let y = 1; y < ny - 1; y += 1) {
        for (let x = 1; x < nx - 1; x += 1) {
          const first = indexOf(x, y, z);
          if (!suspected[first] || visited[first]) continue;
          let head = 0;
          let tail = 0;
          let maxDepthCells = 0;
          let sumX = 0;
          let sumY = 0;
          let sumZ = 0;
          let minX = Infinity;
          let minY = Infinity;
          let minZ = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          let maxZ = -Infinity;
          const region: number[] = [];
          visited[first] = 1;
          floodQueue[tail++] = first;

          while (head < tail) {
            const index = floodQueue[head++];
            region.push(index);
            const cx = index % nx;
            const cy = Math.floor(index / nx) % ny;
            const cz = Math.floor(index / (nx * ny));
            const px = originX + (cx + 0.5) * voxelSizeMm;
            const py = originY + (cy + 0.5) * voxelSizeMm;
            const pz = originZ + (cz + 0.5) * voxelSizeMm;
            const spillZ = spill[index] === NO_SPILL ? nz - 1 : spill[index];
            maxDepthCells = Math.max(maxDepthCells, spillZ - cz);
            sumX += px; sumY += py; sumZ += pz;
            minX = Math.min(minX, px); minY = Math.min(minY, py); minZ = Math.min(minZ, pz);
            maxX = Math.max(maxX, px); maxY = Math.max(maxY, py); maxZ = Math.max(maxZ, pz);

            const add = (neighbor: number) => {
              if (!visited[neighbor] && suspected[neighbor]) {
                visited[neighbor] = 1;
                floodQueue[tail++] = neighbor;
              }
            };
            if (cx > 0) add(index - 1);
            if (cx + 1 < nx) add(index + 1);
            if (cy > 0) add(index - nx);
            if (cy + 1 < ny) add(index + nx);
            if (cz > 0) add(index - nx * ny);
            if (cz + 1 < nz) add(index + nx * ny);
          }

          if (region.length < MIN_REGION_VOXELS || maxDepthCells < MIN_SPILL_DEPTH_CELLS) continue;

          let boundaryFaces = 0;
          for (const index of region) {
            const cx = index % nx;
            const cy = Math.floor(index / nx) % ny;
            const cz = Math.floor(index / (nx * ny));
            if (cx > 0 && solid[index - 1]) boundaryFaces += 1;
            if (cx + 1 < nx && solid[index + 1]) boundaryFaces += 1;
            if (cy > 0 && solid[index - nx]) boundaryFaces += 1;
            if (cy + 1 < ny && solid[index + nx]) boundaryFaces += 1;
            if (cz > 0 && solid[index - nx * ny]) boundaryFaces += 1;
            if (cz + 1 < nz && solid[index + nx * ny]) boundaryFaces += 1;
          }

          const sampleCount = Math.min(MAX_SURFACE_POINTS, region.length);
          const surfacePoints = new Float32Array(sampleCount * 3);
          const point = new THREE.Vector3();
          for (let sample = 0; sample < sampleCount; sample += 1) {
            const index = region[Math.floor((sample * region.length) / sampleCount)];
            const cx = index % nx;
            const cy = Math.floor(index / nx) % ny;
            const cz = Math.floor(index / (nx * ny));
            point.set(originX + (cx + 0.5) * voxelSizeMm,
              originY + (cy + 0.5) * voxelSizeMm,
              originZ + (cz + 0.5) * voxelSizeMm);
            const closest = bvh.closestPointToPoint(point, undefined, 0, Infinity);
            const surfacePoint = closest?.point ?? point;
            surfacePoints[sample * 3] = surfacePoint.x;
            surfacePoints[sample * 3 + 1] = surfacePoint.y;
            surfacePoints[sample * 3 + 2] = surfacePoint.z;
          }

          const center: [number, number, number] = [sumX / region.length, sumY / region.length, sumZ / region.length];
          const radiusMm = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) * 0.5;
          findings.push({
            id: `${input.id}:${findings.length + 1}`,
            voxelCount: region.length,
            estimatedVolumeMm3: region.length * voxelSizeMm ** 3,
            estimatedSurfaceAreaMm2: boundaryFaces * pitchSquared,
            maxSpillDepthMm: maxDepthCells * voxelSizeMm,
            center,
            radiusMm,
            surfacePoints,
          });
        }
      }
    }

    findings.sort((a, b) => b.estimatedVolumeMm3 - a.estimatedVolumeMm3);
    findings.forEach((finding, index) => { finding.id = `${input.id}:${index + 1}`; });
    return {
      modelId: input.id,
      voxelSizeMm,
      findings,
      oddRayColumnRatio: columnCount === 0 ? 0 : oddRayColumns / columnCount,
      reducedPreview: input.reducedPreview,
    };
  } finally {
    geometry.dispose();
  }
}
