const EXPLICIT_BACKUP_KEYS = new Set([
  'support-settings',
  'support-presets-v1',
  'support-active-preset-id-v1',
  'auto-support-presets-v1',
  'auto-support-active-preset-id-v1',
  'magic-prepare-workflows-v1',
  'raft-settings',
  'mesh-appearance-settings',
  'import-defaults-v1',
  'workspace-camera-settings',
  'autoLift',
  'liftDistance',
  'ui-scale',
  'mesh-smoothing-settings',
  'app-hotkeys-config',
  'app-theme-preference',
  'app-theme-colors',
  'app-theme-preset',
  'lumenslicer:floating-panel-layout:v5',
  'app-floating-layout-persistence',
  'app-recent-opened-files',
  'app-3d-view-settings',
  'dragonfruit-profiles-v1',
  'dragonfruit-profiles-v1-backup',
  'dragonfruit-local-backups:auto-sync-enabled',
  'dragonfruit-local-backups:auto-sync-minutes',
  'dragonfruit-local-backups:client-id',
  'dragonfruit-local-backups:last-sync-at',
  'dragonfruit-local-backups:directory',
]);

export function shouldIncludeLocalStorageKeyInBackup(key: string): boolean {
  return EXPLICIT_BACKUP_KEYS.has(key)
    || key.startsWith('dragonfruit-')
    || key.startsWith('app-')
    || key.startsWith('lumenslicer:');
}
