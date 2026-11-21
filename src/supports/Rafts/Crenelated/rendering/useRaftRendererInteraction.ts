import React from 'react';

interface UseRaftRendererInteractionOptions {
  activeModelId: string | null;
  hoverModelId: string | null;
  navigationLodActive: boolean;
  passive: boolean;
  selectedModelIds: string[];
}

export function useRaftRendererInteraction({
  activeModelId,
  hoverModelId,
  navigationLodActive,
  passive,
  selectedModelIds,
}: UseRaftRendererInteractionOptions) {
  const [immediateModelHoverId, setImmediateModelHoverId] = React.useState<string | null>(null);
  const [immediatePrepareActiveModelId, setImmediatePrepareActiveModelId] = React.useState<string | null>(null);
  const lastSyncedPrepareActiveModelIdRef = React.useRef<string | null>(activeModelId);

  React.useEffect(() => {
    if (passive) {
      setImmediateModelHoverId((previous) => (previous === null ? previous : null));
      return;
    }

    const handleImmediateModelHover = (event: Event) => {
      if (navigationLodActive) return;
      const customEvent = event as CustomEvent<{ modelId?: string | null }>;
      setImmediateModelHoverId(customEvent.detail?.modelId ?? null);
    };

    window.addEventListener('model-pointer-hover-immediate', handleImmediateModelHover as EventListener);
    return () => {
      window.removeEventListener('model-pointer-hover-immediate', handleImmediateModelHover as EventListener);
    };
  }, [navigationLodActive, passive]);

  React.useEffect(() => {
    if (passive) {
      setImmediatePrepareActiveModelId((previous) => (previous === null ? previous : null));
      return;
    }

    const handleModelClicked = (event: Event) => {
      const customEvent = event as CustomEvent<{ modelId?: string | null }>;
      const modelId = customEvent.detail?.modelId ?? null;
      setImmediatePrepareActiveModelId((previous) => (previous === modelId ? previous : modelId));
    };

    const handleModelDeselected = () => {
      setImmediatePrepareActiveModelId((previous) => (previous === null ? previous : null));
    };

    window.addEventListener('model-clicked', handleModelClicked as EventListener);
    window.addEventListener('model-deselected', handleModelDeselected);
    return () => {
      window.removeEventListener('model-clicked', handleModelClicked as EventListener);
      window.removeEventListener('model-deselected', handleModelDeselected);
    };
  }, [passive]);

  React.useEffect(() => {
    const next = passive ? null : activeModelId;
    if (lastSyncedPrepareActiveModelIdRef.current === next) return;
    lastSyncedPrepareActiveModelIdRef.current = next;
    setImmediatePrepareActiveModelId((previous) => (previous === next ? previous : next));
  }, [activeModelId, passive]);

  React.useEffect(() => {
    if (passive || !immediatePrepareActiveModelId) return;
    if (selectedModelIds.includes(immediatePrepareActiveModelId)) return;
    setImmediatePrepareActiveModelId((previous) => (previous === null ? previous : null));
  }, [immediatePrepareActiveModelId, passive, selectedModelIds]);

  return {
    effectiveHoverModelId: passive ? null : (immediateModelHoverId ?? hoverModelId),
    effectiveVisualActiveModelId: passive
      ? activeModelId
      : (immediatePrepareActiveModelId ?? activeModelId),
  };
}
