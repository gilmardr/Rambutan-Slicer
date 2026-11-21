import assert from 'node:assert/strict';
import test from 'node:test';
import { computeRegionSpacing, GRID_SPACING_FLOOR_MM } from '../autoSupport/gridPlacement';
import { normalizeAutoSupportSettings } from '../autoSupport/settings';
import type { DetectedIsland } from '../../volumeAnalysis/Islands/types';

// A dense calibration whose raw spacing (≈1.9 mm) falls below the shipped floor.
const denseIsland = { id: 'flat', source: 'overhang', areaMm2: 64, overhangAngleDeg: 0 } as unknown as DetectedIsland;
const dense = { areaPerSupportMm2: 10, flatDensityBoost: 0.7, suctionAreaExponent: 0.15 };

test('grid spacing never drops below the shipped 2 mm floor by default', () => {
    const settings = normalizeAutoSupportSettings(dense);
    assert.equal(settings.gridSpacingFloorMm, undefined, 'the override is not a shipped default');
    assert.equal(computeRegionSpacing(denseIsland, settings), GRID_SPACING_FLOOR_MM);
    assert.equal(GRID_SPACING_FLOOR_MM, 2);
});

test('a spacing-floor override replaces the floor and is clamped', () => {
    const relaxed = normalizeAutoSupportSettings({ ...dense, gridSpacingFloorMm: 1.2 });
    const spacing = computeRegionSpacing(denseIsland, relaxed);
    assert.ok(spacing < GRID_SPACING_FLOOR_MM && spacing >= 1.2, `spacing ${spacing}`);

    assert.equal(normalizeAutoSupportSettings({ gridSpacingFloorMm: 0.01 }).gridSpacingFloorMm, 0.5);
    assert.equal(normalizeAutoSupportSettings({ gridSpacingFloorMm: 99 }).gridSpacingFloorMm, 5);
    assert.equal(
        normalizeAutoSupportSettings({ gridSpacingFloorMm: Number.NaN }).gridSpacingFloorMm,
        undefined,
    );
});
