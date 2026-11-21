const listeners = new Set<() => void>();
let highlightedSupportIds: ReadonlySet<string> = new Set();

export function subscribeSupportProximityHighlights(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSupportProximityHighlightedIds(): ReadonlySet<string> {
  return highlightedSupportIds;
}

export function setSupportProximityHighlightedIds(supportIds: readonly string[]): void {
  const next = new Set(supportIds);
  if (next.size === highlightedSupportIds.size
    && [...next].every((supportId) => highlightedSupportIds.has(supportId))) return;
  highlightedSupportIds = next;
  for (const listener of listeners) listener();
}
