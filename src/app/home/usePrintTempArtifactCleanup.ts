import React from 'react';
import { isDragonfruitTempArtifactPath } from '@/features/import-export/fileHandling';
import type { SliceExportArtifact } from '@/features/slicing/sliceExportOrchestrator';
import {
  cleanupStalePrintTempArtifacts,
  deletePrintTempArtifactPath,
} from '@/features/slicing/tauri/nativeSlicerBridge';

/**
 * Lifecycle of the temp files that slicing leaves on disk: clears stale ones
 * from earlier runs once, deletes the one this page owned when the artifact is
 * replaced or cleared, and deletes the current one on unmount. Moved out of
 * Home verbatim.
 */
export function usePrintTempArtifactCleanup(printingArtifact: SliceExportArtifact | null) {
  'use no memo';
  const lastOwnedPrintTempPathRef = React.useRef<string | null>(null);

  // Best-effort background cleanup of stale Rambutan Slicer temp artifacts from prior runs.
  React.useEffect(() => {
    void cleanupStalePrintTempArtifacts(3 * 24 * 60 * 60)
      .then((removed) => {
        if (removed > 0) {
          console.info(`[Printing] Cleaned up ${removed} stale temporary slice artifact(s).`);
        }
      })
      .catch((error) => {
        console.warn('[Printing] Failed to clean stale temp artifacts.', error);
      });
  }, []);

  // Delete previously-owned temp artifacts once replaced or cleared.
  React.useEffect(() => {
    const currentArtifactPath = printingArtifact?.nativeTempPath?.trim() || null;
    const currentPath = isDragonfruitTempArtifactPath(currentArtifactPath) ? currentArtifactPath : null;
    const previousPath = lastOwnedPrintTempPathRef.current;

    if (previousPath && previousPath !== currentPath) {
      void deletePrintTempArtifactPath(previousPath).catch((error) => {
        console.warn('[Printing] Failed to delete replaced temp artifact.', error);
      });
    }

    lastOwnedPrintTempPathRef.current = currentPath;
  }, [printingArtifact]);

  // Delete currently-owned temp artifact on page unmount.
  React.useEffect(() => {
    return () => {
      const path = lastOwnedPrintTempPathRef.current;
      if (path) {
        void deletePrintTempArtifactPath(path).catch(() => {});
      }
    };
  }, []);
}
