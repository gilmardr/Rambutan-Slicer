/** Keep only pixels within the configured physical distance from a layer outline. */
export function applySliceOnlyHollowing(
  imageData: ImageData,
  wallThicknessMm: number,
  pitchXmm: number,
  pitchYmm: number,
): void {
  const width = imageData.width;
  const height = imageData.height;
  if (
    width === 0
    || height === 0
    || !Number.isFinite(wallThicknessMm)
    || wallThicknessMm <= 0
    || !Number.isFinite(pitchXmm)
    || !Number.isFinite(pitchYmm)
    || pitchXmm <= 0
    || pitchYmm <= 0
  ) return;

  const minPitchMm = Math.min(pitchXmm, pitchYmm);
  const wallPixels = wallThicknessMm / minPitchMm;
  const scale = Math.max(1, Math.min(64, Math.floor(32767 / Math.max(1, wallPixels))));
  const xCost = Math.max(1, Math.round((pitchXmm / minPitchMm) * scale));
  const yCost = Math.max(1, Math.round((pitchYmm / minPitchMm) * scale));
  const diagonalCost = Math.round(Math.hypot(xCost, yCost));
  const threshold = Math.min(65534, Math.ceil(wallPixels * scale));
  const distances = new Uint16Array(width * height);
  const data = imageData.data;
  const maxDistance = 65535;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      const rgbaIndex = pixelIndex * 4;
      if (data[rgbaIndex] < 128) {
        distances[pixelIndex] = 0;
      } else if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
        // Match the native rasterizer: at a corner, use the closest of both
        // edge distances so anisotropic printer pixels keep the same wall.
        let boundaryDistance = maxDistance;
        if (x === 0 || x === width - 1) {
          boundaryDistance = Math.min(boundaryDistance, Math.max(1, Math.floor(xCost / 2)));
        }
        if (y === 0 || y === height - 1) {
          boundaryDistance = Math.min(boundaryDistance, Math.max(1, Math.floor(yCost / 2)));
        }
        distances[pixelIndex] = boundaryDistance;
      } else {
        distances[pixelIndex] = maxDistance;
      }
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      let best = distances[index];
      if (x > 0) best = Math.min(best, distances[index - 1] + xCost);
      if (y > 0) {
        best = Math.min(best, distances[index - width] + yCost);
        if (x > 0) best = Math.min(best, distances[index - width - 1] + diagonalCost);
        if (x + 1 < width) best = Math.min(best, distances[index - width + 1] + diagonalCost);
      }
      distances[index] = Math.min(maxDistance, best);
    }
  }

  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x;
      let best = distances[index];
      if (x + 1 < width) best = Math.min(best, distances[index + 1] + xCost);
      if (y + 1 < height) {
        best = Math.min(best, distances[index + width] + yCost);
        if (x > 0) best = Math.min(best, distances[index + width - 1] + diagonalCost);
        if (x + 1 < width) best = Math.min(best, distances[index + width + 1] + diagonalCost);
      }
      distances[index] = Math.min(maxDistance, best);
    }
  }

  for (let pixel = 0; pixel < distances.length; pixel += 1) {
    if (distances[pixel] <= threshold) continue;
    const offset = pixel * 4;
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
  }
}
