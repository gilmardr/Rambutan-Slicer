import React from 'react';
import type { useSceneCollectionManager } from '@/features/scene/useSceneCollectionManager';

type HomeScene = ReturnType<typeof useSceneCollectionManager>;

type SupportShaftHover = {
  segmentId: string | null;
  point: { x: number; y: number; z: number } | null;
};

/**
 * How a right click in the editor becomes the context menu: the pointer
 * handlers that tell a click from a right-drag orbit, the window during which
 * an orbit suppresses the menu, and the ref the Cut tool fills to open its own
 * menu instead. Moved out of Home verbatim; the menu's two setters come in as
 * inputs.
 */
export function useEditorRightClickGesture({
  scene,
  supportShaftHoverDebug,
  setEditorContextMenuSupportTarget,
  setEditorContextMenuPos,
}: {
  scene: HomeScene;
  supportShaftHoverDebug: SupportShaftHover;
  setEditorContextMenuSupportTarget: React.Dispatch<React.SetStateAction<{ segmentId: string; point: { x: number; y: number; z: number } } | null>>;
  setEditorContextMenuPos: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
}) {
  'use no memo';
  const rightClickGestureRef = React.useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const suppressEditorContextMenuUntilRef = React.useRef(0);

  // The Cut tool's own right-click menu, reached through a ref because the
  // handler below is declared long before the cut session exists.
  const organicCutContextMenuRef = React.useRef<
    ((event: { clientX: number; clientY: number }) => boolean) | null
  >(null);

  const handleEditorPointerDownCapture = React.useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 2) return;
    rightClickGestureRef.current = { x: e.clientX, y: e.clientY, moved: false };
  }, []);

  const handleEditorPointerMoveCapture = React.useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const gesture = rightClickGestureRef.current;
    if (!gesture) return;
    const dx = e.clientX - gesture.x;
    const dy = e.clientY - gesture.y;
    if ((dx * dx + dy * dy) > 36) {
      gesture.moved = true;
    }
  }, []);

  const handleEditorPointerUpCapture = React.useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 2) return;

    const gesture = rightClickGestureRef.current;
    const moved = Boolean(gesture?.moved);
    const shouldSuppress = performance.now() < suppressEditorContextMenuUntilRef.current;
    // No editor menu on the empty-scene welcome screen — there is nothing to act
    // on (unless the clipboard holds a cut/copied model that could be pasted).
    if (!moved && !shouldSuppress && (scene.models.length > 0 || scene.canPasteModel)) {
      // Cut tool: a hovered waypoint or seam opens the cut's own menu instead of
      // the model/support one. The session decides; we only stand down.
      if (organicCutContextMenuRef.current?.(e)) {
        window.setTimeout(() => { rightClickGestureRef.current = null; }, 0);
        return;
      }
      if (scene.mode === 'support' && supportShaftHoverDebug.segmentId && supportShaftHoverDebug.point) {
        setEditorContextMenuSupportTarget({
          segmentId: supportShaftHoverDebug.segmentId,
          point: supportShaftHoverDebug.point,
        });
      } else {
        setEditorContextMenuSupportTarget(null);
      }
      setEditorContextMenuPos({ x: e.clientX, y: e.clientY });
    }

    // keep gesture state until contextmenu fires, clear shortly after
    window.setTimeout(() => {
      rightClickGestureRef.current = null;
    }, 0);
  }, [scene.mode, scene.models.length, scene.canPasteModel, setEditorContextMenuPos, setEditorContextMenuSupportTarget, supportShaftHoverDebug.point, supportShaftHoverDebug.segmentId]);

  React.useEffect(() => {
    const markSuppressed = (durationMs: number) => {
      suppressEditorContextMenuUntilRef.current = Math.max(
        suppressEditorContextMenuUntilRef.current,
        performance.now() + durationMs,
      );
    };

    const onOrbitChange = () => markSuppressed(300);

    window.addEventListener('picking-orbit-change', onOrbitChange as EventListener);

    return () => {
      window.removeEventListener('picking-orbit-change', onOrbitChange as EventListener);
    };
  }, []);

  return {
    organicCutContextMenuRef,
    handleEditorPointerDownCapture,
    handleEditorPointerMoveCapture,
    handleEditorPointerUpCapture,
  };
}
