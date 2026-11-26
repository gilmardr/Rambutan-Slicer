'use no memo';
import React from 'react';

/**
 * Whether a joint, knot or bezier gizmo drag (or its short guard after release) holds the pointer, read from the flags those gizmos set on window and refreshed on their lock events. Part of SceneCanvas.
 */
export function useSupportGizmoInteractionLock({
  supportGizmoInteractionTimeoutRef,
  setSupportGizmoInteractionActive,
}: {
  supportGizmoInteractionTimeoutRef: React.RefObject<number | null>;
  setSupportGizmoInteractionActive: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    type SupportGizmoWindowState = Window & {
      __jointGizmoDragging?: boolean;
      __knotGizmoDragging?: boolean;
      __bezierGizmoDragging?: boolean;
      __jointGizmoGuardUntil?: number;
      __knotGizmoGuardUntil?: number;
      __bezierGizmoGuardUntil?: number;
    };

    const clearPendingSupportGizmoTimeout = () => {
      if (supportGizmoInteractionTimeoutRef.current === null) return;
      window.clearTimeout(supportGizmoInteractionTimeoutRef.current);
      supportGizmoInteractionTimeoutRef.current = null;
    };

    const refreshSupportGizmoInteraction = () => {
      const w = window as SupportGizmoWindowState;
      const dragging = !!(w.__jointGizmoDragging || w.__knotGizmoDragging || w.__bezierGizmoDragging);
      const guardUntil = Math.max(
        Number(w.__jointGizmoGuardUntil ?? 0),
        Number(w.__knotGizmoGuardUntil ?? 0),
        Number(w.__bezierGizmoGuardUntil ?? 0),
      );
      const now = Date.now();
      const guardActive = guardUntil > now;

      setSupportGizmoInteractionActive(dragging || guardActive);
      clearPendingSupportGizmoTimeout();

      if (!dragging && guardActive) {
        supportGizmoInteractionTimeoutRef.current = window.setTimeout(() => {
          supportGizmoInteractionTimeoutRef.current = null;
          refreshSupportGizmoInteraction();
        }, Math.max(0, guardUntil - now + 1));
      }
    };

    const handleSupportGizmoInteractionLock = () => {
      refreshSupportGizmoInteraction();
    };

    refreshSupportGizmoInteraction();
    window.addEventListener('joint-gizmo-interaction-lock', handleSupportGizmoInteractionLock as EventListener);
    window.addEventListener('knot-gizmo-interaction-lock', handleSupportGizmoInteractionLock as EventListener);
    window.addEventListener('bezier-gizmo-interaction-lock', handleSupportGizmoInteractionLock as EventListener);

    return () => {
      window.removeEventListener('joint-gizmo-interaction-lock', handleSupportGizmoInteractionLock as EventListener);
      window.removeEventListener('knot-gizmo-interaction-lock', handleSupportGizmoInteractionLock as EventListener);
      window.removeEventListener('bezier-gizmo-interaction-lock', handleSupportGizmoInteractionLock as EventListener);
      clearPendingSupportGizmoTimeout();
    };
  }, [setSupportGizmoInteractionActive, supportGizmoInteractionTimeoutRef]);
}
