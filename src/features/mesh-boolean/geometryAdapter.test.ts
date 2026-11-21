import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import type { LoadedModel } from '@/features/scene/useSceneCollectionManager';
import { solidMeshForModel, solidMeshBackToModel } from './geometryAdapter';

function makeModel(scaleX = 1): LoadedModel {
  const geometry = new THREE.BoxGeometry(2, 2, 2).translate(5, 3, 1);
  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox!.clone();
  return {
    id: 'model',
    name: 'Model',
    fileUrl: '',
    geometry: { geometry, bbox, center: bbox.getCenter(new THREE.Vector3()), size: bbox.getSize(new THREE.Vector3()), flatteningPlanes: [] },
    transform: {
      position: new THREE.Vector3(10, 20, 30),
      rotation: new THREE.Euler(0, 0, Math.PI / 2),
      scale: new THREE.Vector3(scaleX, 2, 1),
    },
    visible: true,
    color: '#ffffff',
    polygonCount: 12,
  };
}

function signedVolume(mesh: ReturnType<typeof solidMeshForModel>): number {
  const indices = mesh.indices!;
  let volume = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    volume += mesh.positions[a] * (mesh.positions[b + 1] * mesh.positions[c + 2] - mesh.positions[b + 2] * mesh.positions[c + 1])
      + mesh.positions[a + 1] * (mesh.positions[b + 2] * mesh.positions[c] - mesh.positions[b] * mesh.positions[c + 2])
      + mesh.positions[a + 2] * (mesh.positions[b] * mesh.positions[c + 1] - mesh.positions[b + 1] * mesh.positions[c]);
  }
  return volume / 6;
}

test('mesh conversion applies the displayed transform, geometry centering, and reflected winding', () => {
  const mesh = solidMeshForModel(makeModel(-1));
  assert.ok(Math.abs(signedVolume(mesh) - 16) < 1e-5);
  const center = new THREE.Vector3();
  for (let i = 0; i < mesh.positions.length; i += 3) center.add(new THREE.Vector3(
    mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2],
  ));
  center.divideScalar(mesh.positions.length / 3);
  assert.ok(center.distanceTo(new THREE.Vector3(10, 20, 30)) < 1e-5);
});

test('split output returns to source coordinates under rotated and scaled transforms', () => {
  const model = makeModel(1);
  const source = solidMeshForModel(model);
  const roundTrip = solidMeshBackToModel(source, model);
  const original = model.geometry.geometry;
  const originalPosition = original.getAttribute('position');
  const returnedPosition = roundTrip.getAttribute('position');
  assert.equal(returnedPosition.count, originalPosition.count);
  for (let i = 0; i < originalPosition.count; i += 1) {
    assert.ok(Math.abs(originalPosition.getX(i) - returnedPosition.getX(i)) < 1e-5);
    assert.ok(Math.abs(originalPosition.getY(i) - returnedPosition.getY(i)) < 1e-5);
    assert.ok(Math.abs(originalPosition.getZ(i) - returnedPosition.getZ(i)) < 1e-5);
  }
  roundTrip.dispose();
  original.dispose();
});
