import React from 'react';

const REMOTE_OFFLINE_LAYER_HEIGHT_GLOBAL_STORAGE_KEY = 'dragonfruit.slicing.remoteOfflineLayerHeightMm';
const REMOTE_OFFLINE_LAYER_HEIGHT_CHANGED_EVENT = 'dragonfruit:slicing-remote-offline-layer-height-changed';

function readRemoteOfflineLayerHeightSnapshotMm(): number | null {
  if (typeof window === 'undefined') return null;

  const raw = window.localStorage.getItem(REMOTE_OFFLINE_LAYER_HEIGHT_GLOBAL_STORAGE_KEY)
    ?? window.sessionStorage.getItem(REMOTE_OFFLINE_LAYER_HEIGHT_GLOBAL_STORAGE_KEY);
  if (raw == null || raw.trim().length === 0) return null;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(0.01, Math.min(1, parsed));
}

/**
 * The layer height a networked printer last reported while it is offline, as
 * saved in browser storage, kept current when another tab or the slicing panel
 * changes it. Moved out of Home verbatim, with the storage reader and its keys.
 */
export function useRemoteOfflineLayerHeightSnapshot() {
  'use no memo';
  const [remoteOfflineLayerHeightSnapshotMm, setRemoteOfflineLayerHeightSnapshotMm] = React.useState<number | null>(() => (
    readRemoteOfflineLayerHeightSnapshotMm()
  ));

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateSnapshot = () => {
      const next = readRemoteOfflineLayerHeightSnapshotMm();
      setRemoteOfflineLayerHeightSnapshotMm((previous) => (Object.is(previous, next) ? previous : next));
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === REMOTE_OFFLINE_LAYER_HEIGHT_GLOBAL_STORAGE_KEY) updateSnapshot();
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener(REMOTE_OFFLINE_LAYER_HEIGHT_CHANGED_EVENT, updateSnapshot);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(REMOTE_OFFLINE_LAYER_HEIGHT_CHANGED_EVENT, updateSnapshot);
    };
  }, []);

  return remoteOfflineLayerHeightSnapshotMm;
}
