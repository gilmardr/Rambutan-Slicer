'use no memo';
import React from 'react';
import * as THREE from 'three';
import { resolveTrackpadGestureAction } from './sceneCanvasProjection';
import type { WheelSample } from '@/components/scene/SceneCanvas/wheelDeviceClassifier';
import type { WheelDevice } from '@/components/scene/SceneCanvas/wheelDeviceClassifier';
import type { CameraTrackpadPrimaryAction } from '@/components/settings/cameraTrackpadPreferences';
import type { CameraTrackpadModifierKey } from '@/components/settings/cameraTrackpadPreferences';

/**
 * Mouse-wheel zoom over the viewport, reported as an interaction: it starts on the first wheel event and ends after the wheel goes quiet, or at once on a pointer cancel, mouse up, context menu, blur or hidden tab. Part of SceneCanvas.
 */
export function useWheelZoomInteraction({
  containerRef,
  wheelZoomEndTimeoutRef,
  wheelZoomInteractionActiveRef,
  setIsWheelZoomInteracting,
  navigationResumeDelayRef,
  orbitControlsRef,
  wheelDeviceClassifierRef,
  cameraTrackpadSettings,
  cameraTrackpadModifierKey,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  wheelZoomEndTimeoutRef: React.RefObject<number | null>;
  wheelZoomInteractionActiveRef: React.RefObject<boolean>;
  setIsWheelZoomInteracting: React.Dispatch<React.SetStateAction<boolean>>;
  navigationResumeDelayRef: React.RefObject<number>;
  orbitControlsRef: React.RefObject<{ target: THREE.Vector3; rotateSpeed: number; panSpeed: number; zoomSpeed: number; update: () => void; enabled?: boolean | undefined; } | null>;
  wheelDeviceClassifierRef: React.RefObject<{ classify(sample: WheelSample, now: number): WheelDevice; reset(): void; }>;
  cameraTrackpadSettings: CameraTrackpadPrimaryAction;
  cameraTrackpadModifierKey: CameraTrackpadModifierKey;
}) {
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof window === 'undefined') return;

    const clearPendingZoomEnd = () => {
      if (wheelZoomEndTimeoutRef.current === null) return;
      window.clearTimeout(wheelZoomEndTimeoutRef.current);
      wheelZoomEndTimeoutRef.current = null;
    };

    const endZoomInteraction = () => {
      clearPendingZoomEnd();
      if (!wheelZoomInteractionActiveRef.current) return;

      wheelZoomInteractionActiveRef.current = false;
      setIsWheelZoomInteracting(false);
      window.dispatchEvent(new CustomEvent('picking-zoom-end', {
        detail: { resumeAfterMs: navigationResumeDelayRef.current },
      }));
    };

    const beginZoomInteraction = () => {
      if (wheelZoomInteractionActiveRef.current) return;
      wheelZoomInteractionActiveRef.current = true;
      setIsWheelZoomInteracting(true);
      window.dispatchEvent(new Event('picking-zoom-start'));
    };

    const scheduleZoomInteractionEnd = () => {
      clearPendingZoomEnd();
      wheelZoomEndTimeoutRef.current = window.setTimeout(() => {
        wheelZoomEndTimeoutRef.current = null;
        endZoomInteraction();
      }, 120);
    };

    const onWheel = (event: WheelEvent) => {
      if (!container.contains(event.target as Node | null)) return;
      const controls = orbitControlsRef.current;
      if (!controls || controls.enabled === false) return;
      const device = wheelDeviceClassifierRef.current.classify(event, event.timeStamp);
      // Trackpad: allow zoom only for pinch gestures (ctrlKey).
      // Regular two-finger scroll should never trigger zoom.
      // An 'unknown' verdict zooms: a wheel must always zoom, and that is the
      // reading a bare wheel event gets everywhere else.
      if (device === 'trackpad' && !event.ctrlKey) {
        return;
      }
      try {
        if (resolveTrackpadGestureAction(event, device, cameraTrackpadSettings, cameraTrackpadModifierKey) !== null) {
          return;
        }
      } catch (error) {
        console.error('[SceneCanvas] Trackpad gesture resolution failed; falling back to wheel zoom.', error);
      }

      beginZoomInteraction();

      window.dispatchEvent(new Event('picking-zoom-change'));
      scheduleZoomInteractionEnd();
    };

    const forceZoomInteractionEnd = () => {
      endZoomInteraction();
    };

    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('pointerup', forceZoomInteractionEnd, true);
    window.addEventListener('pointercancel', forceZoomInteractionEnd, true);
    window.addEventListener('mouseup', forceZoomInteractionEnd, true);
    window.addEventListener('contextmenu', forceZoomInteractionEnd, true);
    window.addEventListener('blur', forceZoomInteractionEnd);
    document.addEventListener('visibilitychange', forceZoomInteractionEnd);

    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('pointerup', forceZoomInteractionEnd, true);
      window.removeEventListener('pointercancel', forceZoomInteractionEnd, true);
      window.removeEventListener('mouseup', forceZoomInteractionEnd, true);
      window.removeEventListener('contextmenu', forceZoomInteractionEnd, true);
      window.removeEventListener('blur', forceZoomInteractionEnd);
      document.removeEventListener('visibilitychange', forceZoomInteractionEnd);
      endZoomInteraction();
    };
  }, [cameraTrackpadModifierKey, cameraTrackpadSettings, containerRef, navigationResumeDelayRef, orbitControlsRef, setIsWheelZoomInteracting, wheelDeviceClassifierRef, wheelZoomEndTimeoutRef, wheelZoomInteractionActiveRef]);
}
