import React from 'react';
import type { useSceneCollectionManager } from '@/features/scene/useSceneCollectionManager';
import type { useSlicingManager } from '@/features/slicing/useSlicingManager';

type HomeScene = ReturnType<typeof useSceneCollectionManager>;
type HomeSlicing = ReturnType<typeof useSlicingManager>;

/**
 * Arrow Up and Down (and W and S in Printing) step through layers: the
 * printed layer in Printing, the cross-section layer elsewhere. Moved out of
 * Home verbatim, except that the slicing fields are destructured so the
 * dependency list names them, and the printing layer ref joins it (it is
 * stable).
 */
export function useLayerStepHotkeys({
  scene,
  slicing,
  printingPreviewTotalLayers,
  printingSelectedLayerRef,
  handlePrintingLayerChange,
}: {
  scene: HomeScene;
  slicing: HomeSlicing;
  printingPreviewTotalLayers: number;
  printingSelectedLayerRef: React.MutableRefObject<number>;
  handlePrintingLayerChange: (layer: number) => void;
}) {
  'use no memo';
  const { layerIndex, numLayers, setLayerIndex } = slicing;
  React.useEffect(() => {
    const handleLayerHotkeys = (event: CustomEvent) => {
      const { key, altKey, ctrlKey, metaKey } = event.detail;
      if (altKey || ctrlKey || metaKey) return;

      const isPrinting = scene.mode === 'printing';
      const isUp = key === 'ArrowUp' || (isPrinting && (key === 'w' || key === 'W'));
      const isDown = key === 'ArrowDown' || (isPrinting && (key === 's' || key === 'S'));
      if (!isUp && !isDown) return;

      const delta = isUp ? 1 : -1;

      if (isPrinting) {
        if (printingPreviewTotalLayers <= 0) return;
        const nextLayer = printingSelectedLayerRef.current + delta;
        handlePrintingLayerChange(nextLayer);
        return;
      }

      if (numLayers <= 0) return;
      setLayerIndex((previous) => previous + delta);
    };

    window.addEventListener('app-hotkey-keydown', handleLayerHotkeys as EventListener);
    return () => {
      window.removeEventListener('app-hotkey-keydown', handleLayerHotkeys as EventListener);
    };
  }, [handlePrintingLayerChange, printingPreviewTotalLayers, printingSelectedLayerRef, scene.mode, layerIndex, numLayers, setLayerIndex]);
}
