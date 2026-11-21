import { matchesPresetPattern } from '@/features/plugins/pluginRegistry';

type MaterialPresetSource = {
  enabled: boolean;
  manifest: { name: string; materialPresets?: readonly { templateId?: string }[] };
  source: 'builtin' | 'github';
};

export type MaterialPresetCompatibility = 'compatible' | 'incompatible' | 'unverified' | 'not-specified';

export function getMaterialPresetCompatibility(
  validForPresets: readonly string[] | undefined,
  printerPresetId: string | undefined,
): MaterialPresetCompatibility {
  const restrictions = validForPresets?.map((value) => value.trim()).filter(Boolean) ?? [];
  if (restrictions.length === 0) return 'not-specified';
  if (!printerPresetId?.trim()) return 'unverified';
  return restrictions.some((pattern) => matchesPresetPattern(pattern, printerPresetId.trim()))
    ? 'compatible'
    : 'incompatible';
}

export function getMaterialPresetOrigin(
  templateId: string | undefined,
  plugins: readonly MaterialPresetSource[],
): { pluginName: string; source: MaterialPresetSource['source'] } | null {
  const normalizedTemplateId = templateId?.trim();
  if (!normalizedTemplateId) return null;

  const owner = plugins.find((plugin) => (
    plugin.enabled
    && plugin.manifest.materialPresets?.some((preset) => preset.templateId?.trim() === normalizedTemplateId)
  ));
  if (!owner) return null;
  return { pluginName: owner.manifest.name, source: owner.source };
}
