"use client";

import React from 'react';
import { createPortal } from 'react-dom';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { useEscapeToClose } from '@/hotkeys/useEscapeToClose';
import {
  Box,
  Command,
  CornerDownLeft,
  FileText,
  Search,
  X,
} from 'lucide-react';
import type { ContextMenuEntry } from '@/components/ui/ContextMenu';
import type { RecentOpenedFileEntry } from '@/features/scene/useSceneCollectionManager';

type PaletteItem =
  | { kind: 'command'; key: string; entry: ContextMenuEntry }
  | { kind: 'recent'; key: string; entry: RecentOpenedFileEntry };

type AppCommandPaletteProps = {
  entries: ContextMenuEntry[];
  recentFiles: RecentOpenedFileEntry[];
  onSelectCommand: (id: string) => void;
  onReopenRecentFile?: (entryId: string) => Promise<boolean> | boolean;
  onClose: () => void;
};

function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
}

function formatRecentDate(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0 || Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

export function AppCommandPalette({
  entries,
  recentFiles,
  onSelectCommand,
  onReopenRecentFile,
  onClose,
}: AppCommandPaletteProps) {
  const { _ } = useLingui();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const dialogRef = React.useRef<HTMLElement | null>(null);
  const [query, setQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [isOpeningRecent, setIsOpeningRecent] = React.useState(false);
  const [openError, setOpenError] = React.useState(false);

  const normalizedQuery = normalizeSearch(query.trim());
  const visibleCommands = React.useMemo(() => entries.filter((entry) => {
    if (!normalizedQuery) return true;
    return normalizeSearch(`${String(entry.label)} ${entry.id}`).includes(normalizedQuery);
  }), [entries, normalizedQuery]);
  const visibleRecentFiles = React.useMemo(() => recentFiles
    .slice()
    .reverse()
    .slice(0, 8)
    .filter((entry) => !normalizedQuery || normalizeSearch(`${entry.name} ${entry.kind}`).includes(normalizedQuery)),
  [recentFiles, normalizedQuery]);

  const keyboardItems = React.useMemo<PaletteItem[]>(() => [
    ...visibleCommands.filter((entry) => !entry.disabled).map((entry) => ({
      kind: 'command' as const,
      key: `command:${entry.id}`,
      entry,
    })),
    ...(onReopenRecentFile
      ? visibleRecentFiles.map((entry) => ({ kind: 'recent' as const, key: `recent:${entry.id}`, entry }))
      : []),
  ], [onReopenRecentFile, visibleCommands, visibleRecentFiles]);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  React.useEffect(() => {
    setActiveIndex(0);
    setOpenError(false);
  }, [normalizedQuery]);

  const runItem = React.useCallback(async (item: PaletteItem | undefined) => {
    if (!item || isOpeningRecent) return;
    if (item.kind === 'command') {
      onSelectCommand(item.entry.id);
      return;
    }

    if (!onReopenRecentFile) return;
    setIsOpeningRecent(true);
    setOpenError(false);
    try {
      const reopened = await onReopenRecentFile(item.entry.id);
      if (reopened) onClose();
      else setOpenError(true);
    } catch {
      setOpenError(true);
    } finally {
      setIsOpeningRecent(false);
    }
  }, [isOpeningRecent, onClose, onReopenRecentFile, onSelectCommand]);

  useEscapeToClose(true, onClose);

  // Keys reach this handler from inside the dialog, where focus stays while it is open.
  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    // The hotkey system skips keys typed in the search field, so Escape and
    // Ctrl+K / Cmd+K are also handled here.
    if (event.key === 'Escape' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'Tab') {
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [href], select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable?.length) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
      return;
    }
    if (keyboardItems.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % keyboardItems.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + keyboardItems.length) % keyboardItems.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void runItem(keyboardItems[activeIndex]);
    }
  };

  const commandRows = visibleCommands.map((entry, index) => {
    const keyboardIndex = keyboardItems.findIndex((item) => item.kind === 'command' && item.entry.id === entry.id);
    const active = keyboardIndex >= 0 && keyboardIndex === activeIndex;
    const Icon = entry.icon;
    return (
      <React.Fragment key={entry.id}>
        {entry.startsGroup && index > 0 && (
          <div role="separator" className="my-2 h-px" style={{ background: 'var(--border-subtle)' }} />
        )}
        <button
          id={keyboardIndex >= 0 ? `app-command-palette-option-${keyboardIndex}` : undefined}
          type="button"
          role="menuitem"
          disabled={entry.disabled || isOpeningRecent}
          aria-disabled={entry.disabled || isOpeningRecent || undefined}
          data-active={active || undefined}
          onMouseEnter={() => { if (keyboardIndex >= 0) setActiveIndex(keyboardIndex); }}
          onClick={() => { void runItem({ kind: 'command', key: `command:${entry.id}`, entry }); }}
          className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            color: 'var(--text-strong)',
            background: active ? 'color-mix(in srgb, var(--accent), var(--surface-1) 86%)' : 'transparent',
          }}
        >
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border"
            style={{
              borderColor: active ? 'color-mix(in srgb, var(--accent), var(--border-subtle) 55%)' : 'var(--border-subtle)',
              color: active ? 'var(--accent)' : 'var(--text-muted)',
              background: active ? 'color-mix(in srgb, var(--accent), var(--surface-0) 90%)' : 'var(--surface-1)',
            }}
          >
            {Icon ? <Icon className="h-4 w-4" strokeWidth={1.9} /> : null}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{entry.label}</span>
          {active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--accent)' }} />}
        </button>
      </React.Fragment>
    );
  });

  const recentRows = visibleRecentFiles.map((entry) => {
    const keyboardIndex = keyboardItems.findIndex((item) => item.kind === 'recent' && item.entry.id === entry.id);
    const active = keyboardIndex >= 0 && keyboardIndex === activeIndex;
    const Icon = entry.kind === 'scene' ? FileText : Box;
    return (
      <button
        id={keyboardIndex >= 0 ? `app-command-palette-option-${keyboardIndex}` : undefined}
        key={entry.id}
        type="button"
        role="menuitem"
        disabled={!onReopenRecentFile || isOpeningRecent}
        data-active={active || undefined}
        onMouseEnter={() => { if (keyboardIndex >= 0) setActiveIndex(keyboardIndex); }}
        onClick={() => { void runItem({ kind: 'recent', key: `recent:${entry.id}`, entry }); }}
        className="flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45"
        style={{
          borderColor: active ? 'color-mix(in srgb, var(--accent), var(--border-subtle) 56%)' : 'var(--border-subtle)',
          color: 'var(--text-strong)',
          background: active ? 'color-mix(in srgb, var(--accent), var(--surface-1) 90%)' : 'color-mix(in srgb, var(--surface-1), transparent 14%)',
        }}
        title={entry.name}
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{
            color: entry.kind === 'scene' ? 'var(--accent-secondary-contrast)' : 'var(--accent)',
            background: entry.kind === 'scene'
              ? 'color-mix(in srgb, var(--accent-secondary-contrast), var(--surface-0) 90%)'
              : 'color-mix(in srgb, var(--accent), var(--surface-0) 90%)',
          }}
        >
          <Icon className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-semibold">{entry.name}</span>
          <span className="mt-0.5 block text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {entry.kind === 'scene' ? _(msg`Scene`) : _(msg`Mesh`)}
            {formatRecentDate(entry.openedAt) ? ` · ${formatRecentDate(entry.openedAt)}` : ''}
          </span>
        </span>
        {active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--accent)' }} />}
      </button>
    );
  });

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[180] flex items-start justify-center overflow-y-auto px-4 pb-8 pt-[min(16vh,120px)]"
      style={{ background: 'rgba(5, 7, 14, 0.64)', backdropFilter: 'blur(7px)' }}
      data-no-window-drag="true"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        id="app-command-palette-dialog"
        ref={dialogRef}
        role="dialog"
        onKeyDown={handleDialogKeyDown}
        aria-modal="true"
        aria-label={_(msg({ message: 'Rambutan Slicer commands', comment: 'Rambutan Slicer is the product name and must remain unchanged.' }))}
        className="w-full max-w-[650px] overflow-hidden rounded-2xl border shadow-2xl"
        style={{
          borderColor: 'color-mix(in srgb, var(--accent), var(--border-subtle) 60%)',
          background: 'color-mix(in srgb, var(--surface-0), #080a11 12%)',
          boxShadow: '0 28px 100px rgba(0, 0, 0, 0.52), 0 0 0 1px color-mix(in srgb, var(--accent), transparent 92%)',
        }}
      >
        <header className="flex items-center gap-3 border-b px-5 py-4" style={{ borderColor: 'var(--border-subtle)' }}>
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            style={{ color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent), var(--surface-1) 88%)' }}
          >
            <Command className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-bold tracking-wide" style={{ color: 'var(--text-strong)' }}>
              {/* i18n-ignore: product name */}
              Rambutan Slicer
            </div>
            <div className="mt-0.5 text-[10px] uppercase tracking-[0.16em]" style={{ color: 'var(--text-muted)' }}>
              {_(msg`Command palette`)}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-white/10"
            style={{ color: 'var(--text-muted)' }}
            aria-label={_(msg`Close command palette`)}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="px-5 pt-4">
          <label
            className="flex h-12 items-center gap-3 rounded-xl border px-3.5"
            style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
          >
            <Search className="h-4 w-4 shrink-0" style={{ color: 'var(--accent)' }} />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={_(msg`Search commands and recent files...`)}
              aria-label={_(msg`Search commands and recent files`)}
              aria-keyshortcuts="ArrowDown ArrowUp Enter Escape"
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:opacity-55"
              style={{ color: 'var(--text-strong)' }}
            />
            <kbd className="rounded-md border px-1.5 py-1 text-[10px] font-medium" style={{ color: 'var(--text-muted)', borderColor: 'var(--border-subtle)' }}>
              {/* i18n-ignore: key name */}
              Esc
            </kbd>
          </label>
        </div>

        <div className="grid gap-5 px-5 pb-4 pt-5 md:grid-cols-[1fr_0.94fr]">
          <section className="min-w-0">
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: 'var(--text-muted)' }}>
                {_(msg`Commands`)}
              </h2>
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{visibleCommands.length}</span>
            </div>
            {visibleCommands.length > 0 ? (
              <div id="app-command-palette-command-list" role="menu" aria-label={_(msg`Commands`)} className="space-y-1">
                {commandRows}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed px-3 py-5 text-center text-[11px]" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
                {_(msg`No matching commands`)}
              </p>
            )}
          </section>

          <section className="min-w-0">
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: 'var(--text-muted)' }}>
                {_(msg`Recent files`)}
              </h2>
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{visibleRecentFiles.length}</span>
            </div>
            {visibleRecentFiles.length > 0 ? (
              <div id="app-command-palette-recent-list" role="menu" aria-label={_(msg`Recent files`)} className="space-y-1.5">
                {recentRows}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed px-3 py-5 text-center text-[11px]" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
                {normalizedQuery ? _(msg`No matching recent files`) : _(msg`No recent files yet`)}
              </p>
            )}
          </section>
        </div>

        {openError && (
          <div role="alert" className="mx-5 mb-3 rounded-lg border px-3 py-2 text-[11px]" style={{ color: 'var(--danger)', borderColor: 'color-mix(in srgb, var(--danger), var(--border-subtle) 58%)' }}>
            {_(msg`Could not reopen this file. Try opening it from its original location.`)}
          </div>
        )}

        <footer className="flex items-center justify-between gap-4 border-t px-5 py-3 text-[10px]" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)', background: 'color-mix(in srgb, var(--surface-1), transparent 25%)' }}>
          <span>{isOpeningRecent ? _(msg`Opening file...`) : _(msg`Navigate with arrow keys - Enter to select`)}</span>
          <span className="inline-flex items-center gap-1.5">
            {/* i18n-ignore: key name */}
            <kbd className="rounded border px-1.5 py-1 font-semibold" style={{ borderColor: 'var(--border-subtle)' }}>Ctrl</kbd>
            <kbd className="rounded border px-1.5 py-1 font-semibold" style={{ borderColor: 'var(--border-subtle)' }}>K</kbd>
            <span>{_(msg`to open`)}</span>
          </span>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
