'use no memo';
import React from 'react';
import type { LoadedModel } from '@/features/scene/useSceneCollectionManager';

/**
 * Queues the drop-in animation for each newly added mesh model (deferred until the camera intro ends for large ones) and forgets models that were removed. Part of SceneCanvas.
 */
export function useEntryDropQueue({
  models,
  cameraIntroRunId,
  cameraIntroCompletedRunId,
  knownModelIdsRef,
  LARGE_MODEL_DROP_DEFER_THRESHOLD_POLYS,
  LARGE_MODEL_BOUNCE_THRESHOLD_POLYS,
  pendingEntryAnimRef,
  entryAnimRef,
  setEntryDropOffsets,
}: {
  models: LoadedModel[];
  cameraIntroRunId: number;
  cameraIntroCompletedRunId: number;
  knownModelIdsRef: React.RefObject<Set<string>>;
  LARGE_MODEL_DROP_DEFER_THRESHOLD_POLYS: number;
  LARGE_MODEL_BOUNCE_THRESHOLD_POLYS: number;
  pendingEntryAnimRef: React.RefObject<Record<string, { fromZ: number; runId: number; skipBounce: boolean; }>>;
  entryAnimRef: React.RefObject<Record<string, { startMs: number | null; fromZ: number; skipBounce: boolean; }>>;
  setEntryDropOffsets: React.Dispatch<React.SetStateAction<Record<string, number>>>;
}) {
  React.useEffect(() => {
    const currentIds = new Set(models.map((model) => model.id));
    const initialDropOffsets: Record<string, number> = {};
    const shouldDeferLargeModelDrop = cameraIntroRunId > cameraIntroCompletedRunId;

    // Start animation for newly added mesh files
    for (const model of models) {
      const isKnown = knownModelIdsRef.current.has(model.id);
      if (isKnown) continue;

      knownModelIdsRef.current.add(model.id);

      const isMeshFile = model.fileUrl.startsWith('blob:') || /\.(stl|3mf)$/i.test(model.name);
      if (!isMeshFile) continue;

      const dropFrom = Math.max(16, Math.min(64, model.geometry.size.z * 0.45));
      const disableDropAnimation = model.polygonCount >= LARGE_MODEL_DROP_DEFER_THRESHOLD_POLYS;
      if (disableDropAnimation) continue;

      const skipBounce = model.polygonCount >= LARGE_MODEL_BOUNCE_THRESHOLD_POLYS;
      const deferDrop = shouldDeferLargeModelDrop && model.polygonCount >= LARGE_MODEL_DROP_DEFER_THRESHOLD_POLYS;

      if (deferDrop) {
        pendingEntryAnimRef.current[model.id] = {
          fromZ: dropFrom,
          runId: cameraIntroRunId,
          skipBounce,
        };
      } else {
        // Start timer on the first rendered animation frame.
        // This keeps the drop motion intact even if initial GPU upload blocks
        // the main thread for hundreds of milliseconds.
        entryAnimRef.current[model.id] = {
          startMs: null,
          fromZ: dropFrom,
          skipBounce,
        };
        initialDropOffsets[model.id] = dropFrom;
      }
    }

    // Cleanup removed models
    const nextKnown = new Set<string>();
    for (const id of knownModelIdsRef.current) {
      if (currentIds.has(id)) {
        nextKnown.add(id);
      } else {
        delete entryAnimRef.current[id];
        delete pendingEntryAnimRef.current[id];
      }
    }
    knownModelIdsRef.current = nextKnown;

    setEntryDropOffsets((previous) => {
      const next: Record<string, number> = {
        ...initialDropOffsets,
      };
      Object.entries(previous).forEach(([id, offset]) => {
        if (currentIds.has(id) && offset > 0.0001 && next[id] == null) {
          next[id] = offset;
        }
      });
      return next;
    });
  }, [cameraIntroCompletedRunId, cameraIntroRunId, models, LARGE_MODEL_BOUNCE_THRESHOLD_POLYS, LARGE_MODEL_DROP_DEFER_THRESHOLD_POLYS, entryAnimRef, knownModelIdsRef, pendingEntryAnimRef, setEntryDropOffsets]);
}
