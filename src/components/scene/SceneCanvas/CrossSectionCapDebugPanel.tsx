/**
 * The temporary cross-section cap debug panel: per-cap overrides of side,
 * depth test, clip, stencil, offset and rotation. Developer tooling, so its
 * text is not translated.
 */
import React from 'react';
import type { CrossSectionCapDebugOverrides } from '@/components/scene/CrossSectionStencilCap';
import { DEFAULT_CROSS_SECTION_CAP_DEBUG_STATE, type CrossSectionCapDebugPanelState } from './crossSectionCapDebug';

export function CrossSectionCapDebugPanel({
  crossSectionCapDebugState,
  setCrossSectionCapDebugState,
  onClose,
}: {
  crossSectionCapDebugState: CrossSectionCapDebugPanelState;
  setCrossSectionCapDebugState: React.Dispatch<React.SetStateAction<CrossSectionCapDebugPanelState>>;
  onClose: () => void;
}) {
  return (
    <div
      className="absolute right-3 top-3 z-[70] w-[360px] rounded-lg border p-3 shadow-xl"
      style={{
        pointerEvents: 'auto',
        borderColor: 'color-mix(in srgb, var(--accent), var(--border-subtle) 45%)',
        background: 'color-mix(in srgb, var(--surface-0), black 6%)',
        color: 'var(--text-strong)',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold">Cross-Section Cap Debug (temporary)</div>
        <button
          type="button"
          className="rounded border px-2 py-1 text-[10px]"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
          onClick={onClose}
        >
          Close
        </button>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 rounded border p-2" style={{ borderColor: 'var(--border-subtle)' }}>
        <label className="flex items-center gap-2 text-[11px]">
          <input
            type="checkbox"
            checked={crossSectionCapDebugState.enabled}
            onChange={(e) => {
              const enabled = e.target.checked;
              setCrossSectionCapDebugState((prev) => ({ ...prev, enabled }));
            }}
          />
          Enable overrides
        </label>
        <button
          type="button"
          className="rounded border px-2 py-1 text-[10px]"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
          onClick={() => setCrossSectionCapDebugState(DEFAULT_CROSS_SECTION_CAP_DEBUG_STATE)}
        >
          Reset defaults
        </button>
      </div>

      {(['top', 'bottom'] as const).map((which) => {
        const settings = crossSectionCapDebugState[which];
        const setSettings = (partial: Partial<CrossSectionCapDebugOverrides>) => {
          setCrossSectionCapDebugState((prev) => ({
            ...prev,
            [which]: { ...prev[which], ...partial },
          }));
        };

        return (
          <div key={which} className="mt-2 rounded border p-2" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="mb-1 text-[11px] font-semibold uppercase" style={{ color: 'var(--text-muted)' }}>
              {which} cap
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <label className="flex flex-col gap-1">
                <span>Side</span>
                <select
                  value={settings.side ?? 'front'}
                  onChange={(e) => setSettings({ side: e.target.value as 'front' | 'back' | 'double' })}
                  className="rounded border px-1.5 py-1"
                  style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
                >
                  <option value="front">front</option>
                  <option value="back">back</option>
                  <option value="double">double</option>
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span>Depth test</span>
                <select
                  value={settings.depthTest ? 'on' : 'off'}
                  onChange={(e) => setSettings({ depthTest: e.target.value === 'on' })}
                  className="rounded border px-1.5 py-1"
                  style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
                >
                  <option value="on">on</option>
                  <option value="off">off</option>
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span>Clip mode</span>
                <select
                  value={settings.clipMode ?? (which === 'bottom' ? 'lower' : 'upper')}
                  onChange={(e) => setSettings({ clipMode: e.target.value as 'upper' | 'lower' })}
                  disabled={which === 'bottom'}
                  className="rounded border px-1.5 py-1"
                  style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
                >
                  <option value="upper">upper (z ≤ y)</option>
                  <option value="lower">lower (z ≥ y)</option>
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span>Stencil mode</span>
                <select
                  value={settings.stencilMode ?? 'standard'}
                  onChange={(e) => setSettings({ stencilMode: e.target.value as 'standard' | 'mirrored' })}
                  disabled={which === 'bottom'}
                  className="rounded border px-1.5 py-1"
                  style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
                >
                  <option value="standard">standard</option>
                  <option value="mirrored">mirrored</option>
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span>Offset (mm)</span>
                <input
                  type="number"
                  step="0.0001"
                  value={settings.offsetMm ?? (which === 'bottom' ? -0.0001 : 0.0001)}
                  onChange={(e) => setSettings({ offsetMm: Number(e.target.value) })}
                  className="rounded border px-1.5 py-1"
                  style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span>Rotation X (deg)</span>
                <input
                  type="number"
                  step="1"
                  value={settings.rotationXDeg ?? 0}
                  onChange={(e) => setSettings({ rotationXDeg: Number(e.target.value) })}
                  disabled={which === 'bottom'}
                  className="rounded border px-1.5 py-1"
                  style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
                />
              </label>
            </div>

            {which === 'bottom' && (
              <div className="mt-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                Bottom cap uses CPU slice loops right now (side/offset/depth-test apply; clip/stencil/rotation ignored).
              </div>
            )}
          </div>
        );
      })}

      <div className="mt-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>
        Toggle panel: Ctrl+Shift+K · Settings persist locally.
      </div>
    </div>
  );
}
