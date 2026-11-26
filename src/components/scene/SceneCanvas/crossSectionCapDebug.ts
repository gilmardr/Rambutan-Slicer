/** State and defaults of the cross-section cap debug panel. */
import { type CrossSectionCapDebugOverrides } from '@/components/scene/CrossSectionStencilCap';

export type CrossSectionCapDebugPanelState = {
  enabled: boolean;
  top: CrossSectionCapDebugOverrides;
  bottom: CrossSectionCapDebugOverrides;
};

export const CROSS_SECTION_CAP_DEBUG_STORAGE_KEY = 'df:cross-section-cap-debug:v4';

export const CROSS_SECTION_CAP_DEBUG_HOTKEY_ENABLED = false;

export const DEFAULT_CROSS_SECTION_CAP_DEBUG_STATE: CrossSectionCapDebugPanelState = {
  enabled: false,
  top: {
    side: 'front',
    offsetMm: 1e-4,
    rotationXDeg: 0,
    clipMode: 'upper',
    stencilMode: 'standard',
    depthTest: true,
  },
  bottom: {
    side: 'back',
    offsetMm: -1e-4,
    rotationXDeg: 0,
    clipMode: 'lower',
    stencilMode: 'standard',
    depthTest: false,
  },
};
