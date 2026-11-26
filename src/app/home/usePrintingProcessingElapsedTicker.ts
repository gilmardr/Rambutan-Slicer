import React from 'react';

type PrintingUploadDialogStage = 'uploading' | 'processing' | 'ready' | 'starting' | 'failed' | 'started';

/**
 * While the upload dialog waits for the printer to process the file, counts
 * the seconds since processing started, once a second, and resets to zero
 * otherwise. Moved out of Home verbatim; the state stays in Home because the
 * upload flow resets it too.
 */
export function usePrintingProcessingElapsedTicker({
  printingUploadDialogOpen,
  printingUploadDialogStage,
  printingDeviceProcessingStartedAtMs,
  setPrintingDeviceProcessingElapsedSec,
}: {
  printingUploadDialogOpen: boolean;
  printingUploadDialogStage: PrintingUploadDialogStage;
  printingDeviceProcessingStartedAtMs: number | null;
  setPrintingDeviceProcessingElapsedSec: React.Dispatch<React.SetStateAction<number>>;
}) {
  'use no memo';
  React.useEffect(() => {
    if (!printingUploadDialogOpen || printingUploadDialogStage !== 'processing' || printingDeviceProcessingStartedAtMs == null) {
      setPrintingDeviceProcessingElapsedSec(0);
      return;
    }

    const updateElapsed = () => {
      setPrintingDeviceProcessingElapsedSec(Math.max(0, Math.floor((Date.now() - printingDeviceProcessingStartedAtMs) / 1000)));
    };

    updateElapsed();
    const id = window.setInterval(updateElapsed, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [printingDeviceProcessingStartedAtMs, printingUploadDialogOpen, printingUploadDialogStage, setPrintingDeviceProcessingElapsedSec]);
}
