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

  const stride = width + 2;
  const alpha = new Uint8Array(stride * (height + 2));
  const depth = new Float32Array(alpha.length);
  const minDepthMm = Math.min(0.08, maxDepthMm * 0.2);
  let peakAlpha = 0;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const offset = (row * width + column) * 4;
      const sample = (row + 1) * stride + column + 1;
      const coverage = data[offset + 3];
      alpha[sample] = coverage;
      peakAlpha = Math.max(peakAlpha, coverage);
      const luminance = (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) / 255;
      depth[sample] = minDepthMm + (maxDepthMm - minDepthMm) * (1 - luminance) * coverage / 255;
    }
  }
  if (peakAlpha <= 10) return null;

  // Half coverage traces antialiased silhouettes without extruding their fringe.
  // A half-integer threshold keeps crossings strictly inside grid edges.
  const threshold = Math.min(127.5, Math.max(10.5, Math.floor(peakAlpha / 2) + 0.5));
  const pitch = widthMm / width;
  const positions: number[] = [];
  const indices: number[] = [];
  const sampleVertices = new Int32Array(alpha.length).fill(-1);
  const crossings = new Map<number, number>();
  const inside = (sample: number) => alpha[sample] > threshold;

  function vertex(a: number, b: number, t: number, depthMm: number): number {
    const x = (a % stride + (b % stride - a % stride) * t - 0.5 - width / 2) * pitch;
    const rowA = Math.floor(a / stride);
    const rowB = Math.floor(b / stride);
    const y = (height / 2 + 0.5 - rowA - (rowB - rowA) * t) * pitch;
    const top = positions.length / 3;
    positions.push(x, y, maxDepthMm / 2, x, y, maxDepthMm / 2 - depthMm);
    return top;
  }

  function sampleVertex(sample: number): number {
    if (sampleVertices[sample] < 0) {
      sampleVertices[sample] = vertex(sample, sample, 0, depth[sample]);
    }
    return sampleVertices[sample];
  }

  function crossing(a: number, b: number): number {
    const key = Math.min(a, b) * alpha.length + Math.max(a, b);
    const existing = crossings.get(key);
    if (existing !== undefined) return existing;
    const t = (threshold - alpha[a]) / (alpha[b] - alpha[a]);
    const top = vertex(a, b, t, depth[inside(a) ? a : b]);
    crossings.set(key, top);
    return top;
  }

  function addFace(a: number, b: number, c: number): void {
    indices.push(a, b, c, a + 1, c + 1, b + 1);
  }

  function clipTriangle(a: number, b: number, c: number): void {
    const count = Number(inside(a)) + Number(inside(b)) + Number(inside(c));
    if (count === 0) return;
    if (count === 3) {
      addFace(sampleVertex(a), sampleVertex(b), sampleVertex(c));
      return;
    }

    const polygon: number[] = [];
    let enter = -1;
    let exit = -1;
    for (const [from, to] of [[a, b], [b, c], [c, a]]) {
      if (inside(from)) polygon.push(sampleVertex(from));
      if (inside(from) === inside(to)) continue;
      const top = crossing(from, to);
      polygon.push(top);
      if (inside(from)) exit = top;
      else enter = top;
    }
    addFace(polygon[0], polygon[1], polygon[2]);
    if (polygon.length === 4) addFace(polygon[0], polygon[2], polygon[3]);
    indices.push(enter, exit, exit + 1, enter, exit + 1, enter + 1);
  }

  for (let row = 0; row <= height; row += 1) {
    for (let column = 0; column <= width; column += 1) {
      const tl = row * stride + column;
      const tr = tl + 1;
      const bl = tl + stride;
      const br = bl + 1;
      // In ambiguous checkerboards, split along the transparent diagonal so
      // corner-touching details stay separate closed solids.
      if (inside(tl) && inside(br) && !inside(tr) && !inside(bl)) {
        clipTriangle(tl, bl, tr);
        clipTriangle(bl, br, tr);
      } else {
        clipTriangle(tl, bl, br);
        clipTriangle(tl, br, tr);
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
