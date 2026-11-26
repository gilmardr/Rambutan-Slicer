import React from 'react';
import {
  EXPORT_THUMBNAIL_RENDER_OPTIONS_STORAGE_KEY,
  resolveInitialExportThumbnailRenderOptions,
  type ExportThumbnailRenderOptions,
} from '@/features/export/exportThumbnailOptions';

/**
 * The export thumbnail's render options, read from localStorage on first render
 * and written back whenever they change. Moved out of Home verbatim.
 */
export function useExportThumbnailRenderOptions() {
  'use no memo';
  const [exportThumbnailRenderOptions, setExportThumbnailRenderOptions] = React.useState<ExportThumbnailRenderOptions>(resolveInitialExportThumbnailRenderOptions);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      EXPORT_THUMBNAIL_RENDER_OPTIONS_STORAGE_KEY,
      JSON.stringify(exportThumbnailRenderOptions),
    );
  }, [exportThumbnailRenderOptions]);

  return { exportThumbnailRenderOptions, setExportThumbnailRenderOptions };
}
