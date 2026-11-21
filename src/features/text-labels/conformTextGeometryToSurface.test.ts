import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import * as THREE from 'three';
import { conformEngravingGeometryToSurface } from './conformTextGeometryToSurface';
import { createSolidMeshOperations } from '@/features/mesh-boolean/solidMeshOperations';

const require = createRequire(import.meta.url);
const kernelPromise = readFile(require.resolve('manifold-3d/manifold.wasm'))
  .then((wasmBinary) => createSolidMeshOperations({ wasmBinary }));

const identity = {
  position: new THREE.Vector3(),
  rotation: new THREE.Euler(),
  scale: new THREE.Vector3(1, 1, 1),
};

function signedVolume(positions: Float32Array, indices?: Uint32Array): number {
  const triangles = indices ?? Uint32Array.from({ length: positions.length / 3 }, (_, index) => index);
  let volume = 0;
  for (let index = 0; index < triangles.length; index += 3) {
    const a = triangles[index] * 3, b = triangles[index + 1] * 3, c = triangles[index + 2] * 3;
    volume += positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1])
      + positions[a + 1] * (positions[b + 2] * positions[c] - positions[b] * positions[c + 2])
      + positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c]);
  }
  return volume / 6;
}

test('text cutter follows a curved target and keeps its picked surface anchor', () => {
  const target = new THREE.SphereGeometry(5, 64, 32);
  const source = new THREE.BoxGeometry(4, 3, 1);
  const anchor = new THREE.Vector3(0, 0, 5);
  const result = conformEngravingGeometryToSurface(
    source,
    target,
    new THREE.Vector3(),
    identity,
    anchor,
    new THREE.Vector3(0, 0, 1),
    4,
    1,
  );

  assert.ok(result);
  assert.ok(result.geometry.getAttribute('position').count > source.getAttribute('position').count);
  assert.ok(result.transform.position.distanceTo(anchor) > 0);
  const positions = result.geometry.getAttribute('position');
  const worldZ: number[] = [];
  for (let index = 0; index < positions.count; index += 1) {
    worldZ.push(result.transform.position.z + positions.getZ(index) - result.geometry.boundingBox!.getCenter(new THREE.Vector3()).z);
  }
  assert.ok(Math.max(...worldZ) - Math.min(...worldZ) > 0.2, 'the cutter should follow the sphere curvature');

  result.geometry.dispose();
  target.dispose();
});

test('text cutter rejects a placement whose projected footprint leaves the model', () => {
  const target = new THREE.SphereGeometry(5, 16, 12).translate(0, 0, 100);
  const source = new THREE.BoxGeometry(4, 3, 1);
  const result = conformEngravingGeometryToSurface(
    source,
    target,
    new THREE.Vector3(),
    identity,
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, 1),
    4,
    1,
  );

  assert.equal(result, null);
  target.dispose();
});

test('curved text cutter stays a closed solid that can be subtracted from the target', async () => {
  const kernel = await kernelPromise;
  const target = new THREE.SphereGeometry(5, 64, 32);
  const source = new THREE.BoxGeometry(4, 3, 1);
  const anchor = new THREE.Vector3(0, 0, 5);
  const result = conformEngravingGeometryToSurface(
    source,
    target,
    new THREE.Vector3(),
    identity,
    anchor,
    new THREE.Vector3(0, 0, 1),
    4,
    1,
  );
  assert.ok(result);

  const toSolidMesh = (geometry: THREE.BufferGeometry, offset = new THREE.Vector3()) => {
    const position = geometry.getAttribute('position');
    const positions = new Float32Array(position.count * 3);
    for (let index = 0; index < position.count; index += 1) {
      positions[index * 3] = position.getX(index) + offset.x;
      positions[index * 3 + 1] = position.getY(index) + offset.y;
      positions[index * 3 + 2] = position.getZ(index) + offset.z;
    }
    return {
      positions,
      indices: geometry.index ? new Uint32Array(geometry.index.array) : undefined,
    };
  };

  const targetSolid = toSolidMesh(target);
  const cutterSolid = toSolidMesh(result.geometry, result.transform.position.clone()
    .sub(result.geometry.boundingBox!.getCenter(new THREE.Vector3())));
  assert.equal(kernel.split(targetSolid).length, 1, 'target mesh should be a valid solid');
  assert.ok(signedVolume(cutterSolid.positions, cutterSolid.indices) > 0, `cutter signed volume ${signedVolume(cutterSolid.positions, cutterSolid.indices)}`);
  assert.equal(kernel.split(cutterSolid).length, 1, 'curved text should be a valid solid');
  const carved = kernel.boolean('difference', [targetSolid, cutterSolid]);
  assert.ok(carved.positions.length > 0);
  result.geometry.dispose();
  target.dispose();
});
