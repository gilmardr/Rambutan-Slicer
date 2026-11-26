'use no memo';
import React from 'react';
import * as THREE from 'three';
import { ORTHO_MAX_RADIUS, ORTHO_MIN_RADIUS, dollyOrthoToCursor, orthoWheelRadiusScale } from '@/components/scene/camera/orthoDolly';
import { type TrackpadGestureAction } from '@/components/scene/camera/trackpadGesturePose';
import { resolveTrackpadGestureAction } from './sceneCanvasProjection';
import type { WheelSample } from '@/components/scene/SceneCanvas/wheelDeviceClassifier';
import type { WheelDevice } from '@/components/scene/SceneCanvas/wheelDeviceClassifier';
import type { CameraTrackpadPrimaryAction } from '@/components/settings/cameraTrackpadPreferences';
import type { CameraTrackpadModifierKey } from '@/components/settings/cameraTrackpadPreferences';

/**
 * The trackpad wheel gestures over the viewport: orbit and pan from a two-finger swipe, the orthographic cursor dolly, and the gesture's end on blur or a hidden tab. Part of SceneCanvas.
 */
export function useTrackpadWheelGestures({
  containerRef,
  wheelDeviceClassifierRef,
  cameraTrackpadSettings,
  cameraTrackpadModifierKey,
  cameraRef,
  orbitControlsRef,
  orthoSceneRadiusMm,
  perspectiveFov,
  orbitInteractionActiveRef,
  trackpadGestureActionRef,
  handleOrbitStart,
  applyTrackpadGesture,
  handleOrbitEnd,
  handleOrbitChange,
  scheduleTrackpadGestureEnd,
  clearPendingTrackpadGestureEnd,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  wheelDeviceClassifierRef: React.RefObject<{ classify(sample: WheelSample, now: number): WheelDevice; reset(): void; }>;
  cameraTrackpadSettings: CameraTrackpadPrimaryAction;
  cameraTrackpadModifierKey: CameraTrackpadModifierKey;
  cameraRef: React.RefObject<THREE.Camera | null>;
  orbitControlsRef: React.RefObject<{ target: THREE.Vector3; rotateSpeed: number; panSpeed: number; zoomSpeed: number; update: () => void; enabled?: boolean | undefined; } | null>;
  orthoSceneRadiusMm: number;
  perspectiveFov: number;
  orbitInteractionActiveRef: React.RefObject<boolean>;
  trackpadGestureActionRef: React.RefObject<TrackpadGestureAction | null>;
  handleOrbitStart: () => void;
  applyTrackpadGesture: (action: TrackpadGestureAction, event: WheelEvent) => boolean;
  handleOrbitEnd: () => void;
  handleOrbitChange: () => void;
  scheduleTrackpadGestureEnd: () => void;
  clearPendingTrackpadGestureEnd: () => void;
}) {
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof window === 'undefined') return;

    const onTrackpadWheel = (event: WheelEvent) => {
      if (!container.contains(event.target as Node | null)) return;

      try {
        const action = resolveTrackpadGestureAction(
          event,
          wheelDeviceClassifierRef.current.classify(event, event.timeStamp),
          cameraTrackpadSettings,
          cameraTrackpadModifierKey,
        );
        if (action === null) {
          // Orthographic wheel is a real dolly: move the camera along its view
          // axis and let OrthoFrustumSync derive the frustum from the new
          // radius. OrbitControls' zoom is disabled in ortho, so we own it — and
          // that is exactly why this path must check the idle signal itself.
          // OrbitControls being disabled is how every other owner of the camera
          // announces itself: a live SpaceMouse gesture, the Home / focus /
          // mode-framing animations. Without the check the wheel dollies against
          // them, fighting the SpaceMouse over the same dolly radius.
          const camera = cameraRef.current;
          const zoomControls = orbitControlsRef.current;
          if (zoomControls && zoomControls.enabled === false) return;
          if (camera instanceof THREE.OrthographicCamera && zoomControls) {
            const rect = container.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              event.preventDefault();
              const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
              const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
              const aspect = (camera.right - camera.left) / Math.max(1e-6, camera.top - camera.bottom);
              const nextTarget = dollyOrthoToCursor({
                camera,
                target: zoomControls.target,
                ndcX,
                ndcY,
                radiusScale: orthoWheelRadiusScale(event.deltaY, zoomControls.zoomSpeed),
                minRadius: ORTHO_MIN_RADIUS,
                maxRadius: ORTHO_MAX_RADIUS,
                aspect,
                options: { sceneRadius: orthoSceneRadiusMm, fovDeg: perspectiveFov },
              });
              zoomControls.target.copy(nextTarget);
              zoomControls.update();
            }
          }
          return;
        }

        const controls = orbitControlsRef.current;
        if (!controls || controls.enabled === false) return;

        event.preventDefault();
        event.stopPropagation();

        if (!orbitInteractionActiveRef.current) {
          trackpadGestureActionRef.current = action;
          handleOrbitStart();
        } else {
          trackpadGestureActionRef.current = action;
        }

        if (!applyTrackpadGesture(action, event)) {
          trackpadGestureActionRef.current = null;
          handleOrbitEnd();
          return;
        }

        handleOrbitChange();
        scheduleTrackpadGestureEnd();
      } catch (error) {
        console.error('[SceneCanvas] Trackpad wheel handler failed; disabling current trackpad gesture frame.', error);
        trackpadGestureActionRef.current = null;
        clearPendingTrackpadGestureEnd();
      }
    };

    const forceTrackpadGestureEnd = () => {
      clearPendingTrackpadGestureEnd();
      if (trackpadGestureActionRef.current === null) return;
      trackpadGestureActionRef.current = null;
      handleOrbitEnd();
    };

    container.addEventListener('wheel', onTrackpadWheel, { capture: true, passive: false });
    window.addEventListener('blur', forceTrackpadGestureEnd);
    document.addEventListener('visibilitychange', forceTrackpadGestureEnd);

    return () => {
      container.removeEventListener('wheel', onTrackpadWheel, true);
      window.removeEventListener('blur', forceTrackpadGestureEnd);
      document.removeEventListener('visibilitychange', forceTrackpadGestureEnd);
      // Deliberately NOT forceTrackpadGestureEnd(): this effect re-runs whenever
      // one of the callbacks it closes over gets a new identity, which happens
      // mid-gesture (the first wheel event calls onCameraChange, that updates
      // page state, and the changed callbacks rebuild this effect). Ending the
      // gesture there killed the interaction on every event — the camera only
      // moved because the old code moved it synchronously, inside the wheel
      // handler. The gesture's own ends are the idle timeout, blur /
      // visibilitychange, and unmount.
    };
  }, [
    applyTrackpadGesture,
    cameraTrackpadModifierKey,
    cameraTrackpadSettings,
    clearPendingTrackpadGestureEnd,
    handleOrbitChange,
    handleOrbitEnd,
    handleOrbitStart,
    orthoSceneRadiusMm,
    perspectiveFov,
    scheduleTrackpadGestureEnd,
    cameraRef,
    containerRef,
    orbitControlsRef,
    orbitInteractionActiveRef,
    trackpadGestureActionRef,
    wheelDeviceClassifierRef,
  ]);
}
