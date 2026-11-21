import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getDistanceMeasurementSnapshot,
  recordDistanceMeasurementPoint,
  setDistanceMeasurementMode,
  startDistanceMeasurement,
  stopDistanceMeasurement,
} from './distanceMeasurementStore';

test('selecting a measurement mode clears points and starts the tool in that mode', () => {
  startDistanceMeasurement();
  recordDistanceMeasurementPoint('model', [0, 0, 0]);

  setDistanceMeasurementMode('point-to-plane');

  assert.equal(getDistanceMeasurementSnapshot().enabled, true);
  assert.equal(getDistanceMeasurementSnapshot().mode, 'point-to-plane');
  assert.deepEqual(getDistanceMeasurementSnapshot().points, []);
  stopDistanceMeasurement();
});

test('the next click after a complete plane measurement starts a fresh one', () => {
  startDistanceMeasurement('point-to-plane');
  recordDistanceMeasurementPoint('point', [0, 0, 1]);
  recordDistanceMeasurementPoint('plane', [0, 0, 0]);
  recordDistanceMeasurementPoint('plane', [1, 0, 0]);
  recordDistanceMeasurementPoint('plane', [0, 1, 0]);
  recordDistanceMeasurementPoint('next-point', [2, 3, 4]);

  const { mode, points } = getDistanceMeasurementSnapshot();
  assert.equal(mode, 'point-to-plane');
  assert.deepEqual(points, [{ modelId: 'next-point', position: [2, 3, 4] }]);
  stopDistanceMeasurement();
});
