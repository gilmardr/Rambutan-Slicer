import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { BoxGeometry, Euler, Vector3 } from 'three';
import { renderWithProviders, settle } from '@/utils/__tests__/helpers/renderDom';
import { AutoRotationPanel } from '../AutoRotationPanel';

test('orientation panel compares three choices, clears stale results on mode change and applies the selected tilt', async () => {
    const geometry = new BoxGeometry(40, 30, 3);
    const applications: Array<{ id: string; rotation: Euler | undefined }> = [];
    const tree = await renderWithProviders(
        <AutoRotationPanel
            activeModelId="slab"
            geometry={geometry}
            currentRotation={new Euler()}
            scale={new Vector3(1, 1, 1)}
            layerHeightMm={0.1}
            autoLift
            onApplyRotation={(id, rotation, complete) => { applications.push({ id, rotation }); complete(true); }}
        />,
    );
    const buttons = (label: string) => [...tree.container.querySelectorAll('button')]
        .filter((button) => button.textContent?.trim() === label);

    try {
        const mode = tree.container.querySelector<HTMLElement>('[role="combobox"][aria-label="Orientation objective"]');
        assert.ok(mode);
        const compare = async () => {
            assert.equal(buttons('Compare orientations').length, 1);
            await act(async () => buttons('Compare orientations')[0].click());
            for (let i = 0; i < 20 && buttons('Apply orientation').length === 0; i += 1) await settle(20);
            assert.equal(buttons('Apply orientation').length, 3, tree.container.textContent ?? '');
        };

        await compare();
        assert.match(tree.container.textContent ?? '', /smaller area jumps/);
        assert.equal(tree.container.querySelectorAll('[role="img"]').length, 3);
        assert.equal(applications.length, 0);

        await act(async () => mode.click());
        const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
        assert.deepEqual(options.map((option) => option.textContent?.trim()), [
            'Lowest support consumption', 'Highest print safety', 'Best surface quality',
        ]);
        await act(async () => options[2].click());
        assert.equal(buttons('Apply orientation').length, 0);
        await compare();
        assert.match(tree.container.textContent ?? '', /fine details and protected faces/);

        await act(async () => buttons('Apply orientation')[1].click());
        assert.equal(applications.length, 1);
        assert.equal(applications[0].id, 'slab');
        assert.ok(applications[0].rotation instanceof Euler);
        assert.equal(buttons('Apply orientation').length, 0);
    } finally {
        await tree.unmount();
        geometry.dispose();
    }
});
