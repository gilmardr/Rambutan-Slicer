import React from 'react';
import { hotkeyStore, isActionActiveSync } from '@/hotkeys/hotkeyStore';

/**
 * First-run onboarding as Home drives it: the "use without a printer" choice
 * for this session, the hydration flag, the wizard's session latch, and the
 * effects that open it when no printer profile exists, replay it on the debug
 * hotkey, and drop the "without a printer" choice once a printer is active.
 * Moved out of Home verbatim.
 */
export function useOnboardingWizard({
  hasPrinterProfiles,
  hasActivePrinterProfile,
}: {
  hasPrinterProfiles: boolean;
  hasActivePrinterProfile: boolean;
}) {
  'use no memo';
  const [allowPrepareWithoutPrinter, setAllowPrepareWithoutPrinter] = React.useState(false);
  // First-run onboarding. `mounted` avoids SSR/client mismatches: the wizard is
  // only rendered after hydration. `wizardActive` latches the wizard open for
  // the session once it starts, so it can play its finalization step after a
  // printer is added instead of unmounting the moment a profile exists. It is
  // (re)opened whenever there are no printer profiles, and by the debug
  // Ctrl+Shift+O replay even when a printer already exists.
  const [onboardingMounted, setOnboardingMounted] = React.useState(false);
  const [wizardActive, setWizardActive] = React.useState(false);

  const handleUseWithoutPrinter = React.useCallback(() => {
    setAllowPrepareWithoutPrinter(true);
  }, []);

  // Mark the client as hydrated so the onboarding wizard (and top-bar chrome
  // gating) only render after mount, avoiding SSR/client mismatches.
  React.useEffect(() => {
    setOnboardingMounted(true);
  }, []);

  // Reopen the wizard whenever there are no printer profiles. Once active it
  // stays latched until onExit, so the finalization step can play after adding.
  React.useEffect(() => {
    if (onboardingMounted && !hasPrinterProfiles) {
      setWizardActive(true);
    }
  }, [onboardingMounted, hasPrinterProfiles]);

  // DEBUG: Ctrl+Shift+O re-runs the onboarding wizard. Lifts the session latch
  // and drops this session's "use without printer" state so the wizard reappears
  // even when a printer profile already exists.
  React.useEffect(() => {
    let wasActive = false;
    const unsubscribe = hotkeyStore.subscribe(() => {
      const isActive = isActionActiveSync('DEBUG', 'RE_RUN_ONBOARDING');
      if (isActive && !wasActive) {
        setWizardActive(true);
        setAllowPrepareWithoutPrinter(false);
      }
      wasActive = isActive;
    });
    return unsubscribe;
  }, []);

  React.useEffect(() => {
    if (!hasActivePrinterProfile) return;
    if (!allowPrepareWithoutPrinter) return;
    setAllowPrepareWithoutPrinter(false);
  }, [allowPrepareWithoutPrinter, hasActivePrinterProfile]);

  return {
    allowPrepareWithoutPrinter,
    onboardingMounted,
    wizardActive,
    setWizardActive,
    handleUseWithoutPrinter,
  };
}
