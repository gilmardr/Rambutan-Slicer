import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import type * as THREE from 'three';
import { createImageCutterGeometry, type EngravingPixels } from './createImageCutterGeometry';
import { createSolidMeshOperations } from '@/features/mesh-boolean/solidMeshOperations';

const require = createRequire(import.meta.url);
const kernelPromise = readFile(require.resolve('manifold-3d/manifold.wasm'))
  .then((wasmBinary) => createSolidMeshOperations({ wasmBinary }));

/** Builds RGBA pixels from rows of '#' (opaque black) and '.' (transparent). */
function pixelsFrom(rows: string[]): EngravingPixels {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) => [...row].forEach((char, x) => {
    if (char === '#') data[(y * width + x) * 4 + 3] = 255;
  }));
  return { data, width, height };
}

function solidFrom(geometry: THREE.BufferGeometry) {
  return {
    positions: Float32Array.from(geometry.getAttribute('position').array as ArrayLike<number>),
    indices: Uint32Array.from(geometry.getIndex()!.array as ArrayLike<number>),
  };
}

function maxEdgeUse(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex()!;
  const counts = new Map<string, number>();
  for (let i = 0; i < index.count; i += 3) {
    for (let edge = 0; edge < 3; edge += 1) {
      const p = index.getX(i + edge);
      const q = index.getX(i + ((edge + 1) % 3));
      const key = p < q ? `${p}:${q}` : `${q}:${p}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return Math.max(...counts.values());
}

for (const [name, rows] of [
  ['falling diagonal', ['#.', '.#']],
  ['rising diagonal', ['.#', '#.']],
  ['checkerboard', ['#.#', '.#.', '#.#']],
] as const) {
  test(`image cutter stays a valid solid when pixels touch only at a corner (${name})`, async () => {
    const geometry = createImageCutterGeometry(pixelsFrom([...rows]), 4, 1);
    assert.ok(geometry);
    assert.equal(maxEdgeUse(geometry), 2, 'every edge belongs to exactly two faces');

    const kernel = await kernelPromise;
    const parts = kernel.split(solidFrom(geometry));
    const activePixels = rows.join('').split('').filter((char) => char === '#').length;
    assert.equal(parts.length, activePixels, 'each diagonal pixel is its own closed solid');
    geometry.dispose();
  });
}

test('image cutter keeps edge-adjacent pixels in one solid', async () => {
  const geometry = createImageCutterGeometry(pixelsFrom(['##', '#.']), 4, 1);
  assert.ok(geometry);
  const kernel = await kernelPromise;
  assert.equal(kernel.split(solidFrom(geometry)).length, 1);
  geometry.dispose();
});
