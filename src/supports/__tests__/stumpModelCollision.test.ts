import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { resetStore } from '../state';
import { buildContactOverride } from '../supportTypeRegistry';
import { initializeBVH, accelerateGeometry } from '@/utils/bvh';
import { setSettings } from '../Settings/state';
import { createDefaultSettings } from '../Settings/types';
import { compactStumpFit } from '../SupportTypes/Stump/stumpBuilder';

/**
 * A stump must not print through the model.
 *
 * A stump stands where the model is close to the plate, and its socket end (the
 * joint ball plus the cone's wide end) sits a fixed millimetre above the plate.
 * An underside that clears the contact can still be met by that wide end, which
 * is how a rendered stump ends up as a blob with the surface cutting through it.
 * A type with its own contact override returns before the grid's collision gate,
 * so the stump checks its own body.
 */

const CONTACT_X = 0;
const CONTACT_Y = 0;

/** A 20 × 20 mm slab whose bottom face sits at `bottomZ`. */
function slabAt(bottomZ: number): THREE.Mesh {
  initializeBVH();
  const geometry = new THREE.BoxGeometry(20, 20, 2);
  accelerateGeometry(geometry);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.position.set(CONTACT_X, CONTACT_Y, bottomZ + 1);
  mesh.updateMatrixWorld(true);
  return mesh;
}

/** Place a stump on a downward-facing contact at the slab's bottom face. */
function placeStumpOn(bottomZ: number, mesh?: THREE.Mesh) {
  const override = buildContactOverride('stump');
  assert.ok(override, 'the stump registers a contact override');
  return override({
    tipPos: { x: CONTACT_X, y: CONTACT_Y, z: bottomZ },
    tipNormal: { x: 0, y: 0, z: -1 },
    modelId: 'model-a',
    mesh: mesh ?? slabAt(bottomZ),
  });
}

test('a contact lower than the full stump gets a compact stump that clears the model', () => {
  resetStore();
  setSettings(createDefaultSettings());

  // Contact 1.6 mm off the plate. A full stump stands its 1.5 mm joint ball on a
  // 1 mm root, so the ball would reach 1.85 mm, inside the slab: the point used to
  // be refused and left unsupported. The compact stump scales to the gap.
  const result = placeStumpOn(1.6);
  assert.equal(result?.refusal, undefined);
  const stump = result!.placed.entity as { rootHeight: number; joint: { pos: { z: number }; diameter: number } };
  assert.ok(stump.rootHeight < 1, `root shrinks (${stump.rootHeight.toFixed(2)} mm)`);
  assert.ok(stump.joint.pos.z + stump.joint.diameter / 2 < 1.6, 'the joint ball stays below the surface');
});

test('compact stump scaling keeps full size where it fits and a floor where it does not', () => {
  assert.equal(compactStumpFit(3, 0.1), 1, 'a stump with room keeps the full stack');
  assert.equal(compactStumpFit(2.4, 0.1), 1);
  const low = compactStumpFit(1.0, 0.1);
  assert.ok(low > 0.2 && low < 1, `1 mm tip scales (${low.toFixed(2)})`);
  assert.equal(compactStumpFit(0.05, 0.1), 0.2, 'never below the floor');
});

/** A rounded horn (capsule) tilted `tiltDeg` from vertical, lowest point at `tipZ`. */
function hornAt(tipZ: number, tiltDeg: number): { mesh: THREE.Mesh; tip: THREE.Vector3 } {
  initializeBVH();
  const horn = new THREE.CapsuleGeometry(1.5, 20, 12, 24).toNonIndexed();
  horn.rotateX(Math.PI / 2);
  horn.rotateY(-THREE.MathUtils.degToRad(tiltDeg));
  horn.computeBoundingBox();
  horn.translate(0, 0, tipZ - horn.boundingBox!.min.z);
  accelerateGeometry(horn);
  const position = horn.getAttribute('position');
  const tip = new THREE.Vector3(0, 0, Infinity);
  for (let i = 0; i < position.count; i++) {
    if (position.getZ(i) < tip.z) tip.set(position.getX(i), position.getY(i), position.getZ(i));
  }
  const mesh = new THREE.Mesh(horn, new THREE.MeshBasicMaterial());
  mesh.updateMatrixWorld(true);
  return { mesh, tip };
}

for (const [tipZ, tiltDeg] of [[0.75, 50], [1.0, 50], [1.5, 50], [1.0, 70], [1.0, 30]] as const) {
  test(`the low tip of a tilted horn (${tiltDeg}°, ${tipZ} mm off the plate) gets a stump`, () => {
    resetStore();
    setSettings(createDefaultSettings());
    const { mesh, tip } = hornAt(tipZ, tiltDeg);
    const override = buildContactOverride('stump')!;
    // The surface normal at the lowest point of a tilted horn leans sideways;
    // whichever axis the stump takes, the point must not be given up.
    const normal = new THREE.Vector3(Math.sin(THREE.MathUtils.degToRad(tiltDeg)) * 0.3, 0, -1).normalize();
    const result = override({
      tipPos: { x: tip.x, y: tip.y, z: tip.z },
      tipNormal: { x: normal.x, y: normal.y, z: normal.z },
      modelId: 'horn',
      mesh,
    });
    assert.equal(result?.refusal, undefined);
    assert.equal(result?.placed.typeId, 'stump');
  });
}

test('a stump that clears the model is placed', () => {
  resetStore();
  setSettings(createDefaultSettings());

  // Contact 2 mm off the plate: the 0.9 mm of cone plus the joint ball clear the
  // surface, which is what a stump is for.
  const result = placeStumpOn(2.0);
  assert.equal(result?.refusal, undefined);
  assert.equal(result?.placed.typeId, 'stump');
});

/** A ceiling slab the contact sits on, plus a wall standing beside the socket at `wallX`. */
function ceilingWithWall(wallX: number): THREE.Mesh {
  initializeBVH();
  const ceiling = new THREE.BoxGeometry(20, 20, 2).translate(0, 0, 4);
  const wall = new THREE.BoxGeometry(2, 2, 10).translate(wallX + 1, 0, 6);
  const merged = mergeGeometries([ceiling, wall], false);
  assert.ok(merged);
  accelerateGeometry(merged);
  const mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial());
  mesh.updateMatrixWorld(true);
  return mesh;
}

test('a stump whose body would run into a wall beside it is refused', () => {
  resetStore();
  setSettings(createDefaultSettings());

  // The ceiling is 3 mm up, so the cone is long and the socket ball clears it;
  // the wall's face is 0.5 mm from the socket's axis, inside the cone's own
  // radius. Nothing on the axis sees it.
  const result = placeStumpOn(3, ceilingWithWall(0.5));
  assert.equal(result?.refusal, 'COLLISION_WITH_MODEL');
});

test('the same stump with the wall moved away is placed', () => {
  resetStore();
  setSettings(createDefaultSettings());

  const result = placeStumpOn(3, ceilingWithWall(4));
  assert.equal(result?.refusal, undefined);
});

test('a stump on a model lifted well clear of the plate is placed', () => {
  resetStore();
  setSettings(createDefaultSettings());

  const result = placeStumpOn(30);
  assert.equal(result?.refusal, undefined);
});
