"use client";

import React from 'react';
import { finishSupportPaintingStroke } from './supportPainting';
import { cancelSupportInlinePair } from '@/features/support-inline/supportInline';

/** Finish a support-paint stroke even when the pointer is released off the model. */
export function useSupportPaintingSceneBindings({
  mode,
  transformMode,
  activeModelId,
}: {
  mode?: string;
  transformMode?: string;
  activeModelId?: string | null;
}) {
  React.useEffect(() => {
    if (mode !== 'support') return;
    if (transformMode === 'supportInline') {
      const cancel = () => cancelSupportInlinePair();
      window.addEventListener('pointercancel', cancel);
      return () => {
        window.removeEventListener('pointercancel', cancel);
        cancel();
      };
    }
    if (transformMode !== 'supportPainting') return;
    const finish = () => finishSupportPaintingStroke();
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      finish();
    };
  }, [activeModelId, mode, transformMode]);
}
