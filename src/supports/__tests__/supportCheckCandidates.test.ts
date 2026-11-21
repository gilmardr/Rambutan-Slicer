import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { candidatesFromIsland } from '../autoSupport/candidateGeneration';
import { footprintFromPoints } from '@/volumeAnalysis/Islands/voxelFootprint';
import type { DetectedIsland } from '@/volumeAnalysis/Islands/types';

// A flat 20 × 10 mm floating ceiling at z = 8, sampled every 0.25 mm.
function ceiling(supportCheck?: DetectedIsland['supportCheck']): DetectedIsland {
  const points: { x: number; y: number }[] = [];
  for (let x = 0.125; x < 20; x += 0.25) {
    for (let y = 0.125; y < 10; y += 0.25) points.push({ x, y });
  }
  return {
    id: 'check0',
    source: 'voxel',
    contact: new THREE.Vector3(0.125, 0.125, 8),
    baseZ: 8,
    areaMm2: 200,
    contactVoxels: footprintFromPoints(points),
    supportCheck,
  };
}

test('a support-check region gets one contact per 5 × 5 mm cell', () => {
  const candidates = candidatesFromIsland(ceiling({ cellMm: 5, reachMm: 1.5 }));
  assert.equal(candidates.length, 8, '20 × 10 mm = 4 × 2 cells');
  for (const candidate of candidates) {
    assert.equal(candidate.alreadySupportedRadiusMm, 1.5, 'the check reach replaces the 3 mm rule');
    assert.equal(candidate.tipPos.z, 8);
    const cx = Math.floor(candidate.tipPos.x / 5);
    const cy = Math.floor(candidate.tipPos.y / 5);
    assert.ok(Math.abs(candidate.tipPos.x - (cx + 0.5) * 5) <= 0.25, 'contact sits at the cell centre');
    assert.ok(Math.abs(candidate.tipPos.y - (cy + 0.5) * 5) <= 0.25, 'contact sits at the cell centre');
  }
  const cells = new Set(candidates.map((c) => `${Math.floor(c.tipPos.x / 5)}:${Math.floor(c.tipPos.y / 5)}`));
  assert.equal(cells.size, 8, 'no two contacts share a cell');
  const area = candidates.reduce((sum, c) => sum + c.islandAreaMm2, 0);
  assert.ok(Math.abs(area - 200) < 1e-6, 'the region area is split across its cells');
});

test('a small support-check region still gets a contact', () => {
  const tiny: DetectedIsland = {
    ...ceiling({ cellMm: 5, reachMm: 1 }),
    areaMm2: 1,
    contactVoxels: footprintFromPoints([{ x: 1, y: 1 }, { x: 1.25, y: 1 }]),
  };
  const candidates = candidatesFromIsland(tiny);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].alreadySupportedRadiusMm, 1);
});

test('ordinary islands keep their single-contact emission', () => {
  const candidates = candidatesFromIsland(ceiling());
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].alreadySupportedRadiusMm, undefined);
});
