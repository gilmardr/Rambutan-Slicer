export type SuctionCupHighlight = {
  modelId: string;
  surfacePoints: Float32Array;
};

const listeners = new Set<() => void>();
let highlight: SuctionCupHighlight | null = null;

export function subscribeSuctionCupHighlight(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSuctionCupHighlight(): SuctionCupHighlight | null {
  return highlight;
}

export function setSuctionCupHighlight(next: SuctionCupHighlight | null): void {
  if (highlight === next) return;
  highlight = next;
  for (const listener of listeners) listener();
}
