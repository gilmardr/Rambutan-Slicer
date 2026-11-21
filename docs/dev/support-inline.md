# Support Inline

Support Inline places a series of supports between two surface points. Click
the start point on the active model, move the pointer to preview the contacts,
then click the destination to place them. Each pair is one undoable operation;
the tool remains active for another pair.

## Public module surface

`src/features/support-inline/supportInline.ts` owns the temporary start point
and the two-point interaction:

- `beginSupportInlinePair` starts a pair and captures the support-history
  before-state through Support Painting.
- `updateSupportInlinePreview` raycasts along the screen-space line, measures
  the sampled surface path in millimetres, then rebuilds the accepted preview
  at the configured interval.
- `completeSupportInlinePair` refreshes the preview at the destination and
  commits all accepted contacts as one support history action.
- `cancelSupportInlinePair` discards an unfinished pair without changing
  support data.
- `isSupportInlinePairActive` reports whether the first endpoint is waiting for
  a destination.

The scene integration in `src/components/scene/SceneCanvas/StlMesh.tsx` supplies
camera rays and uses the model's current clip or interior-view surface. The
contacts pass through the manual support placement callback, so placement
validation remains owned by the support type. `SupportPaintingOverlay` draws
the current preview.

```ts
beginSupportInlinePair(modelId, startPointer, place);
updateSupportInlinePreview(modelId, pointer, viewport, raycastAtPointer);
completeSupportInlinePair(modelId, pointer, viewport, raycastAtPointer);
```

`viewport` is the renderer size in CSS pixels and each pointer is normalized
device coordinates. `raycastAtPointer` must return a world-space intersection
on the same visible mesh throughout the path, or `null` when the line leaves
that surface. The shared support-paint settings control contact spacing, angle
filtering, and avoidance of existing contacts.

## Constraints

- Only one pair can be active. Leaving Support Inline or receiving a pointer
  cancellation discards its preview.
- Sampling follows a straight line in screen space and projects each sample to
  the visible model surface. It is camera-dependent and is not a geodesic path
  solver.
- Intermediate contacts only are placed; the two clicked endpoints are not
  added as supports.
- The manual placement callback still validates every accepted contact. The
  preview markers show filtered candidates, not complete support geometry.
- An accepted pair is one typed support-history action; do not add history for
  individual contacts.

## Related pages

- [Support Painting](support-painting.md)
- [Support Interaction](support-interaction.md)
- [Support System](support-system.md)
- [History and Undo/Redo](history-and-undo-redo.md)
