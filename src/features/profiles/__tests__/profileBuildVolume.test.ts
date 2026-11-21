import assert from 'node:assert/strict';
import test from 'node:test';

import { addPrinterProfile, getProfileStoreSnapshot, setActivePrinterProfile, type MaterialProfile } from '../profileStore';
import { resolveSliceRasterSettings } from '@/features/slicing/sliceJobAssembly';

test('automatic build volume follows the selected printer resolution and pixel size', () => {
  const printerId = addPrinterProfile({
    name: 'Auto volume regression',
    buildDimensionMode: 'auto',
    pixelSize: { x: 48.23, y: 37.65 },
    buildVolumeMm: { width: 218.88, depth: 122.88, height: 220 },
    display: { resolutionX: 2881, resolutionY: 1620, outputFormat: '.ctb', rotateScreen: true },
  });

  setActivePrinterProfile(printerId);
  const printer = getProfileStoreSnapshot().printerProfiles.find(({ id }) => id === printerId);

  assert.ok(printer);
  assert.equal(getProfileStoreSnapshot().activePrinterProfileId, printerId);
  assert.deepEqual(printer.buildVolumeMm, { width: 138.951, depth: 60.993, height: 220 });

  const rasterSettings = resolveSliceRasterSettings({
    printerProfile: printer,
    materialProfile: { layerHeightMm: 0.05 } as MaterialProfile,
  });
  assert.equal(rasterSettings.buildWidthMm, 60.993);
  assert.equal(rasterSettings.buildDepthMm, 138.951);
});

test('manual build volume stays unchanged when a printer has a pixel size', () => {
  const printerId = addPrinterProfile({
    name: 'Manual volume regression',
    buildDimensionMode: 'manual',
    pixelSize: { x: 50, y: 50 },
    buildVolumeMm: { width: 218.88, depth: 122.88, height: 220 },
    display: { resolutionX: 2880, resolutionY: 1620, outputFormat: '.ctb' },
  });
  const printer = getProfileStoreSnapshot().printerProfiles.find(({ id }) => id === printerId);

  assert.ok(printer);
  assert.deepEqual(printer.buildVolumeMm, { width: 218.88, depth: 122.88, height: 220 });
});
