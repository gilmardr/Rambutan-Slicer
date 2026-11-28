"use client";

import React from 'react';
import { RaftSettings } from '../../Rafts/Crenelated/RaftTypes';
import { NumberInput } from '@/components/ui/NumberInput';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { SelectDropdown } from '@/components/ui/SelectDropdown';
import { setAnatomyPreviewActiveSettingKey } from '../AnatomyPreview/previewState';

interface RaftSettingsCardProps {
    settings: RaftSettings;
    onChange: (settings: Partial<RaftSettings>) => void;
    activeModelId?: string | null;
    selectedModelIds?: string[];
}

export function RaftSettingsCard({ settings, onChange, activeModelId, selectedModelIds }: RaftSettingsCardProps) {
    const { _ } = useLingui();

    const makeFocusHandlers = React.useCallback((key: string) => {
        return {
            onFocusCapture: () => {
                setAnatomyPreviewActiveSettingKey(key);
            },
            onBlurCapture: (e: React.FocusEvent<HTMLElement>) => {
                const next = e.relatedTarget as Node | null;
                if (next && e.currentTarget.contains(next)) return;
                setAnatomyPreviewActiveSettingKey(null);
            },
        };
    }, []);

    if (!settings) return null;

    const ModeButton = ({
        active,
        children,
        onClick,
        className = '',
    }: {
        active: boolean;
        children: React.ReactNode;
        onClick: () => void;
        className?: string;
    }) => (
        <button
            type="button"
            onClick={onClick}
            className={`min-h-[36px] rounded-md border px-3 text-[12px] font-semibold uppercase tracking-wide transition-colors ${className}`}
            style={active
                ? {
                    borderColor: 'color-mix(in srgb, var(--accent), white 10%)',
                    background: 'color-mix(in srgb, var(--accent), var(--surface-1) 84%)',
                    color: 'color-mix(in srgb, var(--accent), var(--text-strong) 25%)',
                }
                : {
                    borderColor: 'var(--border-subtle)',
                    background: 'var(--surface-1)',
                    color: 'var(--text-muted)',
                }}
        >
            {children}
        </button>
    );

    const ToggleButton = ({
        checked,
        onChange,
        label,
        tone = 'primary',
    }: {
        checked: boolean;
        onChange: () => void;
        label: string;
        tone?: 'primary' | 'secondary';
    }) => (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={onChange}
            className="ui-input w-full h-[36px] px-2.5 leading-tight text-sm inline-flex items-center justify-between"
            style={checked
                ? {
                    borderColor: `color-mix(in srgb, ${tone === 'primary' ? 'var(--accent)' : 'var(--accent-secondary)'}, var(--border-subtle) 36%)`,
                    background: `color-mix(in srgb, ${tone === 'primary' ? 'var(--accent)' : 'var(--accent-secondary)'}, var(--surface-1) 90%)`,
                    color: tone === 'primary'
                        ? 'color-mix(in srgb, var(--accent), var(--text-strong) 25%)'
                        : 'color-mix(in srgb, var(--accent-secondary), var(--text-strong) 28%)',
                }
                : {
                    borderColor: 'var(--border-subtle)',
                    background: 'var(--surface-1)',
                    color: 'var(--text-muted)',
                }}
        >
            <span className="text-[12px] font-semibold uppercase tracking-wide">{label}</span>
            <span
                className="inline-flex h-5 w-9 rounded-full p-0.5 transition-colors"
                style={{ background: checked ? (tone === 'primary' ? 'var(--accent)' : 'var(--accent-secondary)') : 'var(--surface-2)' }}
            >
                <span className={`h-4 w-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
            </span>
        </button>
    );

    const unitHint = (unit: string) => (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>{unit}</span>
    );
    const compactInputClass = 'ui-input w-full h-[36px] px-3 py-2 text-base text-center no-spinners !bg-[var(--surface-0)]';

    const isWallEnabled = settings.bottomMode === 'solid' && settings.wallEnabled;

    return (
        <div className="space-y-2.5">
            <div className="space-y-1.5">
                <div className="grid grid-cols-3 gap-1.5">
                    <ModeButton active={settings.bottomMode === 'off'} onClick={() => onChange({ bottomMode: 'off' })}>{_(msg({ message: 'Off', comment: 'Raft bottom mode. One of three narrow buttons: Off / Solid / Line.' }))}</ModeButton>
                    <ModeButton active={settings.bottomMode === 'solid'} onClick={() => onChange({ bottomMode: 'solid' })}>{_(msg({ message: 'Solid', comment: 'Raft bottom mode. One of three narrow buttons: Off / Solid / Line.' }))}</ModeButton>
                    <ModeButton active={settings.bottomMode === 'line'} onClick={() => onChange({ bottomMode: 'line' })}>{_(msg({ message: 'Line', comment: 'Raft bottom mode. One of three narrow buttons: Off / Solid / Line.' }))}</ModeButton>
                </div>
                {settings.bottomMode !== 'off' && (
                    <label className="flex flex-col gap-0.5">
                        <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>{_(msg`Raft footprint`)}</span>
                        <SelectDropdown
                            value={settings.footprintMode ?? 'contour'}
                            onChange={(value) => onChange({ footprintMode: value as 'contour' | 'hull' })}
                            options={[
                                { value: 'contour', label: _(msg`Cover all supports`) },
                                { value: 'hull', label: _(msg`Convex hull`) },
                            ]}
                        />
                        <span className="text-[10px] leading-snug" style={{ color: 'var(--text-muted)' }}>
                            {settings.footprintMode === 'hull'
                                ? _(msg`One convex raft around all support bases.`)
                                : _(msg`Wraps every support base and bridges nearby roots for a stronger raft.`)}
                        </span>
                    </label>
                )}
                {settings.bottomMode === 'solid' && (
                    <div className="flex flex-wrap gap-1.5">
                        <ToggleButton
                            checked={isWallEnabled}
                            onChange={() => onChange({ wallEnabled: !isWallEnabled })}
                            label={_(msg`Wall`)}
                            tone="secondary"
                        />
                        <ToggleButton
                            checked={settings.baseReliefEnabled}
                            onChange={() => onChange({ baseReliefEnabled: !settings.baseReliefEnabled })}
                            label={_(msg`Base relief`)}
                            tone="secondary"
                        />
                    </div>
                )}
            </div>

            {settings.bottomMode !== 'off' && (
                <div className="grid grid-cols-2 gap-1.5 items-start">
                    {settings.bottomMode === 'solid' && (
                        <>
                            <label className="flex flex-col gap-0.5" {...makeFocusHandlers('raft.thickness')}>
                                <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>{_(msg`Thickness`)}</span>
                                <div className="relative">
                                    <NumberInput
                                        value={settings.thickness}
                                        onChange={(val) => onChange({ thickness: val })}
                                        step={0.1}
                                        showStepper={false}
                                        className={compactInputClass}
                                    />
                                    {unitHint('mm')}
                                </div>
                            </label>
                            <label className="flex flex-col gap-0.5" {...makeFocusHandlers('raft.chamferAngle')}>
                                <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>{_(msg`Chamfer Angle`)}</span>
                                <div className="relative">
                                    <NumberInput
                                        value={settings.chamferAngle}
                                        onChange={(val) => onChange({ chamferAngle: val })}
                                        showStepper={false}
                                        className={compactInputClass}
                                    />
                                    {unitHint('°')}
                                </div>
                            </label>
                            {settings.baseReliefEnabled && (
                                <>
                                    <SelectDropdown
                                        ariaLabel={_(msg`Opening pattern`)}
                                        value={settings.baseReliefPattern ?? 'square-round'}
                                        options={[
                                            { value: 'square-round', label: _(msg`Round openings on a square grid`) },
                                            { value: 'staggered-round', label: _(msg`Staggered round openings`) },
                                            { value: 'staggered-hex', label: _(msg`Staggered hexagonal openings`) },
                                        ]}
                                        onChange={(value) => {
                                            if (value === 'square-round' || value === 'staggered-round' || value === 'staggered-hex') {
                                                onChange({ baseReliefPattern: value });
                                            }
                                        }}
                                    />
                                    <label className="flex flex-col gap-0.5" {...makeFocusHandlers('raft.baseReliefHoleDiameterMm')}>
                                        <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>{_(msg`Opening diameter`)}</span>
                                        <div className="relative">
                                            <NumberInput
                                                value={settings.baseReliefHoleDiameterMm}
                                                onChange={(val) => onChange({ baseReliefHoleDiameterMm: val })}
                                                step={0.1}
                                                showStepper={false}
                                                className={compactInputClass}
                                            />
                                            {unitHint('mm')}
                                        </div>
                                    </label>
                                    <label className="flex flex-col gap-0.5" {...makeFocusHandlers('raft.baseReliefPitchMm')}>
                                        <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>{_(msg`Opening pitch`)}</span>
                                        <div className="relative">
                                            <NumberInput
                                                value={settings.baseReliefPitchMm}
                                                onChange={(val) => onChange({ baseReliefPitchMm: val })}
                                                step={0.5}
                                                showStepper={false}
                                                className={compactInputClass}
                                            />
                                            {unitHint('mm')}
                                        </div>
                                    </label>
                                </>
                            )}
                        </>
                    )}

                    {settings.bottomMode === 'line' && (
                        <>
                            <label className="flex flex-col gap-0.5" {...makeFocusHandlers('raft.lineWidthMm')}>
                                <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>{_(msg`Line Width`)}</span>
                                <div className="relative">
                                    <NumberInput
                                        value={settings.lineWidthMm}
                                        onChange={(val) => onChange({ lineWidthMm: val })}
                                        step={0.1}
                                        showStepper={false}
                                        className={compactInputClass}
                                    />
                                    {unitHint('mm')}
                                </div>
                            </label>
                            <label className="flex flex-col gap-0.5" {...makeFocusHandlers('raft.lineHeightMm')}>
                                <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>{_(msg`Line Height`)}</span>
                                <div className="relative">
                                    <NumberInput
                                        value={settings.lineHeightMm}
                                        onChange={(val) => onChange({ lineHeightMm: val })}
                                        step={0.1}
                                        showStepper={false}
                                        className={compactInputClass}
                                    />
                                    {unitHint('mm')}
                                </div>
                            </label>
                        </>
                    )}

                    {isWallEnabled && (
                        <>
                            <label className="flex flex-col gap-0.5" {...makeFocusHandlers('raft.wallHeight')}>
                                <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>{_(msg`Wall Height`)}</span>
                                <div className="relative">
                                    <NumberInput
                                        value={settings.wallHeight}
                                        onChange={(val) => onChange({ wallHeight: val })}
                                        step={0.1}
                                        showStepper={false}
                                        className={compactInputClass}
                                    />
                                    {unitHint('mm')}
                                </div>
                            </label>
                            <label className="flex flex-col gap-0.5" {...makeFocusHandlers('raft.wallThickness')}>
                                <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>{_(msg`Wall Thickness`)}</span>
                                <div className="relative">
                                    <NumberInput
                                        value={settings.wallThickness}
                                        onChange={(val) => onChange({ wallThickness: val })}
                                        step={0.1}
                                        showStepper={false}
                                        className={compactInputClass}
                                    />
                                    {unitHint('mm')}
                                </div>
                            </label>
                            <label className="flex flex-col gap-0.5" {...makeFocusHandlers('raft.crenulationGapWidth')}>
                                <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>{_(msg`Gap Width`)}</span>
                                <div className="relative">
                                    <NumberInput
                                        value={settings.crenulationGapWidth}
                                        onChange={(val) => onChange({ crenulationGapWidth: val })}
                                        step={0.1}
                                        showStepper={false}
                                        className={compactInputClass}
                                    />
                                    {unitHint('mm')}
                                </div>
                            </label>
                            <label className="flex flex-col gap-0.5" {...makeFocusHandlers('raft.crenulationSpacing')}>
                                <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>{_(msg`Gap Spacing`)}</span>
                                <div className="relative">
                                    <NumberInput
                                        value={settings.crenulationSpacing}
                                        onChange={(val) => onChange({ crenulationSpacing: val })}
                                        step={0.1}
                                        showStepper={false}
                                        className={compactInputClass}
                                    />
                                    {unitHint('mm')}
                                </div>
                            </label>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
