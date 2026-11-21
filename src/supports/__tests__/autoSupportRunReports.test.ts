import assert from 'node:assert/strict';
import test from 'node:test';

import { SUPPORT_TYPES } from '../supportTypeRegistry';
import type { AutoPlaceResult } from '../autoSupport/types';
import { buildAutoSupportModelReports, type AutoSupportModelRunReport } from '../autoSupport/autoSupportRunReports';

function emptyPlacedCounts(): AutoPlaceResult['placed'] {
  return Object.fromEntries(SUPPORT_TYPES.map(({ id }) => [id, 0])) as AutoPlaceResult['placed'];
}

test('per-model results preserve scan skips and report each model count and rejection reason', () => {
  const reports: AutoSupportModelRunReport[] = [
    { modelId: 'model-a', modelName: 'Part A', supportCount: 0 },
    { modelId: 'model-b', modelName: 'Part B', supportCount: 0 },
    { modelId: 'model-c', modelName: 'Part C', supportCount: 0, skipReason: 'scan-failed' },
  ];
  const result = {
    placed: { ...emptyPlacedCounts(), trunk: 3 },
    rejectedCandidates: 2,
    changed: true,
    status: 'placed',
    byModel: {
      'model-a': {
        placed: { ...emptyPlacedCounts(), trunk: 3 },
        rejectedCandidates: 0,
        status: 'placed',
        rejectionReasons: {},
        islandsCovered: 1,
        islandsUncovered: 0,
      },
      'model-b': {
        placed: emptyPlacedCounts(),
        rejectedCandidates: 2,
        status: 'placed',
        rejectionReasons: { grid_reject_collision: 2 },
        islandsCovered: 0,
        islandsUncovered: 1,
      },
    },
  } as AutoPlaceResult;

  assert.deepEqual(
    buildAutoSupportModelReports(reports, [{ modelId: 'model-a' }, { modelId: 'model-b' }], result),
    [
      { modelId: 'model-a', modelName: 'Part A', supportCount: 3 },
      { modelId: 'model-b', modelName: 'Part B', supportCount: 0, skipReason: 'collision' },
      { modelId: 'model-c', modelName: 'Part C', supportCount: 0, skipReason: 'scan-failed' },
    ],
  );
});

test('a missing model result in a batch is reported as a per-model failure', () => {
  const result = {
    placed: emptyPlacedCounts(),
    rejectedCandidates: 0,
    changed: false,
    status: 'placed',
    byModel: {},
  } as AutoPlaceResult;
  const reports: AutoSupportModelRunReport[] = [
    { modelId: 'model-a', modelName: 'Part A', supportCount: 0 },
    { modelId: 'model-b', modelName: 'Part B', supportCount: 0 },
  ];

  assert.deepEqual(
    buildAutoSupportModelReports(reports, [{ modelId: 'model-a' }, { modelId: 'model-b' }], result)
      .map(({ modelId, skipReason }) => [modelId, skipReason]),
    [['model-a', 'run-failed'], ['model-b', 'run-failed']],
  );
});

test('single-model result supports the legacy aggregate result shape', () => {
  const result = {
    placed: { ...emptyPlacedCounts(), trunk: 2 },
    rejectedCandidates: 0,
    changed: true,
    status: 'placed',
  } as AutoPlaceResult;

  assert.deepEqual(
    buildAutoSupportModelReports(
      [{ modelId: 'model-a', modelName: 'Part A', supportCount: 0 }],
      [{ modelId: 'model-a' }],
      result,
    ),
    [{ modelId: 'model-a', modelName: 'Part A', supportCount: 2 }],
  );
});
