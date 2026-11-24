export type CtbMultiParameterRule = {
  id: string;
  kind: 'height' | 'area';
  min: number;
  max: number | null;
  exposureSec: number;
};

const STORAGE_PREFIX = 'rambutan.ctb.multi-parameter-rules.v1';

export function ctbMultiParameterRulesStorageKey(printerId: string, materialId: string): string {
  return `${STORAGE_PREFIX}:${encodeURIComponent(printerId)}:${encodeURIComponent(materialId)}`;
}

function newRuleId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function normalizeCtbMultiParameterRules(value: unknown): CtbMultiParameterRule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): CtbMultiParameterRule[] => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    const kind = item.kind === 'area' ? 'area' : item.kind === 'height' ? 'height' : null;
    const min = Number(item.min);
    const rawMax = item.max;
    const max = rawMax == null || rawMax === '' ? null : Number(rawMax);
    const exposureSec = Number(item.exposureSec);
    if (
      !kind
      || !Number.isFinite(min)
      || min < 0
      || (max != null && (!Number.isFinite(max) || max < min))
      || !Number.isFinite(exposureSec)
      || exposureSec <= 0
    ) return [];
    return [{
      id: typeof item.id === 'string' && item.id.length > 0 ? item.id : newRuleId(),
      kind,
      min,
      max,
      exposureSec,
    }];
  });
}

export function readCtbMultiParameterRules(storageKey: string): CtbMultiParameterRule[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = window.localStorage.getItem(storageKey);
    return stored ? normalizeCtbMultiParameterRules(JSON.parse(stored)) : [];
  } catch {
    return [];
  }
}

export function writeCtbMultiParameterRules(storageKey: string, rules: CtbMultiParameterRule[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(rules));
  } catch {
    // Keep slicing available if this browser profile cannot write local storage.
  }
}

export function mergeCtbMultiParameterRulesIntoMetadata(
  metadataJson: string,
  rules: readonly CtbMultiParameterRule[],
): string {
  if (rules.length === 0) return metadataJson;
  const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
  const ctbValue = metadata.ctb && typeof metadata.ctb === 'object'
    ? metadata.ctb as Record<string, unknown>
    : {};
  metadata.ctb = {
    ...ctbValue,
    multiParameterRules: rules.map(({ kind, min, max, exposureSec }) => ({
      kind,
      min,
      max,
      exposureSec,
    })),
  };
  return JSON.stringify(metadata);
}
/** Full grayscale is the default for new projects and legacy models. */
export function normalizeCtbModelGrayscale(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(100, Math.max(1, Math.round(value)))
    : 100;
}

