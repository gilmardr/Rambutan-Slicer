import React from 'react';
import type { useSceneCollectionManager } from '@/features/scene/useSceneCollectionManager';

type HomeScene = ReturnType<typeof useSceneCollectionManager>;

/**
 * Pauses the scene's background geometry work while the camera moves and
 * resumes it 140 ms after the camera stops, so orbiting stays smooth. Also
 * resumes it on unmount. Moved out of Home verbatim.
 */
export function useCameraBackgroundWorkPause({ scene }: { scene: HomeScene }) {
  'use no memo';
  const cameraResumeTimeoutRef = React.useRef<number | null>(null);

  const handleCameraChange = React.useCallback(() => {
    if (cameraResumeTimeoutRef.current !== null) {
      window.clearTimeout(cameraResumeTimeoutRef.current);
      cameraResumeTimeoutRef.current = null;
    }
    scene.setBackgroundGeometryWorkPaused(true);
  }, [scene]);

  const handleCameraEnd = React.useCallback(() => {
    if (cameraResumeTimeoutRef.current !== null) {
      window.clearTimeout(cameraResumeTimeoutRef.current);
    }

    cameraResumeTimeoutRef.current = window.setTimeout(() => {
      scene.setBackgroundGeometryWorkPaused(false);
      cameraResumeTimeoutRef.current = null;
    }, 140);
  }, [scene]);

  React.useEffect(() => {
    return () => {
      if (cameraResumeTimeoutRef.current !== null) {
        window.clearTimeout(cameraResumeTimeoutRef.current);
      }
      scene.setBackgroundGeometryWorkPaused(false);
    };
  }, [scene]);

  return { handleCameraChange, handleCameraEnd };
}
