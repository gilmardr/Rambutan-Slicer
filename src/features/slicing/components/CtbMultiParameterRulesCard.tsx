'use client';

import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Trans } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Button } from '@/components/atoms';
import { normalizeCtbModelGrayscale, type CtbMultiParameterRule } from '@/features/slicing/ctbMultiParameterRules';
import { resolveModelMeshModifiers } from '@/features/mesh-modifiers/meshModifierStore';
import type { LoadedModel } from '@/features/scene/useSceneCollectionManager';
import { NumberInput } from '@/components/ui/NumberInput';

const fieldStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid var(--border-subtle)',
  borderRadius: 4,
  background: 'var(--surface-0)',
  color: 'var(--text-strong)',
  padding: '4px 6px',
  fontSize: 11,
};

function makeId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function CtbMultiParameterRulesCard({
  rules,
  defaultExposureSec,
  onChange,
  models,
  onModelGrayscaleChange,
  modelGrayscaleDisabled,
}: {
  rules: CtbMultiParameterRule[];
  defaultExposureSec: number;
  onChange: (next: CtbMultiParameterRule[]) => void;
  models: readonly LoadedModel[];
  onModelGrayscaleChange?: (modelId: string, percent: number) => void;
  modelGrayscaleDisabled?: boolean;
}) {
  const { _ } = useLingui();
  const updateRule = (id: string, patch: Partial<Omit<CtbMultiParameterRule, 'id'>>) => {
    onChange(rules.map((rule) => rule.id === id ? { ...rule, ...patch } : rule));
  };

  return (
    <details className="rounded-md border p-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}>
      <summary className="cursor-pointer text-xs font-semibold" style={{ color: 'var(--text-strong)' }}>
        <Trans>CTB multi-parameter slicing</Trans>
        {rules.length > 0 && <span className="ml-1 font-normal" style={{ color: 'var(--text-muted)' }}>({rules.length})</span>}
      </summary>
      <p className="mt-2 text-[10px] leading-snug" style={{ color: 'var(--text-muted)' }}>
        <Trans>Set exposure time by height or cross-section area after the bottom and transition layers. The last matching rule wins.</Trans>
      </p>
      {onModelGrayscaleChange && models.length > 0 && (
        <fieldset className="mt-2 space-y-1 rounded border p-2" style={{ borderColor: 'var(--border-subtle)' }}>
          <legend className="px-1 text-[10px] font-semibold"><Trans>Grayscale by model (%)</Trans></legend>
          <p className="text-[10px] leading-snug" style={{ color: 'var(--text-muted)' }}>
            <Trans>Adjust light intensity by model. All models on a layer share its exposure time.</Trans>
          </p>
          {models.map((model) => (
            <label key={model.id} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate" title={model.name}>{model.name}</span>
              <NumberInput
                value={normalizeCtbModelGrayscale(resolveModelMeshModifiers(model)?.ctbGrayscalePercent)}
                onChange={(value) => onModelGrayscaleChange(model.id, value)}
                min={1}
                max={100}
                step={1}
                disabled={modelGrayscaleDisabled}
                className="ui-input h-7 w-[68px] shrink-0 text-[11px]"
              />
            </label>
          ))}
        </fieldset>
      )}
      <div className="mt-2 space-y-2">
        {rules.map((rule, index) => {
          const unit = rule.kind === 'height' ? 'mm' : 'mm²';
          return (
            <div key={rule.id} className="rounded border p-2 space-y-1.5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-0)' }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}><Trans>Rule {index + 1}</Trans></span>
                <button type="button" aria-label={_(msg`Remove CTB rule`)} title={_(msg`Remove rule`)} onClick={() => onChange(rules.filter((entry) => entry.id !== rule.id))} className="rounded p-1" style={{ color: 'var(--text-muted)' }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <select aria-label={_(msg`CTB rule measure`)} value={rule.kind} onChange={(event) => updateRule(rule.id, { kind: event.target.value as CtbMultiParameterRule['kind'] })} style={fieldStyle}>
                <option value="height">{_(msg`Height (mm)`)}</option>
                <option value="area">{_(msg`Cross-section area (mm²)`)}</option>
              </select>
              <div className="grid grid-cols-3 gap-1.5">
                <label className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
                  <Trans>From</Trans> ({unit})
                  <input aria-label={_(msg`Rule minimum`)} type="number" min="0" step={rule.kind === 'height' ? '0.01' : '1'} value={rule.min} onChange={(event) => updateRule(rule.id, { min: Math.max(0, Number(event.target.value) || 0) })} style={fieldStyle} />
                </label>
                <label className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
                  <Trans>To</Trans> ({unit})
                  <input aria-label={_(msg`Rule maximum`)} type="number" min={rule.min} step={rule.kind === 'height' ? '0.01' : '1'} placeholder="∞" value={rule.max ?? ''} onChange={(event) => updateRule(rule.id, { max: event.target.value.trim() ? Math.max(rule.min, Number(event.target.value) || rule.min) : null })} style={fieldStyle} />
                </label>
                <label className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
                  <Trans>Exposure (s)</Trans>
                  <input aria-label={_(msg`Rule exposure`)} type="number" min="0.1" max="120" step="0.1" value={rule.exposureSec} onChange={(event) => updateRule(rule.id, { exposureSec: Math.max(0.1, Number(event.target.value) || 0.1) })} style={fieldStyle} />
                </label>
              </div>
            </div>
          );
        })}
      </div>
      <Button
        variant="secondary"
        size="auto"
        onClick={() => onChange([...rules, {
          id: makeId(),
          kind: 'height',
          min: 0,
          max: null,
          exposureSec: Number.isFinite(defaultExposureSec) && defaultExposureSec > 0 ? defaultExposureSec : 2,
        }])}
        className="mt-2 !h-7 w-full !px-2 !py-0 text-[10px]"
      >
        <Plus className="mr-1 h-3.5 w-3.5" />
        <Trans>Add rule</Trans>
      </Button>
    </details>
  );
}
