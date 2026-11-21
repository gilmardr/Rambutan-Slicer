import type { BooleanOperation, SolidMesh, SolidMeshResult } from './solidMeshOperations';

type Response = { id: number; meshes: SolidMeshResult[]; error?: string };
let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (value: SolidMeshResult[]) => void; reject: (reason: Error) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./solidMeshOperations.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<Response>) => {
    const request = pending.get(event.data.id);
    if (!request) return;
    pending.delete(event.data.id);
    if (event.data.error) request.reject(new Error(event.data.error));
    else request.resolve(event.data.meshes);
  };
  worker.onerror = () => {
    worker?.terminate();
    worker = null;
    for (const request of pending.values()) request.reject(new Error('operation-failed'));
    pending.clear();
  };
  return worker;
}

export function runSolidMeshOperation(operation: BooleanOperation | 'split', meshes: SolidMesh[]): Promise<SolidMeshResult[]> {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    const transfers: Transferable[] = [];
    for (const mesh of meshes) {
      transfers.push(mesh.positions.buffer);
      if (mesh.indices) transfers.push(mesh.indices.buffer);
    }
    getWorker().postMessage({ id, operation, meshes }, transfers);
  });
}
