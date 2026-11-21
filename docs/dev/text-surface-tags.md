# Text and image engraving on model surfaces

The Prepare toolbar's **Engraving** mode creates a cutter that follows a picked
point and normal on the active model. Its icon follows **Smooth** in the tool
rail. It supports text and raster images (PNG, JPEG and WebP). The panel and its
surface-pick listener are mounted only while this mode is selected. The cutter
first appears as a preview; confirmation runs **Difference** in the same panel
and commits the printable result as one undoable scene edit.

## Public surface

- `src/features/text-labels/conformTextGeometryToSurface.ts` exports
  `conformEngravingGeometryToSurface`, which projects a centered engraving mesh onto
  a picked surface and returns the cutter geometry plus its placement transform.
- `src/features/text-labels/createImageCutterGeometry.ts` exports
  `createImageCutterGeometry`, which turns RGBA pixels into a closed height-field
  cutter. Transparent pixels stay open and darker pixels extend farther into
  the source mesh.
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
- `src/components/controls/TextLabelCard.tsx` owns the text/image workflow,
  creates the preview, validates that Difference removes material, and commits
  the operation with `commitSolidOperationResult`. While a preview is pending,
the user can drag the cutter across the source surface. Pointer rays are
intersected with the source mesh, and the preview is reprojected on release.
The user can also pick another surface point and replace the preview there; the
old cutter is deleted only after the replacement was created successfully.

## Minimal use

For an image, build a height-field from its RGBA pixels, then conform the mesh
to a world-space surface pick:

```ts
const imageCutter = createImageCutterGeometry(imageData, widthMm, maxDepthMm);
const result = imageCutter && conformEngravingGeometryToSurface(
  imageCutter,
  model.geometry.geometry,
  model.geometry.center,
  model.transform,
  pickedPoint,
  pickedNormal,
  Math.max(widthMm, imageHeightMm),
  maxDepthMm,
);
if (result) {
  scene.addModelFromGeometry(result.geometry, model.id, label, historyLabel, result.transform);
}
```

The same conforming helper accepts the centered prism from Three.js
`TextGeometry`. After the user confirms the preview, the panel converts the
source and cutter with `solidMeshForModel`, calls `runSolidMeshOperation` with
`difference`, and commits via `commitSolidOperationResult` using source
snapshots. Before commit, long triangles within 0.75 mm of the cutter bounds
receive up to two rounds of conforming edge subdivision, with a 1 mm edge
threshold. Existing vertices stay fixed; new points lie on the original
triangles, so this improves local triangulation without smoothing or changing
the model shape. Output normals are recalculated when the geometry is created.
The helper returns `null` when any part of the footprint cannot be projected
onto the target.

## Constraints

- The projection uses rays parallel to the picked normal. The entire engraving
  footprint must be visible on the selected side of the mesh.
- A uniform triangular subdivision keeps shared edges closed before projection;
  local surface normals bend the cutter through the curved patch.
- The cutter extends 0.08 mm outside the sampled surface so the Boolean kernel
  has an overlap to subtract. Text uses one depth; image darkness controls depth
  and alpha controls coverage. Images are downsampled to at most 512 pixels on
  their longest side before the cutter is built.
- Image engraving preserves aspect ratio. Transparent areas are not cut; an
  opaque image engraves its full rectangular area, with brighter pixels cut less
  deeply than darker pixels.
- A cutter is a temporary Boolean preview, not a persistent surface decal. The
  panel refuses a result that removes no measurable source volume and leaves
  the preview in place so the user can adjust or discard it.
- Solid Operations still requires printable, closed source meshes and refuses
  models with unapplied hollowing or hole modifiers.

## Related pages

- [Model preparation](../workflows/model-preparation.md)
- [Solid operations and engraving workflow](../workflows/text-labels.md)
- [State and stores](state-and-stores.md)
- [History and undo/redo](history-and-undo-redo.md)
