import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addPrinterProfileFromPreset,
  getAvailablePrinterPresets,
  getMaterialProfilesForPrinter,
  getProfileStoreSnapshot,
} from '@/features/profiles/profileStore';
import { assembleSliceJob, describeSliceJobModel } from '../sliceJobAssembly';
import { cubeModel } from './helpers/captureAppSliceJob';

const HALOT_MAGE_PRESET_ID = 'creality-halot-mage-ctb-v4';

test('HALOT-MAGE profile assembles an export job for its CTB v4 screen', () => {
  const preset = getAvailablePrinterPresets().find((entry) => entry.presetId === HALOT_MAGE_PRESET_ID);
  assert.ok(preset, 'HALOT-MAGE official preset is registered');

  const profileId = addPrinterProfileFromPreset(HALOT_MAGE_PRESET_ID);
  const profile = getProfileStoreSnapshot().printerProfiles.find((entry) => entry.id === profileId);
  const materialProfile = getMaterialProfilesForPrinter(profileId)[0];
  assert.ok(profile, 'official HALOT-MAGE profile resolves through the profile store');
  assert.ok(materialProfile, 'profile store supplies a material for the printer');

  const job = assembleSliceJob({
    printerProfile: profile,
    materialProfile,
    scene: {
      totalLayers: 200,
      tallestObjectHeightMm: 10,
      models: [describeSliceJobModel(cubeModel('halot-mage-cube', 10))],
    },
  });

  assert.equal(profile.name, 'HALOT-MAGE');
  assert.equal(profile.networkSupport, undefined, 'this preset does not declare direct network sending');
  assert.equal(job.outputFormat, '.ctb');
  assert.equal(job.formatVersion, 'v4');
  assert.equal(job.sourceWidthPx, 7680);
  assert.equal(job.sourceHeightPx, 4320);
  assert.equal(job.buildWidthMm, 228.096);
  assert.equal(job.buildDepthMm, 128.304);
});
