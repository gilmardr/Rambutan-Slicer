import assert from 'node:assert/strict';
import test from 'node:test';
import { getSlicerLayerIndex, getSlicePreviewLayerNumber } from '../sliceLayerMapping';

test('maps scan-local layers to the real print layer when the model starts on a layer boundary', () => {
  assert.equal(getSlicerLayerIndex(0, 2, 0.05), 40);
  assert.equal(getSlicerLayerIndex(2, 2, 0.05), 42);
});

test('rounds the scan start upward when the model begins between print layers', () => {
  assert.equal(getSlicerLayerIndex(0, 2.01, 0.05), 41);
});

test('clamps below-plate model layers to the first printable layer', () => {
  assert.equal(getSlicerLayerIndex(0, -0.4, 0.05), 0);
});

test('converts the scan layer to the one-based printing preview layer', () => {
  assert.equal(getSlicePreviewLayerNumber(0, 2, 0.05), 41);
  assert.equal(getSlicePreviewLayerNumber(2, 2.01, 0.05), 44);
});
