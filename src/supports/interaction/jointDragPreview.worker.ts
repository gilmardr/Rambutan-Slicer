import type { Knot, Roots } from '../types';
import { computeJointDragPreviewKnots, type JointDragPreviewSnapshot } from './jointDragPreviewMath';
import type {
  JointDragPreviewWorkerCollectionsRef,
  JointDragPreviewWorkerRequestMessage,
  JointDragPreviewWorkerResponseMessage,
  RecordDelta,
} from './jointDragPreview.worker.shared';
import { applyRecordDeltaInPlace } from './recordDelta';

const cachedCollections: JointDragPreviewWorkerCollectionsRef = {
  roots: {},
  knots: {},
  kickstandKnots: {},
  candidateKnots: {},
};

function applyInputDelta(msg: JointDragPreviewWorkerRequestMessage) {
  const delta = msg.delta;
  if (!delta) return;

  applyRecordDeltaInPlace(cachedCollections.roots, delta.roots);
  applyRecordDeltaInPlace(cachedCollections.knots, delta.knots);
  applyRecordDeltaInPlace(cachedCollections.kickstandKnots, delta.kickstandKnots);
  applyRecordDeltaInPlace(cachedCollections.candidateKnots, delta.candidateKnots);
}

function resolveContext(msg: JointDragPreviewWorkerRequestMessage) {
  return {
    root: msg.rootId ? cachedCollections.roots[msg.rootId] ?? null : null,
    parentKnot: msg.parentKnotId ? cachedCollections.knots[msg.parentKnotId] ?? null : null,
    hostKnot: msg.hostKnotId
      ? cachedCollections.kickstandKnots[msg.hostKnotId] ?? cachedCollections.knots[msg.hostKnotId] ?? null
      : null,
  };
}

self.onmessage = (event: MessageEvent<JointDragPreviewWorkerRequestMessage>) => {
  const msg = event.data;
  if (!msg || !msg.requestId) return;

  const cancelView = msg.cancelSignal ? new Int32Array(msg.cancelSignal) : null;
  const expectedEpoch = msg.cancelEpoch ?? 0;
  const shouldAbort = cancelView && typeof Atomics !== 'undefined'
    ? () => Atomics.load(cancelView, 0) !== expectedEpoch
    : undefined;

  if (shouldAbort?.()) return;

  try {
    applyInputDelta(msg);

    const previewKnots = computeJointDragPreviewKnots(
      msg.preview,
      resolveContext(msg),
      cachedCollections.candidateKnots,
      { shouldAbort },
    );

    if (shouldAbort?.()) return;

    const out: JointDragPreviewWorkerResponseMessage = {
      requestId: msg.requestId,
      previewKnots,
    };

    self.postMessage(out);
  } catch (error) {
    console.error('[JointDragPreviewWorker] Failed to compute preview knots', error);
    const out: JointDragPreviewWorkerResponseMessage = {
      requestId: msg.requestId,
      previewKnots: {},
    };
    self.postMessage(out);
  }
};
