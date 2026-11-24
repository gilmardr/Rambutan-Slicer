import assert from 'node:assert/strict';
import test from 'node:test';
import { refineEngravingTriangulation } from './refineEngravingTriangulation';

test('engraving refinement shortens long planar edges beyond two passes', () => {
  const mesh = {
    positions: Float32Array.of(0, 0, 0, 16, 0, 0, 0, 1, 0),
    indices: Uint32Array.of(0, 1, 2),
  };
  const result = refineEngravingTriangulation(mesh, { min: [0, 0, 0], max: [16, 1, 0] });
  let area = 0;
  for (let i = 0; i < result.indices.length; i += 3) {
    const [a, b, c] = result.indices.slice(i, i + 3).map((index) => index * 3);
    const p = result.positions;
    const doubleArea = (p[b] - p[a]) * (p[c + 1] - p[a + 1])
      - (p[b + 1] - p[a + 1]) * (p[c] - p[a]);
    assert.ok(doubleArea > 0);
    area += doubleArea / 2;
    for (const [from, to] of [[a, b], [b, c], [c, a]]) {
      assert.ok(Math.hypot(p[from] - p[to], p[from + 1] - p[to + 1]) <= 1);
    }
  }
  assert.equal(area, 8);
  assert.deepEqual(result.positions.slice(0, mesh.positions.length), mesh.positions);
});

test('engraving refinement splits a closed mesh without introducing centroid fans', () => {
  const side = 1.2;
  const mesh = {
    positions: Float32Array.of(
      0, 0, 0,
      side, 0, 0,
      side / 2, side * Math.sqrt(3) / 2, 0,
      side / 2, side * Math.sqrt(3) / 6, side * Math.sqrt(2 / 3),
    ),
    indices: Uint32Array.of(0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3),
  };
  const result = refineEngravingTriangulation(mesh, { min: [0, 0, 0], max: [2, 2, 2] });
  assert.equal(result.positions.length / 3, 10, 'only shared edge midpoints are added');
  assert.equal(result.indices.length / 3, 16);
  assert.deepEqual(result.positions.slice(0, mesh.positions.length), mesh.positions);

  const directedEdges = new Set<string>();
  for (let i = 0; i < result.indices.length; i += 3) {
    for (let edge = 0; edge < 3; edge += 1) {
      const a = result.indices[i + edge];
      const b = result.indices[i + (edge + 1) % 3];
      const forward = `${a}:${b}`;
      assert.ok(!directedEdges.has(forward), 'an oriented edge occurs only once');
      directedEdges.add(forward);
    }
  }
  for (const edge of directedEdges) {
    const [a, b] = edge.split(':');
    assert.ok(directedEdges.has(`${b}:${a}`), 'adjacent faces share opposite edge directions');
  }
});
