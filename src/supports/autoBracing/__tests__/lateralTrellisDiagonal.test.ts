import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAutoBracedSnapshot } from '../autoBrace';
import { createDefaultAutoBracingSettings } from '../settings';
import { getSettings, updateGridSettings } from '../../Settings/state';
import { createEmptySupportCollections } from '../../supportTypeRegistry';
import type { SupportState } from '../../types';

/** One vertical trunk per plan point, all on model `m`. */
function forest(points: ReadonlyArray<readonly [number, number]>, topZ = 20): SupportState {
    const snapshot: SupportState = {
        ...createEmptySupportCollections(),
        selectedId: null,
        selectedCategory: null,
        hoveredId: null,
        hoveredCategory: 'none',
        interactionWarning: null,
    };
    points.forEach(([x, y], i) => {
        snapshot.roots[`r${i}`] = {
            id: `r${i}`,
            modelId: 'm',
            transform: { pos: { x, y, z: 0 }, rot: { x: 0, y: 0, z: 0, w: 1 } },
            diameter: 3,
            diskHeight: 0.5,
            coneHeight: 0.5,
        };
        snapshot.trunks[`t${i}`] = {
            id: `t${i}`,
            typeId: 'trunk',
            modelId: 'm',
            rootId: `r${i}`,
            segments: [{ id: `s${i}`, diameter: 1, topJoint: { id: `j${i}`, pos: { x, y, z: topZ }, diameter: 1.2 } }],
        };
    });
    return snapshot;
}

/** Braced trunk pairs, as sorted `i-j` keys of the trunk indices. */
function bracedPairs(snapshot: SupportState): Set<string> {
    const pairs = new Set<string>();
    for (const brace of Object.values(snapshot.braces)) {
        const a = Number(snapshot.knots[brace.startKnotId]!.parentShaftId.slice(1));
        const b = Number(snapshot.knots[brace.endKnotId]!.parentShaftId.slice(1));
        pairs.add([a, b].sort((x, y) => x - y).join('-'));
    }
    return pairs;
}

function withGrid<T>(grid: { enabled: boolean; spacingMm?: number }, run: () => T): T {
    const previous = { ...getSettings().grid };
    updateGridSettings(grid);
    try {
        return run();
    } finally {
        updateGridSettings(previous);
    }
}

test('the lateral trellis braces supports that are diagonal neighbours on the grid', () => {
    withGrid({ enabled: true, spacingMm: 4 }, () => {
        // Two posts one grid cell apart on both axes: a plan diagonal.
        const result = buildAutoBracedSnapshot(forest([[0, 0], [4, 4]]), createDefaultAutoBracingSettings());
        assert.ok(result.generatedBraceCount > 0, 'diagonal neighbours get braced');
        assert.deepEqual([...bracedPairs(result.snapshot)], ['0-1']);
    });
});

test('without the lateral trellis the grid keeps braces on its rows and columns', () => {
    withGrid({ enabled: true, spacingMm: 4 }, () => {
        const settings = { ...createDefaultAutoBracingSettings(), lateralTrellisEnabled: false };
        const result = buildAutoBracedSnapshot(forest([[0, 0], [4, 4]]), settings);
        assert.equal(result.generatedBraceCount, 0);
    });
});

test('no generated brace runs through a third support', () => {
    // A fixed pseudo-random dense forest: before the fix about a hundred
    // braces here crossed the shaft of a post they were not joining.
    let seed = 1;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const points: Array<[number, number]> = [];
    for (let i = 0; i < 30; i++) points.push([random() * 15, random() * 15]);

    for (const grid of [{ enabled: false }, { enabled: true, spacingMm: 4 }]) {
        withGrid(grid, () => {
            const result = buildAutoBracedSnapshot(forest(points), createDefaultAutoBracingSettings());
            assert.ok(result.generatedBraceCount > 0);
            for (const brace of Object.values(result.snapshot.braces)) {
                const start = result.snapshot.knots[brace.startKnotId]!;
                const end = result.snapshot.knots[brace.endKnotId]!;
                const joined = new Set([start.parentShaftId, end.parentShaftId]);
                const dx = end.pos.x - start.pos.x;
                const dy = end.pos.y - start.pos.y;
                const lengthSq = dx * dx + dy * dy;
                points.forEach(([x, y], i) => {
                    if (joined.has(`s${i}`)) return;
                    // A post standing on an end is that end's twin: closer
                    // than one brace diameter, it cannot be bridged anyway.
                    if (Math.hypot(x - start.pos.x, y - start.pos.y) < 1.0
                        || Math.hypot(x - end.pos.x, y - end.pos.y) < 1.0) return;
                    const t = ((x - start.pos.x) * dx + (y - start.pos.y) * dy) / lengthSq;
                    if (t <= 0.05 || t >= 0.95) return;
                    const distance = Math.hypot(start.pos.x + t * dx - x, start.pos.y + t * dy - y);
                    // trunk radius 0.5 + brace radius 0.5
                    assert.ok(distance >= 1.0,
                        `grid ${grid.enabled ? 'on' : 'off'}: brace ${start.parentShaftId}-${end.parentShaftId} runs through t${i} (${distance.toFixed(2)} mm)`);
                });
            }
        });
    }
});
