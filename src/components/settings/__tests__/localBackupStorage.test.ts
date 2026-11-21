import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldIncludeLocalStorageKeyInBackup } from '../localBackupStorage';

test('local backup includes app stores without a product prefix', () => {
  for (const key of [
    'support-settings',
    'support-presets-v1',
    'support-active-preset-id-v1',
    'auto-support-presets-v1',
    'auto-support-active-preset-id-v1',
    'magic-prepare-workflows-v1',
    'raft-settings',
    'mesh-appearance-settings',
    'import-defaults-v1',
    'workspace-camera-settings',
    'autoLift',
    'liftDistance',
    'ui-scale',
    'mesh-smoothing-settings',
  ]) {
    assert.equal(shouldIncludeLocalStorageKeyInBackup(key), true, key);
  }
});

test('local backup excludes unrelated unscoped storage keys', () => {
  assert.equal(shouldIncludeLocalStorageKeyInBackup('random-user-data'), false);
});
