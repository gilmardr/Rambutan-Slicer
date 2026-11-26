import React from 'react';
import type { useSceneCollectionManager } from '@/features/scene/useSceneCollectionManager';
import { useActionActive } from '@/hotkeys/hotkeyStore';

type HomeScene = ReturnType<typeof useSceneCollectionManager>;

/**
 * Runs Save As when its hotkey goes down, once per press, and only when the
 * scene has models. Moved out of Home verbatim.
 */
export function useSaveAsHotkey({
  scene,
  handleTopBarSaveSceneAs,
}: {
  scene: HomeScene;
  handleTopBarSaveSceneAs: () => unknown;
}) {
  'use no memo';
  const saveAsActive = useActionActive('GLOBAL', 'SAVE_AS');
  const wasSaveAsActive = React.useRef(false);

  React.useEffect(() => {
    if (!saveAsActive || wasSaveAsActive.current) {
      wasSaveAsActive.current = saveAsActive;
      return;
    }
    wasSaveAsActive.current = true;

    if (scene.models.length === 0) return;
    handleTopBarSaveSceneAs();
  }, [saveAsActive, scene.models.length, handleTopBarSaveSceneAs]);
}
