import React from 'react';
import { msg } from '@lingui/core/macro';
import type { useLingui } from '@lingui/react';
import type { getProfileNetworkUiAdapter } from '@/features/plugins/pluginRegistry';
import { uploadPrintJobWithProgress, type PluginUploadProgressEvent } from '@/features/plugins/pluginUploadBridge';
import type { usePrintingMonitorManager } from '@/features/printing/usePrintingMonitorManager';
import {
  selectPrinterNetworkDevice,
  upsertPrinterNetworkDevice,
  type getActivePrinterProfile,
  type PrinterNetworkDevice,
} from '@/features/profiles/profileStore';
import type { SliceExportArtifact } from '@/features/slicing/sliceExportOrchestrator';
import { readJsonObject } from '@/utils/jsonFields';
import { pluginNetworkFetch } from '@/utils/pluginNetworkBridge';
import {
  formatImportComplete,
  formatLayerHeightMismatch,
  formatPrintStarted,
  formatPrintStartFailed,
  formatSendFailed,
  formatUploadCompleteProcessing,
  formatUploadStillProcessing,
} from './homeFormatters';

type SetState<T> = React.Dispatch<React.SetStateAction<T>>;
type PrintingMonitor = ReturnType<typeof usePrintingMonitorManager>;

export type PrintingUploadDialogStage = 'uploading' | 'processing' | 'ready' | 'starting' | 'failed' | 'started';

export type UsePrintJobSenderInput = {
  _: ReturnType<typeof useLingui>['_'];
  activeNetworkUiAdapter: ReturnType<typeof getProfileNetworkUiAdapter>;
  activePrinterProfile: ReturnType<typeof getActivePrinterProfile>;
  isLayerHeightMatch: (candidateLayerHeightMm: number | null | undefined) => boolean;
  openPrintingMonitorForTargetDevice: PrintingMonitor['openPrintingMonitorForTargetDevice'];
  printableConnectedPrinterFleet: PrinterNetworkDevice[];
  printingArtifact: SliceExportArtifact | null;
  printingMonitoringAdapter: PrintingMonitor['printingMonitoringAdapter'];
  printingReadyPlateId: number | null;
  printingSendBusy: boolean;
  printingSendCancelRequestedRef: React.RefObject<boolean>;
  printingTargetDevice: PrintingMonitor['printingTargetDevice'];
  printingTargetMaterialOptions: PrintingMonitor['printingTargetMaterialOptions'];
  printingUploadProcessingHandoffTimeoutRef: React.RefObject<number | null>;
  requiresRemoteMaterialSelectionForUpload: PrintingMonitor['requiresRemoteMaterialSelectionForUpload'];
  setPrintingDeviceProcessingElapsedSec: SetState<number>;
  setPrintingDeviceProcessingStartedAtMs: SetState<number | null>;
  setPrintingPrintNowBusy: SetState<boolean>;
  setPrintingReadyPlateId: SetState<number | null>;
  setPrintingSendBusy: SetState<boolean>;
  setPrintingSendProgress: SetState<number>;
  setPrintingSendStageText: SetState<string | null>;
  setPrintingSendStatusText: SetState<string | null>;
  setPrintingTargetDeviceId: PrintingMonitor['setPrintingTargetDeviceId'];
  setPrintingTargetPickerMode: PrintingMonitor['setPrintingTargetPickerMode'];
  setPrintingTargetPickerOpen: PrintingMonitor['setPrintingTargetPickerOpen'];
  setPrintingUploadDialogOpen: SetState<boolean>;
  setPrintingUploadDialogStage: SetState<PrintingUploadDialogStage>;
  setPrintingUploadDisplayProgress: SetState<number>;
  setPrintingUploadTelemetry: SetState<{ speed: string; remaining: string; transferred: string } | null>;
  slicedLayerHeightMm: number;
};

/**
 * Sending a sliced plate to a network printer from the Home page: upload with
 * progress and cancel, the device's metadata-processing wait, and starting the
 * print. Moved verbatim out of src/app/page.tsx; the dialog state it drives
 * stays in Home, which renders the upload dialog.
 */

