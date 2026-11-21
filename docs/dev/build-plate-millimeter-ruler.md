# Build-Plate Millimeter Ruler

The ruler provides a visual coordinate reference for placing and inspecting
models against the printer's usable build volume. It draws X and Y measurement
tracks along the visible plate rim, with the printable dimensions preserved in
the numeric scale.

## When to use it

Use this feature when working on scene placement, printer build-volume geometry,
or the controls that show and hide scene helpers. The user-facing instructions
are in [Model Preparation](../workflows/model-preparation.md#read-the-build-plate-dimensions).

## Files and flow

- `src/app/page.tsx` owns `millimeterRulerVisible`, which defaults to `false`.
- `src/components/layout/TopBar.tsx` exposes one toggle with the accessible
  states `Millimeter ruler: On` and `Millimeter ruler: Off`. One toggle controls
  both axes.
- `src/components/scene/SceneCanvas/SceneCanvas.tsx` passes the visibility
  through to the scene helpers and hides it during thumbnail capture.
- `src/components/scene/SceneCanvas/SceneEnvironment.tsx` passes the active
  plate's X/Y build dimensions into the private `MillimeterRuler` renderer.

Minimal wiring follows the existing app state:

```tsx
<TopBar
  millimeterRulerVisible={millimeterRulerVisible}
  onMillimeterRulerVisibleChange={setMillimeterRulerVisible}
/>
<SceneCanvas showMillimeterRuler={millimeterRulerVisible} />
```

## Drawing and dimensions

`MillimeterRuler` receives the usable `widthMm` and `depthMm`, the plate's
`edgeOffsetMm`, and the scene-space plate `position`. X labels use cyan and Y
labels use amber. The tick geometry draws a small mark per millimeter, a longer
mark every 5 mm, and the longest marks every 10 mm. Canvas textures label 0 and
each 10 mm position; the far end is labeled with the exact usable dimension and
the locale-formatted `mm` unit.

The visible plate is deliberately oversized by 3 mm per side. `edgeOffsetMm`
places the ruler tracks on that outer rim, while tick positions and endpoint
labels continue to span only the printer's usable build volume. The numeric
labels sit just inside the rim so they remain on the plate. This distinction
keeps the displayed total useful for print placement without treating the
decorative rim as printable area.

The ruler renders only when it is enabled, the plate is active, and the build
plate is visible with non-zero opacity. Visibility is local UI state, not part
of a saved scene or printer profile, and defaults off when the app page mounts.

## Constraints

- The UI has one visibility control for both X and Y; there are no independent
  axis switches.
- Dimensions come from the active printer build-volume settings, not the loaded
  model's bounding box.
- Keep the label text locale-formatted through `useLocaleFormat()`; do not add
  bare unit strings or `toFixed` display values.
- Preserve geometry and texture disposal when their dimensions or locale
  change.

## Related pages

- [Model Preparation](../workflows/model-preparation.md#read-the-build-plate-dimensions)
- [Camera Navigation](camera-navigation.md)
- [Localization](localization.md)
