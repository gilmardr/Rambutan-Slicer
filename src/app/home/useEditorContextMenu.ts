import React from 'react';
import type { KnotSplitRemap } from '@/supports/SupportPrimitives/Knot/knotUtils';
import * as THREE from 'three';
import { type ModelAlignment, computeAlignedModelTransforms } from '@/features/scene/align/alignSelectedModels';
import { resolveModelActionTargetIds, dispatchDeleteModelAction, dispatchCutModelAction } from '@/features/scene/modelActionTargets';
import { getHomeSupportCollectionsSnapshot } from '@/features/supports/supportSnapshotHelpers';
import { getBezierPointAtT } from '@/supports/Curves/BezierUtils';
import { captureSupportEditSnapshot, pushSupportEditHistory } from '@/supports/history/supportEditHistory';
import { createJointLabel } from '@/supports/history/supportHistoryLabels';
import { subscribe as subscribeSupportState, getSelectedId, getSelectedCategory, findShaftOwnerOfSegment, getSnapshot as getSupportSnapshot, toggleSegmentCurve, getSupportEntity, resolveDeclaredHosts, updateKnot } from '@/supports/state';
import { splitSupportShaft } from '@/supports/SupportPrimitives/Joint/jointUtils';
import { type ShaftEntity, resolveSegmentEndpoints } from '@/supports/SupportPrimitives/Knot/segmentEndpoints';
import { knotHostId, spanKnotHostType, getSupportTypeDescriptor, updateSupportEntity } from '@/supports/supportTypeRegistry';
import { RefreshCw, Plus, Wrench, Undo2, ClipboardList, Pyramid } from 'lucide-react';
import { msg } from '@lingui/core/macro';
import type { useLingui } from '@lingui/react';
import { MENU_ITEMS, type EditorMenuAction } from '@/components/ui/EditorContextMenu';
import type { useSceneCollectionManager } from '@/features/scene/useSceneCollectionManager';

type SetState<T> = React.Dispatch<React.SetStateAction<T>>;
type HomeScene = ReturnType<typeof useSceneCollectionManager>;

/** The support segment a right-click landed on, when it landed on one. */
export type EditorContextMenuSupportTarget = {
  segmentId: string;
  point: { x: number; y: number; z: number };
};

export type UseEditorContextMenuItemsInput = {
  _: ReturnType<typeof useLingui>['_'];
  scene: HomeScene;
  editorContextMenuSupportTarget: EditorContextMenuSupportTarget | null;
};

export type UseEditorMenuActionsInput = {
  scene: HomeScene;
  arrangeSpacingMm: number;
  closeEditorContextMenu: () => void;
  editorContextMenuSupportTarget: EditorContextMenuSupportTarget | null;
  printingBaseResinMlCacheRef: React.RefObject<Map<string, number | null>>;
  printingEstimatedResinMlRef: React.RefObject<number | null>;
  setPrintingEstimatedResinMl: SetState<number | null>;
  supportAndRaftResinMl: number;
  setAutoStartRepair: SetState<boolean>;
  setManualRepairModelIds: SetState<string[] | null>;
  setTetSurfaceConfirmModelId: SetState<string | null>;
  setShrinkWrapConfirmModelId: SetState<string | null>;
};

/**
 * Apply knot re-anchor patches from a segment split BEFORE the host update runs,
 * so attached branches/leaves keep their world position when a joint is inserted
 * (issue #204). Mirror of the helper in useJointCreation for the context-menu
 * "Add joint" path.
 */
function applyJointSplitKnotRemaps(remaps: KnotSplitRemap[]) {
    if (remaps.length === 0) return;
    const knots = getSupportSnapshot().knots;
    for (const remap of remaps) {
        const knot = knots[remap.knotId];
        if (!knot) continue;
        updateKnot({ ...knot, parentShaftId: remap.parentShaftId, t: remap.t });
    }
}

