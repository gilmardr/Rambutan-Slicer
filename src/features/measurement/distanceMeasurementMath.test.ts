import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateMeasurement } from './distanceMeasurementMath';

test('point-to-point measurement returns the 3D distance and segment', () => {
  const result = calculateMeasurement('point-to-point', [
    { modelId: 'a', position: [0, 0, 0] },
    { modelId: 'a', position: [3, 4, 0] },
  ]);

  assert.equal(result?.distance, 5);
  assert.deepEqual(result?.segment, [[0, 0, 0], [3, 4, 0]]);
});

test('point-to-plane measurement returns perpendicular distance and projection', () => {
  const result = calculateMeasurement('point-to-plane', [
    { modelId: 'point', position: [1, 2, 4] },
    { modelId: 'plane', position: [0, 0, 0] },
    { modelId: 'plane', position: [1, 0, 0] },
    { modelId: 'plane', position: [0, 1, 0] },
  ]);

  assert.equal(result?.distance, 4);
  assert.deepEqual(result?.segment, [[1, 2, 4], [1, 2, 0]]);
});

test('point-to-plane rejects three collinear plane points', () => {
  const result = calculateMeasurement('point-to-plane', [
    { modelId: 'point', position: [0, 0, 1] },
    { modelId: 'plane', position: [0, 0, 0] },
    { modelId: 'plane', position: [1, 0, 0] },
    { modelId: 'plane', position: [2, 0, 0] },
  ]);

  assert.equal(result, null);
});

test('parallel-plane measurement returns their perpendicular separation', () => {
  const result = calculateMeasurement('plane-to-plane', [
    { modelId: 'plane-a', position: [0, 0, 0] },
    { modelId: 'plane-a', position: [1, 0, 0] },
    { modelId: 'plane-a', position: [0, 1, 0] },
    { modelId: 'plane-b', position: [0, 0, 5] },
    { modelId: 'plane-b', position: [1, 0, 5] },
    { modelId: 'plane-b', position: [0, 1, 5] },
  ]);

  assert.equal(result?.distance, 5);
  assert.deepEqual(result?.segment, [[0, 0, 0], [0, 0, 5]]);
});

test('plane-to-plane rejects non-parallel planes', () => {
  const result = calculateMeasurement('plane-to-plane', [
    { modelId: 'plane-a', position: [0, 0, 0] },
    { modelId: 'plane-a', position: [1, 0, 0] },
    { modelId: 'plane-a', position: [0, 1, 0] },
    { modelId: 'plane-b', position: [0, 0, 0] },
    { modelId: 'plane-b', position: [0, 1, 0] },
    { modelId: 'plane-b', position: [0, 0, 1] },
  ]);

  assert.equal(result, null);
});
