/**
 * Translations for the built-in auto-support preset names.
 *
 * Presets are persisted to localStorage, so a stored `name` must stay
 * language-neutral — a user who switches language should not end up with a
 * built-in frozen in the language it was first shown in. The built-ins are
 * looked up by id at render time; anything else (a preset the user made and
 * named) falls back to what is stored, which is exactly what should be shown.
 *
 * Module level on purpose: React Compiler renames locals inside components
 * before the Lingui macro derives the message id.
 */

import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import type { AutoSupportPreset } from './autoSupportPresets';

type Translate = (descriptor: MessageDescriptor) => string;

/**
 * What a preset selector shows before the user has ever picked one. Shared by the
 * panel's dropdown and the settings dialog's strip, so the two surfaces name the
 * state the same way.
 */
export const NO_ACTIVE_PRESET_LABEL = msg({ message: 'Custom — not a preset', comment: 'Shown in a half-width preset dropdown when no preset is selected. Keep it short; "no preset" alone is enough.' });

const BUILT_IN_NAMES: Record<string, MessageDescriptor> = {
  light: msg({ message: 'Filigree', context: 'auto-support preset', comment: 'Built-in profile for a sparse, fine-contact support layout.' }),
  medium: msg({ message: 'Weave', context: 'auto-support preset', comment: 'Built-in balanced support layout for general models.' }),
  heavy: msg({ message: 'Buttress', context: 'auto-support preset', comment: 'Built-in dense support layout with the largest contact and shaft sizing tier.' }),
  'interior-pillar': msg({ message: 'Hollow Core', context: 'auto-support preset', comment: 'Built-in profile for large, sparse supports on interior surfaces.' }),
};

export function translateAutoSupportPresetName(preset: AutoSupportPreset, translate: Translate): string {
  const descriptor = BUILT_IN_NAMES[preset.id];
  return descriptor ? translate(descriptor) : preset.name;
}

/** The name Duplicate gives a copy: the source's shown name, so a built-in's copy is in the user's language. */
export function formatAutoSupportPresetCopyName(preset: AutoSupportPreset, translate: Translate): string {
  const presetName = translateAutoSupportPresetName(preset, translate);
  return translate(msg({ message: `${presetName} copy`, context: 'Name of a duplicated auto-support preset' }));
}
