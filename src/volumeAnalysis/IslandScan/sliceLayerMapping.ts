/** Map a 0-based scan layer to the 0-based print layer used at the same Z. */
export function getSlicerLayerIndex(scanLayerIndex: number, scanMinZMm: number, layerHeightMm: number): number {
  const localLayer = Number.isFinite(scanLayerIndex) ? Math.max(0, Math.trunc(scanLayerIndex)) : 0;
  if (!Number.isFinite(scanMinZMm) || !Number.isFinite(layerHeightMm) || layerHeightMm <= 0) return localLayer;

  const firstPrintLayer = Math.ceil(scanMinZMm / layerHeightMm - 1e-7);
  return Math.max(0, firstPrintLayer + localLayer);
}

/** Convert a scan-local layer to the one-based selection used by the slice preview. */
export function getSlicePreviewLayerNumber(scanLayerIndex: number, scanMinZMm: number, layerHeightMm: number): number {
  return getSlicerLayerIndex(scanLayerIndex, scanMinZMm, layerHeightMm) + 1;
}
