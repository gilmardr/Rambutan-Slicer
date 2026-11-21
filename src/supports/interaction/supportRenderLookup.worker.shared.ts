import type { SupportState } from '../types';
import type { SupportCollectionKey } from '../supportTypeRegistry';
import type { SupportRenderLookupInput, SupportRenderLookupSnapshot } from './supportRenderLookupMath';
import type { RecordDelta } from './recordDelta';

type SupportLookupStateInput = SupportRenderLookupInput['state'];

export type { RecordDelta } from './recordDelta';

/** One delta per collection, keyed off the registry rather than a written list. */
export type SupportLookupStateDelta = Partial<{
  [K in SupportCollectionKey]: RecordDelta<SupportLookupStateInput[K][string]>;
}>;

export type SupportLookupInputDelta = {
  state?: SupportLookupStateDelta;
  activePreviewSupport?: SupportRenderLookupInput['activePreviewSupport'];
  activePreviewSupportChanged?: boolean;
};

export type SupportRenderLookupWorkerRequestMessage = {
  requestId: number;
  delta?: SupportLookupInputDelta;
  cancelSignal?: SharedArrayBuffer;
  cancelEpoch?: number;
};

export type SupportRenderLookupWorkerResponseMessage = {
  requestId: number;
  snapshot: SupportRenderLookupSnapshot;
};

export type SupportLookupCollections = Pick<SupportState, SupportCollectionKey>;
