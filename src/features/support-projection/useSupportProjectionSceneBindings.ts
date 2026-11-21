"use client";

import React from 'react';
import { cancelSupportProjectionPreview, finishSupportProjectionStroke } from './supportProjection';

/** Finish projection when the pointer is released away from the model. */
export function useSupportProjectionSceneBindings({
  mode,
  transformMode,
}: {
  mode?: string;
  transformMode?: string;
}) {
  React.useEffect(() => {
    if (mode !== 'support' || transformMode !== 'supportProjection') return;
    const finish = () => finishSupportProjectionStroke();
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      finish();
      cancelSupportProjectionPreview();
    };
  }, [mode, transformMode]);
}
