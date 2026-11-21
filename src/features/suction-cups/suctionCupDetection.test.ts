import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { detectSuctionCups } from './suctionCupDetection';
import type { CollisionMeshInput } from '@/features/model-collision/modelCollision';

function boxSurfacePositions(size: number, omitTop = false): number[] {
  const geometry = new THREE.BoxGeometry(size, size, size);
  const position = geometry.getAttribute('position');
  const index = geometry.index;
  const positions: number[] = [];
  const triangleCount = index ? index.count / 3 : position.count / 3;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const points = [0, 1, 2].map((corner) => {
      const vertex = index ? index.getX(triangle * 3 + corner) : triangle * 3 + corner;
      return new THREE.Vector3().fromBufferAttribute(position, vertex);
    });
    if (omitTop && points.every((point) => Math.abs(point.z - size / 2) < 1e-6)) continue;
    for (const point of points) positions.push(point.x, point.y, point.z);
  }
  geometry.dispose();
  return positions;
}

function meshInput(positions: number[], reducedPreview = false): CollisionMeshInput {
  return {
    id: 'test-model',
    plateId: 'plate-1',
    positions: new Float32Array(positions),
    worldMatrix: new THREE.Matrix4().toArray(),
    reducedPreview,
  };
}

test('suction cup report exposes voxel precision and detects a trapped air cavity', () => {
  const report = detectSuctionCups(meshInput([
    ...boxSurfacePositions(10),
    ...boxSurfacePositions(6),
  ], true));

  assert.ok(report);
  assert.equal(report.voxelSizeMm, 0.35);
  assert.equal(report.reducedPreview, true);
  assert.equal(report.oddRayColumnRatio, 0);
  assert.ok(report.findings.length > 0, 'the enclosed cavity is reported');
  assert.ok(report.findings[0].maxSpillDepthMm >= report.voxelSizeMm * 2);
});

test('open mesh crossings are surfaced as an inconclusive scan signal', () => {
  const report = detectSuctionCups(meshInput(boxSurfacePositions(10, true)));

  assert.ok(report);
  assert.ok(report.oddRayColumnRatio > 0.08, 'the panel warning threshold is exceeded');
});

test('invalid mesh input returns no suction cup report', () => {
  const report = detectSuctionCups(meshInput([0, 0, 0, Number.NaN, 1, 0, 0, 1, 0]));
  assert.equal(report, null);
});
