import React from 'react';
import { type MeshShaderType } from '@/features/shaders/mesh';

/**
 * The Overhangs quick toggle: switches the viewport to the overhang heat map
 * and, when turned off, back to the view it interrupted. Moved out of Home
 * verbatim; it takes the scene's shader type and setter instead of
 * the whole scene.
 */
export function useOverhangViewToggle({
  shaderType,
  setShaderType,
}: {
  shaderType: MeshShaderType;
  setShaderType: (shaderType: MeshShaderType) => void;
}) {
  'use no memo';
  // The Overhangs quick toggle remembers what it interrupted, so turning it off
  // puts the viewport back where it was rather than on an arbitrary mode.
  const preOverhangViewTypeRef = React.useRef<MeshShaderType>('soft_clay');
  const toggleOverhangView = React.useCallback((next: boolean) => {
    if (next) {
      if (shaderType !== 'overhang_heatmap') {
        preOverhangViewTypeRef.current = shaderType;
      }
      setShaderType('overhang_heatmap');
      return;
    }
    const previous = preOverhangViewTypeRef.current;
    setShaderType(previous === 'overhang_heatmap' ? 'soft_clay' : previous);
  }, [shaderType, setShaderType]);

  return toggleOverhangView;
}
