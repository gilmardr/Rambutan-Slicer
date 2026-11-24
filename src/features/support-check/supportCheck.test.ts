import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  classifySupportCheckIslands,
  clampSupportCheckReach,
  supportCheckBounds,
  SUPPORT_CHECK_REACH_MM,
} from './supportCheck';
import type { DetectedIsland } from '@/volumeAnalysis/Islands/types';

// A 10 × 10 × 2 mm slab floating 5 mm above the plate, in world space.
function slabPositions(): Float32Array {
  const box = new THREE.BoxGeometry(10, 10, 2).translate(0, 0, 6).toNonIndexed();
  const positions = Float32Array.from(box.getAttribute('position').array as ArrayLike<number>);
  box.dispose();
  return positions;
}

function island(id: string, x: number, y: number, z: number): DetectedIsland {
  return { id, source: 'voxel', contact: new THREE.Vector3(x, y, z), baseZ: z, areaMm2: 4 };
}

const options = { baseZ: 0, layerHeightMm: 0.05, pxMm: 0.1, reachMm: 1.5 };

test('the scan includes the build plate under an elevated part and grounds the first layer of a raft', () => {
  for (const bottom of [0, 0.002, 5]) {
    const bounds = new THREE.Box3(new THREE.Vector3(0, 0, bottom), new THREE.Vector3(10, 10, 7));
    const scanBounds = supportCheckBounds(bounds);
    assert.equal(scanBounds.min.z, 0);
    assert.equal(bounds.min.z, bottom);
    const result = classifySupportCheckIslands(
      [island('first-layer', 2, 2, 0.05), island('elevated', 2, 2, 5.05)],
      slabPositions(),
      { ...options, baseZ: scanBounds.min.z },
    );
    assert.equal(result.groundedCount, 1);
    assert.deepEqual(result.modelIslands.map(region => region.id), ['elevated']);
  }
});

test('regions on the model surface are support candidates; regions on supports are reported apart', () => {
  const result = classifySupportCheckIslands(
    [
      island('underside', 2, 2, 5.05), // on the slab underside (z = 5)
      island('side', 5.02, 0, 6), // on the slab side wall (x = 5)
      island('floating-support', 20, 20, 3), // far from the model: a support piece
    ],
    slabPositions(),
    options,
  );
  assert.deepEqual(result.modelIslands.map((i) => i.id), ['underside', 'side']);
  assert.deepEqual(result.supportIslands.map((i) => i.id), ['floating-support']);
  assert.equal(result.groundedCount, 0);
});

test('regions in the base layer stand on the plate and are not reported', () => {
  const result = classifySupportCheckIslands(
    [island('raft', 0, 0, 0.05), island('underside', 0, 0, 5.05)],
    slabPositions(),
    options,
  );
  assert.equal(result.groundedCount, 1);
  assert.deepEqual(result.modelIslands.map((i) => i.id), ['underside']);
});

test('with no model triangles every region counts as a support region', () => {
  const result = classifySupportCheckIslands([island('a', 0, 0, 3)], new Float32Array(), options);
  assert.equal(result.modelIslands.length, 0);
  assert.equal(result.supportIslands.length, 1);
});

test('reach distance is clamped to its documented range', () => {
  assert.equal(clampSupportCheckReach(Number.NaN), SUPPORT_CHECK_REACH_MM.defaultValue);
  assert.equal(clampSupportCheckReach(0), SUPPORT_CHECK_REACH_MM.min);
  assert.equal(clampSupportCheckReach(99), SUPPORT_CHECK_REACH_MM.max);
  assert.equal(clampSupportCheckReach(1.2), 1.2);
});

test('model regions carry the 5 mm coverage cell and the scan reach into auto-support', () => {
  const result = classifySupportCheckIslands([island('underside', 2, 2, 5.05)], slabPositions(), options);
  assert.deepEqual(result.modelIslands[0].supportCheck, { cellMm: 5, reachMm: 1.5 });
});
