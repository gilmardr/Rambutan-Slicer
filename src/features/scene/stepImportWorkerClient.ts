type StepImportMesh = {
  attributes?: {
    position?: { array?: unknown };
    normal?: { array?: unknown };
  };
  index?: { array?: unknown };
};

export type StepImportResult = {
  success?: boolean;
  error?: string | { message?: string };
  meshes?: StepImportMesh[];
};

type PendingStepImport = {
  resolve: (result: StepImportResult) => void;
  reject: (error: Error) => void;
};

const STEP_IMPORT_WORKER_URL = '/vendor/occt-import-js/occt-import-js-worker.js';

let stepImportWorker: Worker | null = null;
let pendingStepImport: PendingStepImport | null = null;
let stepImportQueue: Promise<void> = Promise.resolve();

function getStepImportWorker(): Worker {
  if (stepImportWorker) return stepImportWorker;
  if (typeof Worker === 'undefined') {
    throw new Error('STEP import is not available in this environment.');
  }

  const worker = new Worker(STEP_IMPORT_WORKER_URL, { name: 'step-import' });
  worker.addEventListener('message', (event: MessageEvent<StepImportResult>) => {
    if (stepImportWorker !== worker) return;
    const pending = pendingStepImport;
    if (!pending) return;
    pendingStepImport = null;
    pending.resolve(event.data);
  });
  worker.addEventListener('error', (event: ErrorEvent) => {
    if (stepImportWorker !== worker) return;
    const pending = pendingStepImport;
    pendingStepImport = null;
    worker.terminate();
    stepImportWorker = null;
    pending?.reject(new Error(event.message || 'The STEP importer worker stopped unexpectedly.'));
  });
  worker.addEventListener('messageerror', () => {
    if (stepImportWorker !== worker) return;
    const pending = pendingStepImport;
    pendingStepImport = null;
    worker.terminate();
    stepImportWorker = null;
    pending?.reject(new Error('The STEP importer returned unreadable data.'));
  });
  stepImportWorker = worker;
  return worker;
}

export function importStepOnWorker(bytes: Uint8Array, takeOwnership = false): Promise<StepImportResult> {
  const result = stepImportQueue.then(() => new Promise<StepImportResult>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = getStepImportWorker();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    pendingStepImport = { resolve, reject };
    const canTransferOriginal = takeOwnership
      && bytes.byteOffset === 0
      && bytes.byteLength === bytes.buffer.byteLength;
    let transferableBytes: Uint8Array;
    if (canTransferOriginal) {
      transferableBytes = bytes;
    } else {
      transferableBytes = new Uint8Array(bytes.byteLength);
      transferableBytes.set(bytes);
    }
    const transferableBuffer = transferableBytes.buffer as ArrayBuffer;
    try {
      worker.postMessage(
        {
          format: 'step',
          buffer: transferableBytes,
          params: { linearUnit: 'millimeter' },
        },
        [transferableBuffer],
      );
    } catch (error) {
      pendingStepImport = null;
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  }));
  stepImportQueue = result.then(() => undefined, () => undefined);
  return result;
}
