import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { scanModelCollisions, type CollisionMeshInput } from './modelCollision';

function box(id: string, plateId: string, size: [number, number, number], position: [number, number, number]): CollisionMeshInput {
  const geometry = new THREE.BoxGeometry(...size);
  const matrix = new THREE.Matrix4().makeTranslation(...position);
  const input = {
    id, plateId,
    positions: new Float32Array(geometry.getAttribute('position').array),
    indices: Uint32Array.from(geometry.index!.array),
    worldMatrix: matrix.toArray(),
    reducedPreview: false,
  };
  geometry.dispose();
  return input;
}

test('overlapping model surfaces are reported with their model IDs', () => {
  const report = scanModelCollisions([
    box('a', 'plate', [2, 2, 2], [0, 0, 0]),
    box('b', 'plate', [2, 2, 2], [1, 0, 0]),
  ]);
  assert.ok(report.pairs[0]?.location?.every(Number.isFinite));
  assert.deepEqual(report.pairs.map(({ modelIds, kind }) => ({ modelIds, kind })), [{ modelIds: ['a', 'b'], kind: 'surface-contact' }]);
});

test('a solid fully inside another is detected without a surface crossing', () => {
  const report = scanModelCollisions([
    box('outer', 'plate', [4, 4, 4], [0, 0, 0]),
    box('inner', 'plate', [1, 1, 1], [0.2, 0, 0]),
  ]);
  assert.ok(report.pairs[0]?.location?.every(Number.isFinite));
  assert.deepEqual(report.pairs.map(({ modelIds, kind }) => ({ modelIds, kind })), [{ modelIds: ['outer', 'inner'], kind: 'containment' }]);
});

test('models on separate plates do not form a collision pair', () => {
  const report = scanModelCollisions([
    box('a', 'plate-a', [2, 2, 2], [0, 0, 0]),
    box('b', 'plate-b', [2, 2, 2], [0, 0, 0]),
  ]);
  assert.deepEqual(report.pairs, []);
});

test('the scan leaves caller-owned geometry arrays unchanged', () => {
  const first = box('a', 'plate', [2, 2, 2], [0, 0, 0]);
  const second = box('b', 'plate', [2, 2, 2], [1, 0, 0]);
  const positions = first.positions.slice();
  const indices = second.indices!.slice();
  scanModelCollisions([first, second]);
  assert.deepEqual(first.positions, positions);
  assert.deepEqual(second.indices, indices);
});
