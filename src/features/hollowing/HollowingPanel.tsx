import React from 'react';
import { Droplets } from 'lucide-react';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { HollowMode, InfillMode, OpenFace } from '@/utils/meshHollowing';
import type { ModelHollowing2DModifier } from '@/features/mesh-modifiers/types';
import type { HolePunchVerificationResult } from '@/features/hole-punching/holePunchVerification';
import { Button, Card, CardHeader, Select, Spinner } from '@/components/atoms';
import { PanelCollapseToggle } from '@/components/atoms/PanelCollapseToggle';
import { ScrollableNumberField } from '@/components/ui/scrollableNumberField';
import { useLocaleFormat } from '@/hooks/useLocaleFormat';

export interface HollowingPanelState {
  mode: HollowMode;
  voxelSizeMm: number;
  shellThicknessMm: number;
  infillMode: InfillMode;
  infillCellMm: number;
  infillBeamRadiusMm: number;
  detectResinTraps?: boolean;
  detectInteriorSuctionCups?: boolean;
  openFace: OpenFace;
}

interface HollowingPanelProps {
  state: HollowingPanelState;
  onStateChange: (next: HollowingPanelState) => void;
  hollowing2D: ModelHollowing2DModifier;
  onHollowing2DChange: (next: ModelHollowing2DModifier) => void;
  onReset: () => void;
  onResetSettings: () => void;
  onStartEdit: () => void;
  onDoneEdit: () => void;
  onClearEdit: () => void;
  onApply: () => void;
  isApplying?: boolean;
  isPreviewing?: boolean;
  isApplyingBlockers?: boolean;
  canApply?: boolean;
  canEdit?: boolean;
  isEditMode?: boolean;
  isHollowingApplied?: boolean;
  shellFaceSelectionPending?: boolean;
  drainHoleCount?: number;
  drainHoleVerificationResults?: readonly HolePunchVerificationResult[];
  canVerifyDrainHoles?: boolean;
  onVerifyDrainHoles?: () => void;
}

