import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { importStepOnWorker, type StepImportResult } from './stepImportWorkerClient';

function flattenNumericArray(value: unknown, fieldName: string): number[] {
  const flattened: number[] = [];
  const pending: unknown[] = [value];

  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === 'number') {
      flattened.push(current);
      continue;
    }

    if (Array.isArray(current) || (ArrayBuffer.isView(current) && !(current instanceof DataView))) {
      const values = current as unknown as ArrayLike<unknown>;
      for (let index = values.length - 1; index >= 0; index -= 1) {
        pending.push(values[index]);
      }
      continue;
    }

    throw new Error('The STEP importer returned invalid ' + fieldName + ' data.');
  }

  return flattened;
}

function geometryFromStepResult(result: StepImportResult): THREE.BufferGeometry {
  const meshes = result.meshes ?? [];
  const geometries = meshes.map((mesh) => {
    const positions = flattenNumericArray(mesh.attributes?.position?.array, 'position');
    if (positions.length === 0 || positions.length % 3 !== 0) {
      throw new Error('The STEP file contains a mesh with invalid vertex positions.');
    }

    const indices = mesh.index?.array === undefined
      ? []
      : flattenNumericArray(mesh.index.array, 'index');
    if (indices.length > 0 && indices.length % 3 !== 0) {
      throw new Error('The STEP file contains an incomplete triangle index.');
    }
    if (indices.length === 0 && positions.length % 9 !== 0) {
      throw new Error('The STEP file contains incomplete triangle data.');
    }

    const vertexCount = positions.length / 3;
    for (const index of indices) {
      if (!Number.isInteger(index) || index < 0 || index >= vertexCount) {
        throw new Error('The STEP file contains an invalid triangle index.');
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    if (indices.length > 0) geometry.setIndex(indices);

    const normalsSource = mesh.attributes?.normal?.array;
    if (normalsSource !== undefined) {
      const normals = flattenNumericArray(normalsSource, 'normal');
      if (normals.length === positions.length) {
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      }
    }
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    return geometry;
  });

  if (geometries.length === 0) {
    throw new Error('The STEP file does not contain any printable geometry.');
  }
  if (geometries.length === 1) return geometries[0];

  const merged = mergeGeometries(geometries, false);
  for (const geometry of geometries) geometry.dispose();
  if (!merged) {
    throw new Error('The STEP file contains geometry that could not be combined.');
  }
  return merged;
}

export async function parseStepGeometry(fileUrlOrBytes: string | Uint8Array): Promise<THREE.BufferGeometry> {
  let bytes: Uint8Array;
  let takeOwnership = false;
  if (fileUrlOrBytes instanceof Uint8Array) {
    bytes = fileUrlOrBytes;
  } else {
    const response = await fetch(fileUrlOrBytes);
    if (!response.ok) {
      throw new Error('Unable to read STEP file (HTTP ' + response.status + ').');
    }
    bytes = new Uint8Array(await response.arrayBuffer());
    takeOwnership = true;
  }

  const result = await importStepOnWorker(bytes, takeOwnership);
  if (result.success !== true) {
    const errorMessage = typeof result.error === 'string'
      ? result.error
      : result.error?.message;
    throw new Error(errorMessage || 'The STEP file could not be read.');
  }
  return geometryFromStepResult(result);
}
