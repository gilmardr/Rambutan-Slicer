import type { SolidMeshResult } from './solidMeshOperations';

export type MeshBounds = { min: readonly [number, number, number]; max: readonly [number, number, number] };

const MAX_EDGE_LENGTH_MM = 1;
const REFINEMENT_PASSES = 2;
const BOUNDS_PADDING_MM = 0.75;

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function triangleNearBounds(
  positions: number[],
  a: number,
  b: number,
  c: number,
  bounds: MeshBounds,
): boolean {
  for (let axis = 0; axis < 3; axis += 1) {
    const min = Math.min(positions[a * 3 + axis], positions[b * 3 + axis], positions[c * 3 + axis]);
    const max = Math.max(positions[a * 3 + axis], positions[b * 3 + axis], positions[c * 3 + axis]);
    if (max < bounds.min[axis] - BOUNDS_PADDING_MM || min > bounds.max[axis] + BOUNDS_PADDING_MM) return false;
  }
  return true;
}

function refinePass(mesh: SolidMeshResult, bounds: MeshBounds): SolidMeshResult {
  const positions = Array.from(mesh.positions);
  const indices = mesh.indices;
  const markedEdges = new Set<string>();
  const edgeLengthSq = (a: number, b: number) => {
    const x = positions[a * 3] - positions[b * 3];
    const y = positions[a * 3 + 1] - positions[b * 3 + 1];
    const z = positions[a * 3 + 2] - positions[b * 3 + 2];
    return x * x + y * y + z * z;
  };

  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];
    if (!triangleNearBounds(positions, a, b, c, bounds)) continue;
    if (edgeLengthSq(a, b) > MAX_EDGE_LENGTH_MM ** 2) markedEdges.add(edgeKey(a, b));
    if (edgeLengthSq(b, c) > MAX_EDGE_LENGTH_MM ** 2) markedEdges.add(edgeKey(b, c));
    if (edgeLengthSq(c, a) > MAX_EDGE_LENGTH_MM ** 2) markedEdges.add(edgeKey(c, a));
  }
  if (!markedEdges.size) return mesh;

  const midpointIndices = new Map<string, number>();
  const midpoint = (a: number, b: number): number => {
    const key = edgeKey(a, b);
    const existing = midpointIndices.get(key);
    if (existing !== undefined) return existing;
    const index = positions.length / 3;
    positions.push(
      (positions[a * 3] + positions[b * 3]) / 2,
      (positions[a * 3 + 1] + positions[b * 3 + 1]) / 2,
      (positions[a * 3 + 2] + positions[b * 3 + 2]) / 2,
    );
    midpointIndices.set(key, index);
    return index;
  };

  const refinedIndices: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];
    const boundary = [a];
    if (markedEdges.has(edgeKey(a, b))) boundary.push(midpoint(a, b));
    boundary.push(b);
    if (markedEdges.has(edgeKey(b, c))) boundary.push(midpoint(b, c));
    boundary.push(c);
    if (markedEdges.has(edgeKey(c, a))) boundary.push(midpoint(c, a));

    if (boundary.length === 3) {
      refinedIndices.push(a, b, c);
      continue;
    }

    const center = positions.length / 3;
    positions.push(
      (positions[a * 3] + positions[b * 3] + positions[c * 3]) / 3,
      (positions[a * 3 + 1] + positions[b * 3 + 1] + positions[c * 3 + 1]) / 3,
      (positions[a * 3 + 2] + positions[b * 3 + 2] + positions[c * 3 + 2]) / 3,
    );
    for (let edge = 0; edge < boundary.length; edge += 1) {
      refinedIndices.push(center, boundary[edge], boundary[(edge + 1) % boundary.length]);
    }
  }

  return { positions: Float32Array.from(positions), indices: Uint32Array.from(refinedIndices) };
}

/** Subdivides long edges around an engraving without moving the existing surface. */
export function refineEngravingTriangulation(mesh: SolidMeshResult, cutterBounds: MeshBounds): SolidMeshResult {
  let refined = mesh;
  for (let pass = 0; pass < REFINEMENT_PASSES; pass += 1) {
    const next = refinePass(refined, cutterBounds);
    if (next === refined) break;
    refined = next;
  }
  return refined;
}
