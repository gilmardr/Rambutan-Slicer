import React from 'react';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { SCENE_AUTOSAVE_FAILED_EVENT } from '@/hooks/useSceneAutosave';
import { formatLastSuccessfulAutosave } from './homeFormatters';

/**
 * The scene-save error dialog's state, the listener that fills it when autosave
 * keeps failing, and its dismiss callback. Moved out of Home verbatim.
 */
export function useSceneSaveError() {
  'use no memo';
  const { _, i18n } = useLingui();

  /**
   * User-facing scene-save failure (Ph0.1 sub-phase D).
   *
   * Two producers, one surface: the 4 GiB VOXL guard rejecting an explicit save
   * (D1), and a persistently failing autosave (D3 / finding N4). Both were
   * previously `console.error` into a console the user never opens — and in the
   * 4 GiB case the alternative was worse than silence, because the writer
   * wrapped its `u32` offsets and produced a file that parsed and was wrong.
   */
  const [sceneSaveError, setSceneSaveError] = React.useState<{
    title: string;
    message: string;
    detail?: string | null;
  } | null>(null);

  /**
   * Persistent autosave failure (Ph0.1 D3, finding N4).
   *
   * Fires once per outage, after two consecutive failures — one failure is a
   * transient (antivirus on the destination, a share blinking), two across a
   * 30 s debounce is a condition. Before this the user's only signal was a
   * recovery prompt at next launch showing an hour-old timestamp.
   */
  React.useEffect(() => {
    const onAutosaveFailed = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string; lastSuccessAt?: string | null }>).detail;
      setSceneSaveError({
        title: _(msg`Autosave is not working`),
        message: detail?.message ?? _(msg`The background recovery save failed repeatedly.`),
        detail: detail?.lastSuccessAt
          ? formatLastSuccessfulAutosave(_, new Date(detail.lastSuccessAt).toLocaleString(i18n.locale))
          : _(msg`No autosave has succeeded this session. Save your project manually.`),
      });
    };
    window.addEventListener(SCENE_AUTOSAVE_FAILED_EVENT, onAutosaveFailed);
    return () => window.removeEventListener(SCENE_AUTOSAVE_FAILED_EVENT, onAutosaveFailed);
  }, [_, i18n.locale, setSceneSaveError]);

  const dismissSceneSaveError = React.useCallback(() => setSceneSaveError(null), []);

  return {
    sceneSaveError,
    setSceneSaveError,
    dismissSceneSaveError,
  };
}
