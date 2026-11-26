import React from 'react';
import type { useSceneCollectionManager } from '@/features/scene/useSceneCollectionManager';

type HomeScene = ReturnType<typeof useSceneCollectionManager>;

/**
 * The non-manifold mesh warning: which models were already warned about, the
 * modal's state, the model its Repair Now button targets, and the effect that
 * opens it when an import brings in a flagged model. Moved out of Home verbatim.
 */
export function useManifoldWarning({ scene }: { scene: HomeScene }) {
  'use no memo';
  // Warn when an imported mesh fails the manifold_csg validity check — the same
  // models shown with the red striped overlay in the viewport. Only a single
  // warning is shown per import job: as soon as any newly-imported model is
  // flagged, every currently-flagged model is marked as warned so the rest of
  // the batch does not pop additional modals.
  const warnedManifoldModelIdsRef = React.useRef<Set<string>>(new Set());
  const [showManifoldWarning, setShowManifoldWarning] = React.useState(false);
  // The model the warning's Repair Now button repairs: the first flagged one.
  const [manifoldWarningModelId, setManifoldWarningModelId] = React.useState<string | null>(null);
  React.useEffect(() => {
    const flagged = scene.models.filter(
      (model) => model.geometry?.meshDefects?.nativeRepairReport?.model_is_manifold === false,
    );
    const hasUnwarned = flagged.some((model) => !warnedManifoldModelIdsRef.current.has(model.id));
    if (!hasUnwarned) return;
    for (const model of flagged) warnedManifoldModelIdsRef.current.add(model.id);
    setManifoldWarningModelId(flagged[0].id);
    setShowManifoldWarning(true);
  }, [scene.models]);

  return {
    showManifoldWarning,
    setShowManifoldWarning,
    manifoldWarningModelId,
  };
}
