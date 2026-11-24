import type { SolidMeshResult } from './solidMeshOperations';

export type MeshBounds = { min: readonly [number, number, number]; max: readonly [number, number, number] };

const MAX_EDGE_LENGTH_MM = 1;
const REFINEMENT_PASSES = 5;
const MAX_ADDED_TRIANGLES = 150_000;
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

function refinePass(mesh: SolidMeshResult, bounds: MeshBounds, maxIndices: number): SolidMeshResult {
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
    const vertices = [a, b, c];
    const split = vertices.map((from, side) => {
      const to = vertices[(side + 1) % 3];
      return markedEdges.has(edgeKey(from, to)) ? midpoint(from, to) : -1;
    });
    const unsplitCount = split.filter((index) => index === -1).length;
    // Each marked side adds one triangle. Keep the last complete conforming
    // pass if this pass would exceed the budget.
    if (refinedIndices.length + (indices.length - i) + 3 * (3 - unsplitCount) > maxIndices) {
      return mesh;
    }
    if (unsplitCount === 3) {
      refinedIndices.push(a, b, c);
    } else if (unsplitCount === 2) {
      const side = split.findIndex((index) => index !== -1);
      const from = vertices[side];
      const to = vertices[(side + 1) % 3];
      const opposite = vertices[(side + 2) % 3];
      refinedIndices.push(from, split[side], opposite, split[side], to, opposite);
    } else if (unsplitCount === 1) {
      // Rotate so the intact side is C–A. Choose the shorter diagonal of
      // the remaining quad after removing the triangle at B.
      const side = split.indexOf(-1);
      const from = vertices[(side + 1) % 3];
      const corner = vertices[(side + 2) % 3];
      const to = vertices[side];
      const first = split[(side + 1) % 3];
      const second = split[(side + 2) % 3];
      refinedIndices.push(first, corner, second);
      if (edgeLengthSq(from, second) <= edgeLengthSq(first, to)) {
        refinedIndices.push(from, first, second, from, second, to);
      } else {
        refinedIndices.push(from, first, to, first, second, to);
      }
    } else {
      const [ab, bc, ca] = split;
      refinedIndices.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
  }

  return { positions: Float32Array.from(positions), indices: Uint32Array.from(refinedIndices) };
}

/** Subdivides long edges around an engraving without moving the existing surface. */
export function refineEngravingTriangulation(mesh: SolidMeshResult, cutterBounds: MeshBounds): SolidMeshResult {
  const maxIndices = mesh.indices.length + MAX_ADDED_TRIANGLES * 3;
  let refined = mesh;
  for (let pass = 0; pass < REFINEMENT_PASSES; pass += 1) {
    const next = refinePass(refined, cutterBounds, maxIndices);
    if (next === refined) break;
    refined = next;
  }
  return refined;
}
