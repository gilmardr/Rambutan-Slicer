import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import type * as THREE from 'three';

export type SolidOperationSourceSnapshot = {
  id: string;
  geometry: THREE.BufferGeometry;
  positionAttribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
  positionVersion: number;
  indexAttribute: THREE.BufferAttribute | null;
  indexVersion: number;
  position: number[];
  rotation: Array<number | string | undefined>;
  scale: number[];
  plateId: string;
  modifiersFingerprint: string;
};

export type BooleanOperation = 'union' | 'difference' | 'intersection';
export type SolidMesh = { positions: Float32Array; indices?: Uint32Array };
export type SolidMeshResult = { positions: Float32Array; indices: Uint32Array };
export type SolidMeshErrorCode = 'invalid-input' | 'not-manifold' | 'empty-result' | 'cavity-split';

export class SolidMeshOperationError extends Error {
  constructor(public readonly code: SolidMeshErrorCode, public readonly inputIndex?: number) {
    super(code);
    this.name = 'SolidMeshOperationError';
  }
}

export type SolidMeshModuleOptions = {
  locateFile?: () => string;
  wasmBinary?: Uint8Array;
};

export type SolidMeshOperations = {
  boolean: (operation: BooleanOperation, meshes: readonly SolidMesh[]) => SolidMeshResult;
  split: (mesh: SolidMesh) => SolidMeshResult[];
};

/** Initialize once per worker. Native operations are synchronous; run them off the UI thread. */
export async function createSolidMeshOperations(options: SolidMeshModuleOptions = {}): Promise<SolidMeshOperations> {
  const { default: Module } = await import('manifold-3d');
  // Emscripten accepts wasmBinary; Manifold's declaration exposes only locateFile.
  const initialize = Module as (config: SolidMeshModuleOptions) => Promise<ManifoldToplevel>;
  const manifoldModule = await initialize(options);
  manifoldModule.setup();

  function read(mesh: SolidMesh, inputIndex: number, owned: Manifold[]): Manifold {
    const { positions, indices } = mesh;
    if (!(positions instanceof Float32Array) || positions.length < 12 || positions.length % 3 !== 0
      || (indices !== undefined && !(indices instanceof Uint32Array))) {
      throw new SolidMeshOperationError('invalid-input', inputIndex);
    }
    const vertexCount = positions.length / 3;
    const triangleIndices = indices?.slice() ?? Uint32Array.from({ length: vertexCount }, (_, i) => i);
    if (triangleIndices.length < 12 || triangleIndices.length % 3 !== 0
      || triangleIndices.some((index) => index >= vertexCount) || positions.some((value) => !Number.isFinite(value))) {
      throw new SolidMeshOperationError('invalid-input', inputIndex);
    }
    try {
      const input = new manifoldModule.Mesh({ numProp: 3, vertProperties: positions.slice(), triVerts: triangleIndices });
      // Reconnect STL triangle soup and duplicated render vertices along open edges.
      input.merge();
      const solid = new manifoldModule.Manifold(input);
      owned.push(solid);
      if (solid.status() !== 'NoError' || solid.isEmpty() || solid.volume() <= 0) {
        throw new SolidMeshOperationError('not-manifold', inputIndex);
      }
      return solid;
    } catch (error) {
      if (error instanceof SolidMeshOperationError) throw error;
      throw new SolidMeshOperationError('not-manifold', inputIndex);
    }
  }

  function write(solid: Manifold): SolidMeshResult {
    if (solid.status() !== 'NoError') throw new SolidMeshOperationError('not-manifold');
    if (solid.isEmpty() || solid.volume() <= 0) throw new SolidMeshOperationError('empty-result');
    const mesh = solid.getMesh();
    return { positions: mesh.vertProperties.slice(), indices: mesh.triVerts.slice() };
  }

  return {
    boolean(operation, meshes) {
      if (meshes.length < 2 || !['union', 'difference', 'intersection'].includes(operation)) {
        throw new SolidMeshOperationError('invalid-input');
      }
      const owned: Manifold[] = [];
      try {
        const inputs = meshes.map((mesh, index) => read(mesh, index, owned));
        const result = manifoldModule.Manifold[operation](inputs);
        owned.push(result);
        return write(result);
      } finally {
        for (const solid of owned.reverse()) solid.delete();
      }
    },
    split(mesh) {
      const owned: Manifold[] = [];
      try {
        const source = read(mesh, 0, owned);
        const parts = source.decompose();
        owned.push(...parts);
        // Decompose separates boundary shells, including inward-facing cavity walls.
        // Refuse that case instead of turning a void into a printable solid.
        if (parts.some((part) => part.volume() <= 0)) throw new SolidMeshOperationError('cavity-split', 0);
        return parts.map(write);
      } finally {
        for (const solid of owned.reverse()) solid.delete();
      }
    },
  };
}
