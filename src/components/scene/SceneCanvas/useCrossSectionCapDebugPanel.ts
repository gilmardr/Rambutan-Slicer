'use no memo';
/**
 * The cross-section cap debug panel: whether it is shown, its overrides
 * (persisted in localStorage), and the overrides the caps should use. Part of
 * SceneCanvas.
 */
import React from 'react';
import { useActionActive } from '@/hotkeys/hotkeyStore';
import {
  CROSS_SECTION_CAP_DEBUG_HOTKEY_ENABLED,
  CROSS_SECTION_CAP_DEBUG_STORAGE_KEY,
  DEFAULT_CROSS_SECTION_CAP_DEBUG_STATE,
  type CrossSectionCapDebugPanelState,
} from './crossSectionCapDebug';

export function useCrossSectionCapDebugPanel() {
  const [showCrossSectionCapDebugPanel, setShowCrossSectionCapDebugPanel] = React.useState(false);
  const [crossSectionCapDebugState, setCrossSectionCapDebugState] = React.useState<CrossSectionCapDebugPanelState>(
    DEFAULT_CROSS_SECTION_CAP_DEBUG_STATE,
  );

  // Read after mount so the first render matches the server render.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(CROSS_SECTION_CAP_DEBUG_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<CrossSectionCapDebugPanelState>;
      setCrossSectionCapDebugState((prev) => ({
        enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : prev.enabled,
        top: { ...prev.top, ...(parsed.top ?? {}) },
        bottom: { ...prev.bottom, ...(parsed.bottom ?? {}) },
      }));
    } catch {
      // Ignore malformed debug state.
    }
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(CROSS_SECTION_CAP_DEBUG_STORAGE_KEY, JSON.stringify(crossSectionCapDebugState));
    } catch {
      // Ignore storage write failures in temporary debug tooling.
    }
  }, [crossSectionCapDebugState]);

  const isCapsDebugActive = useActionActive('DEBUG', 'TOGGLE_CAPS');
  const wasCapsDebugActive = React.useRef(false);

  React.useEffect(() => {
    if (!CROSS_SECTION_CAP_DEBUG_HOTKEY_ENABLED) return;
    if (isCapsDebugActive && !wasCapsDebugActive.current) {
      setShowCrossSectionCapDebugPanel((prev) => !prev);
    }
    wasCapsDebugActive.current = isCapsDebugActive;
  }, [isCapsDebugActive]);

  const topCapDebugOverrides = crossSectionCapDebugState.enabled
    ? crossSectionCapDebugState.top
    : undefined;
  const bottomCapDebugOverrides = crossSectionCapDebugState.enabled
    ? crossSectionCapDebugState.bottom
    : undefined;

  return {
    showCrossSectionCapDebugPanel,
    setShowCrossSectionCapDebugPanel,
    crossSectionCapDebugState,
    setCrossSectionCapDebugState,
    topCapDebugOverrides,
    bottomCapDebugOverrides,
  };
}
