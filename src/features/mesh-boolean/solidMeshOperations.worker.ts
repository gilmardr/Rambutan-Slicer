import { createSolidMeshOperations, type BooleanOperation, type SolidMesh } from './solidMeshOperations';

type Request = { id: number; operation: BooleanOperation | 'split'; meshes: SolidMesh[] };
type Response = { id: number; meshes: SolidMesh[]; error?: string };

const operations = createSolidMeshOperations({
  locateFile: () => new URL('/vendor/manifold.wasm', self.location.href).href,
});

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, operation, meshes } = event.data;
  try {
    const kernel = await operations;
    const result = operation === 'split'
      ? kernel.split(meshes[0])
      : [kernel.boolean(operation, meshes)];
    self.postMessage({ id, meshes: result } satisfies Response);
  } catch (error) {
    self.postMessage({ id, meshes: [], error: error instanceof Error ? error.message : 'operation-failed' } satisfies Response);
  }
};
