const EMPTY_HIDDEN_TAGS: ReadonlySet<string> = new Set();

let hiddenTags: ReadonlySet<string> = EMPTY_HIDDEN_TAGS;
const listeners = new Set<() => void>();

export function subscribeToSupportTagVisibility(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getHiddenSupportTagsSnapshot(): ReadonlySet<string> {
  return hiddenTags;
}

export function getHiddenSupportTagsServerSnapshot(): ReadonlySet<string> {
  return EMPTY_HIDDEN_TAGS;
}

export function setSupportTagVisible(tag: string, visible: boolean): void {
  const normalizedTag = tag.trim();
  if (!normalizedTag) return;

  const wasHidden = hiddenTags.has(normalizedTag);
  if (visible && !wasHidden) return;
  if (!visible && wasHidden) return;

  const next = new Set(hiddenTags);
  if (visible) next.delete(normalizedTag);
  else next.add(normalizedTag);
  hiddenTags = next;
  listeners.forEach((listener) => listener());
}

export function retainVisibleSupportTags(activeTags: ReadonlySet<string>): void {
  const next = new Set([...hiddenTags].filter((tag) => activeTags.has(tag)));
  if (next.size === hiddenTags.size) return;
  hiddenTags = next;
  listeners.forEach((listener) => listener());
}
