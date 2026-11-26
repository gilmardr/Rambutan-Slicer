import assert from 'node:assert/strict';
import test from 'node:test';

import type * as ProfileStore from '../profileStore';

const HALOT_MAGE_PRESET_ID = 'creality-halot-mage-ctb-v4';

/**
 * A HALOT-MAGE profile saved before the preset switched to CXDLPv4 (preset
 * version 2) still says CTB, which the printer's firmware rejects. Loading the
 * store must move it to the preset's format, so export writes a file the
 * printer reads.
 */
function installBrowserStorage(seed: Record<string, string>): Map<string, string> {
  const store = new Map<string, string>(Object.entries(seed));
  const storage: Storage = {
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
  };
  const fakeWindow = {
    document: {},
    localStorage: storage,
    sessionStorage: storage,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  };
  Object.defineProperty(globalThis, 'window', { value: fakeWindow, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  return store;
}

function savedPrinter(id: string, display: Record<string, unknown>) {
  return {
    id,
    name: 'HALOT-MAGE',
    manufacturer: 'Creality',
    officialPresetId: HALOT_MAGE_PRESET_ID,
    officialPresetVersion: 2,
    isOfficial: true,
    isCustom: false,
    buildVolumeMm: { width: 228.096, depth: 128.304, height: 230 },
    display: { resolutionX: 7680, resolutionY: 4320, ...display },
  };
}

test('a saved HALOT-MAGE profile on CTB exports CXDLPv4 after loading', async () => {
  installBrowserStorage({
    'dragonfruit-profiles-v1': JSON.stringify({
      version: 3,
      state: {
        printerProfiles: [
          savedPrinter('printer-halot-mage-old', { outputFormat: '.ctb', formatVersion: 'v4' }),
          { ...savedPrinter('printer-halot-mage-custom', { outputFormat: '.ctb', formatVersion: 'v4' }), isOfficial: false, isCustom: true },
        ],
        materialProfiles: [],
        activePrinterProfileId: 'printer-halot-mage-old',
      },
    }),
  });

  const store: typeof ProfileStore = await import('../profileStore');
  const printers = store.getProfileStoreSnapshot().printerProfiles;

  const official = printers.find((entry) => entry.id === 'printer-halot-mage-old');
  assert.ok(official, 'the saved official profile survives loading');
  assert.equal(official.display.outputFormat, '.cxdlpv4');
  assert.equal(official.display.formatVersion, undefined);
  assert.equal(official.display.settingsMode, 'simple');

  const custom = printers.find((entry) => entry.id === 'printer-halot-mage-custom');
  assert.ok(custom, 'the saved custom profile survives loading');
  assert.equal(custom.display.outputFormat, '.ctb', 'a custom profile keeps the format its owner chose');
});
