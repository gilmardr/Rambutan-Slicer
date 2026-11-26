import React from 'react';
import type { useSceneCollectionManager } from '@/features/scene/useSceneCollectionManager';

type HomeScene = ReturnType<typeof useSceneCollectionManager>;

/**
 * How much room the model stats card takes at the bottom of the viewport: the
 * card's container ref and a clearance measured with a ResizeObserver, never
 * under 220 px, so floating panels stop above the card. Moved out of Home
 * verbatim.
 */
export function useModelStatsClearance({ scene }: { scene: HomeScene }) {
  'use no memo';
  const modelStatsCardContainerRef = React.useRef<HTMLDivElement | null>(null);
  const [modelStatsBottomClearancePx, setModelStatsBottomClearancePx] = React.useState(220);

  React.useLayoutEffect(() => {
    const element = modelStatsCardContainerRef.current;
    if (!element) {
      setModelStatsBottomClearancePx(220);
      return;
    }

    const updateClearance = () => {
      const rect = element.getBoundingClientRect();
      const bottomMarginPx = 12; // bottom-3 (aligned with floating panel margin)
      const safetyGapPx = 14;
      const measured = Math.ceil(rect.height + bottomMarginPx + safetyGapPx);
      setModelStatsBottomClearancePx(Math.max(220, measured));
    };

    updateClearance();
    const observer = new ResizeObserver(() => {
      updateClearance();
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [scene.models.length]);

  return { modelStatsCardContainerRef, modelStatsBottomClearancePx };
}
