# Text and image engraving on model surfaces

The Prepare toolbar's **Engraving** mode places text or a raster image (PNG,
JPEG or WebP) on a picked point and normal of the active model. Its icon follows
**Smooth** in the tool rail. The panel offers an engraving operation
(**Difference**) and a raised relief operation (**Union**). The preview can be
rotated around its center and repositioned on the surface before confirmation;
each operation commits the printable result as one undoable scene edit.

## Public surface

- `src/features/text-labels/conformTextGeometryToSurface.ts` exports
  `conformEngravingGeometryToSurface`, which projects a centered text or image
  mesh onto a picked surface and returns the preview geometry plus its placement
  transform. Its optional `rotationDegrees` argument (default `0`) rotates the
  footprint around its center in the picked surface plane. Its optional `mode`
  argument (default `engraving`) selects inward cutter depth or outward relief
  height.
- `src/features/text-labels/createImageCutterGeometry.ts` exports
  `createImageCutterGeometry`, which turns RGBA pixels into a closed height-field
  cutter. Transparent pixels stay open and darker pixels carry more height;
  conformation maps that height inward for engraving or outward for relief.
- `src/components/scene/SceneCanvas/StlMesh.tsx` emits
  `model-surface-picked` with the model ID, world-space point and world-space
  normal when the user clicks a model in Prepare's Engraving mode.
- `buildPrepareToolRailEntries` in `src/components/controls/toolRailEntries.ts`
  selects the `engraving` transform mode, which mounts the engraving panel.
- `addModelFromGeometry` in
  `src/features/scene/useSceneCollectionManager.ts` accepts an optional
  `placementTransform`. When supplied, it places the generated model with that
  transform and on the base model's plate; the created model remains one scene
  history edit.
- `setModelGeometryRaw` in
  `src/features/scene/useSceneCollectionManager.ts` swaps transient preview
  geometry without adding history or scheduling geometry post-processing. Pass
  the preview's `transformAfter` when the geometry is reprojected; otherwise it
  preserves the preview's world placement as its bounds change. It returns the
  updated model or `null` when the ID is no longer in the scene. Use it only
  while adjusting temporary previews; committed edits use
  `replaceModelGeometry` or the relevant scene operation so history and derived
  geometry stay in sync.
- `src/components/controls/TextLabelCard.tsx` owns the text/image workflow,
  creates the preview, validates that Difference removes or Union adds material,
  and commits the operation with `commitSolidOperationResult`. While a preview
  is pending, the user can drag it across the source surface. Pointer rays are
  intersected with the source mesh, and the preview is reprojected on release.
  The angle field turns the preview around its center as the value changes; the
  zero button resets it. Leaving the field reprojects the preview onto the
  source surface before confirmation.
  The user can also pick another surface point and replace the preview there;
  the old preview is deleted only after the replacement is created successfully.

## Minimal use

For an image, build a height-field from its RGBA pixels, then conform the mesh
to a world-space surface pick:

```ts
const imageCutter = createImageCutterGeometry(imageData, widthMm, maxDepthMm);
const rotationDegrees = 30; // optional; defaults to 0
const mode = 'relief'; // optional; defaults to 'engraving'
const result = imageCutter && conformEngravingGeometryToSurface(
  imageCutter,
  model.geometry.geometry,
  model.geometry.center,
  model.transform,
  pickedPoint,
  pickedNormal,
  Math.max(widthMm, imageHeightMm),
  maxDepthMm,
  rotationDegrees,
  mode,
);
if (result) {
  scene.addModelFromGeometry(result.geometry, model.id, label, historyLabel, result.transform);
}
```

When only the temporary preview changes, install its geometry without adding a
history entry. Pass the new placement when reprojection changes it; otherwise
the scene manager adjusts its center while preserving the preview's world
position:

```ts
const updatedPreview = scene.setModelGeometryRaw(previewId, rotatedGeometry);
if (!updatedPreview) rotatedGeometry.dispose();
```

The same conforming helper accepts the centered prism from Three.js
`TextGeometry`. After the user confirms the preview, the panel converts the
source and preview with `solidMeshForModel`, calls `runSolidMeshOperation` with
`difference` for engraving or `union` for relief, and commits via
`commitSolidOperationResult` using source snapshots. Before commit, long
triangles within 0.75 mm of the preview bounds
receive up to two rounds of conforming edge subdivision, with a 1 mm edge
threshold. Existing vertices stay fixed; new points lie on the original
triangles, so this improves local triangulation without smoothing or changing
the model shape. Output normals are recalculated when the geometry is created.
The helper returns `null` when any part of the footprint cannot be projected
onto the target.

## Constraints

- The projection uses rays parallel to the picked normal. The entire operation
  footprint must be visible on the selected side of the mesh.
- A uniform triangular subdivision keeps shared edges closed before projection;
  local surface normals bend the cutter through the curved patch.
- Engraving cutters extend 0.08 mm outside the sampled surface so the Boolean
  kernel has an overlap to subtract. Relief meshes extend 0.08 mm into the
  surface so Union joins the raised geometry to the source. Text uses one depth
  or height; image darkness controls the cut depth or raised height, and alpha
  controls coverage. Images are downsampled to at most 512 pixels on their
  longest side before the preview is built.
- Images preserve aspect ratio and transparent areas stay untouched. In
  engraving mode, brighter pixels cut less deeply than darker pixels; in relief
  mode, brighter pixels rise less than darker pixels.
- `rotationDegrees` turns text or image around its center in the surface plane;
  positive angles follow the right-hand direction around the picked surface
  normal. The panel accepts angles from -180° to 180° and updates the preview
  while the numeric field changes. The exact surface projection is refreshed
  when rotation input ends and again before the Boolean is confirmed.
- The preview is a temporary Boolean operand, not a persistent surface decal.
  Engraving is refused if it removes no measurable source volume; relief is
  refused if it adds no measurable source volume. The preview stays in place so
  the user can adjust or discard it.
- Solid Operations still requires printable, closed source meshes and refuses
  models with unapplied hollowing or hole modifiers.

## Related pages

- [Model preparation](../workflows/model-preparation.md)
- [Solid operations and engraving workflow](../workflows/text-labels.md)
- [State and stores](state-and-stores.md)
- [History and undo/redo](history-and-undo-redo.md)
