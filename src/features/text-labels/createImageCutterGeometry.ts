import * as THREE from 'three';

export type EngravingPixels = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

/** Builds a closed height-field cutter from a raster image, preserving transparency. */
export function createImageCutterGeometry(
  pixels: EngravingPixels,
  widthMm: number,
  maxDepthMm: number,
): THREE.BufferGeometry | null {
  const { data, width, height } = pixels;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || data.length !== width * height * 4 || !Number.isFinite(widthMm) || widthMm <= 0
    || !Number.isFinite(maxDepthMm) || maxDepthMm <= 0) return null;

  const active = new Uint8Array(width * height);
  const pixelDepth = new Float32Array(width * height);
  let activeCount = 0;
  const minDepthMm = Math.min(0.08, maxDepthMm * 0.2);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    const alpha = data[offset + 3] / 255;
    if (alpha <= 0.04) continue;
    const luminance = (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) / 255;
    active[pixel] = 1;
    pixelDepth[pixel] = minDepthMm + (maxDepthMm - minDepthMm) * (1 - luminance) * alpha;
    activeCount += 1;
  }
  if (activeCount === 0) return null;

  const gridWidth = width + 1;
  const gridSize = gridWidth * (height + 1);
  const top = new Uint32Array(gridSize);
  const bottom = new Uint32Array(gridSize);
  const positions: number[] = [];
  const depthAt = (row: number, column: number) => {
    let total = 0;
    let count = 0;
    for (let y = row - 1; y <= row; y += 1) {
      for (let x = column - 1; x <= column; x += 1) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const pixel = y * width + x;
        if (!active[pixel]) continue;
        total += pixelDepth[pixel];
        count += 1;
      }
    }
    return count > 0 ? total / count : minDepthMm;
  };

  for (let row = 0; row <= height; row += 1) {
    for (let column = 0; column <= width; column += 1) {
      const grid = row * gridWidth + column;
      const x = ((column / width) - 0.5) * widthMm;
      const y = (0.5 - row / height) * widthMm * (height / width);
      top[grid] = positions.length / 3;
      positions.push(x, y, maxDepthMm / 2);
      bottom[grid] = positions.length / 3;
      positions.push(x, y, maxDepthMm / 2 - depthAt(row, column));
    }
  }

  const indices: number[] = [];
  const cellActive = (row: number, column: number) => row >= 0 && row < height
    && column >= 0 && column < width && active[row * width + column] === 1;
  const addQuad = (a: number, b: number, c: number, d: number) => {
    indices.push(a, b, c, a, c, d);
  };

  // Two active pixels that touch only at a corner would share one vertex there,
  // which is not a manifold solid. Give the lower of the two cells its own copy of
  // that corner, nudged a hair toward its own centre so later welding by position
  // cannot merge it back.
  const pinchOffsetMm = Math.min(0.002, (widthMm / width) * 0.01);
  const pinchedCorners = new Map<number, { cell: number; top: number; bottom: number }>();
  for (let row = 1; row < height; row += 1) {
    for (let column = 1; column < width; column += 1) {
      const upperLeft = cellActive(row - 1, column - 1);
      const upperRight = cellActive(row - 1, column);
      const lowerLeft = cellActive(row, column - 1);
      const lowerRight = cellActive(row, column);
      let ownerColumn: number | null = null;
      if (upperLeft && lowerRight && !upperRight && !lowerLeft) ownerColumn = column;
      else if (upperRight && lowerLeft && !upperLeft && !lowerRight) ownerColumn = column - 1;
      if (ownerColumn === null) continue;

      const grid = row * gridWidth + column;
      const towardCentreX = ownerColumn === column ? pinchOffsetMm : -pinchOffsetMm;
      const sharedTop = top[grid] * 3;
      const sharedBottom = bottom[grid] * 3;
      const copyTop = positions.length / 3;
      positions.push(positions[sharedTop] + towardCentreX, positions[sharedTop + 1] - pinchOffsetMm, positions[sharedTop + 2]);
      const copyBottom = positions.length / 3;
      positions.push(positions[sharedBottom] + towardCentreX, positions[sharedBottom + 1] - pinchOffsetMm, positions[sharedBottom + 2]);
      pinchedCorners.set(grid, { cell: row * width + ownerColumn, top: copyTop, bottom: copyBottom });
    }
  }
  const cornerFor = (cell: number, grid: number) => {
    const pinched = pinchedCorners.get(grid);
    return pinched?.cell === cell ? pinched : { top: top[grid], bottom: bottom[grid] };
  };

  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      if (!cellActive(row, column)) continue;
      const cell = row * width + column;
      const tl = cornerFor(cell, row * gridWidth + column);
      const tr = cornerFor(cell, row * gridWidth + column + 1);
      const bl = cornerFor(cell, (row + 1) * gridWidth + column);
      const br = cornerFor(cell, (row + 1) * gridWidth + column + 1);

      // The image-facing side is the top of the cutter; reverse the bottom winding.
      indices.push(tl.top, bl.top, br.top);
      indices.push(tl.top, br.top, tr.top);
      indices.push(tl.bottom, br.bottom, bl.bottom);
      indices.push(tl.bottom, tr.bottom, br.bottom);

      if (!cellActive(row - 1, column)) {
        addQuad(tr.top, tr.bottom, tl.bottom, tl.top);
      }
      if (!cellActive(row, column + 1)) {
        addQuad(br.top, br.bottom, tr.bottom, tr.top);
      }
      if (!cellActive(row + 1, column)) {
        addQuad(bl.top, bl.bottom, br.bottom, br.top);
      }
      if (!cellActive(row, column - 1)) {
        addQuad(tl.top, tl.bottom, bl.bottom, bl.top);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
