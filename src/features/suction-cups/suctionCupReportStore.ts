export type SuctionCupSummaryStatus = 'idle' | 'scanning' | 'ready' | 'failed' | 'stale';

export type SuctionCupSummary = {
  modelId: string | null;
  status: SuctionCupSummaryStatus;
  findingCount: number;
};

const EMPTY_SUMMARY: SuctionCupSummary = { modelId: null, status: 'idle', findingCount: 0 };
let summary = EMPTY_SUMMARY;
const listeners = new Set<() => void>();

export function getSuctionCupSummary(): SuctionCupSummary {
  return summary;
}

export function subscribeSuctionCupSummary(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSuctionCupSummary(next: SuctionCupSummary): void {
  if (summary.modelId === next.modelId && summary.status === next.status && summary.findingCount === next.findingCount) return;
  summary = next;
  for (const listener of listeners) listener();
}