export function usePrintJobSender({
  _,
  activeNetworkUiAdapter,
  activePrinterProfile,
  isLayerHeightMatch,
  openPrintingMonitorForTargetDevice,
  printableConnectedPrinterFleet,
  printingArtifact,
  printingMonitoringAdapter,
  printingReadyPlateId,
  printingSendBusy,
  printingSendCancelRequestedRef,
  printingTargetDevice,
  printingTargetMaterialOptions,
  printingUploadProcessingHandoffTimeoutRef,
  requiresRemoteMaterialSelectionForUpload,
  setPrintingDeviceProcessingElapsedSec,
  setPrintingDeviceProcessingStartedAtMs,
  setPrintingPrintNowBusy,
  setPrintingReadyPlateId,
  setPrintingSendBusy,
  setPrintingSendProgress,
  setPrintingSendStageText,
  setPrintingSendStatusText,
  setPrintingTargetDeviceId,
  setPrintingTargetPickerMode,
  setPrintingTargetPickerOpen,
  setPrintingUploadDialogOpen,
  setPrintingUploadDialogStage,
  setPrintingUploadDisplayProgress,
  setPrintingUploadTelemetry,
  slicedLayerHeightMm,
}: UsePrintJobSenderInput) {
  // Home is not compiled by the React Compiler (it bails out on it), and this
  // code ran there with its useMemo/useCallback dependency lists honoured as
  // written. Compiled, a memo keeps only what its body reads and drops a
  // dependency listed to force a refresh (the resin estimate stopped updating
  // in the Support tab). Opting out keeps the behaviour it had inside Home.
  'use no memo';
  const performSendToPrinter = React.useCallback(async (targetDevice: PrinterNetworkDevice, selectedMaterialIdOverride?: string) => {
    if (!printingArtifact || !activePrinterProfile) return;
    if (!activeNetworkUiAdapter) return;
    if (!printingMonitoringAdapter.pluginId || !printingMonitoringAdapter.operations?.platesList) return;

    const host = (targetDevice.ipAddress || activePrinterProfile.network?.ipAddress || '').trim();
    const port = targetDevice.port || 80;
    const requiresRemoteMaterialSelection = activeNetworkUiAdapter.supportsRemoteMaterialProfiles !== false;
    const selectedMaterialId = requiresRemoteMaterialSelection
      ? (selectedMaterialIdOverride ?? targetDevice.selectedMaterialId ?? '').trim()
      : ((selectedMaterialIdOverride ?? targetDevice.selectedMaterialId ?? '').trim() || '__local_profile__');
    if (!host) {
      setPrintingSendStatusText(_(msg`No printer IP address available for send operation.`));
      return;
    }
    if (requiresRemoteMaterialSelection && !selectedMaterialId) {
      setPrintingSendStatusText(_(msg`Select a matching material profile before upload.`));
      return;
    }
    if (requiresRemoteMaterialSelection && !selectedMaterialIdOverride && !isLayerHeightMatch(targetDevice.selectedMaterialLayerHeightMm ?? null)) {
      setPrintingSendStatusText(formatLayerHeightMismatch(_, slicedLayerHeightMm.toFixed(3)));
      return;
    }

    const isCancelRequested = () => printingSendCancelRequestedRef.current;
    const throwIfCanceled = () => {
      if (isCancelRequested()) {
        throw new Error('Upload canceled by user.');
      }
    };

    setPrintingTargetDeviceId(targetDevice.id);
    selectPrinterNetworkDevice(activePrinterProfile.id, targetDevice.id);

    if (requiresRemoteMaterialSelection) {
      const selectedMaterialOption = printingTargetMaterialOptions.find((material) => material.id === selectedMaterialId) ?? null;
      upsertPrinterNetworkDevice(
        activePrinterProfile.id,
        {
          id: targetDevice.id,
          ipAddress: targetDevice.ipAddress,
          selectedMaterialId,
          selectedMaterialName: selectedMaterialOption?.name ?? targetDevice.selectedMaterialName ?? selectedMaterialId,
          selectedMaterialLayerHeightMm: selectedMaterialOption?.layerHeightMm ?? targetDevice.selectedMaterialLayerHeightMm,
        },
        { select: true },
      );
    }

    setPrintingReadyPlateId(null);
  printingSendCancelRequestedRef.current = false;
    setPrintingSendBusy(true);
    setPrintingSendProgress(0.01);
    setPrintingUploadDisplayProgress(0.01);
    setPrintingSendStageText(_(msg`Uploading Print Job…`));
    setPrintingSendStatusText(_(msg`Uploading Print Job to Printer…`));
    setPrintingUploadTelemetry(null);
    setPrintingUploadDialogStage('uploading');
    setPrintingUploadDialogOpen(true);
    setPrintingDeviceProcessingStartedAtMs(null);
    setPrintingDeviceProcessingElapsedSec(0);

    try {
      const nativeTempPath = printingArtifact.nativeTempPath?.trim() || '';
      const zipFilePath = nativeTempPath.length > 0 ? nativeTempPath : null;
      const zipBlob = printingArtifact.blob ?? null;
      throwIfCanceled();

      if (!zipBlob && !zipFilePath) {
        throw new Error('No print artifact payload available for printer upload.');
      }

      throwIfCanceled();

      const pathBase = printingArtifact.outputName.replace(/\.[^.]+$/i, '');
      const networkMode = (activeNetworkUiAdapter.mode || '').trim();
      if (!networkMode) {
        throw new Error('No network mode available for printer upload.');
      }
      
      // Build the printer host URL
      const hostUrl = `http://${host}${port && port !== 80 ? `:${port}` : ''}`;

      // Track upload progress and send via active plugin handler
      let resolvedPlateId: number | null = null;
      
      const uploadResult = await uploadPrintJobWithProgress({
        networkMode,
        hostUrl,
        zipBlob,
        zipFilePath,
        path: pathBase,
        profileId: selectedMaterialId,
        callbacks: {
          onProgress: (event: PluginUploadProgressEvent) => {
            if (isCancelRequested()) return;
            const progress = event.percentComplete / 100;
            const clampedProgress = Math.min(progress, 0.9999);
            if (printingUploadProcessingHandoffTimeoutRef.current !== null) {
              window.clearTimeout(printingUploadProcessingHandoffTimeoutRef.current);
              printingUploadProcessingHandoffTimeoutRef.current = null;
            }
            setPrintingSendProgress(clampedProgress);
            setPrintingUploadDisplayProgress(clampedProgress);
            setPrintingUploadTelemetry({
              speed: event.uploadSpeed,
              remaining: event.remainingTime,
              transferred: event.transferred,
            });
          },
          onStatusUpdate: (update) => {
            if (isCancelRequested()) return;
            if (update.stage === 'processing') {
              setPrintingSendProgress(1);
              setPrintingUploadDisplayProgress(1);
              if (printingUploadProcessingHandoffTimeoutRef.current !== null) {
                window.clearTimeout(printingUploadProcessingHandoffTimeoutRef.current);
              }
              printingUploadProcessingHandoffTimeoutRef.current = window.setTimeout(() => {
                printingUploadProcessingHandoffTimeoutRef.current = null;
                setPrintingUploadDialogStage('processing');
                setPrintingSendStageText(_(msg`Processing on device…`));
                setPrintingSendStatusText(formatUploadCompleteProcessing(_, activeNetworkUiAdapter.displayName));
                setPrintingUploadTelemetry(null);
                setPrintingDeviceProcessingStartedAtMs(Date.now());
              }, 220);
            } else if (update.stage === 'error') {
              if (printingUploadProcessingHandoffTimeoutRef.current !== null) {
                window.clearTimeout(printingUploadProcessingHandoffTimeoutRef.current);
                printingUploadProcessingHandoffTimeoutRef.current = null;
              }
              setPrintingSendStatusText(formatSendFailed(_, update.error || update.message));
              setPrintingSendStageText(_(msg`Upload failed`));
              setPrintingUploadDialogStage('failed');
              setPrintingUploadTelemetry(null);
              setPrintingSendProgress(0);
              setPrintingUploadDisplayProgress(0);
            }
          },
          onComplete: (plateId) => {
            if (isCancelRequested()) return;
            resolvedPlateId = plateId;
          },
        },
      });

      throwIfCanceled();

      if (!uploadResult.ok) {
        throw new Error('Upload failed on printer backend');
      }

      const startedAt = Date.now();
      const timeoutMs = 10 * 60 * 1000;
      const pollMs = 1250;
      let metadataReady = false;
      let pollFailureCount = 0;

      while ((Date.now() - startedAt) < timeoutMs) {
        throwIfCanceled();
        try {
          const responseReady = await pluginNetworkFetch({
            pluginId: printingMonitoringAdapter.pluginId,
            operation: printingMonitoringAdapter.operations.platesList,
            ipAddress: host,
            port,
            plateId: resolvedPlateId,
            jobName: pathBase,
          });

          const readyPayload = await readJsonObject(responseReady);
          const matchedPlate = readyPayload?.matchedPlate as Record<string, unknown> | null | undefined;
          const matchedPlateId = Number(
            (matchedPlate as any)?.PlateID
            ?? (matchedPlate as any)?.plateId
            ?? (matchedPlate as any)?.plate_id
            ?? (matchedPlate as any)?.id,
          );
          if (!resolvedPlateId && Number.isFinite(matchedPlateId) && matchedPlateId > 0) {
            resolvedPlateId = matchedPlateId;
          }

          throwIfCanceled();

          metadataReady = readyPayload?.metadataReady === true;
          pollFailureCount = 0;

          if (metadataReady) {
            break;
          }
        } catch {
          pollFailureCount += 1;
          if (pollFailureCount >= 6) {
            throw new Error('Lost connection while waiting for device processing.');
          }
        }

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, pollMs);
        });

        throwIfCanceled();
      }

      if (resolvedPlateId) {
        setPrintingReadyPlateId(resolvedPlateId);
      }

      if (printingUploadProcessingHandoffTimeoutRef.current !== null) {
        window.clearTimeout(printingUploadProcessingHandoffTimeoutRef.current);
        printingUploadProcessingHandoffTimeoutRef.current = null;
      }

      if (metadataReady) {
        setPrintingSendProgress(1);
        setPrintingUploadDisplayProgress(1);
        setPrintingSendStageText(_(msg`Ready to print`));
        setPrintingUploadDialogStage('ready');
        setPrintingDeviceProcessingStartedAtMs(null);
        setPrintingUploadTelemetry(null);
        setPrintingSendStatusText(formatImportComplete(_, resolvedPlateId));
      } else {
        setPrintingSendProgress(1);
        setPrintingUploadDisplayProgress(1);
        setPrintingSendStageText(_(msg`Device still processing`));
        setPrintingUploadDialogStage('failed');
        setPrintingDeviceProcessingStartedAtMs(null);
        setPrintingUploadTelemetry(null);
        setPrintingSendStatusText(formatUploadStillProcessing(_, resolvedPlateId));
      }
    } catch (error) {
      if (printingUploadProcessingHandoffTimeoutRef.current !== null) {
        window.clearTimeout(printingUploadProcessingHandoffTimeoutRef.current);
        printingUploadProcessingHandoffTimeoutRef.current = null;
      }
      const message = error instanceof Error ? error.message : _(msg`Unknown error`);
      const canceled = printingSendCancelRequestedRef.current || /cancel|abort/i.test(message);
      if (canceled) {
        setPrintingSendStatusText(_(msg`Upload canceled. You can retry when ready.`));
        setPrintingSendStageText(_(msg`Upload canceled`));
      } else {
        setPrintingSendStatusText(formatSendFailed(_, message));
        setPrintingSendStageText(_(msg`Upload failed`));
      }
      setPrintingUploadDialogStage('failed');
      setPrintingDeviceProcessingStartedAtMs(null);
      setPrintingUploadTelemetry(null);
      setPrintingSendProgress(0);
      setPrintingUploadDisplayProgress(0);
    } finally {
      setPrintingSendBusy(false);
      printingSendCancelRequestedRef.current = false;
    }
  }, [
    _,
    activeNetworkUiAdapter,
    activePrinterProfile,
    isLayerHeightMatch,
    printingArtifact,
    printingMonitoringAdapter.operations,
    printingMonitoringAdapter.pluginId,
    printingTargetMaterialOptions,
    slicedLayerHeightMm,
  ]);

  const handleSendToPrinter = React.useCallback(async () => {
    if (!printingArtifact || !activePrinterProfile) return;
    if (!activeNetworkUiAdapter) return;
    if (printableConnectedPrinterFleet.length === 0) {
      setPrintingSendStatusText(_(msg`No connected printer is available for upload.`));
      return;
    }

    const selectedTarget = printingTargetDevice ?? printableConnectedPrinterFleet[0] ?? null;
    if (!selectedTarget) {
      setPrintingSendStatusText(_(msg`No connected printer is available for upload.`));
      return;
    }

    if (requiresRemoteMaterialSelectionForUpload && !isLayerHeightMatch(selectedTarget.selectedMaterialLayerHeightMm ?? null)) {
      setPrintingTargetPickerMode('post-slice');
      setPrintingTargetPickerOpen(true);
      return;
    }

    await performSendToPrinter(selectedTarget);
  }, [
    _,
    activeNetworkUiAdapter,
    activePrinterProfile,
    isLayerHeightMatch,
    performSendToPrinter,
    printableConnectedPrinterFleet,
    printingArtifact,
    printingTargetDevice,
    requiresRemoteMaterialSelectionForUpload,
  ]);

  const handleCancelSendToPrinter = React.useCallback(() => {
    if (!printingSendBusy) return;

    printingSendCancelRequestedRef.current = true;
    setPrintingSendStageText(_(msg`Canceling upload…`));
    setPrintingSendStatusText(_(msg`Canceling upload…`));

    if (activeNetworkUiAdapter?.pluginId === 'athena') {
      void import('../../../plugins/athena/network')
        .then((mod) => {
          if (typeof mod.abortUpload === 'function') {
            mod.abortUpload();
          }
        })
        .catch(() => {
          // Ignore; cooperative cancellation checks still stop follow-up work.
        });
    }
  }, [_, activeNetworkUiAdapter?.pluginId, printingSendBusy]);

  const handlePrintNow = React.useCallback(async () => {
    if (!activePrinterProfile || !printingTargetDevice) return;
    if (!printingMonitoringAdapter.pluginId || !printingMonitoringAdapter.operations?.start) return;
    if (printingTargetDevice.connected !== true) return;
    if (!printingReadyPlateId) return;

    const host = (printingTargetDevice.ipAddress || activePrinterProfile.network?.ipAddress || '').trim();
    const port = printingTargetDevice.port || 80;
    if (!host) {
      setPrintingSendStatusText(_(msg`No printer IP address available for Print Now.`));
      return;
    }

    setPrintingPrintNowBusy(true);
    setPrintingSendStageText(_(msg`Starting print…`));
    setPrintingUploadDialogStage('starting');
    setPrintingDeviceProcessingStartedAtMs(null);

    try {
      const response = await pluginNetworkFetch({
        pluginId: printingMonitoringAdapter.pluginId,
        operation: printingMonitoringAdapter.operations.start,
        ipAddress: host,
        port,
        plateId: printingReadyPlateId,
      });

      const payload = await readJsonObject(response);
      if (response.ok && payload?.ok === true) {
        setPrintingSendStageText(_(msg`Print started`));
        setPrintingUploadDialogStage('started');
        setPrintingSendStatusText(formatPrintStarted(_, printingReadyPlateId));
        setPrintingUploadDialogOpen(false);
        openPrintingMonitorForTargetDevice(printingTargetDevice.id);
      } else {
        const reason = typeof payload?.error === 'string' ? payload.error : `HTTP ${response.status}`;
        setPrintingSendStageText(_(msg`Start print failed`));
        setPrintingUploadDialogStage('failed');
        setPrintingSendStatusText(formatPrintStartFailed(_, reason));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : _(msg`Unknown error`);
      setPrintingSendStageText(_(msg`Start print failed`));
      setPrintingUploadDialogStage('failed');
      setPrintingSendStatusText(formatPrintStartFailed(_, message));
    } finally {
      setPrintingPrintNowBusy(false);
    }
  }, [_, activePrinterProfile, openPrintingMonitorForTargetDevice, printingMonitoringAdapter.operations, printingMonitoringAdapter.pluginId, printingReadyPlateId, printingTargetDevice]);

  return {
    performSendToPrinter,
    handleSendToPrinter,
    handleCancelSendToPrinter,
    handlePrintNow,
  };
}
