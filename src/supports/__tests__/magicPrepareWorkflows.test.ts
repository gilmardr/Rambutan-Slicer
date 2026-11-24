import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

import type * as WorkflowStore from '../autoSupport/magicPrepareWorkflows';

type Store = typeof WorkflowStore;
const require = createRequire(import.meta.url);
const STORE_PATH = require.resolve('../autoSupport/magicPrepareWorkflows.ts');
const STORAGE_KEY = 'magic-prepare-workflows-v1';

function installMemoryLocalStorage(): Map<string, string> {
    const values = new Map<string, string>();
    const stub: Storage = {
        get length() { return values.size; },
        key: (index) => [...values.keys()][index] ?? null,
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => { values.set(key, String(value)); },
        removeItem: (key) => { values.delete(key); },
        clear: () => { values.clear(); },
    };
    Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true, writable: true });
    return values;
}

function reloadStore(): Store {
    delete require.cache[STORE_PATH];
    return require(STORE_PATH) as Store;
}

test('Magic Prepare workflows save, replace by name, reload, and delete', () => {
    const storage = installMemoryLocalStorage();
    const store = reloadStore();
    const config = {
        orientationEnabled: true,
        supportsEnabled: true,
        optimizeEnabled: true,
        bracingEnabled: false,
        raftEnabled: true,
        arrangeAfterPrepare: true,
        saveProjectAfterPrepare: true,
        sliceAfterPrepare: true,
        supportScope: 'exterior' as const,
    };

    const id = store.saveMagicPrepareWorkflow('Miniature cleanup', config);
    assert.ok(id);
    assert.equal(store.getMagicPrepareWorkflowsSnapshot().length, 1);
    assert.deepEqual(JSON.parse(storage.get(STORAGE_KEY)!), [
        { id, name: 'Miniature cleanup', ...config },
    ]);

    const updatedId = store.saveMagicPrepareWorkflow(' miniature CLEANUP ', {
        ...config,
        bracingEnabled: true,
        supportScope: 'combined',
    });
    assert.equal(updatedId, id);
    assert.equal(store.getMagicPrepareWorkflowsSnapshot().length, 1);

    const reloaded = reloadStore();
    assert.equal(reloaded.getMagicPrepareWorkflowsSnapshot()[0].supportScope, 'combined');
    assert.equal(reloaded.getMagicPrepareWorkflowsSnapshot()[0].arrangeAfterPrepare, true);
    assert.equal(reloaded.getMagicPrepareWorkflowsSnapshot()[0].saveProjectAfterPrepare, true);
    assert.equal(reloaded.getMagicPrepareWorkflowsSnapshot()[0].sliceAfterPrepare, true);
    assert.equal(reloaded.deleteMagicPrepareWorkflow(id), true);
    assert.deepEqual(reloaded.getMagicPrepareWorkflowsSnapshot(), []);
    assert.equal(reloaded.deleteMagicPrepareWorkflow(id), false);
    assert.equal(store.saveMagicPrepareWorkflow('  ', config), null);
});

test('older workflows keep slicing enabled without opting in to new stages', () => {
    const storage = installMemoryLocalStorage();
    storage.set(STORAGE_KEY, JSON.stringify([{ id: 'legacy', name: 'Legacy', sliceAfterPrepare: true }]));
    const [workflow] = reloadStore().getMagicPrepareWorkflowsSnapshot();
    assert.equal(workflow.sliceAfterPrepare, true);
    assert.equal(workflow.arrangeAfterPrepare, false);
    assert.equal(workflow.saveProjectAfterPrepare, false);
});
