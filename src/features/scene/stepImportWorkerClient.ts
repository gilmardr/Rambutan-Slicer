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

export type StepImportOptions = {
  /** Overrides the size-based limit from `stepImportTimeoutMs`. */
  timeoutMs?: number;
};

type PendingStepImport = {
  resolve: (result: StepImportResult) => void;
  reject: (error: Error) => void;
};

const STEP_IMPORT_WORKER_URL = '/vendor/occt-import-js/occt-import-js-worker.js';

/** Time every STEP import gets, however small the file. */
const STEP_IMPORT_BASE_TIMEOUT_MS = 120_000;
/** Extra time per MiB, since OCCT's tessellation grows with the model. */
const STEP_IMPORT_TIMEOUT_MS_PER_MIB = 10_000;
/** No single file may hold the importer longer than this. */
const STEP_IMPORT_MAX_TIMEOUT_MS = 600_000;

let stepImportWorker: Worker | null = null;
let pendingStepImport: PendingStepImport | null = null;
let stepImportQueue: Promise<void> = Promise.resolve();

/**
 * How long one STEP import may run before the worker is killed: two minutes,
 * plus ten seconds per MiB, at most ten minutes.
 */
export function stepImportTimeoutMs(byteLength: number): number {
  const mib = Math.max(0, byteLength) / (1024 * 1024);
  return Math.min(
    STEP_IMPORT_MAX_TIMEOUT_MS,
    Math.round(STEP_IMPORT_BASE_TIMEOUT_MS + mib * STEP_IMPORT_TIMEOUT_MS_PER_MIB),
  );
}

/**
 * Terminates the worker and fails the import it is running. The next import
 * starts a fresh worker, so one stuck file cannot block the ones after it.
 */
function discardStepImportWorker(worker: Worker, error: Error): void {
  if (stepImportWorker !== worker) return;
  const pending = pendingStepImport;
  pendingStepImport = null;
  stepImportWorker = null;
  worker.terminate();
  pending?.reject(error);
}

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
    discardStepImportWorker(
      worker,
      new Error(event.message || 'The STEP importer worker stopped unexpectedly.'),
    );
  });
  worker.addEventListener('messageerror', () => {
    discardStepImportWorker(worker, new Error('The STEP importer returned unreadable data.'));
  });
  stepImportWorker = worker;
  return worker;
}

export function importStepOnWorker(
  bytes: Uint8Array,
  takeOwnership = false,
  options: StepImportOptions = {},
): Promise<StepImportResult> {
  // Read the size now: transferring the buffer below detaches it.
  const timeoutMs = options.timeoutMs ?? stepImportTimeoutMs(bytes.byteLength);
  const result = stepImportQueue.then(() => new Promise<StepImportResult>((outerResolve, outerReject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const resolve = (value: StepImportResult) => { settle(); outerResolve(value); };
    const reject = (error: Error) => { settle(); outerReject(error); };

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
      return;
    }

    timer = setTimeout(() => {
      timer = null;
      const seconds = Math.round(timeoutMs / 1000);
      discardStepImportWorker(
        worker,
        new Error(
          `The STEP import took longer than ${seconds} s and was stopped. `
          + 'The file may be too complex or damaged; try exporting it again, or as STL.',
        ),
      );
    }, timeoutMs);
  }));
  stepImportQueue = result.then(() => undefined, () => undefined);
  return result;
}
