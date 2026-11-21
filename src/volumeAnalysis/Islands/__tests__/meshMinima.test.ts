import assert from 'node:assert/strict';
import test from 'node:test';

import { scanMeshMinima } from '../meshMinima';

test('mesh minima scan is a no-op outside the Tauri desktop runtime', async () => {
  const minima = await scanMeshMinima(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));

  assert.deepEqual(minima, []);
});
