'use no memo';
import React from 'react';

/**
 * Listens for the pointer-hover events the meshes, rafts and supports dispatch, and keeps the hovered model of each kind exclusive. Part of SceneCanvas.
 */
export function useModelHoverEvents({
  modelPickerEnabled,
  onModelHoverModelChange,
  pendingHoverModelIdRef,
  hoverModelRafRef,
  setHoveredMeshModelId,
  setHoveredSupportPointerModelId,
  setHoveredRaftModelId,
}: {
  modelPickerEnabled: boolean;
  onModelHoverModelChange: (id: string | null) => void;
  pendingHoverModelIdRef: React.RefObject<string | null>;
  hoverModelRafRef: React.RefObject<number | null>;
  setHoveredMeshModelId: React.Dispatch<React.SetStateAction<string | null>>;
  setHoveredSupportPointerModelId: React.Dispatch<React.SetStateAction<string | null>>;
  setHoveredRaftModelId: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  React.useEffect(() => {
    const handleModelPointerHoverImmediate = (event: Event) => {
      if (!modelPickerEnabled) return;
      const customEvent = event as CustomEvent<{ modelId?: string | null }>;
      const modelId = customEvent.detail?.modelId ?? null;
      onModelHoverModelChange(modelId);
    };

    const handleSupportRaftModelPointerHover = (event: Event) => {
      if (!modelPickerEnabled) return;
      const customEvent = event as CustomEvent<{ modelId?: string | null; category?: string | null }>;
      const category = customEvent.detail?.category;
      if (category === 'raft') {
        const modelId = customEvent.detail?.modelId ?? null;
        if (modelId) {
          pendingHoverModelIdRef.current = null;
          if (hoverModelRafRef.current !== null) {
            cancelAnimationFrame(hoverModelRafRef.current);
            hoverModelRafRef.current = null;
          }
          setHoveredMeshModelId((prev) => (prev === null ? prev : null));
          setHoveredSupportPointerModelId((prev) => (prev === null ? prev : null));
        }
        if (modelId) {
          setHoveredRaftModelId((prev) => (prev === modelId ? prev : modelId));
        } else {
          setHoveredRaftModelId((prev) => (prev === null ? prev : null));
        }
        return;
      }

      if (category === 'support') {
        const modelId = customEvent.detail?.modelId ?? null;
        if (modelId) {
          pendingHoverModelIdRef.current = null;
          if (hoverModelRafRef.current !== null) {
            cancelAnimationFrame(hoverModelRafRef.current);
            hoverModelRafRef.current = null;
          }
          setHoveredMeshModelId((prev) => (prev === null ? prev : null));
          setHoveredRaftModelId((prev) => (prev === null ? prev : null));
        }
        if (modelId) {
          setHoveredSupportPointerModelId((prev) => (prev === modelId ? prev : modelId));
        } else {
          setHoveredSupportPointerModelId((prev) => (prev === null ? prev : null));
        }
      }
    };

    window.addEventListener('model-pointer-hover-immediate', handleModelPointerHoverImmediate as EventListener);
    window.addEventListener('support-raft-model-pointer-hover', handleSupportRaftModelPointerHover as EventListener);

    return () => {
      window.removeEventListener('model-pointer-hover-immediate', handleModelPointerHoverImmediate as EventListener);
      window.removeEventListener('support-raft-model-pointer-hover', handleSupportRaftModelPointerHover as EventListener);
    };
  }, [modelPickerEnabled, onModelHoverModelChange, hoverModelRafRef, pendingHoverModelIdRef, setHoveredMeshModelId, setHoveredRaftModelId, setHoveredSupportPointerModelId]);
}
