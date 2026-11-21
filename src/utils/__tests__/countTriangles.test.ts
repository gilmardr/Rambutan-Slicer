import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { countConnectedMeshComponents, countTriangles } from '@/utils/geometry';

test('countTriangles counts an unindexed geometry by its corners', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(2 * 9), 3));
  assert.equal(countTriangles(geometry), 2);
});

test('countTriangles counts an indexed geometry by its index, not its shared vertices', () => {
  // A quad: four shared vertices, two triangles. Four over three is the 1.33 the
  // models panel used to show for indexed meshes.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  assert.equal(countTriangles(geometry), 2);
});

test('countTriangles is zero for a geometry with no positions', () => {
  assert.equal(countTriangles(new THREE.BufferGeometry()), 0);
});

test('countConnectedMeshComponents counts disconnected STL triangle shells', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    3, 0, 0, 4, 0, 0, 3, 1, 0,
    6, 0, 0, 7, 0, 0, 6, 1, 0,
    9, 0, 0, 10, 0, 0, 9, 1, 0,
  ], 3));

  assert.equal(countTriangles(geometry), 4);
  assert.equal(countConnectedMeshComponents(geometry), 4);
});

test('countConnectedMeshComponents joins indexed triangles that share an edge', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
  ], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);

  assert.equal(countConnectedMeshComponents(geometry), 1);
});
