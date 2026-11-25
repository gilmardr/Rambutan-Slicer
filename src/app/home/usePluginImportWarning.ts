import React from 'react';
import {
  PLUGIN_IMPORT_WARNING_DISMISSED_STORAGE_KEY,
  findPluginImportWarning,
} from '@/features/import-export/fileHandling';

/**
 * The warning a format plugin can ask for before its files import: the modal's
 * state, the "don't show again" choice saved per plugin in localStorage, and
 * the promise an import waits on until the user continues or cancels. Moved out
 * of Home verbatim.
 */
export function usePluginImportWarning() {
  'use no memo';
  const [showPluginImportWarningModal, setShowPluginImportWarningModal] = React.useState(false);
  const [suppressPluginImportWarning, setSuppressPluginImportWarning] = React.useState(false);
  const [pluginImportWarningSkipFuture, setPluginImportWarningSkipFuture] = React.useState(false);
  const [activePluginImportWarning, setActivePluginImportWarning] = React.useState<{ title: string; body: string; storageKey: string } | null>(null);
  const pluginImportWarningPendingResolveRef = React.useRef<((proceed: boolean) => void) | null>(null);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(PLUGIN_IMPORT_WARNING_DISMISSED_STORAGE_KEY);
      setSuppressPluginImportWarning(stored === '1');
    } catch {
      setSuppressPluginImportWarning(false);
    }
  }, []);

  /** True when the user has already dismissed this specific plugin's warning. */
  const isPluginImportWarningDismissed = React.useCallback((storageKey: string) => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(storageKey) === '1';
    } catch {
      return false;
    }
  }, []);

  React.useEffect(() => {
    return () => {
      if (pluginImportWarningPendingResolveRef.current) {
        const resolve = pluginImportWarningPendingResolveRef.current;
        pluginImportWarningPendingResolveRef.current = null;
        resolve(false);
      }
    };
  }, []);

  const maybeConfirmPluginImportWarning = React.useCallback(async (filesInput: FileList | File[]) => {
    // Each plugin declares its own warning and storageKey, so a format is
    // gated by whether *its* plugin asked for a warning -- not by extension.
    const warning = findPluginImportWarning(Array.from(filesInput));
    if (!warning) return true;
    if (suppressPluginImportWarning && warning.storageKey === PLUGIN_IMPORT_WARNING_DISMISSED_STORAGE_KEY) return true;
    if (isPluginImportWarningDismissed(warning.storageKey)) return true;

    setActivePluginImportWarning(warning);

    if (pluginImportWarningPendingResolveRef.current) {
      const pendingResolve = pluginImportWarningPendingResolveRef.current;
      pluginImportWarningPendingResolveRef.current = null;
      pendingResolve(false);
    }

    setPluginImportWarningSkipFuture(false);
    setShowPluginImportWarningModal(true);
    return await new Promise<boolean>((resolve) => {
      pluginImportWarningPendingResolveRef.current = resolve;
    });
  }, [isPluginImportWarningDismissed, suppressPluginImportWarning]);

  const resolvePluginImportWarning = React.useCallback((proceed: boolean) => {
    const resolve = pluginImportWarningPendingResolveRef.current;
    pluginImportWarningPendingResolveRef.current = null;
    setPluginImportWarningSkipFuture(false);
    setShowPluginImportWarningModal(false);
    resolve?.(proceed);
  }, []);

  const handleCancelPluginImportWarning = React.useCallback(() => {
    resolvePluginImportWarning(false);
  }, [resolvePluginImportWarning]);

  const handleContinuePluginImportWarning = React.useCallback(() => {
    if (pluginImportWarningSkipFuture) {
      setSuppressPluginImportWarning(true);
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(
            activePluginImportWarning?.storageKey ?? PLUGIN_IMPORT_WARNING_DISMISSED_STORAGE_KEY,
            '1',
          );
        } catch {
          // Ignore persistence failure and still proceed.
        }
      }
    }
    resolvePluginImportWarning(true);
  }, [activePluginImportWarning, pluginImportWarningSkipFuture, resolvePluginImportWarning]);

  return {
    showPluginImportWarningModal,
    pluginImportWarningSkipFuture,
    setPluginImportWarningSkipFuture,
    activePluginImportWarning,
    maybeConfirmPluginImportWarning,
    handleCancelPluginImportWarning,
    handleContinuePluginImportWarning,
  };
}
