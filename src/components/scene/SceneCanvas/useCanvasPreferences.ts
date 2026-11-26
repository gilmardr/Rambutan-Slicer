'use no memo';
/**
 * Small subscriptions SceneCanvas reads: the camera preferences (projection,
 * field of view, feel, trackpad mapping and accelerations) and whether the app
 * is showing its light theme.
 */
import React from 'react';
import { subscribeToCameraProjectionSettings, getSavedCameraProjectionSettings, DEFAULT_CAMERA_PROJECTION_SETTINGS } from '@/components/settings/cameraProjectionPreferences';
import { subscribeToCameraFovSettings, getSavedCameraFovSettings, DEFAULT_CAMERA_FOV_SETTINGS } from '@/components/settings/cameraFovPreferences';
import { subscribeToCameraFeelSettings, getSavedCameraFeelSettings, DEFAULT_CAMERA_FEEL_SETTINGS } from '@/components/settings/cameraFeelPreferences';
import { subscribeToCameraTrackpadSettings, getSavedCameraTrackpadSettings, DEFAULT_CAMERA_TRACKPAD_SETTINGS } from '@/components/settings/cameraTrackpadPreferences';

/** The camera preferences, each a live snapshot of its settings store. */
export function useCanvasCameraPreferences() {
  const cameraProjectionMode = React.useSyncExternalStore(
    subscribeToCameraProjectionSettings,
    () => getSavedCameraProjectionSettings().mode,
    () => DEFAULT_CAMERA_PROJECTION_SETTINGS.mode,
  );
  const perspectiveFov = React.useSyncExternalStore(
    subscribeToCameraFovSettings,
    () => getSavedCameraFovSettings().fov,
    () => DEFAULT_CAMERA_FOV_SETTINGS.fov,
  );
  const cameraFeelPreset = React.useSyncExternalStore(
    subscribeToCameraFeelSettings,
    () => getSavedCameraFeelSettings().preset,
    () => DEFAULT_CAMERA_FEEL_SETTINGS.preset,
  );
  const cameraTrackpadSettings = React.useSyncExternalStore(
    subscribeToCameraTrackpadSettings,
    () => getSavedCameraTrackpadSettings().primaryAction,
    () => DEFAULT_CAMERA_TRACKPAD_SETTINGS.primaryAction,
  );
  const cameraTrackpadModifierKey = React.useSyncExternalStore(
    subscribeToCameraTrackpadSettings,
    () => getSavedCameraTrackpadSettings().modifierKey,
    () => DEFAULT_CAMERA_TRACKPAD_SETTINGS.modifierKey,
  );
  const cameraTrackpadPanAcceleration = React.useSyncExternalStore(
    subscribeToCameraTrackpadSettings,
    () => getSavedCameraTrackpadSettings().panAcceleration,
    () => DEFAULT_CAMERA_TRACKPAD_SETTINGS.panAcceleration,
  );
  const cameraTrackpadOrbitAcceleration = React.useSyncExternalStore(
    subscribeToCameraTrackpadSettings,
    () => getSavedCameraTrackpadSettings().orbitAcceleration,
    () => DEFAULT_CAMERA_TRACKPAD_SETTINGS.orbitAcceleration,
  );
  const cameraTrackpadZoomAcceleration = React.useSyncExternalStore(
    subscribeToCameraTrackpadSettings,
    () => getSavedCameraTrackpadSettings().zoomAcceleration,
    () => DEFAULT_CAMERA_TRACKPAD_SETTINGS.zoomAcceleration,
  );

  return {
    cameraProjectionMode,
    perspectiveFov,
    cameraFeelPreset,
    cameraTrackpadSettings,
    cameraTrackpadModifierKey,
    cameraTrackpadPanAcceleration,
    cameraTrackpadOrbitAcceleration,
    cameraTrackpadZoomAcceleration,
  };
}

/** Whether the app shows its light theme, following class, data-theme and the OS preference. */
export function useIsLightTheme() {
  const [isLightTheme, setIsLightTheme] = React.useState(() => {
    if (typeof window === 'undefined') return false;
    const html = document.documentElement;
    return (
      html.classList.contains('dragonfruit-light') ||
      html.getAttribute('data-theme') === 'light' ||
      (window.matchMedia('(prefers-color-scheme: light)').matches && !html.classList.contains('dragonfruit-dark'))
    );
  });
  React.useEffect(() => {
    const check = () => {
      const html = document.documentElement;
      setIsLightTheme(
        html.classList.contains('dragonfruit-light') ||
        html.getAttribute('data-theme') === 'light' ||
        (window.matchMedia('(prefers-color-scheme: light)').matches && !html.classList.contains('dragonfruit-dark')),
      );
    };
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', check);
    return () => { observer.disconnect(); mq.removeEventListener('change', check); };
  }, []);

  return isLightTheme;
}
