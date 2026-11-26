import React from 'react';
import { hotkeyStore } from '@/hotkeys/hotkeyStore';
import type { useSceneCollectionManager } from '@/features/scene/useSceneCollectionManager';

type HomeScene = ReturnType<typeof useSceneCollectionManager>;

/**
 * While the scene-import placement prompt is open, a fresh Escape press loads
 * the scene as is. Moved out of Home; the scene fields are
 * destructured so the dependency list stays complete.
 */
export function useSceneImportPromptEscape({ scene }: { scene: HomeScene }) {
  'use no memo';
  const { sceneImportPlacementPrompt, resolveSceneImportPlacementPrompt } = scene;
  React.useEffect(() => {
    if (!sceneImportPlacementPrompt) return;

    let wasEscapePressed = false;

    const unsubscribe = hotkeyStore.subscribe((state) => {
      const active = state.activeKeys;
      const isEscapePressed = active.has('escape');
      if (isEscapePressed && !wasEscapePressed) {
        resolveSceneImportPlacementPrompt('load_as_is');
      }
      wasEscapePressed = isEscapePressed;
    });

    return unsubscribe;
  }, [sceneImportPlacementPrompt, resolveSceneImportPlacementPrompt]);
}
