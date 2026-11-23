import { msg, plural } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import { splitDurationSeconds } from '@/utils/durationParts';

/**
 * Lingui label formatters for the Home page, moved verbatim out of src/app/page.tsx so the page holds only the
 * Home component's own state and wiring.
 */

// Module scope for the same React Compiler reason as the duration formatters below.
export function formatSelectedModelCount(translate: (descriptor: MessageDescriptor) => string, count: number): string {
  return translate(msg`${plural(count, { one: '# model', other: '# models' })}`);
}

export function formatArrangeOverflowMessage(translate: (descriptor: MessageDescriptor) => string, count: number): string {
  return translate(msg`${plural(count, {
    one: '# model could not fit in the available build volume and was moved outside the plate. Scale or split it before printing.',
    other: '# models could not fit in the available build volume and were moved outside the plate. Scale or split them before printing.',
  })}`);
}

// Duration label formatters. These MUST stay at module scope. React Compiler
// rewrites the component body and renames locals (e.g. `minutes` -> `minutes_2`);
// when that rename lands inside a Lingui `msg` template, the macro bakes the
// renamed name into the generated message id, which then no longer matches the
// compiled catalog (extracted from the original names). Lingui only interpolates
// the fallback message in development, so production builds render raw
// `{minutes_2}` placeholders. Plain module-scope functions are left untouched by
// React Compiler, keeping the placeholder names — and thus the ids — stable.
export function formatApproxPrintTimeLabel(translate: (descriptor: MessageDescriptor) => string, totalSec: number): string {
  const { hours, minutes: mins } = splitDurationSeconds(totalSec);
  if (hours > 0) return translate(msg({ message: `~${hours} h ${mins} min`, comment: 'Approximate estimated print time (the "~" marks it as a rough estimate). {hours}/{mins} are whole-number quantities.' }));
  return translate(msg({ message: `~${mins} min`, comment: 'Approximate estimated print time under an hour (the "~" marks it as a rough estimate).' }));
}

export function formatProcessingElapsedLabel(translate: (descriptor: MessageDescriptor) => string, elapsedSec: number): string {
  const total = Math.max(0, elapsedSec);
  const { totalMinutes: minutes, seconds } = splitDurationSeconds(total);
  return translate(msg`${minutes} min ${seconds} s`);
}

/** Module-scope helpers because they interpolate: React Compiler renames inline `msg` locals in production. */
export function formatApplyingToModelLabel(translate: (descriptor: MessageDescriptor) => string, current: number, total: number): string {
  return translate(msg`Applying to model ${current} of ${total}`);
}

export function formatCompressedModelSize(translate: (descriptor: MessageDescriptor) => string, name: string, megabytes: string): string {
  return translate(msg({ message: `${name}: ${megabytes} MB compressed`, comment: 'One row of the per-model breakdown when a scene is too large to save.' }));
}

export function formatElapsedLabel(translate: (descriptor: MessageDescriptor) => string, elapsed: string): string {
  return translate(msg({ message: `Elapsed: ${elapsed}`, comment: 'Time a blocking task has been running, e.g. "Elapsed: 1 min 12 s".' }));
}

export type Translate = (descriptor: MessageDescriptor) => string;

export function formatUploadToLabel(translate: Translate, printer: string): string {
  return translate(msg({ message: `Upload to ${printer}`, comment: 'Send button label; {printer} is the target printer name, shortened when long.' }));
}

export function formatLayerHeightMismatch(translate: Translate, layerHeight: string): string {
  return translate(msg`Selected material on this printer does not match sliced layer height ${layerHeight} mm.`);
}

export function formatUploadCompleteProcessing(translate: Translate, printer: string): string {
  return translate(msg`Upload complete. ${printer} is processing file metadata…`);
}

export function formatSendFailed(translate: Translate, reason: string): string {
  return translate(msg`Send failed: ${reason}`);
}

export function formatImportComplete(translate: Translate, plateId: string | number | null | undefined): string {
  return plateId
    ? translate(msg({ message: `Import complete • Plate #${plateId}. Click Print Now when ready.`, comment: 'Plate here is the file slot on the printer.' }))
    : translate(msg`Import complete. Click Print Now when ready.`);
}

export function formatUploadStillProcessing(translate: Translate, plateId: string | number | null | undefined): string {
  return plateId
    ? translate(msg({ message: `Upload complete • Plate #${plateId}. Device is still processing metadata after waiting.`, comment: 'Plate here is the file slot on the printer.' }))
    : translate(msg`Upload complete. Device is still processing metadata after waiting.`);
}

export function formatPrintStarted(translate: Translate, plateId: string | number | null | undefined): string {
  return plateId
    ? translate(msg({ message: `Print started successfully • Plate #${plateId}.`, comment: 'Plate here is the file slot on the printer.' }))
    : translate(msg`Print started successfully.`);
}

export function formatPrintStartFailed(translate: Translate, reason: string): string {
  return translate(msg`Print start failed: ${reason}`);
}

export function formatEstimatedPrintTimeLabel(translate: (descriptor: MessageDescriptor) => string, totalSec: number): string {
  const wholeSeconds = Math.max(0, Math.floor(totalSec));
  const { hours, minutes, seconds } = splitDurationSeconds(wholeSeconds);
  if (hours > 0) return translate(msg`${hours} h ${minutes} min`);
  return translate(msg`${minutes} min ${seconds} s`);
}

// Static ICU pattern in a module-level formatter (see PrinterVariantPickerModal):
// inline interpolation loses its placeholder names to the React Compiler in
// production builds, leaving the raw {timestamp} on screen.
export function formatLastSuccessfulAutosave(
  translate: (descriptor: MessageDescriptor, values?: Record<string, unknown>) => string,
  timestamp: string,
): string {
  return translate(msg({
    message: 'Last successful autosave: {timestamp}. Save your project manually.',
    comment: '{timestamp} is a locale-formatted date and time.',
  }), { timestamp });
}

// Static ICU pattern in a module-level formatter (see DEVELOPMENT.md): written inside the
// component, the React Compiler renames the interpolated local and the message id stops
// matching the compiled catalogue.
export function formatPlateLockedNotice(
  translate: (descriptor: MessageDescriptor, values?: Record<string, unknown>) => string,
  plateName: string,
): string {
  return translate(msg({
    message: '{plateName} is locked.',
    comment: '{plateName} is the locked build plate, named as the Models panel names it: its own name, or "Plate 1".',
  }), { plateName });
}
