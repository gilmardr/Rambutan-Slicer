import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import test from 'node:test';
import { createRoot } from 'react-dom/client';
import Home from '@/app/page';
import { withProviders } from '@/utils/__tests__/helpers/renderDom';

/**
 * Characterization of what the page shows for one known model, written before
 * page.tsx is split into hooks. Each subtest pins a block that a split moves:
 * the resin and print estimate card, the model context menu, the main menu and
 * the new-scene flow. A split that changes any of it fails here.
 */

const reactGlobals = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A closed 10 mm cube: 1.00 ml of resin, 10 mm tall.
const CUBE_STL = `solid cube
${[
  [[0, 0, 0], [10, 0, 0], [10, 10, 0]], [[0, 0, 0], [10, 10, 0], [0, 10, 0]],
  [[0, 0, 10], [10, 10, 10], [10, 0, 10]], [[0, 0, 10], [0, 10, 10], [10, 10, 10]],
  [[0, 0, 0], [10, 0, 10], [10, 0, 0]], [[0, 0, 0], [0, 0, 10], [10, 0, 10]],
  [[0, 10, 0], [10, 10, 0], [10, 10, 10]], [[0, 10, 0], [10, 10, 10], [0, 10, 10]],
  [[0, 0, 0], [0, 10, 0], [0, 10, 10]], [[0, 0, 0], [0, 10, 10], [0, 0, 10]],
  [[10, 0, 0], [10, 10, 10], [10, 10, 0]], [[10, 0, 0], [10, 0, 10], [10, 10, 10]],
].map((tri) => `facet normal 0 0 0
outer loop
${tri.map((v) => `vertex ${v.join(' ')}`).join('\n')}
endloop
endfacet`).join('\n')}
endsolid cube
`;

// The importer reads the dropped file back through a `blob:` URL, which happy-dom's fetch
// refuses; the URL is Node's, so Node can resolve it.
const domFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const blob = url.startsWith('blob:') ? resolveObjectURL(url) : undefined;
  return blob ? new Response(await blob.arrayBuffer()) : domFetch(input, init);
}) as typeof fetch;

function reactProps(element: Element): Record<string, unknown> | undefined {
  const key = Object.keys(element).find((name) => name.startsWith('__reactProps$'));
  return key ? (element as unknown as Record<string, Record<string, unknown>>)[key] : undefined;
}

function dropCube(container: HTMLElement) {
  const target = Array.from(container.querySelectorAll('div')).find((element) => typeof reactProps(element)?.onDrop === 'function');
  assert.ok(target, 'the editor takes drops');
  const drop = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', {
    value: { files: [new File([CUBE_STL], 'cube.stl', { type: 'model/stl' })], types: ['Files'] },
  });
  target.dispatchEvent(drop);
}

const normalizedText = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ');

function menuItemLabels(menu: Element): string[] {
  return [...menu.querySelectorAll('[role=menuitem]')].map((item) => (item.textContent ?? '').trim());
}

/** The open menu that holds an item with this label. */
function findMenuWith(label: string): Element | undefined {
  return [...document.querySelectorAll('[role=menu]')].find((menu) => menuItemLabels(menu).includes(label));
}

test('page characterization with one 10 mm cube', async (t) => {
  // Not `act`, for the reason the page smoke test gives.
  const actEnvironment = reactGlobals.IS_REACT_ACT_ENVIRONMENT;
  reactGlobals.IS_REACT_ACT_ENVIRONMENT = false;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    root.render(withProviders(<Home />));
    await wait(500);
    dropCube(container);
    await wait(2500);

    // i18n-ignore-start: selectors and expectations against the English UI
    await t.test('the model card shows its resin and print estimates', () => {
      const text = normalizedText(container);
      assert.match(text, /cube\.stl/);
      assert.match(text, /Layers:200/);
      assert.match(text, /Est\. print time:—/);
      assert.match(text, /Model resin:1\.00 ml/);
      assert.match(text, /Supports resin:0\.00 ml/);
      assert.match(text, /Raft resin:0\.00 ml/);
      assert.match(text, /Total resin:1\.00 ml/);
      assert.match(text, /Triangles:12/);
      assert.match(text, /Height:10\.00 mm/);
    });

    await t.test('the model list context menu offers the model actions', async () => {
      const row = [...container.querySelectorAll('div')]
        .find((element) => element.textContent === 'cube.stl' && typeof reactProps(element)?.onContextMenu === 'function');
      assert.ok(row, 'the model row takes a context menu');
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
      await wait(300);
      const menu = findMenuWith('Rename model');
      assert.ok(menu, 'the model context menu opens');
      assert.deepEqual(menuItemLabels(menu), ['Rename model', 'Repair mesh…', 'Model actions…']);
    });

    await t.test('the main menu lists the scene actions', async () => {
      const menuButton = container.querySelector<HTMLButtonElement>('button[aria-label="Open Rambutan Slicer menu"]');
      assert.ok(menuButton);
      menuButton.click();
      await wait(300);
      const menu = findMenuWith('New scene');
      assert.ok(menu, 'the main menu opens');
      assert.deepEqual(menuItemLabels(menu), [
        'New scene',
        'Save scene',
        'Save scene as…',
        'Open scene…',
        'Import mesh…',
        'Import scene…',
        'Import diagnostics',
        'Close program',
      ]);
    });

    await t.test('a new scene over unsaved edits asks first, and discarding empties the scene', async () => {
      const newScene = [...document.querySelectorAll<HTMLElement>('[role=menuitem]')]
        .find((item) => item.textContent?.trim() === 'New scene');
      assert.ok(newScene);
      newScene.click();
      await wait(500);
      const dialog = [...document.querySelectorAll('[role=dialog], [role=alertdialog]')]
        .find((element) => (element.textContent ?? '').includes('Unsaved Scene Changes'));
      assert.ok(dialog, 'the unsaved-changes dialog opens');
      const buttons = [...dialog.querySelectorAll('button')].map((button) => (button.textContent ?? '').trim()).filter(Boolean);
      assert.deepEqual(buttons, ['Discard Changes', 'Save & New Scene']);
      assert.match(normalizedText(container), /cube\.stl/, 'nothing is cleared before the choice');

      const discard = [...dialog.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent?.trim() === 'Discard Changes');
      assert.ok(discard);
      discard.click();
      await wait(1500);
      const text = normalizedText(container);
      assert.match(text, /No models loaded/);
      assert.doesNotMatch(text, /cube\.stl/);
    });
    // i18n-ignore-end
  } finally {
    root.unmount();
    container.remove();
    reactGlobals.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
  }
});
