import React from 'react';
import type { useSceneCollectionManager } from '@/features/scene/useSceneCollectionManager';

type HomeScene = ReturnType<typeof useSceneCollectionManager>;

/**
 * With no models left, any workspace other than Prepare falls back to Prepare.
 * Moved out of Home; the scene fields are destructured so the dependency list
 * stays complete.
 */
export function useEmptySceneReturnsToPrepare({ scene }: { scene: HomeScene }) {
  'use no memo';
  const { mode, models, setMode } = scene;
  React.useEffect(() => {
    if (models.length > 0) return;
    if (mode === 'prepare') return;
    setMode('prepare');
  }, [mode, models.length, setMode]);
}
