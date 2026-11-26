import React from 'react';
import { hotkeyStore } from '@/hotkeys/hotkeyStore';
import type { useSceneCollectionManager } from '@/features/scene/useSceneCollectionManager';
import type { useTransformManager } from '@/features/transform/useTransformManager';

type HomeScene = ReturnType<typeof useSceneCollectionManager>;
type HomeTransform = ReturnType<typeof useTransformManager>;

/**
 * In the hollowing tool, a fresh Escape press clears the selected and hovered
 * hole-punch placements. Moved out of Home; the hole-punch state stays there
 * and its stable setters come in as inputs.
 */
export function useHolePunchSelectionEscape({
  sceneMode,
  transformMode,
  selectedHolePunchPlacementCount,
  setSelectedHolePunchPlacementIds,
  setHoveredHolePunchPlacementId,
  setHolePunchHoverPlacement,
}: {
  sceneMode: HomeScene['mode'];
  transformMode: HomeTransform['transformMode'];
  selectedHolePunchPlacementCount: number;
  setSelectedHolePunchPlacementIds: (ids: string[]) => void;
  setHoveredHolePunchPlacementId: (id: string | null) => void;
  setHolePunchHoverPlacement: (placement: null) => void;
}) {
  'use no memo';
  React.useEffect(() => {
    if (
      (sceneMode !== 'prepare' && sceneMode !== 'support')
      || transformMode !== 'hollowing'
      || selectedHolePunchPlacementCount === 0
    ) {
      return;
    }

    let wasEscapePressed = false;
    const unsubscribe = hotkeyStore.subscribe((state) => {
      const active = state.activeKeys;
      const isEscapePressed = active.has('escape');
      if (isEscapePressed && !wasEscapePressed) {
        setSelectedHolePunchPlacementIds([]);
        setHoveredHolePunchPlacementId(null);
        setHolePunchHoverPlacement(null);
      }
      wasEscapePressed = isEscapePressed;
    });

    return unsubscribe;
  }, [
    sceneMode,
    selectedHolePunchPlacementCount,
    transformMode,
    setSelectedHolePunchPlacementIds,
    setHoveredHolePunchPlacementId,
    setHolePunchHoverPlacement,
  ]);
}
