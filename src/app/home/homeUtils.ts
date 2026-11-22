import type { ModelTransform, TransformMode } from '@/hooks/useModelTransform';
import type { SupportMode } from '@/supports/types';

/**
 * Pure helpers of the Home page, moved verbatim out of src/app/page.tsx so the page holds only the
 * Home component's own state and wiring.
 */

export function countRecordEntries(record: Record<string, unknown>): number {
  let count = 0;
  for (const _key in record) {
    count += 1;
  }
  return count;
}

export function areSortedNumberArraysEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

export function isKeyboardTargetEditable(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('[contenteditable="true"]'));
}

export const HOLE_PUNCH_DEPTH_OFFSET_FROM_SHELL_MM = 1;
export function getDefaultHolePunchDepthMm(shellThicknessMm: number): number {
  return Number(
    Math.min(120, Math.max(1, shellThicknessMm + HOLE_PUNCH_DEPTH_OFFSET_FROM_SHELL_MM)).toFixed(1),
  );
}

export function createModelTransformKey(modelId: string, transform: ModelTransform): string {
  return [
    modelId,
    transform.position.x.toFixed(6),
    transform.position.y.toFixed(6),
    transform.position.z.toFixed(6),
    transform.rotation.x.toFixed(6),
    transform.rotation.y.toFixed(6),
    transform.rotation.z.toFixed(6),
    transform.scale.x.toFixed(6),
    transform.scale.y.toFixed(6),
    transform.scale.z.toFixed(6),
  ].join('|');
}

/**
 * Modes a history entry may name as its origin. The history store carries the
 * origin as plain strings (it must not depend on the app's unions), so these
 * narrow it back on the way in — an entry recorded by an older build, or a mode
 * that has since been renamed, is ignored rather than jamming the app into a
 * mode that no longer exists.
 */
export const HISTORY_APP_MODES: readonly SupportMode[] = ['prepare', 'analysis', 'support', 'export', 'printing'];
export const HISTORY_TRANSFORM_MODES: readonly TransformMode[] = [
  'select', 'transform', 'smoothing', 'engraving', 'solidOperations', 'arrange', 'duplicate', 'placeOnFace', 'mirror', 'hollowing', 'organicCut',
  'supportBlockers', 'supportPainting', 'supportInline', 'supportProjection',
];

/**
 * The transform modes Prepare's rail offers. Support's Hollowing is deliberately
 * absent: it is a Support tool now, and Prepare must never restore it.
 */
export const PREPARE_TOOL_MODES: readonly TransformMode[] = [
  'select', 'transform', 'placeOnFace', 'mirror', 'duplicate', 'arrange', 'organicCut', 'smoothing', 'engraving', 'solidOperations',
];

export function isAppMode(value: string): value is SupportMode {
  return (HISTORY_APP_MODES as readonly string[]).includes(value);
}

export function isTransformMode(value: string): value is TransformMode {
  return (HISTORY_TRANSFORM_MODES as readonly string[]).includes(value);
}