/** What the editor context menu offers and disables, moved verbatim out of src/app/page.tsx. */
export function useEditorContextMenuItems({
  _,
  scene,
  editorContextMenuSupportTarget,
}: UseEditorContextMenuItemsInput) {
  // Home is not compiled by the React Compiler (it bails out on it), and this
  // code ran there with its useMemo/useCallback dependency lists honoured as
  // written. Compiled, a memo keeps only what its body reads and drops a
  // dependency listed to force a refresh (the resin estimate stopped updating
  // in the Support tab). Opting out keeps the behaviour it had inside Home.
  'use no memo';
  // The menu reads the selection and the braces collection, so it subscribes to
  // those rather than to the snapshot object. The snapshot is rebuilt on every
  // store write, a support hover included, and this is the app root: the whole
  // page and the scene canvas re-rendered for a hover that changed neither. The
  // collections snapshot is identity-cached, so an edit still invalidates it.
  const supportMenuSelectedId = React.useSyncExternalStore(subscribeSupportState, getSelectedId, getSelectedId);
  const supportMenuSelectedCategory = React.useSyncExternalStore(subscribeSupportState, getSelectedCategory, getSelectedCategory);
  const supportMenuCollections = React.useSyncExternalStore(
    subscribeSupportState,
    getHomeSupportCollectionsSnapshot,
    getHomeSupportCollectionsSnapshot,
  );

  const supportMenuSelection = React.useMemo(() => {
    const selectedId = supportMenuSelectedId;
    return {
      selectedId,
      selectedCategory: supportMenuSelectedCategory,
      isBraceSelected: Boolean(selectedId && supportMenuCollections.braces[selectedId]),
    };
  }, [supportMenuSelectedId, supportMenuSelectedCategory, supportMenuCollections]);

  const supportsCanToggleCurve = React.useMemo(() => {
    if (scene.mode !== 'support') return false;
    if (supportMenuSelection.selectedCategory === 'segment' && supportMenuSelection.selectedId) return true;
    return supportMenuSelection.isBraceSelected;
  }, [scene.mode, supportMenuSelection.isBraceSelected, supportMenuSelection.selectedCategory, supportMenuSelection.selectedId]);

  // The same lookup the add-joint handler runs, so the menu item is offered
  // exactly when the action would succeed.
  const supportContextMenuSegmentOwner = React.useMemo(() => {
    const segmentId = editorContextMenuSupportTarget?.segmentId;
    return segmentId ? findShaftOwnerOfSegment(segmentId) : null;
    // The collections are read through a helper, not named here: the lookup is
    // the invalidation this memo needs, and a support edit is what moves it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorContextMenuSupportTarget?.segmentId, supportMenuCollections]);

  const supportsCanAddJoint = React.useMemo(() => {
    if (scene.mode !== 'support') return false;
    if (!editorContextMenuSupportTarget?.segmentId || !editorContextMenuSupportTarget.point) return false;
    return supportContextMenuSegmentOwner !== null;
  }, [editorContextMenuSupportTarget, scene.mode, supportContextMenuSegmentOwner]);

  const supportContextMenuItems = React.useMemo(() => {
    return [
      {
        id: 'supports-toggle-curve' as const,
        label: msg`Toggle curve`,
        icon: RefreshCw,
      },
      {
        id: 'supports-add-joint' as const,
        label: msg`Add joint`,
        icon: Plus,
      },
    ];
  }, []);

  const editorContextMenuTitle = scene.mode === 'support' ? _(msg`Supports`) : _(msg`Editor`);
  // Only a repair run from this menu offers "Auto-Repair Again" and the report: the import pass
  // repairs every model at load, so the report it leaves behind cannot be the signal.
  const editorContextMenuItems = React.useMemo(() => {
    if (scene.mode === 'support') {
      return supportContextMenuItems;
    }
    const repaired = !!scene.activeModelId
      && scene.manuallyRepairedModelIds.includes(scene.activeModelId);
    return MENU_ITEMS.map((item) =>
      item.id === 'repair-menu' && 'children' in item
        ? {
            ...item,
            children: [
              { id: 'repair' as const, label: repaired ? msg`Repair Again` : msg`Auto-Repair`, icon: Wrench },
              // Whole-surface replacements, each behind its own confirmation.
              { id: 'remesh' as const, label: msg`Remesh`, icon: Pyramid },
              { id: 'shrinkwrap' as const, label: msg`Shrink-Wrap`, icon: RefreshCw },
              // The second group only exists once there is a repair to undo or report on.
              ...(repaired
                ? [
                    { id: 'undo-repairs' as const, label: msg`Undo Repairs`, icon: Undo2, startsGroup: true },
                    { id: 'show-repair-report' as const, label: msg`Show Report`, icon: ClipboardList },
                  ]
                : []),
            ],
          }
        : item,
    );
  }, [scene.mode, scene.activeModelId, scene.manuallyRepairedModelIds, supportContextMenuItems]);
  const editorContextMenuDisabledActions = React.useMemo(() => {
    if (scene.mode === 'support') {
      return [
        ...(!supportsCanToggleCurve ? (['supports-toggle-curve'] as const) : []),
        ...(!supportsCanAddJoint ? (['supports-add-joint'] as const) : []),
      ];
    }

    const activeModel = scene.activeModelId
      ? scene.models.find((m) => m.id === scene.activeModelId)
      : undefined;
    const canSplitSupports = !!activeModel?.geometry.meshDefects?.nativeRepairReport?.model_triangle_count;
    const canMergeSupports = scene.selectedModelIds.length === 2;

    const hasTargetModel = resolveModelActionTargetIds({
      modelIds: scene.models.map((model) => model.id),
      selectedModelIds: scene.selectedModelIds,
      activeModelId: scene.activeModelId,
    }).length > 0;
    const canLink = scene.selectedModelIds.length >= 2;
    const canAlignModels = scene.selectedModelIds.length >= 2;
    const selectedOrActiveModels = scene.selectedModelIds.length > 0
      ? scene.models.filter((m) => scene.selectedModelIds.includes(m.id))
      : (scene.activeModelId ? scene.models.filter((m) => m.id === scene.activeModelId) : []);
    const canUnlink = selectedOrActiveModels.some((m) => !!m.linkGroupId);

    return [
      ...(!hasTargetModel ? (['delete'] as const) : []),
      ...(!scene.activeModelId ? (['cut', 'copy', 'repair', 'remesh', 'shrinkwrap'] as const) : []),
      ...(!hasTargetModel ? (['mark-as-support-geometry', 'mark-as-model-geometry'] as const) : []),
      ...(!canLink ? (['link-models'] as const) : []),
      ...(!canUnlink ? (['unlink-models'] as const) : []),
      ...(!canAlignModels ? (['align-x-center', 'align-y-center', 'align-z-center', 'align-z-bottom'] as const) : []),
      ...(!scene.canPasteModel ? (['paste'] as const) : []),
      ...(!canSplitSupports ? (['split-supports'] as const) : []),
      ...(!canMergeSupports ? (['merge-supports'] as const) : []),
    ];
  }, [scene.activeModelId, scene.canPasteModel, scene.mode, scene.models, scene.selectedModelIds, supportsCanAddJoint, supportsCanToggleCurve]);

  return {
    editorContextMenuTitle,
    editorContextMenuItems,
    editorContextMenuDisabledActions,
  };
}

/** What each editor context menu action does, moved verbatim out of src/app/page.tsx. */
export function useEditorMenuActions({
  scene,
  arrangeSpacingMm,
  closeEditorContextMenu,
  editorContextMenuSupportTarget,
  printingBaseResinMlCacheRef,
  printingEstimatedResinMlRef,
  setPrintingEstimatedResinMl,
  supportAndRaftResinMl,
  setAutoStartRepair,
  setManualRepairModelIds,
  setTetSurfaceConfirmModelId,
  setShrinkWrapConfirmModelId,
}: UseEditorMenuActionsInput) {
  // Home is not compiled by the React Compiler (it bails out on it), and this
  // code ran there with its useMemo/useCallback dependency lists honoured as
  // written. Compiled, a memo keeps only what its body reads and drops a
  // dependency listed to force a refresh (the resin estimate stopped updating
  // in the Support tab). Opting out keeps the behaviour it had inside Home.
  'use no memo';
  const handleEditorMenuAction = React.useCallback((action: EditorMenuAction) => {
    const projectSplitPoint = (
      start: { x: number; y: number; z: number },
      end: { x: number; y: number; z: number },
      point: { x: number; y: number; z: number },
    ) => {
      const startVec = new THREE.Vector3(start.x, start.y, start.z);
      const endVec = new THREE.Vector3(end.x, end.y, end.z);
      const pointVec = new THREE.Vector3(point.x, point.y, point.z);
      const lineDir = endVec.clone().sub(startVec);
      const lenSq = lineDir.lengthSq();
      if (lenSq <= 1e-10) {
        return {
          t: 0,
          point: { x: startVec.x, y: startVec.y, z: startVec.z },
        };
      }

      const rawT = pointVec.clone().sub(startVec).dot(lineDir) / lenSq;
      const t = Math.max(0, Math.min(1, rawT));
      const projected = startVec.clone().lerp(endVec, t);
      return {
        t,
        point: { x: projected.x, y: projected.y, z: projected.z },
      };
    };

    const projectBezierSplitPoint = (
      start: { x: number; y: number; z: number },
      control1: { x: number; y: number; z: number },
      control2: { x: number; y: number; z: number },
      end: { x: number; y: number; z: number },
      point: { x: number; y: number; z: number },
    ) => {
      const target = new THREE.Vector3(point.x, point.y, point.z);
      let bestT = 0;
      let bestPoint = start;
      let bestDistanceSq = Number.POSITIVE_INFINITY;

      const steps = 40;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const sample = getBezierPointAtT(start, control1, control2, end, t);
        const sampleVec = new THREE.Vector3(sample.x, sample.y, sample.z);
        const distanceSq = sampleVec.distanceToSquared(target);
        if (distanceSq < bestDistanceSq) {
          bestDistanceSq = distanceSq;
          bestT = t;
          bestPoint = sample;
        }
      }

      return {
        t: bestT,
        point: bestPoint,
      };
    };

    switch (action) {
      case 'supports-toggle-curve': {
        const state = getSupportSnapshot();
        if (state.selectedCategory === 'segment' && state.selectedId) {
          toggleSegmentCurve(state.selectedId);
        } else if (state.selectedId && state.braces[state.selectedId]) {
          toggleSegmentCurve(knotHostId(spanKnotHostType(), state.selectedId));
        }
        break;
      }
      case 'supports-add-joint': {
        const target = editorContextMenuSupportTarget;
        if (!target?.segmentId || !target.point) break;

        const state = getSupportSnapshot();
        const segmentId = target.segmentId;
        const splitTargetPoint = target.point;
        const beforeSnapshot = captureSupportEditSnapshot();

        const owner = findShaftOwnerOfSegment(segmentId);
        const entity = owner ? getSupportEntity(owner.typeId, owner.id) as ShaftEntity | null : null;
        if (owner && entity) {
          const segmentIndex = entity.segments.findIndex((segment) => segment.id === segmentId);
          const segment = entity.segments[segmentIndex];
          if (segment) {
            const descriptor = getSupportTypeDescriptor(owner.typeId);
            // Read off the declared edges: a kickstand's knot is at its upper
            // end, so `lower.kind` would hand it none.
            const hosts = resolveDeclaredHosts(owner.typeId, entity as unknown as Record<string, unknown>);
            const endpoints = resolveSegmentEndpoints(entity, segment, segmentIndex, hosts);

            if (endpoints) {
              const { start, end } = endpoints;
              const projected = segment.type === 'bezier'
                ? projectBezierSplitPoint(start, segment.controlPoint1, segment.controlPoint2, end, splitTargetPoint)
                : projectSplitPoint(start, end, splitTargetPoint);
              const { entity: updated, knotRemaps } = splitSupportShaft(
                entity, segmentId, projected.point, projected.t, hosts, state.knots,
              );
              applyJointSplitKnotRemaps(knotRemaps);
              updateSupportEntity(owner.typeId, updated);
              pushSupportEditHistory(createJointLabel(descriptor.id), beforeSnapshot, captureSupportEditSnapshot());
            }
          }
        }
        break;
      }
      case 'split-supports': {
        const targetId = scene.activeModelId;
        if (targetId) {
          closeEditorContextMenu();
          scene.splitSupports(targetId);
          return;
        }
        break;
      }
      case 'merge-supports': {
        closeEditorContextMenu();
        scene.mergeSupports();
        return;
      }
      case 'delete':
        dispatchDeleteModelAction({
          modelIds: scene.models.map((model) => model.id),
          selectedModelIds: scene.selectedModelIds,
          activeModelId: scene.activeModelId,
        }, scene.deleteModels);
        break;
      case 'copy':
        if (scene.selectedModelIds.length > 0) {
          scene.copySelectedModels();
        } else if (scene.activeModelId) {
          scene.copyModel(scene.activeModelId);
        }
        break;
      case 'cut':
        dispatchCutModelAction({
          modelIds: scene.models.map((model) => model.id),
          selectedModelIds: scene.selectedModelIds,
          activeModelId: scene.activeModelId,
        }, scene.cutSelectedModels);
        break;
      case 'paste': {
        const pastedIds = scene.pasteCopiedModelsAutoArrange(arrangeSpacingMm);
        if (pastedIds.length > 0 && printingEstimatedResinMlRef.current != null) {
          const pastedModel = scene.models.find((m) => pastedIds.includes(m.id));
          if (pastedModel) {
            const geom = pastedModel.geometry.geometry;
            const pos = geom.getAttribute('position');
            const idx = geom.getIndex();
            const sourceKey = String(geom.userData?.resinVolumeSourceKey ?? geom.uuid);
            const posVer = (pos as { version?: number; data?: { version?: number } }).version
              ?? (pos as { version?: number; data?: { version?: number } }).data?.version ?? 0;
            const idxVer = (idx as { version?: number } | null)?.version ?? 0;
            const cacheKey = `${sourceKey}:${posVer}:${idxVer}`;
            const cachedMl = printingBaseResinMlCacheRef.current.get(cacheKey) ?? null;
            if (cachedMl != null) {
              const sx = Math.abs(pastedModel.transform.scale.x || 1);
              const sy = Math.abs(pastedModel.transform.scale.y || 1);
              const sz = Math.abs(pastedModel.transform.scale.z || 1);
              const addedMl = cachedMl * sx * sy * sz;
              const nextTotal = (printingEstimatedResinMlRef.current - supportAndRaftResinMl) + addedMl + supportAndRaftResinMl;
              printingEstimatedResinMlRef.current = nextTotal;
              setPrintingEstimatedResinMl(nextTotal);
            }
          }
        }
        break;
      }
      case 'undo-repairs': {
        const targetId = scene.activeModelId;
        if (targetId) {
          closeEditorContextMenu();
          void scene.undoRepairsInPlace(targetId);
          return;
        }
        break;
      }
      case 'show-repair-report': {
        const targetId = scene.activeModelId;
        if (targetId) {
          closeEditorContextMenu();
          scene.openMeshRepairReportForModel(targetId);
          return;
        }
        break;
      }
      case 'repair': {
        const targetIds = resolveModelActionTargetIds({
          modelIds: scene.models.map((model) => model.id),
          selectedModelIds: scene.selectedModelIds,
          activeModelId: scene.activeModelId,
        });
        if (targetIds.length > 0) {
          closeEditorContextMenu();
          setAutoStartRepair(false);
          setManualRepairModelIds(targetIds);
          return;
        }
        break;
      }
      // Remesh and Shrink-Wrap act on the active model only and ask first: Home's
      // confirm dialogs read these ids and run the pass on Confirm.
      case 'remesh': {
        const targetId = scene.activeModelId;
        if (targetId) {
          closeEditorContextMenu();
          setTetSurfaceConfirmModelId(targetId);
          return;
        }
        break;
      }
      case 'shrinkwrap': {
        const targetId = scene.activeModelId;
        if (targetId) {
          closeEditorContextMenu();
          setShrinkWrapConfirmModelId(targetId);
          return;
        }
        break;
      }
      case 'mark-as-support-geometry': {
        const targetIds = scene.selectedModelIds.length > 0
          ? scene.selectedModelIds
          : (scene.activeModelId ? [scene.activeModelId] : []);
        if (targetIds.length > 0) {
          scene.toggleSupportDesignation(targetIds, true);
        }
        break;
      }
      case 'mark-as-model-geometry': {
        const targetIds = scene.selectedModelIds.length > 0
          ? scene.selectedModelIds
          : (scene.activeModelId ? [scene.activeModelId] : []);
        if (targetIds.length > 0) {
          scene.toggleSupportDesignation(targetIds, false);
        }
        break;
      }
      case 'link-models': {
        const targetIds = scene.selectedModelIds.length > 0
          ? scene.selectedModelIds
          : (scene.activeModelId ? [scene.activeModelId] : []);
        if (targetIds.length >= 2) {
          scene.linkModels(targetIds);
        }
        break;
      }
      case 'unlink-models': {
        const targetIds = scene.selectedModelIds.length > 0
          ? scene.selectedModelIds
          : (scene.activeModelId ? [scene.activeModelId] : []);
        if (targetIds.length > 0) {
          scene.unlinkModels(targetIds);
        }
        break;
      }
      case 'scan-for-supports': {
        const targetId = scene.activeModelId;
        if (targetId) {
          scene.scanModelForSupportsInPlace(targetId);
        }
        break;
      }
      case 'align-x-center':
      case 'align-y-center':
      case 'align-z-center':
      case 'align-z-bottom': {
        const selected = scene.models.filter((model) => scene.selectedModelIds.includes(model.id));
        const referenceId = selected.some((model) => model.id === scene.activeModelId)
          ? scene.activeModelId
          : selected[0]?.id;
        if (referenceId && selected.length > 1) {
          const alignment: ModelAlignment = action === 'align-x-center'
            ? 'center-x'
            : action === 'align-y-center'
              ? 'center-y'
              : action === 'align-z-center'
                ? 'center-z'
                : 'bottom-z';
          const updates = computeAlignedModelTransforms(selected, referenceId, alignment);
          scene.updateModelTransforms(updates);
        }
        break;
      }
      default:
        break;
    }
    closeEditorContextMenu();
  }, [arrangeSpacingMm, closeEditorContextMenu, scene, setShrinkWrapConfirmModelId, setTetSurfaceConfirmModelId]);

  return {
    handleEditorMenuAction,
  };
}
