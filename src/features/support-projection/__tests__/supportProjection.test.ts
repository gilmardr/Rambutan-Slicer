import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  beginSupportProjectionStroke,
  cancelSupportProjectionPreview,
  finishSupportProjectionStroke,
  getSupportProjectionTriangles,
  getSupportProjectionPreviewPoints,
  paintSupportProjectionSurface,
  setSupportProjectionSettings,
  type SupportProjectionSettings,
} from '../supportProjection';

const defaultSettings: SupportProjectionSettings = {
  brushRadiusMm: 5,
  borderIntervalMm: 5,
  infillIntervalMm: 5,
  maxAngleDeg: 70,
  borderEnabled: true,
  infillEnabled: true,
  doubleBorderEnabled: false,
  doubleBorderOffsetMm: 5,
  islandInfluenceEnabled: true,
  islandInfluenceMm: 5,
  pattern: 'grid',
  symmetryAxis: 'none',
  borderSupportPresetId: null,
  infillSupportPresetId: null,
  borderTag: null,
  infillTag: null,
};

function startStroke(geometry: THREE.BufferGeometry): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry);
  beginSupportProjectionStroke({ modelId: 'large-face', mesh, place: () => undefined });
  return mesh;
}

function downwardFacingGeometry(triangles: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(triangles, 3));
  return geometry;
}

test('projection brush selects a large face when its dab lands between its vertices', () => {
  setSupportProjectionSettings(defaultSettings);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0,
    100, 0, 0,
    0, 100, 0,
  ], 3));
  startStroke(geometry);

  paintSupportProjectionSurface('large-face', new THREE.Vector3(20, 20, 0));

  assert.deepEqual([...getSupportProjectionTriangles('large-face')], [0]);
  finishSupportProjectionStroke();
  cancelSupportProjectionPreview();
  geometry.dispose();
});

test('projection symmetry mirrors contacts onto an unpainted matching surface', () => {
  const geometry = downwardFacingGeometry([
    -10, -5, 0, -10, 5, 0, -5, -5, 0,
    10, -5, 0, 5, -5, 0, 10, 5, 0,
  ]);
  setSupportProjectionSettings({
    ...defaultSettings,
    brushRadiusMm: 2,
    borderIntervalMm: 2,
    infillIntervalMm: 2,
    islandInfluenceEnabled: false,
    symmetryAxis: 'x',
  });
  const mesh = startStroke(geometry);
  mesh.updateMatrixWorld(true);

  paintSupportProjectionSurface('large-face', new THREE.Vector3(-8, 0, 0));
  finishSupportProjectionStroke();

  const points = getSupportProjectionPreviewPoints('large-face');
  assert.ok(points.some((point) => point.x < 0), 'the painted side keeps its contacts');
  assert.ok(points.some((point) => point.x > 0), 'matching unpainted geometry receives mirrored contacts');

  cancelSupportProjectionPreview();
  geometry.dispose();
});

test('contour projection samples the painted region boundary', () => {
  const geometry = downwardFacingGeometry([
    -10, -10, 0, -10, 10, 0, 10, -10, 0,
    10, -10, 0, -10, 10, 0, 10, 10, 0,
  ]);
  setSupportProjectionSettings({
    ...defaultSettings,
    brushRadiusMm: 20,
    borderIntervalMm: 4,
    infillIntervalMm: 4,
    infillEnabled: false,
    islandInfluenceEnabled: false,
    pattern: 'contour',
  });
  const mesh = startStroke(geometry);
  mesh.updateMatrixWorld(true);

  paintSupportProjectionSurface('large-face', new THREE.Vector3(0, 0, 0));
  finishSupportProjectionStroke();

  const points = getSupportProjectionPreviewPoints('large-face');
  assert.ok(points.length >= 8, `expected sampled boundary contacts, received ${points.length}`);

  cancelSupportProjectionPreview();
  geometry.dispose();
});
