# Support Painting

Support Painting adds contact points while dragging over a model surface. It
filters by surface angle and spacing, can skip points near existing support
contacts, previews accepted points during the drag, and commits the full stroke
as one undo action.

## Public module surface

`src/features/support-paint/supportPainting.ts` owns settings, the active stroke,
accepted hit points, existing-contact filtering, preview subscriptions, and the
history batch. `SupportPaintingSettings` contains `intervalMm`, `maxAngleDeg`,
and `avoidExistingEnabled`. The interval controls both spacing along a stroke
and the radius used to skip nearby existing contacts.

The scene adapter in `useSupportPaintingSceneBindings.ts` finishes an active
paint stroke on pointer release or when leaving the tool; it discards an inline
pair when leaving that tool or changing the active model. `StlMesh` records valid
surface hits and `SupportPaintingOverlay` draws the accepted contact markers in
mesh-local coordinates while the stroke is active.

Inline Supports uses the same preview, filters, placement callback, and history
batch. Its two-point interaction is owned by
`src/features/support-inline/supportInline.ts`; see
[Support Inline](support-inline.md) for that contract.

```ts
beginSupportPaintingStroke(modelId);
recordSupportPaintingHit(modelId, hit, place);
finishSupportPaintingStroke();
```

`subscribeSupportPainting` and `getSupportPaintingVersion` let renderers observe
preview changes. `getSupportPaintingPreviewPoints(modelId)` returns the current
stroke's read-only local points; consumers must not mutate them. Settings are
loaded once with `loadSupportPaintingSettings` and persisted by
`setSupportPaintingSettings`.

## Constraints

- Only one stroke can be active at a time. Finish it on pointer up, pointer
  cancel, or when leaving Support Painting mode.
- Contacts within `intervalMm` of an existing contact on the same model are
  skipped when `avoidExistingEnabled` is on. The scene placement callback still
  owns collision, bounds, and support-type validation.
- Preview markers represent accepted contact candidates, not a complete support
  geometry preview. Placement is committed on release.
- The whole stroke is one typed support-history action; do not add history for
  individual contacts.

## Related pages

- [Support Projection](support-projection.md)
- [Support Inline](support-inline.md)
- [Support System](support-system.md)
- [History and Undo/Redo](history-and-undo-redo.md)
