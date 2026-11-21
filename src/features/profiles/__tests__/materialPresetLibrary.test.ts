import assert from 'node:assert/strict';
import test from 'node:test';

import { getMaterialPresetCompatibility, getMaterialPresetOrigin } from '../materialPresetLibrary';

test('material compatibility is explicit when printer restrictions are known or absent', () => {
  assert.equal(getMaterialPresetCompatibility(['printer-a', 'printer-b'], 'printer-a'), 'compatible');
  assert.equal(getMaterialPresetCompatibility(['printer-a'], 'custom-printer'), 'incompatible');
  assert.equal(getMaterialPresetCompatibility(['printer-*'], undefined), 'unverified');
  assert.equal(getMaterialPresetCompatibility([], 'printer-a'), 'not-specified');
});

test('material compatibility honors the printer catalog wildcard format', () => {
  assert.equal(getMaterialPresetCompatibility(['vendor-*'], 'vendor-model-2'), 'compatible');
  assert.equal(getMaterialPresetCompatibility(['vendor-*'], 'other-model'), 'incompatible');
});

test('material origin distinguishes built-in and installed profile sources', () => {
  const plugins = [
    {
      manifest: { schemaVersion: 1, id: 'built-in-resins', name: 'Built-in Resin Catalog', version: '1', materialPresets: [{ templateId: 'builtin-resin' }] },
      source: 'builtin' as const,
      enabled: true,
    },
    {
      manifest: { schemaVersion: 1, id: 'community-resins', name: 'Community Resin Catalog', version: '1', materialPresets: [{ templateId: 'community-resin' }] },
      source: 'github' as const,
      enabled: true,
    },
  ];

  assert.deepEqual(getMaterialPresetOrigin('builtin-resin', plugins), {
    pluginName: 'Built-in Resin Catalog',
    source: 'builtin',
  });
  assert.deepEqual(getMaterialPresetOrigin('community-resin', plugins), {
    pluginName: 'Community Resin Catalog',
    source: 'github',
  });
  assert.equal(getMaterialPresetOrigin('missing', plugins), null);
});
