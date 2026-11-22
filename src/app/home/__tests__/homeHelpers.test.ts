import assert from 'node:assert/strict';
import test from 'node:test';
import type { MessageDescriptor } from '@lingui/core';
import { EMPTY_HOME_SUPPORT_COLLECTIONS_SNAPSHOT } from '@/features/supports/supportSnapshotHelpers';
import { getRaftSettings } from '@/supports/Rafts/Crenelated/RaftState';
import {
  formatApproxPrintTimeLabel,
  formatEstimatedPrintTimeLabel,
  formatImportComplete,
  formatLastSuccessfulAutosave,
  formatProcessingElapsedLabel,
  formatSelectedModelCount,
} from '../homeFormatters';
import {
  areSortedNumberArraysEqual,
  countRecordEntries,
  createModelTransformKey,
  getDefaultHolePunchDepthMm,
  isAppMode,
  isTransformMode,
  PREPARE_TOOL_MODES,
} from '../homeUtils';
import { computeArrangeSupportBounds } from '../homeArrangeGeometry';

// The unit-test macro stub interpolates template messages, so the English text is the message.
const translate = (descriptor: MessageDescriptor, values?: Record<string, unknown>) =>
  (descriptor.message ?? descriptor.id).replace(/\{(\w+)\}/g, (_match, name: string) => String(values?.[name] ?? `{${name}}`));

test('print time labels split seconds into hours, minutes and seconds', () => {
  assert.equal(formatEstimatedPrintTimeLabel(translate, 65), '1 min 5 s');
  assert.equal(formatEstimatedPrintTimeLabel(translate, 3725.9), '1 h 2 min');
  assert.equal(formatEstimatedPrintTimeLabel(translate, -4), '0 min 0 s');
  assert.equal(formatApproxPrintTimeLabel(translate, 1500), '~25 min');
  assert.equal(formatApproxPrintTimeLabel(translate, 7260), '~2 h 1 min');
  assert.equal(formatProcessingElapsedLabel(translate, -3), '0 min 0 s');
});

test('count, plate and timestamp labels', () => {
  assert.equal(formatSelectedModelCount(translate, 1), '1 model');
  assert.equal(formatSelectedModelCount(translate, 3), '3 models');
  assert.equal(formatImportComplete(translate, 7), 'Import complete • Plate #7. Click Print Now when ready.');
  assert.equal(formatImportComplete(translate, null), 'Import complete. Click Print Now when ready.');
  assert.equal(
    formatLastSuccessfulAutosave(translate, '22/11/2026 10:00'),
    'Last successful autosave: 22/11/2026 10:00. Save your project manually.',
  );
});

test('model transform keys round every component to six decimals', () => {
  const key = createModelTransformKey('m1', {
    position: { x: 1, y: 2.0000004, z: -3 },
    rotation: { x: 0, y: 0.1234567, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  } as Parameters<typeof createModelTransformKey>[1]);
  assert.equal(key, 'm1|1.000000|2.000000|-3.000000|0.000000|0.123457|0.000000|1.000000|1.000000|1.000000');
});

test('hole punch default depth follows the shell, clamped to 1..120 mm', () => {
  assert.equal(getDefaultHolePunchDepthMm(2), 3);
  assert.equal(getDefaultHolePunchDepthMm(-10), 1);
  assert.equal(getDefaultHolePunchDepthMm(500), 120);
  assert.equal(getDefaultHolePunchDepthMm(1.234), 2.2);
});

test('history origin modes narrow known names only', () => {
  assert.equal(isAppMode('support'), true);
  assert.equal(isAppMode('slicing'), false);
  assert.equal(isTransformMode('hollowing'), true);
  assert.equal(isTransformMode('nonexistent'), false);
  assert.equal(PREPARE_TOOL_MODES.includes('hollowing'), false, 'Prepare never restores Support hollowing');
});

test('small record and array helpers', () => {
  assert.equal(countRecordEntries({ a: 1, b: 2 }), 2);
  assert.equal(countRecordEntries({}), 0);
  assert.equal(areSortedNumberArraysEqual([1, 2], [1, 2]), true);
  assert.equal(areSortedNumberArraysEqual([1, 2], [1, 3]), false);
  assert.equal(areSortedNumberArraysEqual([1], [1, 2]), false);
});

test('arrange support bounds are empty without supports', () => {
  const bounds = computeArrangeSupportBounds(EMPTY_HOME_SUPPORT_COLLECTIONS_SNAPSHOT, getRaftSettings());
  assert.equal(bounds.all.size, 0);
  assert.equal(bounds.supports.size, 0);
  assert.equal(bounds.rafts.size, 0);
});
