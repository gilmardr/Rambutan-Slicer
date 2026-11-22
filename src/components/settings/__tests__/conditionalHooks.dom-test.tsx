import assert from 'node:assert/strict';
import test from 'node:test';
import { act, useEffect, useState } from 'react';
import type { ProfileLocalMaterialSettingsAdapter } from '@/features/plugins/pluginRegistry';
import { renderWithProviders, settle } from '@/utils/__tests__/helpers/renderDom';
import { PluginLocalMaterialSettingsSections } from '../profileFormAtoms';

const ADAPTER: ProfileLocalMaterialSettingsAdapter = {
  outputFormat: '.test',
  displayName: 'Test Settings',
  fields: [{ key: 'exposureS', label: 'Exposure probe', kind: 'number', defaultValue: 2 }],
};

// Switching the Plugin Studio between a format with plugin material settings and one
// without them mounts and unmounts the settings body; the hooks must stay unconditional.
test('plugin material settings survive the adapter coming and going', async () => {
  const ref: { setAdapter: ((value: ProfileLocalMaterialSettingsAdapter | null) => void) | null } = { setAdapter: null };
  function Probe() {
    const [adapter, setAdapter] = useState<ProfileLocalMaterialSettingsAdapter | null>(null);
    const [values, setValues] = useState({});
    useEffect(() => {
      ref.setAdapter = setAdapter;
    });
    return (
      <PluginLocalMaterialSettingsSections
        outputFormat=".test"
        adapter={adapter}
        localSettingsByOutput={values}
        onChange={setValues}
      />
    );
  }

  const tree = await renderWithProviders(<Probe />);
  try {
    assert.equal(tree.container.textContent, '', 'nothing renders without an adapter');

    await act(async () => ref.setAdapter?.(ADAPTER));
    await settle(10);
    assert.match(tree.container.textContent ?? '', /Exposure probe/);

    await act(async () => ref.setAdapter?.(null));
    await settle(10);
    assert.equal(tree.container.textContent, '');

    await act(async () => ref.setAdapter?.(ADAPTER));
    await settle(10);
    assert.match(tree.container.textContent ?? '', /Exposure probe/);
  } finally {
    await tree.unmount();
  }
});
