import React from 'react';
import type { useSceneCollectionManager } from '@/features/scene/useSceneCollectionManager';
import { getRedoCount, getUndoCount, subscribeHistory } from '@/history/historyStore';

type HomeScene = ReturnType<typeof useSceneCollectionManager>;

/**
 * Whether the scene has changes since it was last saved or loaded: a baseline
 * of the undo and redo counts and the model count, compared on every history
 * change and whenever the model count moves. Moved out of Home verbatim.
 */
export function useUnsavedSceneChanges({ scene }: { scene: HomeScene }) {
  'use no memo';
  const [hasUnsavedSceneChanges, setHasUnsavedSceneChanges] = React.useState(false);
  const hasUnsavedSceneChangesRef = React.useRef(false);
  const sceneSaveBaselineRef = React.useRef<{
    undo: number;
    redo: number;
    modelCount: number;
  }>({
    undo: getUndoCount(),
    redo: getRedoCount(),
    modelCount: scene.models.length,
  });

  const markSceneSaveBaseline = React.useCallback(() => {
    sceneSaveBaselineRef.current = {
      undo: getUndoCount(),
      redo: getRedoCount(),
      modelCount: scene.models.length,
    };
    setHasUnsavedSceneChanges(false);
    hasUnsavedSceneChangesRef.current = false;
  }, [scene.models.length]);

  const recomputeUnsavedSceneChanges = React.useCallback(() => {
    const baseline = sceneSaveBaselineRef.current;
    const undoCount = getUndoCount();
    const redoCount = getRedoCount();
    const modelCount = scene.models.length;

    const dirty = modelCount > 0 && (
      undoCount !== baseline.undo
      || redoCount !== baseline.redo
      || modelCount !== baseline.modelCount
    );

    setHasUnsavedSceneChanges(dirty);
    hasUnsavedSceneChangesRef.current = dirty;
  }, [scene.models.length]);

  React.useEffect(() => {
    const unsubscribe = subscribeHistory(recomputeUnsavedSceneChanges);
    return () => {
      unsubscribe();
    };
  }, [recomputeUnsavedSceneChanges]);

  React.useEffect(() => {
    recomputeUnsavedSceneChanges();
  }, [recomputeUnsavedSceneChanges, scene.models.length]);

  return {
    hasUnsavedSceneChanges,
    hasUnsavedSceneChangesRef,
    markSceneSaveBaseline,
  };
}
