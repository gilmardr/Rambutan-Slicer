/** The colour a model is drawn in, including the legacy defaults old scene files carry. */
import type { SupportMode } from '@/supports/types';

export const PEARL_MODEL_COLOR = '#f3f0e8';

export const LOGO_RED_MODEL_COLOR = '#ed0921';

// Scene files can retain an older app default in per-model colors.
export const LEGACY_DEFAULT_MODEL_COLORS = new Set(['#a3a3a3', LOGO_RED_MODEL_COLOR]);

export function getModelBaseColor(color: string | undefined, fallback: string): string {
  return color && LEGACY_DEFAULT_MODEL_COLORS.has(color.toLowerCase()) ? fallback : color || fallback;
}

export function usesLogoRedModelColor(mode: SupportMode | undefined, supportModelColorMapEnabled: boolean): boolean {
  return mode === 'export' || mode === 'printing' || (mode === 'support' && !supportModelColorMapEnabled);
}
