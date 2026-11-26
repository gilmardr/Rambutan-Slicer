'use no memo';
/**
 * Small subscriptions SceneCanvas reads: the camera preferences (projection,
 * field of view, feel, trackpad mapping and accelerations) and whether the app
 * is showing its light theme.
 */
import React from 'react';
import * as THREE from 'three';
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

/**
 * The out-of-bounds stripe colour and the view cube colours, resolved from the
 * theme's CSS variables and refreshed whenever the theme changes.
 */
export function useThemeAccentColors() {
  const [outOfBoundsStripeColor, setOutOfBoundsStripeColor] = React.useState<string>('#b6ff2e');
  const [gizmoColors, setGizmoColors] = React.useState({
    face: '#1f2937',
    text: '#f8fafc',
    accent: '#ffb45d',
    chip: '#20242c',
    chipBorder: '#3a3f4b',
  });

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const resolveOutOfBoundsStripeColor = () => {
      const rootStyles = getComputedStyle(document.documentElement);
      const accentSecondary = rootStyles.getPropertyValue('--accent-secondary').trim();

      if (!accentSecondary) {
        setOutOfBoundsStripeColor('#b6ff2e');
      } else {
        try {
          const parsedSecondary = new THREE.Color();
          parsedSecondary.setStyle(accentSecondary);
          setOutOfBoundsStripeColor(parsedSecondary.getStyle());
        } catch {
          setOutOfBoundsStripeColor('#b6ff2e');
        }
      }
    };

    resolveOutOfBoundsStripeColor();

    const resolveGizmoColors = () => {
      const rootStyles = getComputedStyle(document.documentElement);
      const tryColor = (variable: string, fallback: string) => {
        const raw = rootStyles.getPropertyValue(variable).trim();
        if (!raw) return fallback;
        try {
          const c = new THREE.Color();
          c.setStyle(raw);
          return c.getStyle();
        } catch {
          return fallback;
        }
      };

      const accent = tryColor('--accent-secondary', '#ffb45d');
      // Derive face/text colors from theme surface/text tokens.
      // --surface-1 is the panel background; --text-strong is primary text.
      const face = tryColor('--surface-1', '#1f2937');
      const text = tryColor('--text-strong', '#f8fafc');
      // The home chip wears the same surface and hairline as the app's own floating
      // buttons, so it reads as a control rather than a stray glyph.
      const chip = tryColor('--surface-0', '#20242c');
      const chipBorder = tryColor('--border-subtle', '#3a3f4b');
      setGizmoColors((prev) => {
        if (
          prev.face === face
          && prev.text === text
          && prev.accent === accent
          && prev.chip === chip
          && prev.chipBorder === chipBorder
        ) return prev;
        return { face, text, accent, chip, chipBorder };
      });
    };

    resolveGizmoColors();

    const observer = new MutationObserver(() => {
      resolveOutOfBoundsStripeColor();
      resolveGizmoColors();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme'],
    });

    return () => observer.disconnect();
  }, []);

  return { outOfBoundsStripeColor, gizmoColors };
}
