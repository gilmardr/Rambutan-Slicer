import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { useLingui } from '@lingui/react';
import type { EditorMenuAction } from '@/components/ui/EditorContextMenu';
import { renderWithProviders, settle } from '@/utils/__tests__/helpers/renderDom';
import { useEditorContextMenuItems, useEditorMenuActions } from '../useEditorContextMenu';

/**
 * Remesh and Shrink-Wrap live in the Editor menu's Repair flyout. The flyout is
 * rebuilt by useEditorContextMenuItems, which once dropped both entries, so their
 * confirm dialogs in Home could never open. This pins the entries and what they do.
 */

type Scene = Parameters<typeof useEditorContextMenuItems>[0]['scene'];

function fakeScene(activeModelId: string | null): Scene {
  return {
    mode: 'prepare',
    activeModelId,
    selectedModelIds: activeModelId ? [activeModelId] : [],
    manuallyRepairedModelIds: [],
    models: activeModelId ? [{ id: activeModelId, geometry: {} }] : [],
    canPasteModel: false,
  } as unknown as Scene;
}

type Captured = {
  items: ReadonlyArray<{ id: string; children?: ReadonlyArray<{ id: string }> }>;
  disabled: readonly EditorMenuAction[];
  act: (action: EditorMenuAction) => void;
};

function Probe({ scene, sink, onRemesh, onShrinkWrap, onClose }: {
  scene: Scene;
  sink: { current: Captured | null };
  onRemesh: (id: string | null) => void;
  onShrinkWrap: (id: string | null) => void;
  onClose: () => void;
}) {
  const { _ } = useLingui();
  const { editorContextMenuItems, editorContextMenuDisabledActions } = useEditorContextMenuItems({
    _,
    scene,
    editorContextMenuSupportTarget: null,
  });
  const { handleEditorMenuAction } = useEditorMenuActions({
    scene,
    arrangeSpacingMm: 2,
    closeEditorContextMenu: onClose,
    editorContextMenuSupportTarget: null,
    printingBaseResinMlCacheRef: { current: new Map() },
    printingEstimatedResinMlRef: { current: null },
    setPrintingEstimatedResinMl: () => {},
    supportAndRaftResinMl: 0,
    setAutoStartRepair: () => {},
    setManualRepairModelIds: () => {},
    setTetSurfaceConfirmModelId: (value) => onRemesh(typeof value === 'function' ? value(null) : value),
    setShrinkWrapConfirmModelId: (value) => onShrinkWrap(typeof value === 'function' ? value(null) : value),
  });
  sink.current = {
    items: editorContextMenuItems as Captured['items'],
    disabled: editorContextMenuDisabledActions as readonly EditorMenuAction[],
    act: handleEditorMenuAction,
  };
  return null;
}

async function mount(activeModelId: string | null) {
  const sink: { current: Captured | null } = { current: null };
  const calls = { remesh: [] as Array<string | null>, shrinkWrap: [] as Array<string | null>, closed: 0 };
  const tree = await renderWithProviders(
    <Probe
      scene={fakeScene(activeModelId)}
      sink={sink}
      onRemesh={(id) => calls.remesh.push(id)}
      onShrinkWrap={(id) => calls.shrinkWrap.push(id)}
      onClose={() => { calls.closed += 1; }}
    />,
  );
  await settle(20);
  assert.ok(sink.current, 'the hooks rendered');
  return { captured: sink.current, calls, tree };
}

test('the Repair flyout offers Remesh and Shrink-Wrap after Auto-Repair', async () => {
  const { captured, tree } = await mount('model-a');
  try {
    const repair = captured.items.find((item) => item.id === 'repair-menu');
    assert.ok(repair?.children, 'the Repair flyout exists');
    assert.deepEqual(repair.children.map((child) => child.id), ['repair', 'remesh', 'shrinkwrap']);
    assert.ok(!captured.disabled.includes('remesh'));
    assert.ok(!captured.disabled.includes('shrinkwrap'));
  } finally {
    await tree.unmount();
  }
});

test('Remesh and Shrink-Wrap open their confirmation for the active model', async () => {
  const { captured, calls, tree } = await mount('model-a');
  try {
    captured.act('remesh');
    captured.act('shrinkwrap');
    assert.deepEqual(calls.remesh, ['model-a']);
    assert.deepEqual(calls.shrinkWrap, ['model-a']);
    assert.equal(calls.closed, 2, 'each closes the menu');
  } finally {
    await tree.unmount();
  }
});

test('without an active model both entries are disabled and do nothing', async () => {
  const { captured, calls, tree } = await mount(null);
  try {
    assert.ok(captured.disabled.includes('remesh'));
    assert.ok(captured.disabled.includes('shrinkwrap'));
    captured.act('remesh');
    captured.act('shrinkwrap');
    assert.deepEqual(calls.remesh, []);
    assert.deepEqual(calls.shrinkWrap, []);
  } finally {
    await tree.unmount();
  }
});