export function HollowingPanel({
  state,
  onStateChange,
  hollowing2D,
  onHollowing2DChange,
  onReset,
  onResetSettings,
  onStartEdit,
  onDoneEdit,
  onClearEdit,
  onApply,
  isApplying = false,
  isPreviewing = false,
  isApplyingBlockers = false,
  canApply = true,
  canEdit = true,
  isEditMode = false,
  isHollowingApplied = false,
  shellFaceSelectionPending = false,
  drainHoleCount = 0,
  drainHoleVerificationResults = [],
  canVerifyDrainHoles = false,
  onVerifyDrainHoles,
}: HollowingPanelProps) {
  const { _ } = useLingui();
  const fmt = useLocaleFormat();
  const [expanded, setExpanded] = React.useState(true);
  const [guidedStep, setGuidedStep] = React.useState(0);
  const modeLabel = state.mode === 'cavity' ? _(msg`Cavity`) : state.mode === 'infill' ? _(msg`Infill`) : _(msg`Shell Open Face`);
  const infillLabel = state.infillMode === 'double_lattice' ? _(msg`Double Lattice`) : state.infillMode === 'pillar' ? _(msg`Pillar`) : _(msg`Lattice`);
  const minInfillCellMm = 3;
  const maxInfillCellMm = 24;
  const minInfillDiameterMm = 0.5;
  const maxInfillDiameterMm = 6.0;

  const setState = React.useCallback((patch: Partial<HollowingPanelState>) => {
    onStateChange({ ...state, ...patch });
  }, [onStateChange, state]);

  const clampFloat = React.useCallback((value: number, min: number, max: number, decimals = 1) => {
    const safe = Number.isFinite(value) ? value : min;
    const rounded = Number(safe.toFixed(decimals));
    return Math.min(max, Math.max(min, rounded));
  }, []);

  const infillDensityPct = React.useMemo(() => {
    const clampedCell = Math.min(maxInfillCellMm, Math.max(minInfillCellMm, state.infillCellMm));
    return clampFloat((minInfillCellMm * minInfillCellMm * 100) / (clampedCell * clampedCell), 1, 100, 0);
  }, [clampFloat, state.infillCellMm]);

  const infillDiameterMm = React.useMemo(() => (
    clampFloat(state.infillBeamRadiusMm * 2, minInfillDiameterMm, maxInfillDiameterMm, 2)
  ), [clampFloat, state.infillBeamRadiusMm]);

  const densityPctToCellMm = React.useCallback((densityPct: number) => {
    const clampedDensity = clampFloat(densityPct, 1, 100, 0);
    return clampFloat(minInfillCellMm / Math.sqrt(clampedDensity / 100), minInfillCellMm, maxInfillCellMm, 1);
  }, [clampFloat]);

  const panelCardStyle: React.CSSProperties = {
    borderColor: 'var(--border-subtle)',
    background: 'var(--surface-1)',
  };

  const accentCardStyle: React.CSSProperties = {
    borderColor: 'color-mix(in srgb, var(--accent), var(--border-subtle) 76%)',
    background: 'color-mix(in srgb, var(--accent), var(--surface-1) 95%)',
  };

  const activeModeStyle: React.CSSProperties = {
    borderColor: 'color-mix(in srgb, var(--accent), var(--border-subtle) 30%)',
    background: 'color-mix(in srgb, var(--accent), var(--surface-1) 85%)',
    color: 'var(--text-strong)',
  };

  return (
    <Card>
      <CardHeader
        left={(
          <>
            <PanelCollapseToggle expanded={expanded} onToggle={() => setExpanded((prev) => !prev)} />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}><Trans>Hollowing</Trans></h3>
          </>
        )}
        right={(
            <div className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5" style={{ borderColor: 'var(--border-subtle)' }}>
            <Droplets className="w-3 h-3" style={{ color: 'var(--accent)' }} />
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {state.mode === 'infill'
                  ? _(msg`Infill`)
                  : _(msg`Cavity`)}
            </span>
          </div>
        )}
      />

      {expanded && (
        <div className="px-2 pb-2 space-y-2 sm:px-2.5 sm:pb-2.5">
          {!isEditMode && (
            <section className="rounded-md border p-2 space-y-2" style={panelCardStyle} aria-label={_(msg`Guided hollowing setup`)}>
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-xs font-semibold" style={{ color: 'var(--text-strong)' }}><Trans>Guided hollowing setup</Trans></h4>
                <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-muted)' }}><Trans>Step {fmt.fixed(guidedStep + 1, 0)} of 4</Trans></span>
              </div>
              <div className="grid grid-cols-4 gap-1" role="group" aria-label={_(msg`Hollowing setup steps`)}>
                {[
                  _(msg`Shell`),
                  _(msg`Drain`),
                  _(msg`Pockets`),
                  _(msg`Review`),
                ].map((label, index) => (
                  <button key={label} type="button" className="rounded border px-1 py-1 text-[9px]"
                    style={guidedStep === index ? activeModeStyle : { borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
                    aria-current={guidedStep === index ? 'step' : undefined} onClick={() => setGuidedStep(index)}>
                    {label}
                  </button>
                ))}
              </div>
              {guidedStep === 0 && <p className="text-[10px] leading-snug" style={{ color: 'var(--text-muted)' }}><Trans>Choose cavity or infill, then set shell thickness and voxel size below. Infill also needs a pattern and spacing.</Trans></p>}
              {guidedStep === 1 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] leading-snug" style={{ color: 'var(--text-muted)' }}><Trans>Place drain holes through the shell in the scene, then verify that they reach the cavity.</Trans></p>
                  <div className="flex items-center justify-between text-[10px]">
                    <span style={{ color: 'var(--text-strong)' }}><Trans>Drain holes: {fmt.fixed(drainHoleCount, 0)}</Trans></span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      {drainHoleVerificationResults.length === 0
                        ? <Trans>Not verified</Trans>
                        : <Trans>Confirmed {fmt.fixed(drainHoleVerificationResults.filter((result) => result.status === 'confirmed').length, 0)} of {fmt.fixed(drainHoleVerificationResults.length, 0)}</Trans>}
                    </span>
                  </div>
                  {drainHoleVerificationResults.some((result) => result.status !== 'confirmed') && <p className="text-[10px]" style={{ color: 'var(--warning)' }}><Trans>Review shallow or uncertain holes before applying.</Trans></p>}
                  <Button size="xs" variant="secondary" className="w-full" onClick={onVerifyDrainHoles} disabled={!canVerifyDrainHoles || !onVerifyDrainHoles}><Trans>Verify drain holes</Trans></Button>
                </div>
              )}
              {guidedStep === 2 && (
                <div className="space-y-1">
                  <p className="text-[10px] leading-snug" style={{ color: 'var(--text-muted)' }}><Trans>Enable resin trap or interior suction cup detection below. Drain holes act as vents in the build direction.</Trans></p>
                  {state.mode !== 'shell_open_face' && state.detectResinTraps && drainHoleCount === 0 && <p className="text-[10px] leading-snug" style={{ color: 'var(--warning)' }}><Trans>No drain holes are recorded, so sealed resin traps have no vent path.</Trans></p>}
                </div>
              )}
              {guidedStep === 3 && (
                <div className="space-y-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  <p><Trans>Mode:</Trans> {modeLabel}</p>
                  <p><Trans>Shell thickness:</Trans> {fmt.quantity(state.shellThicknessMm, 1, 'mm')}</p>
                  <p><Trans>Drain holes:</Trans> {fmt.fixed(drainHoleCount, 0)}</p>
                  {state.mode === 'infill' && <p><Trans>Infill pattern:</Trans> {infillLabel}</p>}
                  <p><Trans>Resin trap detection:</Trans> {state.detectResinTraps ? <Trans>On</Trans> : <Trans>Off</Trans>}</p>
                  <p><Trans>Interior suction cup detection:</Trans> {state.detectInteriorSuctionCups ? <Trans>On</Trans> : <Trans>Off</Trans>}</p>
                  <p className="leading-snug"><Trans>Review the cavity preview and drain hole verification in the scene before applying.</Trans></p>
                  <Button variant="accent" size="auto" className="w-full" onClick={onApply} disabled={isApplying || isPreviewing || !canApply}>{isApplying ? <Trans>Applying…</Trans> : <Trans>Apply Hollowing</Trans>}</Button>
                </div>
              )}
              <div className="flex justify-between gap-2 border-t pt-1.5" style={{ borderColor: 'var(--border-subtle)' }}>
                <Button size="xs" variant="secondary" onClick={() => setGuidedStep((step) => Math.max(0, step - 1))} disabled={guidedStep === 0}><Trans>Back</Trans></Button>
                {guidedStep < 3 && <Button size="xs" variant="secondary" onClick={() => setGuidedStep((step) => Math.min(3, step + 1))}><Trans>Next</Trans></Button>}
              </div>
            </section>
          )}
          {isEditMode ? (
            <div
              className="rounded-md border p-2 space-y-1.5 text-center min-h-[4.5rem] box-border"
              style={{
                borderColor: 'var(--accent-secondary-action-border)',
                background: 'var(--accent-secondary-action-bg-92)',
              }}
            >
              <div className="ui-meta font-semibold" style={{ color: 'var(--accent-secondary-action-color)' }}><Trans>Solid Areas</Trans></div>
              <div className="flex items-start justify-center min-h-8">
                <p className="text-[10px] leading-snug line-clamp-2" style={{ color: 'var(--text-muted)' }}>
                  <Trans>Click or lasso to keep voxels solid, <span style={{ color: 'var(--accent-secondary-action-color)', fontWeight: 600 }}>Alt+Lasso</span> to release.<br /><span style={{ color: 'var(--accent-secondary-action-color)', fontWeight: 600 }}>Clear</span> to reset all, <span style={{ color: 'var(--accent-secondary-action-color)', fontWeight: 600 }}>Done</span> to apply.</Trans>
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-md border p-2 space-y-1.5 min-h-[4.5rem] box-border" style={accentCardStyle}>
              <div className="ui-meta" style={{ color: 'var(--text-muted)' }}><Trans>Mode</Trans></div>
              <div className="grid grid-cols-2 gap-1 min-h-8">
                <Button
                  variant="secondary"
                  size="auto"
                  className="!h-8 whitespace-nowrap px-1.5 text-[10px] sm:text-[11px]"
                  onClick={() => setState({ mode: 'cavity' })}
                  style={state.mode === 'cavity' ? activeModeStyle : undefined}
                  disabled={isApplying}
                >
                  <Trans>Cavity</Trans>
                </Button>

                <Button
                  variant="secondary"
                  size="auto"
                  className="!h-8 whitespace-nowrap px-1.5 text-[10px] sm:text-[11px]"
                  onClick={() => setState({ mode: 'infill' })}
                  style={state.mode === 'infill' ? activeModeStyle : undefined}
                  disabled={isApplying}
                >
                  <Trans>Infill</Trans>
                </Button>

              </div>
            </div>
          )}

          <div className="rounded-md border p-2 space-y-1.5" style={panelCardStyle}>
            <label className="ui-meta block" style={{ color: 'var(--text-muted)' }}><Trans>Voxel Size</Trans></label>
            <ScrollableNumberField
              value={state.voxelSizeMm}
              onChange={(value) => setState({ voxelSizeMm: clampFloat(value, 0.2, 10, 2) })}
              min={0.2}
              max={10}
              step={0.1}
              unit="mm"
              ariaLabel={_(msg`Voxel Size`)}
              disabled={isApplying}
              className="mt-1"
            />
          </div>

          <div className="rounded-md border p-2 space-y-1.5" style={panelCardStyle}>
            <label className="ui-meta block" style={{ color: 'var(--text-muted)' }}><Trans>Shell Thickness</Trans></label>
            <ScrollableNumberField
              value={state.shellThicknessMm}
              onChange={(value) => setState({ shellThicknessMm: clampFloat(value, 0.2, 10, 1) })}
              min={0.2}
              max={10}
              step={0.1}
              unit="mm"
              ariaLabel={_(msg`Shell thickness in millimeters`)}
              disabled={isApplying}
              className="mt-1"
            />
          </div>

          <div className="rounded-md border p-2 space-y-2" style={panelCardStyle}>
            <label className="flex items-center gap-2 text-xs font-medium">
              <input
                type="checkbox"
                checked={hollowing2D.enabled}
                onChange={(event) => onHollowing2DChange({
                  ...hollowing2D,
                  enabled: event.currentTarget.checked,
                })}
                className="ui-checkbox !h-4 !w-4"
                disabled={!canEdit || isApplying}
              />
              <Trans>2D hollowing when slicing</Trans>
            </label>
            <p className="text-[10px] leading-snug" style={{ color: 'var(--text-muted)' }}>
              <Trans>Creates a hollow shell in each slice without changing the 3D model. Supports and rafts stay solid.</Trans>
            </p>
            {hollowing2D.enabled && (
              <div className="space-y-2">
                <label className="ui-meta block" style={{ color: 'var(--text-muted)' }}><Trans>2D wall thickness</Trans></label>
                <ScrollableNumberField
                  value={hollowing2D.wallThicknessMm}
                  onChange={(wallThicknessMm) => onHollowing2DChange({
                    ...hollowing2D,
                    wallThicknessMm: clampFloat(wallThicknessMm, 0.5, 10, 1),
                  })}
                  min={0.5}
                  max={10}
                  step={0.1}
                  unit="mm"
                  ariaLabel={_(msg`2D wall thickness in millimeters`)}
                  disabled={!canEdit || isApplying}
                  className="mt-1"
                />
                {([
                  { key: 'infillDensityPercent', label: msg`2D infill density`, defaultValue: 0, min: 0, max: 100, step: 1, unit: '%' },
                  { key: 'infillCellMm', label: msg`2D infill grid spacing`, defaultValue: 3, min: 0.8, max: 10, step: 0.1, unit: 'mm' },
                  { key: 'infillIntensityPercent', label: msg`2D infill pixel intensity`, defaultValue: 100, min: 0, max: 100, step: 1, unit: '%' },
                ] as const).map(({ key, label, defaultValue, min, max, step, unit }) => (
                    <div key={key}>
                      <div className="ui-meta" style={{ color: 'var(--text-muted)' }}>
                      {_(label)}
                      </div>
                      <ScrollableNumberField
                        value={hollowing2D[key] ?? defaultValue}
                        onChange={(value) => onHollowing2DChange({ ...hollowing2D, [key]: clampFloat(value, min, max, defaultValue) })}
                        min={min}
                        max={max}
                        step={step}
                        unit={unit}
                        ariaLabel={_(label)}
                        disabled={!canEdit || isApplying || (key !== 'infillDensityPercent' && !hollowing2D.infillDensityPercent)}
                        className="mt-1"
                      />
                    </div>
                ))}
              </div>
            )}
          </div>

          {state.mode !== 'shell_open_face' && (
            <div className="rounded-md border p-2 space-y-2" style={panelCardStyle}>
              <div className="ui-meta" style={{ color: 'var(--text-muted)' }}><Trans>Detect and fill pockets</Trans></div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={state.detectResinTraps ?? false}
                  onChange={(event) => setState({ detectResinTraps: event.currentTarget.checked })}
                  className="ui-checkbox !h-4 !w-4"
                  disabled={isApplying}
                />
                <Trans>Resin traps</Trans>
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={state.detectInteriorSuctionCups ?? false}
                  onChange={(event) => setState({ detectInteriorSuctionCups: event.currentTarget.checked })}
                  className="ui-checkbox !h-4 !w-4"
                  disabled={isApplying}
                />
                <Trans>Interior suction cups</Trans>
              </label>
              {(state.detectResinTraps || state.detectInteriorSuctionCups) && (
                <p className="text-[10px] leading-tight" style={{ color: 'var(--text-muted)' }}>
                  <Trans>Detection follows the build Z axis and uses drain holes as vents. Results are a geometric approximation.</Trans>
                </p>
              )}
            </div>
          )}

          {state.mode === 'infill' && (
            <>
              <div className="rounded-md border p-2 space-y-1.5" style={panelCardStyle}>
                <div className="ui-meta" style={{ color: 'var(--text-muted)' }}><Trans>Infill Type</Trans></div>
                <div className="grid grid-cols-2 gap-1">
                  <Button
                    variant="secondary"
                    size="auto"
                    className="!h-8 whitespace-nowrap px-1.5 text-[10px] sm:text-[11px]"
                    onClick={() => setState({ infillMode: 'lattice' })}
                    style={state.infillMode === 'lattice' ? activeModeStyle : undefined}
                    disabled={isApplying}
                  >
                    <Trans>Lattice</Trans>
                  </Button>

                  <Button
                    variant="secondary"
                    size="auto"
                    className="!h-8 whitespace-nowrap px-1.5 text-[10px] sm:text-[11px]"
                    onClick={() => setState({ infillMode: 'double_lattice' })}
                    style={state.infillMode === 'double_lattice' ? activeModeStyle : undefined}
                    disabled={isApplying}
                  >
                    <Trans>Double Lattice</Trans>
                  </Button>

                  <Button
                    variant="secondary"
                    size="auto"
                    className="!h-8 whitespace-nowrap px-1.5 text-[10px] sm:text-[11px]"
                    onClick={() => setState({ infillMode: 'pillar' })}
                    style={state.infillMode === 'pillar' ? activeModeStyle : undefined}
                    disabled={isApplying}
                  >
                    <Trans>Pillar</Trans>
                  </Button>

                </div>
              </div>

              <div className="rounded-md border p-2 space-y-1.5" style={panelCardStyle}>
                <label className="ui-meta block" style={{ color: 'var(--text-muted)' }}>
                  {state.infillMode === 'pillar' ? _(msg`Pillar Spacing`) : _(msg`Infill Density`)}
                </label>
                <ScrollableNumberField
                  value={infillDensityPct}
                  onChange={(value) => setState({ infillCellMm: densityPctToCellMm(value) })}
                  min={1}
                  max={100}
                  step={1}
                  unit="%"
                  ariaLabel={state.infillMode === 'pillar' ? _(msg`Pillar spacing percent`) : _(msg`Infill density percent`)}
                  disabled={isApplying}
                  className="mt-1"
                />
              </div>

              <div className="rounded-md border p-2 space-y-1.5" style={panelCardStyle}>
                <label className="ui-meta block" style={{ color: 'var(--text-muted)' }}><Trans>Infill Diameter</Trans></label>
                <ScrollableNumberField
                  value={infillDiameterMm}
                  onChange={(value) => setState({ infillBeamRadiusMm: clampFloat(value / 2, minInfillDiameterMm / 2, maxInfillDiameterMm / 2, 2) })}
                  min={minInfillDiameterMm}
                  max={maxInfillDiameterMm}
                  step={0.1}
                  unit="mm"
                  ariaLabel={_(msg`Infill diameter in millimeters`)}
                  disabled={isApplying}
                  className="mt-1"
                />
              </div>
            </>
          )}

          {state.mode === 'shell_open_face' && (
            <div className="rounded-md border p-2" style={panelCardStyle}>
              <label className="ui-meta block" style={{ color: 'var(--text-muted)' }}><Trans>Open Face</Trans></label>
              <Select
                className="mt-1 w-full !h-8 px-2 text-xs"
                value={state.openFace}
                onChange={(e) => setState({ openFace: e.target.value as OpenFace })}
                disabled={isApplying}
              >
                <option value="x_min">{_(msg`X Min`)}</option>
                <option value="x_max">{_(msg`X Max`)}</option>
                <option value="y_min">{_(msg`Y Min`)}</option>
                <option value="y_max">{_(msg`Y Max`)}</option>
                <option value="z_min">{_(msg`Z Min`)}</option>
                <option value="z_max">{_(msg`Z Max`)}</option>
              </Select>

              {shellFaceSelectionPending && (
                <p className="mt-1.5 text-[11px] leading-tight" style={{ color: 'var(--text-muted)' }}>
                  <Trans>Click the face you want to open in the scene.</Trans>
                </p>
              )}
            </div>
          )}

          {isEditMode ? (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="auto"
                className="flex-1 !min-h-8 px-1.5 py-1 text-[10px] sm:text-[11px] whitespace-normal text-center leading-tight disabled:opacity-60"
                onClick={onClearEdit}
                disabled={isApplying || isPreviewing}
              >
                <Trans>Clear</Trans>
              </Button>

              <Button
                variant="accent"
                size="auto"
                className="flex-1 !min-h-8 px-1.5 py-1 text-[10px] sm:text-[11px] whitespace-normal text-center leading-tight disabled:opacity-60"
                onClick={onDoneEdit}
                disabled={isApplying || isPreviewing || isApplyingBlockers}
              >
                {isApplyingBlockers ? (
                  <span className="inline-flex items-center justify-center gap-1.5">
                    <Spinner size="xs" />
                    <span><Trans>Applying Solid Areas</Trans></span>
                  </span>
                ) : _(msg`Done`)}
              </Button>

            </div>
          ) : (
            <div className="flex gap-2">
              {isHollowingApplied ? (
                <>
                  {canApply && (
                    <Button
                      variant="secondary"
                      size="auto"
                      className="flex-1 !min-h-8 px-1.5 py-1 text-[10px] sm:text-[11px] whitespace-normal text-center leading-tight disabled:opacity-60"
                      onClick={onResetSettings}
                      disabled={isApplying || isPreviewing}
                    >
                      <Trans>Reset</Trans>
                    </Button>

                  )}
                  <Button
                    variant="accent"
                    size="auto"
                    className="flex-1 !min-h-8 px-1.5 py-1 text-[10px] sm:text-[11px] whitespace-normal text-center leading-tight disabled:opacity-60"
                    onClick={onReset}
                    disabled={isApplying || isPreviewing}
                  >
                    <Trans>Remove Hollowing</Trans>
                  </Button>

                </>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    size="auto"
                    className="flex-1 !min-h-8 px-1.5 py-1 text-[10px] sm:text-[11px] whitespace-normal text-center leading-tight disabled:opacity-60"
                    onClick={onStartEdit}
                    disabled={isApplying || isPreviewing || !canEdit}
                  >
                    <Trans>Solid Areas</Trans>
                  </Button>

                  <Button
                    variant="accent"
                    size="auto"
                    className="flex-1 !min-h-8 px-1.5 py-1 text-[10px] sm:text-[11px] whitespace-normal text-center leading-tight disabled:opacity-60"
                    onClick={onApply}
                    disabled={isApplying || isPreviewing || !canApply}
                  >
                    {isApplying ? _(msg`Applying…`) : isPreviewing ? (
                      <span className="inline-flex items-center justify-center gap-1.5">
                        <Spinner size="xs" />
                        <span><Trans>Updating</Trans></span>
                      </span>
                    ) : _(msg`Apply`)}
                  </Button>

                </>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
