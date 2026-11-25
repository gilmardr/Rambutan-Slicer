import React from 'react';
import { hotkeyStore } from '@/hotkeys/hotkeyStore';

/**
 * The "overwrite or save as" question a save asks when the scene already has a
 * file: the dialog's state, the promise the save waits on, Escape as Cancel,
 * and a pending question cancelled on unmount. Moved out of Home verbatim.
 */
export function useSceneSaveChoicePrompt() {
  'use no memo';
  const [showSceneSaveChoiceModal, setShowSceneSaveChoiceModal] = React.useState(false);
  const [sceneSaveChoiceFileName, setSceneSaveChoiceFileName] = React.useState<string | null>(null);
  const [sceneSaveChoicePath, setSceneSaveChoicePath] = React.useState<string | null>(null);
  const sceneSaveChoiceResolveRef = React.useRef<((choice: 'overwrite' | 'save_as' | 'cancel') => void) | null>(null);

  const resolveSceneSaveChoice = React.useCallback((choice: 'overwrite' | 'save_as' | 'cancel') => {
    const resolve = sceneSaveChoiceResolveRef.current;
    sceneSaveChoiceResolveRef.current = null;
    setShowSceneSaveChoiceModal(false);
    setSceneSaveChoiceFileName(null);
    setSceneSaveChoicePath(null);
    resolve?.(choice);
  }, []);

  const promptSceneSaveChoice = React.useCallback(async (
    options: { fileName: string; scenePath: string | null },
  ): Promise<'overwrite' | 'save_as' | 'cancel'> => {
    if (sceneSaveChoiceResolveRef.current) {
      sceneSaveChoiceResolveRef.current('cancel');
      sceneSaveChoiceResolveRef.current = null;
    }

    setSceneSaveChoiceFileName(options.fileName);
    setSceneSaveChoicePath(options.scenePath);
    setShowSceneSaveChoiceModal(true);

    return await new Promise<'overwrite' | 'save_as' | 'cancel'>((resolve) => {
      sceneSaveChoiceResolveRef.current = resolve;
    });
  }, []);

  React.useEffect(() => {
    if (!showSceneSaveChoiceModal) return;

    let wasEscapePressed = false;

    const unsubscribe = hotkeyStore.subscribe((state) => {
      const active = state.activeKeys;
      const isEscapePressed = active.has('escape');
      if (isEscapePressed && !wasEscapePressed) {
        resolveSceneSaveChoice('cancel');
      }
      wasEscapePressed = isEscapePressed;
    });

    return unsubscribe;
  }, [resolveSceneSaveChoice, showSceneSaveChoiceModal]);

  React.useEffect(() => {
    return () => {
      if (sceneSaveChoiceResolveRef.current) {
        sceneSaveChoiceResolveRef.current('cancel');
        sceneSaveChoiceResolveRef.current = null;
      }
    };
  }, []);

  return {
    showSceneSaveChoiceModal,
    setShowSceneSaveChoiceModal,
    sceneSaveChoiceFileName,
    setSceneSaveChoiceFileName,
    sceneSaveChoicePath,
    setSceneSaveChoicePath,
    sceneSaveChoiceResolveRef,
    resolveSceneSaveChoice,
    promptSceneSaveChoice,
  };
}
