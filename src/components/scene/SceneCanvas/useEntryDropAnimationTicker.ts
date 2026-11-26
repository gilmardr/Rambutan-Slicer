'use no memo';
import React from 'react';
import type { LoadedModel } from '@/features/scene/useSceneCollectionManager';

/**
 * Plays the drop-in animation of newly added models: one animation frame loop that eases each queued model from its start height down to the plate, with an optional rebound, and publishes the offsets. Part of SceneCanvas.
 */
export function useEntryDropAnimationTicker({
  entryAnimRef,
  DROP_ANIMATION_DURATION_MS,
  setEntryDropOffsets,
  cameraIntroCompletedRunId,
  models,
}: {
  entryAnimRef: React.RefObject<Record<string, { startMs: number | null; fromZ: number; skipBounce: boolean; }>>;
  DROP_ANIMATION_DURATION_MS: number;
  setEntryDropOffsets: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  cameraIntroCompletedRunId: number;
  models: LoadedModel[];
}) {
  React.useEffect(() => {
    let frame = 0;

    const tick = () => {
      const entries = Object.entries(entryAnimRef.current);
      if (entries.length === 0) return;

      const now = performance.now();
      const nextOffsets: Record<string, number> = {};

      for (const [id, animation] of entries) {
        if (animation.startMs == null) {
          animation.startMs = now;
          nextOffsets[id] = animation.fromZ;
          continue;
        }

        const t = Math.min(1, (now - animation.startMs) / DROP_ANIMATION_DURATION_MS);

        // Drop -> impact -> optional rebound -> settle
        const impactT = animation.skipBounce ? 1 : 0.72;
        let zOffset = 0;

        if (t < impactT) {
          const p = t / impactT;
          // Accelerating descent for more weight
          zOffset = animation.fromZ * (1 - p * p);
        } else if (!animation.skipBounce) {
          const q = (t - impactT) / (1 - impactT);
          // One clear rebound arc after impact (rubber-ball feel)
          const reboundHeight = Math.max(4.5, animation.fromZ * 0.2);
          zOffset = reboundHeight * 4 * q * (1 - q);
        }

        if (t >= 1 || zOffset <= 0.0001) {
          delete entryAnimRef.current[id];
        } else {
          nextOffsets[id] = zOffset;
        }
      }

      setEntryDropOffsets(nextOffsets);

      if (Object.keys(entryAnimRef.current).length > 0) {
        frame = requestAnimationFrame(tick);
      }
    };

    if (Object.keys(entryAnimRef.current).length > 0) {
      frame = requestAnimationFrame(tick);
    }

    return () => {
      if (frame) cancelAnimationFrame(frame);
    };
  }, [cameraIntroCompletedRunId, models.length, DROP_ANIMATION_DURATION_MS, entryAnimRef, setEntryDropOffsets]);
}
