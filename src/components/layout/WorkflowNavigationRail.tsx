"use client";

import React from 'react';
import { createPortal } from 'react-dom';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { Lock } from 'lucide-react';
import type { SupportMode } from '@/supports/types';

export const WORKFLOW_RAIL_LEFT_PX = 8;
export const WORKFLOW_RAIL_WIDTH_PX = 64;
export const WORKFLOW_RAIL_RESERVED_WIDTH_PX = 80;

export type WorkflowNavigationStep = {
  mode: SupportMode;
  label: string;
  step: number;
  icon: React.ReactNode;
  hint: string;
  locked: boolean;
};

type WorkflowNavigationRailProps = {
  steps: WorkflowNavigationStep[];
  activeMode: SupportMode;
  isDisabled?: boolean;
  onModeChange: (mode: SupportMode) => void;
};

export function WorkflowNavigationRail({
  steps,
  activeMode,
  isDisabled = false,
  onModeChange,
}: WorkflowNavigationRailProps) {
  const { _ } = useLingui();
  const [isMounted, setIsMounted] = React.useState(false);

  React.useEffect(() => setIsMounted(true), []);
  if (!isMounted) return null;

  return createPortal(
    <div
      aria-label={_(msg`Print workflow`)}
      className="fixed bottom-2 top-[var(--topbar-height)] z-[45] flex flex-col items-center overflow-y-auto overflow-x-hidden rounded-xl border px-1.5 pb-2 pt-2 shadow-lg backdrop-blur-md custom-scrollbar"
      style={{
        left: WORKFLOW_RAIL_LEFT_PX,
        width: WORKFLOW_RAIL_WIDTH_PX,
        borderColor: 'color-mix(in srgb, var(--border-subtle), transparent 8%)',
        background: 'color-mix(in srgb, var(--surface-0), transparent 8%)',
      }}
      data-no-drag="true"
      data-no-window-drag="true"
      role="toolbar"
      aria-orientation="vertical"
    >
      <div className="mb-2 flex w-full items-center justify-center gap-1.5 px-1 pt-0.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent)' }} aria-hidden="true" />
        <span className="text-[8px] font-bold uppercase tracking-[0.13em]" style={{ color: 'var(--text-muted)' }}>
          {_(msg`Workflow`)}
        </span>
      </div>

      <div className="flex w-full flex-col gap-1.5">
        {steps.map((item) => {
          const active = activeMode === item.mode;
          const disabled = item.locked || isDisabled;

          return (
            <button
              key={item.mode}
              type="button"
              onClick={() => { if (!disabled) onModeChange(item.mode); }}
              disabled={disabled}
              aria-disabled={disabled}
              aria-current={active ? 'step' : undefined}
              aria-label={`${item.step}. ${item.label}. ${item.hint}`}
              title={isDisabled
                ? _(msg`Slicing in progress. Workflow navigation is temporarily disabled.`)
                : disabled
                  ? item.mode === 'printing'
                    ? _(msg`Run slicing in Export to unlock Printing preview`)
                    : _(msg`Load a model in Prepare to unlock Support and Export`)
                  : item.hint}
              className="relative flex min-h-[62px] w-full flex-col items-center justify-center gap-1 rounded-lg border px-1 py-1.5 text-center transition-colors disabled:cursor-not-allowed"
              style={{
                borderColor: active
                  ? 'color-mix(in srgb, var(--accent), var(--border-subtle) 44%)'
                  : 'transparent',
                color: disabled
                  ? 'var(--text-muted)'
                  : active ? 'var(--text-strong)' : 'var(--text-muted)',
                background: active
                  ? 'color-mix(in srgb, var(--accent), var(--surface-1) 86%)'
                  : 'transparent',
                opacity: disabled ? 0.55 : 1,
                boxShadow: active ? '0 5px 16px rgba(0,0,0,0.2)' : undefined,
              }}
              onMouseEnter={(event) => {
                if (active || disabled) return;
                event.currentTarget.style.background = 'color-mix(in srgb, var(--surface-1), transparent 12%)';
                event.currentTarget.style.borderColor = 'var(--border-subtle)';
              }}
              onMouseLeave={(event) => {
                if (active) return;
                event.currentTarget.style.background = 'transparent';
                event.currentTarget.style.borderColor = 'transparent';
              }}
            >
              <span
                className="absolute right-1 top-1 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[8px] font-bold"
                style={{
                  background: active ? 'var(--accent)' : 'var(--surface-2)',
                  color: active ? 'var(--surface-0)' : 'var(--text-muted)',
                }}
                aria-hidden="true"
              >
                {item.step}
              </span>
              <span
                className="flex h-7 w-7 items-center justify-center rounded-md"
                style={{ color: active ? 'var(--accent)' : undefined }}
                aria-hidden="true"
              >
                {item.icon}
              </span>
              <span className="max-w-full truncate text-[9px] font-semibold leading-tight">
                {item.label}
              </span>
              {item.locked && <Lock className="absolute bottom-1 right-1 h-2.5 w-2.5" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
