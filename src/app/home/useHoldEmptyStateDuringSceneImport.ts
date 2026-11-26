import React from 'react';
import type { useSceneCollectionManager } from '@/features/scene/useSceneCollectionManager';

type HomeScene = ReturnType<typeof useSceneCollectionManager>;

/**
 * Keeps the empty-scene panel up while the first scene or mesh import runs,
 * so the viewport does not flash empty before the models land. Moved out of
 * Home verbatim.
 */
export function useHoldEmptyStateDuringSceneImport({ scene }: { scene: HomeScene }) {
  'use no memo';
  const [holdEmptyStateSceneImportUi, setHoldEmptyStateSceneImportUi] = React.useState(false);

  React.useEffect(() => {
    const isSceneImportActive =
      (scene.importProgress.active
        && (scene.importProgress.type === 'scene' || scene.importProgress.type === 'mesh'))
      || scene.pluginImportPhase === 'processing';

    if (isSceneImportActive && scene.models.length === 0) {
      setHoldEmptyStateSceneImportUi(true);
      return;
    }

    if (!isSceneImportActive && holdEmptyStateSceneImportUi) {
      setHoldEmptyStateSceneImportUi(false);
    }
  }, [holdEmptyStateSceneImportUi, scene.importProgress.active, scene.importProgress.type, scene.pluginImportPhase, scene.models.length]);

  return holdEmptyStateSceneImportUi;
}
