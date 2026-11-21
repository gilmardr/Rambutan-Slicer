/**
 * Which scene model is the pending engraving cutter, and whether it is ready to
 * apply. The Engraving panel writes it; the scene tints that model so the area
 * that will be cut reads green (ready) or red (the last step on it failed).
 */
export type EngravingPreviewStatus = 'ready' | 'error';

export type EngravingPreviewHighlight = {
  cutterId: string;
  status: EngravingPreviewStatus;
};

export const ENGRAVING_PREVIEW_COLORS: Record<EngravingPreviewStatus, string> = {
  ready: '#22c55e',
  error: '#ef4444',
};

let current: EngravingPreviewHighlight | null = null;
const listeners = new Set<() => void>();

export function getEngravingPreviewHighlight(): EngravingPreviewHighlight | null {
  return current;
}

export function setEngravingPreviewHighlight(next: EngravingPreviewHighlight | null): void {
  if (current?.cutterId === next?.cutterId && current?.status === next?.status) return;
  current = next;
  for (const listener of listeners) listener();
}

export function subscribeEngravingPreviewHighlight(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The tint for a model, or null when it is not the pending engraving cutter. */
export function engravingPreviewColorFor(
  highlight: EngravingPreviewHighlight | null,
  modelId: string,
): string | null {
  return highlight?.cutterId === modelId ? ENGRAVING_PREVIEW_COLORS[highlight.status] : null;
}
