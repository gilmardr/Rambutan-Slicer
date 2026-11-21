# Suction Cup Detection

The suction cup detector is an on-demand, non-destructive scan in Support mode.
Use it to inspect concave air regions that need resin drainage along the build
Z axis. It reports possible regions, highlights sampled surface points and can
focus the scene camera on a selected result; it never changes the model.

## Public surface

- `src/features/suction-cups/suctionCupDetection.ts` exports
  `detectSuctionCups`, `SuctionCupFinding`, `SuctionCupReport`, and
  `SuctionCupWorkerResponse`.
- `src/features/suction-cups/suctionCupDetection.worker.ts` accepts one
  `CollisionMeshInput` and returns a transferable report or `{ error: true }`.
- `src/features/suction-cups/suctionCupHighlights.ts` exposes the current
  `SuctionCupHighlight` through `subscribeSuctionCupHighlight`,
  `getSuctionCupHighlight`, and `setSuctionCupHighlight` for scene overlays.
- `src/components/controls/toolRailEntries.ts` adds the `suction` value to
  `SupportRailMode`; `buildSupportToolRailEntries` exposes it as **Suction
  Cups** in the Support rail.
- `src/components/organisms/panels/SuctionCupDetectorPanel.tsx` owns the
  on-demand worker lifecycle and result selection.
- `src/components/scene/SuctionCupHighlightOverlay.tsx` draws the selected
  finding's world-space surface samples.
- `src/components/scene/camera/CameraFocusHotkeyController.tsx` accepts an
  optional one-shot `focusPointRequest` from analysis results.

## Minimal usage

Build an owned scene-mesh input with `createCollisionInputs`, then either call
the detector in a worker or use the panel. Transfer the geometry buffers to the
worker so the UI thread does not retain duplicate mesh copies:

```ts
const input = createCollisionInputs([activeModel], plateFrames)[0];
worker.postMessage(input, [input.positions.buffer, ...(input.indices ? [input.indices.buffer] : [])]);
```

The worker returns findings with a center, radius, estimated volume and area,
maximum spill depth, and up to 320 sampled surface points. Set the selected
finding with `setSuctionCupHighlight({ modelId, surfacePoints })` to display the
yellow overlay, then clear it with `setSuctionCupHighlight(null)`.
The panel is mounted with the other Support panels and selected by the
`SupportRailMode` value `suction`.

## Analysis and limits

The detector rasterizes the world-space mesh into a voxel grid with at most 120
cells on the longest axis and a 0.35 mm minimum cell size. It casts vertical
rays to classify solid cells, then runs a minimax flood through air cells from
the grid boundary. Air regions whose route to the outside rises by at least two
voxel layers are reported as possible suction cups. Volume, area and surface
samples are grid approximations; small features can be missed. The panel shows
the report's `voxelSizeMm` so the user can judge the spatial sampling used for
that scan; smaller voxels mean finer sampling.

Open or damaged meshes can produce unreliable ray parity. The report flags a
high ratio of odd crossing columns, and reduced-preview geometry is called out
in the UI. Review findings manually. A finding is only an overlay and camera
focus: resolving it still requires a separately placed drain hole or a model
edit.

The detector follows the world build Z axis and analyzes the geometry currently
stored on the model, including applied hollowing when that geometry is active.
Unapplied hollowing previews are not analyzed. Input geometry and modifiers are
never mutated.

## Related pages

- [Hollowing and Hole Punch Workflow](../workflows/hollowing.md)
- [Voxel Hollowing](hollowing-infill.md)
- [Camera Navigation](camera-navigation.md)
- [Model Collision Analysis](model-collision.md)
