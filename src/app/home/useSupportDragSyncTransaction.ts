import React from 'react';
import type { ModelTransform } from '@/hooks/useModelTransform';
import type { useSceneCollectionManager } from '@/features/scene/useSceneCollectionManager';
import { createModelTransformKey } from './homeUtils';

type HomeScene = ReturnType<typeof useSceneCollectionManager>;
type DebugTimestamp = { perfMs: number; epochMs: number } | null;

const SUPPORT_DRAG_HOLD_FALLBACK_MS = 320;

export type TransformStoreCommitResult = {
  updated: boolean;
  supportsChanged: boolean;
  kickstandsChanged: boolean;
};

type PendingSupportDragSyncTransaction = {
  transactionId: number;
  expectedModelTransformKeys: Map<string, string>;
  expectedSupportStoreVersion: number;
  expectedKickstandStoreVersion: number;
};

/**
 * After a gizmo drag commits, supports and kickstands keep showing the drag
 * delta until the model transforms and both support stores have caught up
 * (or a short fallback timer fires), so they do not flash back to the old
 * pose. Moved out of Home; the scene models are destructured so the
 * dependency list stays complete.
 */
export function useSupportDragSyncTransaction({
  scene,
  supportStateSnapshot,
  kickstandStateSnapshot,
  transformDebugTimelineRef,
}: {
  scene: HomeScene;
  supportStateSnapshot: unknown;
  kickstandStateSnapshot: unknown;
  transformDebugTimelineRef: React.MutableRefObject<{
    supportStoreUpdatedAt: DebugTimestamp;
    kickstandStoreUpdatedAt: DebugTimestamp;
  }>;
}) {
  'use no memo';
  const { models: sceneModels } = scene;
  const [holdSupportDragDeltaUntilSupportSync, setHoldSupportDragDeltaUntilSupportSync] = React.useState(false);
  const [supportDragTransactionId, setSupportDragTransactionId] = React.useState(0);
  const supportDragTransactionIdRef = React.useRef(0);
  const pendingSupportDragSyncRef = React.useRef<PendingSupportDragSyncTransaction | null>(null);
  const supportStoreVersionRef = React.useRef(0);
  const kickstandStoreVersionRef = React.useRef(0);
  const supportSyncFallbackTimeoutRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    supportDragTransactionIdRef.current = supportDragTransactionId;
  }, [supportDragTransactionId]);

  const clearSupportSyncFallbackTimeout = React.useCallback(() => {
    if (typeof window === 'undefined') return;
    if (supportSyncFallbackTimeoutRef.current !== null) {
      window.clearTimeout(supportSyncFallbackTimeoutRef.current);
      supportSyncFallbackTimeoutRef.current = null;
    }
  }, []);

  const finalizeSupportDragSyncTransaction = React.useCallback((transactionId?: number) => {
    if (
      transactionId !== undefined
      && pendingSupportDragSyncRef.current
      && pendingSupportDragSyncRef.current.transactionId !== transactionId
    ) {
      return;
    }

    pendingSupportDragSyncRef.current = null;
    clearSupportSyncFallbackTimeout();
    setHoldSupportDragDeltaUntilSupportSync(false);
  }, [clearSupportSyncFallbackTimeout]);

  const beginSupportDragSyncTransaction = React.useCallback((
    expectedModelTransforms: Array<{ modelId: string; transform: ModelTransform }>,
    commitResult: TransformStoreCommitResult,
  ) => {
    const nextTransactionId = supportDragTransactionIdRef.current + 1;
    supportDragTransactionIdRef.current = nextTransactionId;
    setSupportDragTransactionId(nextTransactionId);

    const expectedModelTransformKeys = new Map<string, string>();
    expectedModelTransforms.forEach(({ modelId, transform }) => {
      expectedModelTransformKeys.set(modelId, createModelTransformKey(modelId, transform));
    });

    const expectedSupportStoreVersion = supportStoreVersionRef.current + (commitResult.supportsChanged ? 1 : 0);
    const expectedKickstandStoreVersion = kickstandStoreVersionRef.current + (commitResult.kickstandsChanged ? 1 : 0);
    const needsHold = (
      expectedModelTransformKeys.size > 0
      || expectedSupportStoreVersion > supportStoreVersionRef.current
      || expectedKickstandStoreVersion > kickstandStoreVersionRef.current
    );

    if (!needsHold) {
      finalizeSupportDragSyncTransaction();
      return;
    }

    pendingSupportDragSyncRef.current = {
      transactionId: nextTransactionId,
      expectedModelTransformKeys,
      expectedSupportStoreVersion,
      expectedKickstandStoreVersion,
    };
    setHoldSupportDragDeltaUntilSupportSync(true);

    if (typeof window !== 'undefined') {
      clearSupportSyncFallbackTimeout();
      const requiresSupportSync = commitResult.supportsChanged || commitResult.kickstandsChanged;
      const fallbackMs = requiresSupportSync
        ? Math.max(SUPPORT_DRAG_HOLD_FALLBACK_MS, 520)
        : SUPPORT_DRAG_HOLD_FALLBACK_MS;
      supportSyncFallbackTimeoutRef.current = window.setTimeout(() => {
        finalizeSupportDragSyncTransaction(nextTransactionId);
      }, fallbackMs);
    }
  }, [clearSupportSyncFallbackTimeout, finalizeSupportDragSyncTransaction]);

  React.useEffect(() => {
    return () => {
      clearSupportSyncFallbackTimeout();
    };
  }, [clearSupportSyncFallbackTimeout]);

  React.useEffect(() => {
    transformDebugTimelineRef.current.supportStoreUpdatedAt = {
      perfMs: performance.now(),
      epochMs: Date.now(),
    };
    supportStoreVersionRef.current += 1;
  }, [supportStateSnapshot, transformDebugTimelineRef]);

  React.useEffect(() => {
    transformDebugTimelineRef.current.kickstandStoreUpdatedAt = {
      perfMs: performance.now(),
      epochMs: Date.now(),
    };
    kickstandStoreVersionRef.current += 1;
  }, [kickstandStateSnapshot, transformDebugTimelineRef]);

  React.useEffect(() => {
    if (!holdSupportDragDeltaUntilSupportSync) return;

    const pendingTransaction = pendingSupportDragSyncRef.current;
    if (!pendingTransaction) {
      finalizeSupportDragSyncTransaction();
      return;
    }

    if (supportDragTransactionId < pendingTransaction.transactionId) return;

    const modelsById = new Map(sceneModels.map((model) => [model.id, model]));
    const modelTransformsSynced = Array.from(pendingTransaction.expectedModelTransformKeys.entries()).every(
      ([modelId, expectedTransformKey]) => {
        const model = modelsById.get(modelId);
        if (!model) return false;
        return createModelTransformKey(modelId, model.transform) === expectedTransformKey;
      },
    );
    if (!modelTransformsSynced) return;

    if (supportStoreVersionRef.current < pendingTransaction.expectedSupportStoreVersion) return;
    if (kickstandStoreVersionRef.current < pendingTransaction.expectedKickstandStoreVersion) return;

    finalizeSupportDragSyncTransaction(pendingTransaction.transactionId);
  }, [
    finalizeSupportDragSyncTransaction,
    holdSupportDragDeltaUntilSupportSync,
    kickstandStateSnapshot,
    sceneModels,
    supportDragTransactionId,
    supportStateSnapshot,
  ]);

  return {
    holdSupportDragDeltaUntilSupportSync,
    supportDragTransactionId,
    beginSupportDragSyncTransaction,
    supportSyncFallbackTimeoutRef,
  };
}
