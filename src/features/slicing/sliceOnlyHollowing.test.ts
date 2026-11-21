import assert from 'node:assert/strict';
import test from 'node:test';
import { applySliceOnlyHollowing } from './sliceOnlyHollowing';

type TestImageData = Pick<ImageData, 'data' | 'width' | 'height'>;

function makeMask(
  width: number,
  height: number,
  contains: (x: number, y: number) => boolean,
): TestImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const value = contains(x, y) ? 255 : 0;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { data, width, height };
}

function pixel(image: TestImageData, x: number, y: number): number {
  return image.data[(y * image.width + x) * 4];
}

test('slice hollowing preserves the wall and removes the center of a filled layer', () => {
  const image = makeMask(21, 21, () => true);

  applySliceOnlyHollowing(image as ImageData, 3, 1, 1);

  assert.equal(pixel(image, 10, 10), 0);
  assert.equal(pixel(image, 1, 10), 255);
  assert.equal(pixel(image, 0, 0), 255);
});

test('each layer keeps a shell around its own cross-section outline', () => {
  const lowerLayer = makeMask(21, 21, () => true);
  const upperLayer = makeMask(21, 21, (x, y) => x >= 6 && x < 15 && y >= 6 && y < 15);

  applySliceOnlyHollowing(lowerLayer as ImageData, 2, 1, 1);
  applySliceOnlyHollowing(upperLayer as ImageData, 2, 1, 1);

  assert.equal(pixel(lowerLayer, 10, 10), 0);
  assert.equal(pixel(upperLayer, 10, 10), 0);
  assert.equal(pixel(upperLayer, 6, 10), 255);
  assert.notDeepEqual(lowerLayer.data, upperLayer.data);
});

test('invalid thickness or pixel pitch leaves the browser layer mask unchanged', () => {
  for (const [wallThicknessMm, pitchXmm, pitchYmm] of [
    [Number.NaN, 1, 1],
    [2, Number.POSITIVE_INFINITY, 1],
  ]) {
    const image = makeMask(5, 5, () => true);
    const before = image.data.slice();

    applySliceOnlyHollowing(image as ImageData, wallThicknessMm, pitchXmm, pitchYmm);

    assert.deepEqual(image.data, before);
  }
});
