'use no memo';
import React from 'react';
import type { TransformMode } from '@/hooks/useModelTransform';
import type { SupportMode } from '@/supports/types';

/**
 * While a select-mode press may become a model drag, follows the pointer on window: starts the drag past the threshold, moves it, and finishes it on release or cancel. Part of SceneCanvas.
 */
export function useSelectDragWindowListeners({
  mode,
  transformMode,
  selectDragCandidateRef,
  selectDragActiveRef,
  finishSelectDrag,
  SELECT_DRAG_START_DIST_SQ,
  beginSelectDrag,
  clearSelectDragCandidate,
  applySelectDragMove,
}: {
  mode: SupportMode | undefined;
  transformMode: TransformMode | undefined;
  selectDragCandidateRef: React.RefObject<{ modelId: string; clientX: number; clientY: number; } | null>;
  selectDragActiveRef: React.RefObject<boolean>;
  finishSelectDrag: () => void;
  SELECT_DRAG_START_DIST_SQ: number;
  beginSelectDrag: (candidate: { modelId: string; clientX: number; clientY: number; }) => boolean;
  clearSelectDragCandidate: () => void;
  applySelectDragMove: (clientX: number, clientY: number) => void;
}) {
  // Window-level pointer tracking for the select-mode drag: candidate presses
  // only start moving once the pointer crosses the drag threshold, and moves /
  // release are followed globally so the drag survives leaving the mesh.
  React.useEffect(() => {
    if (mode !== 'prepare' || transformMode !== 'select') return;

    const handleWindowPointerMove = (e: PointerEvent) => {
      const candidate = selectDragCandidateRef.current;
      if (!candidate) return;

      // Only a held left button drives the model move — a right-button orbit
      // started while the left press is still down must not drag the model.
      if ((e.buttons & 1) === 0) {
        if (selectDragActiveRef.current) finishSelectDrag();
        return;
      }

      if (!selectDragActiveRef.current) {
        const dx = e.clientX - candidate.clientX;
        const dy = e.clientY - candidate.clientY;
        if (dx * dx + dy * dy < SELECT_DRAG_START_DIST_SQ) return;
        if (!beginSelectDrag(candidate)) {
          clearSelectDragCandidate();
          return;
        }
        // Let the isGizmoDragging render (which attaches the dragged model's
        // supports to its group) land before the first move — the same cadence
        // the gizmo uses, so supports never detach at the start of a drag.
        return;
      }

      applySelectDragMove(e.clientX, e.clientY);
    };

    const handleWindowPointerUp = () => {
      if (!selectDragCandidateRef.current && !selectDragActiveRef.current) return;
      finishSelectDrag();
    };

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerUp);
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerUp);
    };
  }, [
    applySelectDragMove,
    beginSelectDrag,
    clearSelectDragCandidate,
    finishSelectDrag,
    mode,
    transformMode,
    SELECT_DRAG_START_DIST_SQ,
    selectDragActiveRef,
    selectDragCandidateRef,
  ]);
}
