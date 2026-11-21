import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { BoxGeometry } from 'three';
import {
  createSolidMeshOperations,
  SolidMeshOperationError,
  type SolidMesh,
} from './solidMeshOperations';

const require = createRequire(import.meta.url);
const kernelPromise = readFile(require.resolve('manifold-3d/manifold.wasm'))
  .then((wasmBinary) => createSolidMeshOperations({ wasmBinary }));

function cube(size = 2, x = 0, soup = false): SolidMesh {
  const source = new BoxGeometry(size, size, size).translate(x, 0, 0);
  const geometry = soup ? source.toNonIndexed() : source;
  const mesh = {
    positions: new Float32Array(geometry.getAttribute('position').array),
    indices: geometry.index ? new Uint32Array(geometry.index.array) : undefined,
  };
  if (geometry !== source) geometry.dispose();
  source.dispose();
  return mesh;
}

function volume(mesh: SolidMesh): number {
  const p = mesh.positions;
  const indices = mesh.indices ?? Uint32Array.from({ length: p.length / 3 }, (_, i) => i);
  let total = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    total += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
      + p[a + 1] * (p[b + 2] * p[c] - p[b] * p[c + 2])
      + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return total / 6;
}

function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`);
}

test('overlapping cubes yield exact union, intersection, and ordered difference volumes', async () => {
  const kernel = await kernelPromise;
  const a = cube(), b = cube(2, 1);
  close(volume(kernel.boolean('union', [a, b])), 12);
  close(volume(kernel.boolean('intersection', [a, b])), 4);
  const difference = kernel.boolean('difference', [a, b]);
  close(volume(difference), 4);
  assert.ok(Math.max(...difference.positions.filter((_, i) => i % 3 === 0)) <= 0);
});

test('batch difference subtracts all other operands from the first', async () => {
  const kernel = await kernelPromise;
  close(volume(kernel.boolean('difference', [cube(4), cube(2, -1), cube(2, 1)])), 48);
});

test('non-indexed STL triangles are welded without modifying input arrays', async () => {
  const kernel = await kernelPromise;
  const a = cube(2, 0, true), b = cube(2, 1);
  const beforeA = a.positions.slice(), beforeB = b.indices!.slice();
  close(volume(kernel.boolean('union', [a, b])), 12);
  assert.deepEqual(a.positions, beforeA);
  assert.deepEqual(b.indices, beforeB);
});

test('disjoint solids split with volume and coordinates preserved', async () => {
  const kernel = await kernelPromise;
  const joined = kernel.boolean('union', [cube(), cube(2, 5)]);
  const parts = kernel.split(joined);
  assert.equal(parts.length, 2);
  close(parts.reduce((sum, part) => sum + volume(part), 0), 16);
  const minima = parts.map((p) => Math.min(...p.positions.filter((_, i) => i % 3 === 0))).sort((a, b) => a - b);
  assert.deepEqual(minima, [-1, 4]);
  assert.equal(kernel.split(cube()).length, 1);
});

test('empty intersections and fully consumed differences are explicit failures', async () => {
  const kernel = await kernelPromise;
  for (const [operation, meshes] of [
    ['intersection', [cube(), cube(2, 5)]],
    ['difference', [cube(), cube(4)]],
  ] as const) {
    assert.throws(() => kernel.boolean(operation, meshes), (error) =>
      error instanceof SolidMeshOperationError && error.code === 'empty-result');
  }
});

test('split never turns the inner shell of a hollow object into a solid model', async () => {
  const kernel = await kernelPromise;
  const hollow = kernel.boolean('difference', [cube(4), cube(2)]);
  close(volume(hollow), 56);
  assert.throws(() => kernel.split(hollow), (error) =>
    error instanceof SolidMeshOperationError && error.code === 'cavity-split');
});

test('malformed and open meshes fail with operand identity; kernel survives each failure', async () => {
  const kernel = await kernelPromise;
  const badIndex = cube(); badIndex.indices![0] = 999;
  const nonFinite = cube(); nonFinite.positions[0] = Infinity;
  const open = cube(); open.indices = open.indices!.slice(3);
  for (const mesh of [badIndex, nonFinite, open, { positions: new Float32Array(8) }]) {
    assert.throws(() => kernel.boolean('union', [cube(), mesh]), (error) =>
      error instanceof SolidMeshOperationError && error.inputIndex === 1);
    close(volume(kernel.boolean('union', [cube(), cube(2, 1)])), 12);
  }
  assert.throws(() => kernel.boolean('union', [cube()]), SolidMeshOperationError);
});

test('returned arrays own their storage after later operations and native deletion', async () => {
  const kernel = await kernelPromise;
  const result = kernel.boolean('union', [cube(), cube(2, 1)]);
  const positions = result.positions.slice(), indices = result.indices.slice();
  for (let i = 0; i < 12; i++) kernel.boolean('difference', [cube(4), cube(2, i / 10)]);
  assert.deepEqual(result.positions, positions);
  assert.deepEqual(result.indices, indices);
  close(volume(result), 12);
});
