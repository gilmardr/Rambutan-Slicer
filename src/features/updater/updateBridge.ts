/**
 * Bridge for update checking, using custom Rust commands for channel-aware
 * checks (stable vs dev prerelease) and the plugin's download+install flow.
 *
 * Browser-mode calls return null gracefully.
 */

import { Channel, invoke } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UpdateInfo = {
  version: string;
  currentVersion: string;
  body: string | undefined;
  date: string | undefined;
};

export type DownloadProgress = {
  contentLength: number;
  downloaded: number;
};

export type UpdateChannel = 'stable' | 'dev';

// ---------------------------------------------------------------------------
// Tauri availability check (gets rid of errors in pure frontend mode)
// ---------------------------------------------------------------------------

function isTauriAvailable(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// ---------------------------------------------------------------------------
// Platform delivery
// ---------------------------------------------------------------------------

/**
 * Rambutan Slicer has no independent signed update feed yet. In-app updates
 * (background check, Updates settings tab) stay off unless the build sets
 * NEXT_PUBLIC_UPDATER_ENABLED=true. Next.js inlines this at build time.
 */
export const UPDATER_ENABLED = process.env.NEXT_PUBLIC_UPDATER_ENABLED === 'true';

export function updatesAreExternal(): boolean {
  return !UPDATER_ENABLED;
}

// ---------------------------------------------------------------------------
// Channel preference (persisted in app data dir via Rust)
// ---------------------------------------------------------------------------

export async function getUpdateChannel(): Promise<UpdateChannel> {
  if (!isTauriAvailable()) {
    return 'stable';
  }
  try {
    const ch = await invoke<UpdateChannel>('get_saved_update_channel');
    console.log('[updater] saved channel:', ch);
    return ch;
  } catch (err) {
    console.warn('[updater] getUpdateChannel failed, defaulting to stable:', err);
    return 'stable';
  }
}

export async function setUpdateChannel(channel: UpdateChannel): Promise<void> {
  if (!isTauriAvailable()) {
    return;
  }
  try {
    await invoke('save_update_channel', { channel });
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Check for updates (channel-aware, via Rust)
// ---------------------------------------------------------------------------

/**
 * Check for updates using the configured release channel.
 * Returns null until this build has an independent update feed.
 */
export async function fetchUpdateInfo(
  channel?: UpdateChannel,
  allowSameVersion = false,
): Promise<UpdateInfo | null> {
  if (!isTauriAvailable()) {
    return null;
  }
  if (updatesAreExternal()) {
    console.log('[updater] No independent Rambutan Slicer update feed is configured');
    return null;
  }
  console.log('[updater] fetchUpdateInfo called, channel:', channel ?? 'null (Rust default)', 'allowSameVersion:', allowSameVersion);
  try {
    const result = await invoke<{
      updateAvailable: boolean;
      version: string;
      currentVersion: string;
      body: string | null;
      date: string | null;
    } | null>('check_updates', { channel: channel ?? null, allow_same_version: allowSameVersion, allowSameVersion: allowSameVersion } as unknown as Record<string, unknown>);
    console.log('[updater] check_updates result:', result);

    if (!result?.updateAvailable) return null;

    return {
      version: result.version,
      currentVersion: result.currentVersion,
      body: result.body ?? undefined,
      date: result.date ?? undefined,
    };
  } catch (err) {
    console.error('[updater] check_updates invoke failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Download + install (via Rust — uses cached Update)
// ---------------------------------------------------------------------------

/** Progress payload pushed by the Rust `perform_update` channel. */
type PerformUpdateProgress = {
  downloadedBytes: number;
  totalBytes: number | null;
  phase: string;
};

/**
 * Download and install the previously cached update.
 * The Rust side handles signature verification, installer launch, and exit.
 *
 * Throws with the real backend message on failure — the caller shows it.
 */
export async function downloadAndInstall(
  onProgress?: (progress: DownloadProgress) => void,
): Promise<void> {
  if (!isTauriAvailable()) {
    throw new Error('Updates are only available in the desktop app.');
  }
  if (updatesAreExternal()) {
    throw new Error('In-app updates are not configured for this Rambutan Slicer build.');
  }

  // `perform_update` takes a Channel. Invoking without it fails argument
  // deserialization before the command body runs at all, so the channel is
  // what makes the call reach Rust — not just what reports progress.
  const onChunk = new Channel<PerformUpdateProgress>();
  onChunk.onmessage = ({ downloadedBytes, totalBytes, phase }) => {
    console.log(`[updater] ${phase}: ${downloadedBytes}/${totalBytes ?? '?'} bytes`);
    onProgress?.({ contentLength: totalBytes ?? 0, downloaded: downloadedBytes });
  };

  try {
    await invoke('perform_update', { onChunk });
  } catch (err) {
    console.error('[updater] perform_update failed:', err);
    throw err instanceof Error ? err : new Error(String(err));
  }

  try {
    await relaunch();
  } catch (err) {
    console.error('[updater] relaunch after install failed:', err);
    throw err instanceof Error ? err : new Error(String(err));
  }
}
