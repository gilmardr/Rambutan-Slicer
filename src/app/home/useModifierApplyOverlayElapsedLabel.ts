import React from 'react';

/**
 * The m:ss timer on the modifier-apply blocking overlay: counts from when the
 * overlay shows and resets when it hides. Moved out of Home verbatim.
 */
export function useModifierApplyOverlayElapsedLabel(showModifierApplyBlockingOverlay: boolean) {
  'use no memo';
  const [modifierApplyOverlayElapsedSec, setModifierApplyOverlayElapsedSec] = React.useState(0);

  React.useEffect(() => {
    if (!showModifierApplyBlockingOverlay) {
      setModifierApplyOverlayElapsedSec(0);
      return;
    }

    const startedAt = Date.now();
    const id = window.setInterval(() => {
      setModifierApplyOverlayElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);

    return () => window.clearInterval(id);
  }, [showModifierApplyBlockingOverlay]);

  const modifierApplyOverlayElapsedLabel = React.useMemo(() => {
    const total = Math.max(0, modifierApplyOverlayElapsedSec);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }, [modifierApplyOverlayElapsedSec]);

  return modifierApplyOverlayElapsedLabel;
}
