export function computeBuildDimensionMm(resolutionPx: number, pixelSizeUm: number): number {
    const safeResolution = Math.max(1, Math.round(resolutionPx));
    const safePixelSize = Math.max(0.001, Number(pixelSizeUm) || 0.001);
    return Number(((safeResolution * safePixelSize) / 1000).toFixed(3));
}
