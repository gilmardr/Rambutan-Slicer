import React from 'react';

export interface ShaftHoverDebugDetail {
  segmentId: string | null;
  point: { x: number; y: number; z: number } | null;
}

/**
 * Which support shaft segment the pointer is over, and where, from the
 * viewport's shaft-hover and shaft-leave events. The right-click menu and the
 * brace debug overlay read it. Moved out of Home verbatim.
 */
export function useSupportShaftHover() {
  'use no memo';
  const [supportShaftHoverDebug, setSupportShaftHoverDebug] = React.useState<ShaftHoverDebugDetail>({
    segmentId: null,
    point: null,
  });

  React.useEffect(() => {
    const handleShaftHover = (evt: Event) => {
      const detail = (evt as CustomEvent<{ segmentId?: string | null; point?: { x: number; y: number; z: number } | null }>).detail;
      const nextSegmentId = detail?.segmentId ?? null;
      const nextPoint = detail?.point ?? null;

      setSupportShaftHoverDebug((prev) => {
        if (
          prev.segmentId === nextSegmentId &&
          prev.point?.x === nextPoint?.x &&
          prev.point?.y === nextPoint?.y &&
          prev.point?.z === nextPoint?.z
        ) {
          return prev;
        }

        return {
          segmentId: nextSegmentId,
          point: nextPoint,
        };
      });
    };

    const handleShaftLeave = (evt: Event) => {
      const detail = (evt as CustomEvent<{ segmentId?: string | null }>).detail;
      setSupportShaftHoverDebug((prev) => {
        if (!detail?.segmentId || prev.segmentId === detail.segmentId) {
          if (prev.segmentId === null && prev.point === null) {
            return prev;
          }
          return { segmentId: null, point: null };
        }
        return prev;
      });
    };

    window.addEventListener('shaft-hover', handleShaftHover as EventListener);
    window.addEventListener('shaft-leave', handleShaftLeave as EventListener);
    return () => {
      window.removeEventListener('shaft-hover', handleShaftHover as EventListener);
      window.removeEventListener('shaft-leave', handleShaftLeave as EventListener);
    };
  }, []);

  return supportShaftHoverDebug;
}
