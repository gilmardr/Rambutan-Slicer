import React from 'react';
import type { useSceneCollectionManager } from '@/features/scene/useSceneCollectionManager';
import { PROFILE_SETTINGS_MODAL_OPEN_CHANGE_EVENT } from '@/components/settings/profileModalEvents';

type HomeScene = ReturnType<typeof useSceneCollectionManager>;

/**
 * Sends the user back to Prepare, with the re-slice prompt, when the slice
 * shown in the Printing workspace goes stale. While the profile settings modal
 * is open it waits and does it when the modal closes. Moved out of Home
 * verbatim; the prompt's setter comes in as an input and joins the dependency
 * lists (it is stable).
 */
export function useStaleSliceKickFromPrinting({
  scene,
  isActiveSliceStale,
  setShowPrintingResliceModal,
}: {
  scene: HomeScene;
  isActiveSliceStale: boolean;
  setShowPrintingResliceModal: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  'use no memo';
  // Track whether the profile settings modal is currently open so we can
  // defer the printing-workspace kick until after the user closes it.
  const isProfileModalOpenRef = React.useRef(false);
  const pendingPrintingKickRef = React.useRef(false);
  React.useEffect(() => {
    const handler = (e: Event) => {
      const isOpen = (e as CustomEvent<{ isOpen: boolean }>).detail.isOpen;
      isProfileModalOpenRef.current = isOpen;
      if (!isOpen && pendingPrintingKickRef.current) {
        pendingPrintingKickRef.current = false;
        scene.setMode('prepare');
        setShowPrintingResliceModal(true);
      }
    };
    window.addEventListener(PROFILE_SETTINGS_MODAL_OPEN_CHANGE_EVENT, handler);
    return () => window.removeEventListener(PROFILE_SETTINGS_MODAL_OPEN_CHANGE_EVENT, handler);
  }, [scene, setShowPrintingResliceModal]);

  // If artifact becomes invalid while already in printing workspace, kick back and show modal.
  // If the profile settings modal is currently open, defer until it closes.
  React.useEffect(() => {
    if (scene.mode === 'printing' && isActiveSliceStale) {
      if (isProfileModalOpenRef.current) {
        pendingPrintingKickRef.current = true;
      } else {
        scene.setMode('prepare');
        setShowPrintingResliceModal(true);
      }
    }
  }, [isActiveSliceStale, scene.mode, scene, setShowPrintingResliceModal]);
}
