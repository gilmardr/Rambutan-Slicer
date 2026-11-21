import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ENGRAVING_PREVIEW_COLORS,
  engravingPreviewColorFor,
  getEngravingPreviewHighlight,
  setEngravingPreviewHighlight,
  subscribeEngravingPreviewHighlight,
} from './engravingPreviewHighlight';

test('only the pending cutter is tinted, green when ready and red after a failure', () => {
  assert.equal(engravingPreviewColorFor(null, 'cutter'), null);
  assert.equal(engravingPreviewColorFor({ cutterId: 'cutter', status: 'ready' }, 'model'), null);
  assert.equal(engravingPreviewColorFor({ cutterId: 'cutter', status: 'ready' }, 'cutter'), ENGRAVING_PREVIEW_COLORS.ready);
  assert.equal(engravingPreviewColorFor({ cutterId: 'cutter', status: 'error' }, 'cutter'), ENGRAVING_PREVIEW_COLORS.error);
});

test('the highlight store notifies only on a real change', () => {
  let notified = 0;
  const unsubscribe = subscribeEngravingPreviewHighlight(() => { notified += 1; });
  setEngravingPreviewHighlight({ cutterId: 'a', status: 'ready' });
  setEngravingPreviewHighlight({ cutterId: 'a', status: 'ready' });
  setEngravingPreviewHighlight({ cutterId: 'a', status: 'error' });
  setEngravingPreviewHighlight(null);
  setEngravingPreviewHighlight(null);
  unsubscribe();
  assert.equal(notified, 3);
  assert.equal(getEngravingPreviewHighlight(), null);
});
