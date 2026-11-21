# Support Projection

Support Projection paints a surface patch, projects a pattern onto its selected
faces, previews the resulting contact points, and adds them through the existing
manual support placement route only after the user applies the preview. It is
for quickly distributing contacts over a broad surface; complex models still
need manual or automatic supports for separate overhangs and islands.

## Public module surface

`src/features/support-projection/supportProjection.ts` owns the single active
stroke, persisted settings, surface selection, projection and history batch.
`SupportProjectionSettings` contains the brush radius, independent border and
infill intervals, maximum surface angle, border and infill toggles, a double-border
toggle with its row offset, island influence toggle and radius, and
`SupportProjectionPattern` (`grid`, `concentric`, `random`, or `contour`) plus
`symmetryAxis` (`none`, `x`, or `y`). The
contour pattern samples the projected boundary edges of the selected faces for
the outer support row, then uses the projected grid for optional infill. Island influence
snaps a nearby projected contact to a detected unsupported island contact when
it falls within the configured world-XY radius. Island contacts use the border
Support Studio preset and tag. Border and infill can each select a Support Studio preset through
`borderSupportPresetId` and `infillSupportPresetId`; `null` uses the active
Support Studio settings. `borderTag` and `infillTag` optionally label supports
created in their respective zones. Named `SupportProjectionPreset` records save
the projection settings snapshot, including preset and tag selections, in local
storage for reuse.

The scene adapter in `useSupportProjectionSceneBindings.ts` starts and paints a
stroke from mesh pointer events, and finishes it on pointer release. The
sidebar passes projected hits to the existing manual placement callback. A
caller that already owns the mesh and placement callback can use the same seam:

```ts
beginSupportProjectionStroke({ modelId, mesh, place, clipLower, clipUpper });
paintSupportProjectionSurface(modelId, localHitPoint);
finishSupportProjectionStroke();
```

The app supplies supported island-analysis results with
`setSupportProjectionIslandContacts(modelId, contacts)`. Each contact is a
world-space `{ point: { x, y, z } }`; the setter replaces the current model's
snapshot, and a stroke captures that snapshot when it begins. Call it with a
`null` model id and an empty list when the source model is cleared. Callers that
do not run island analysis can omit this input; ordinary projection continues
to work.

```ts
setSupportProjectionIslandContacts(modelId, [{ point: island.contact }]);
beginSupportProjectionStroke({ modelId, mesh, place, clipLower, clipUpper });
```

`place` accepts `(hit, settingsOverride?)`. The projection captures selected
Support Studio preset settings when a stroke begins and passes the matching
border or infill snapshot with each candidate when the preview is applied. The
scene adapter forwards that override to standard trunk placement; a custom
caller can consume the same optional argument or ignore it to keep its current
placement behavior.

The optional tags are stored as `SupportEntity.supportTags`. When one or more
supports have tags, the Support Projection panel lists each tag and its support
count; selecting a tag selects its supports through the normal multi-selection
path. The eye control beside each tag hides or shows all supports carrying it.
Visibility is a session-only view filter: it does not mutate support data or
history, and clearing a tag group removes its stale visibility entry. The
`supportTagVisibility.ts` store exposes `subscribeToSupportTagVisibility`,
`getHiddenSupportTagsSnapshot`, `setSupportTagVisible(tag, visible)`, and
`retainVisibleSupportTags(activeTags)` for the sidebar and both render paths;
`getHiddenSupportTagsServerSnapshot` supplies its stable server snapshot.
The `New` buttons generate the next unused sequential name with the
`projectionSupport` prefix and the matching zone suffix. Existing tags can be
reused from either zone's selector.

```ts
const hiddenTags = useSyncExternalStore(
  subscribeToSupportTagVisibility,
  getHiddenSupportTagsSnapshot,
  getHiddenSupportTagsServerSnapshot,
);
setSupportTagVisible(tag, false); // hide every support carrying this tag
```

`subscribeSupportProjection` and `getSupportProjectionVersion` expose state
changes to scene bindings. `getSupportProjectionTriangles` supplies the
selected face indices to the overlay, and `getSupportProjectionPreviewPoints`
supplies candidate contacts in mesh-local coordinates.
`isSupportProjectionPreviewReady` reports when the release-stage preview is
waiting for a decision. Settings are read with
`getSupportProjectionSettings`, loaded once with `loadSupportProjectionSettings`,
and persisted through `setSupportProjectionSettings`. Presets are read with
`getSupportProjectionPresets`, saved from the current settings with
`saveSupportProjectionPreset(name)`, applied with
`applySupportProjectionPreset(id)`, and removed with
`deleteSupportProjectionPreset(id)`. Saving a name that already exists updates
that preset; the catalog is local to the current app profile and is not synced.
`finishSupportProjectionStroke` calculates and stages contacts;
`applySupportProjectionPreview` adds them, while
`cancelSupportProjectionPreview` discards the staged selection.

## Constraints

- Only one projection stroke can be active at a time. Pointer up or pointer
  cancel creates a preview and does not add supports by itself. Leaving the
  tool mode discards an unapplied preview.
- Surface selection uses model-local coordinates. Projection follows world +Z
  and only accepts ray hits on selected faces within the angle and clipping
  limits.
- `concentric` uses inward rings over the projected sample grid. It gives a
  raster approximation of concentric infill, not exact polygon-offset contours.
- `contour` follows selected mesh-face boundary edges in world XY for the outer
  row. Sampling is capped at 256 candidates and raycasts back to selected faces,
  so unsupported or clipped boundary segments are omitted. It does not offset
  the polygon for the optional second border row.
- `symmetryAxis` mirrors every projected candidate across the whole model's
  world X or Y center plane. The mirrored point is raycast against
  the model and still must pass the angle and clip checks; it does not need to
  lie in the painted face selection. `none` keeps the original projection.
- `doubleBorderEnabled` adds one interior boundary row when border placement is
  enabled. `doubleBorderOffsetMm` selects the nearest inward raster row; its
  realized spacing is quantized to the projected cell grid. The outer and second
  rows are spaced independently so a small offset does not suppress the second row.
- Island influence only considers unsupported, ungrounded detected contacts in
  the active model. A contact must be within `islandInfluenceMm` of a projected
  candidate and raycast to a selected face that passes the same angle and clip
  checks. It replaces the nearest projected candidate, uses the border preset
  and tag, and does not add a second support beside that candidate.
- Large selections coarsen their sample spacing to keep a stroke within 256
  projected cells. Placement still goes through the existing manual route, so
  its collision and printer-bound checks remain authoritative.
- Projection presets store projection settings and border/infill profile ids,
  including the island influence toggle and radius.
  They do not capture a mesh selection, candidate contacts, or generated
  supports. The selected support profile is resolved at stroke start, so an
  edit made while a preview is open does not change that preview's contacts.
- Tags are attached to newly created support entities when applying the preview;
  refused placement candidates do not create tagged records. Tag selection
  selects all matching support entities, after which the existing edit and
  delete actions apply.
- Projection settings are held while a candidate preview is waiting. Apply the
  preview, or cancel it before changing settings and painting again.
- Applying a preview routes each candidate through the existing manual
  placement callback and records the result as one undo action.
- Border and infill profile overrides apply on the standard trunk placement
  route. Alternate placement handlers retain their own settings.
- The whole stroke is one typed support-history action. Do not push a second
  history item for each hit.

## Related pages

- [Support System](support-system.md)
- [Auto-Supports](auto-supports.md)
- [History and Undo/Redo](history-and-undo-redo.md)
