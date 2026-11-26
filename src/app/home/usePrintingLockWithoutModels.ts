import React from 'react';
import type { useSceneCollectionManager } from '@/features/scene/useSceneCollectionManager';
import type { useSlicedPlates } from '@/features/printing/useSlicedPlates';

type HomeScene = ReturnType<typeof useSceneCollectionManager>;
type HomeSlicedPlates = ReturnType<typeof useSlicedPlates>['slicedPlates'];

/**
 * Deleting the last model while in Printing sends the app back to Prepare and
 * clears the sliced plates. Moved out of Home verbatim.
 */
export function usePrintingLockWithoutModels({
  scene,
  slicedPlates,
}: {
  scene: HomeScene;
  slicedPlates: HomeSlicedPlates;
}) {
  'use no memo';
  // Lock printing workspace when no models exist
  React.useEffect(() => {
    if (scene.models.length === 0 && scene.mode === 'printing') {
      // Reset to prepare mode if we delete the last model while in printing
      scene.setMode('prepare');
      slicedPlates.clear();
    }
  }, [scene.models.length, scene.mode, scene, slicedPlates]);
}
