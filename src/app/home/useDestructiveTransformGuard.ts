import React from 'react';
import { useLingui } from '@lingui/react';
import type { useSceneCollectionManager } from '@/features/scene/useSceneCollectionManager';
import { MODEL_ID_COLLECTION_KEYS } from '@/supports/supportTypeRegistry';
import { getSnapshot as getSupportSnapshot } from '@/supports/state';
import { getSupportsForModel } from '@/supports/PlacementLogic/SupportModelLinker';
import { formatSelectedModelCount } from './homeFormatters';
import { deleteSupportsForModelLabel, deleteSupportsForModelsLabel } from '@/features/scene/sceneHistoryLabels';

type HomeScene = ReturnType<typeof useSceneCollectionManager>;

/**
 * The prompt shown before a transform that would invalidate placed supports:
 * the pending request, the continuation to run after the user confirms, the
 * request helpers the transform handlers call, and confirm and cancel. Moved
 * out of Home verbatim; the two nonce setters it bumps on confirm come in as
 * inputs.
 */
export function useDestructiveTransformGuard({
  scene,
  setSupportRenderRefreshNonce,
  setGizmoResetNonce,
}: {
  scene: HomeScene;
  setSupportRenderRefreshNonce: React.Dispatch<React.SetStateAction<number>>;
  setGizmoResetNonce: React.Dispatch<React.SetStateAction<number>>;
}) {
  'use no memo';
  const { _ } = useLingui();
  const [pendingDestructiveTransform, setPendingDestructiveTransform] = React.useState<{
    modelIds: string[];
    modelName: string;
    supportCount: number;
    operationLabel: string;
  } | null>(null);
  const pendingDestructiveTransformContinueRef = React.useRef<(() => void) | null>(null);

  // Reads the live stores directly: Home's subscribed snapshot is an empty
  // stub in support mode (trackSupportCollectionsInHome), so counting from it
  // would silently report zero exactly where orient needs the truth. In
  // prepare mode the stub mirrors the store, so existing callers are unaffected.
  // Summed over every modelId-bearing collection, so a model carrying only one
  // type still reports its supports.
  const getSupportPrimitiveCountForModel = React.useCallback((modelId: string | null | undefined) => {
    if (!modelId) return 0;

    const supportIds = getSupportsForModel(getSupportSnapshot(), modelId);
    return MODEL_ID_COLLECTION_KEYS.reduce((total, key) => total + supportIds[key].length, 0);
  }, []);

  /**
   * Asks before a transform that would invalidate supports. `modelIds` defaults to the active
   * model; a selection edit passes the whole selection, so the prompt counts, and the
   * confirmation deletes, the supports of every model it is about to change.
   */
  const requestDestructiveTransformSupportDeletion = React.useCallback((
    operationLabel: string,
    modelIds?: readonly string[],
  ) => {
    if (scene.mode !== 'prepare') return true;
    const targetIds = modelIds ?? (scene.activeModelId ? [scene.activeModelId] : []);
    if (targetIds.length === 0) return true;
    if (pendingDestructiveTransform) return false;

    const supportedIds = targetIds.filter((modelId) => getSupportPrimitiveCountForModel(modelId) > 0);
    if (supportedIds.length === 0) return true;
    const supportCount = supportedIds.reduce((total, modelId) => total + getSupportPrimitiveCountForModel(modelId), 0);

    const firstModel = scene.models.find((model) => model.id === supportedIds[0]);
    setPendingDestructiveTransform({
      modelIds: supportedIds,
      modelName: supportedIds.length === 1
        ? (firstModel?.name ?? supportedIds[0]).trim()
        : formatSelectedModelCount(_, supportedIds.length),
      supportCount,
      operationLabel,
    });
    return false;
  }, [_, getSupportPrimitiveCountForModel, pendingDestructiveTransform, scene.activeModelId, scene.mode, scene.models]);

  const requestDestructiveTransformSupportDeletionWithContinuation = React.useCallback((
    operationLabel: string,
    onContinue: () => void,
  ) => {
    const proceedImmediately = requestDestructiveTransformSupportDeletion(operationLabel);
    if (proceedImmediately) {
      pendingDestructiveTransformContinueRef.current = null;
      return true;
    }

    pendingDestructiveTransformContinueRef.current = onContinue;
    return false;
  }, [requestDestructiveTransformSupportDeletion]);

  const requestOrientSupportDeletionWithContinuation = React.useCallback((onContinue: () => void) => {
    // Unlike the prepare-mode destructive transforms, orient always forces the
    // dialog when placed supports would be invalidated by the rotation.
    if (!scene.activeModelId) return true;
    if (pendingDestructiveTransform) return false;
    const supportCount = getSupportPrimitiveCountForModel(scene.activeModelId);
    if (supportCount <= 0) return true;
    setPendingDestructiveTransform({
      modelIds: [scene.activeModelId],
      modelName: (scene.activeModel?.name ?? scene.activeModelId).trim(),
      supportCount,
      operationLabel: 'Auto Orient',
    });
    pendingDestructiveTransformContinueRef.current = onContinue;
    return false;
  }, [getSupportPrimitiveCountForModel, pendingDestructiveTransform, scene]);

  const handleConfirmDestructiveTransform = React.useCallback(() => {
    const pending = pendingDestructiveTransform;
    if (!pending) return;

    scene.deleteSupportsForModels(
      pending.modelIds,
      pending.modelIds.length === 1
        ? deleteSupportsForModelLabel(pending.modelName)
        : deleteSupportsForModelsLabel(pending.modelIds.length),
    );

    setSupportRenderRefreshNonce((value) => value + 1);
    setGizmoResetNonce((value) => value + 1);
    setPendingDestructiveTransform(null);
    const continueAfterDeletion = pendingDestructiveTransformContinueRef.current;
    pendingDestructiveTransformContinueRef.current = null;
    continueAfterDeletion?.();
  }, [pendingDestructiveTransform, scene, setGizmoResetNonce, setSupportRenderRefreshNonce]);

  const handleCancelDestructiveTransform = React.useCallback(() => {
    pendingDestructiveTransformContinueRef.current = null;
    setPendingDestructiveTransform(null);
  }, []);

  return {
    pendingDestructiveTransform,
    requestDestructiveTransformSupportDeletion,
    requestDestructiveTransformSupportDeletionWithContinuation,
    requestOrientSupportDeletionWithContinuation,
    handleConfirmDestructiveTransform,
    handleCancelDestructiveTransform,
  };
}
