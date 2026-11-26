import React from 'react';
import { getSavedCameraProjectionSettings, saveCameraProjectionSettings } from '@/components/settings/cameraProjectionPreferences';
import { getSavedWorkspaceCameraSettings, getWorkspaceCameraSettingsSnapshot } from '@/components/settings/workspaceCameraPreferences';
import type { useSceneCollectionManager } from '@/features/scene/useSceneCollectionManager';

type HomeScene = ReturnType<typeof useSceneCollectionManager>;

/**
 * When the camera setting is per workspace, switching workspace (or changing
 * the setting) applies that workspace's projection mode, except during the
 * automatic re-slice round trip. Moved out of Home; workspaceCameraSettings is
 * only a re-run trigger, as before.
 */
export function useWorkspaceCameraProjectionSync({
  sceneMode,
  workspaceCameraSettings,
  shouldReturnToPrintingAfterSliceRef,
}: {
  sceneMode: HomeScene['mode'];
  workspaceCameraSettings: ReturnType<typeof getWorkspaceCameraSettingsSnapshot>;
  shouldReturnToPrintingAfterSliceRef: React.MutableRefObject<boolean>;
}) {
  'use no memo';
  React.useEffect(() => {
    // Skip camera changes during automatic re-slice flow to prevent flickering
    if (shouldReturnToPrintingAfterSliceRef.current) return;

    const persistedWorkspaceCameraSettings = getSavedWorkspaceCameraSettings();

    if (persistedWorkspaceCameraSettings.scope !== 'workspace') return;

    const workspaceProjectionMode = persistedWorkspaceCameraSettings.defaults[sceneMode];
    const currentProjectionMode = getSavedCameraProjectionSettings().mode;

    if (workspaceProjectionMode !== currentProjectionMode) {
      saveCameraProjectionSettings({ mode: workspaceProjectionMode });
    }
  }, [sceneMode, workspaceCameraSettings, shouldReturnToPrintingAfterSliceRef]);
}
