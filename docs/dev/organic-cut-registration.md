# Organic Cut registration shapes

Organic Cut can add a registration tenon to a split and cut its matching mortise into
the other half. Use this when the halves need a repeatable position after printing.
The shape and fit are evaluated before the cut; the live preview and the boolean
operation use the same plan.

## Public surface

The geometry lives in `rust/dragonfruit-organic-cut/src/tenon.rs`:

- `TenonShape` selects `Frustum`, `Rectangular`, `Cylinder` or `Dome`.
- `TenonKind` reports which shape was built, or `None` when no tenon was placed.
- `build_tenon_preview_at_frame` builds the tenon and mortise preview soup and
  reports fit, reason and placement frame.
- `build_tenon_preview_at_frame_with_chamfer` uses the same plan with an optional
  mortise-mouth chamfer.
- `build_tenon_preview_at_frame_with_chamfer_and_taper` also accepts an optional
  frustum side angle, measured from vertical in degrees. `None` keeps the historical
  half-size tip; explicit values from 0° to 45° taper both axes by the same side
  inset (`depth × tan(angle)`).
- `apply_tenon_at_frame` adds the tenon to one cut half and subtracts the matching
  mortise from the other. It returns the original halves unchanged if the fit check
  or either boolean fails.
- `apply_tenon_at_frame_with_chamfer` applies the same chamfer used by the preview.
  The original functions stay available and preserve the previous no-chamfer behavior.

The UI and IPC send the lowercase shape names: `frustum`, `rectangular`, `cylinder`
and `dome`. `TenonShape::from_str_or_default` accepts those names and falls back to
`Frustum` for older or unknown values. TypeScript contracts and request serialization
are in `src/features/organicCut/types.ts` and
`src/features/organicCut/meshOrganicCut.ts`.

The cut contract also supports an ordered list of independently positioned plugs:
`OrganicCutSpec.tenon_plugs` (`tenonPlugs`) for plane cuts and
`OrganicCutSpec.loop_tenons[i].plugs` for each contour loop. Each
`LoopTenonPlugSpec` carries its own shape, dimensions, fit, anchor, side, tilt and
optional frustum taper angle.
If the list is omitted, the old single-tenon fields remain in effect. An empty list
explicitly requests no plugs. The UI keeps one legacy slot plus the extra plugs in
the active loop and sends enabled entries in list order.

The plug strip also has an opposite-side action. It duplicates the selected plug's
settings, offsets the new anchor along the active placement frame, flips which cut
half receives its tenon, and selects the new plug. Both plugs remain independently
editable and the addition is one undoable edit. If there is no placement frame yet,
the new plug uses the default centered anchor.

The side controls let each plug target `Above`, `Below`, or `Both`. In `Both` mode,
preview and cut expand that plug into two entries at the same anchor with opposite
`tenonSwapSides` values. New plugs inherit the selected plug's mode; the existing
offset opposite-side action creates a single plug on the other half. Changing the
mode is an undoable tenon-settings edit.

Each plug may also set `tenonChamferSizeMm` and `tenonChamferDepthMm`. These widen
the mortise opening and return it to the standard fit size over the requested depth.
A zero size disables the chamfer. Frustum, rectangular and cylinder plugs support
it; domes ignore it. The fit check includes the added opening width.

## Minimal preview

Given a staged `IndexedMesh` named `model` and a cut-aligned `TenonFrame` named
`frame`, request a tapered frustum preview:

```rust
use dragonfruit_mesh_core::mesh::IndexedMesh;
use dragonfruit_organic_cut::{
    build_tenon_preview_at_frame_with_chamfer_and_taper, TenonFrame, TenonShape, TenonTilt,
};

fn preview_frustum(model: &IndexedMesh, frame: TenonFrame) {
    let preview = build_tenon_preview_at_frame_with_chamfer_and_taper(
        model,
        frame,
        TenonShape::from_str_or_default("frustum"),
        false,
        TenonTilt::default(),
        3.0,  // base width in millimeters
        4.0,  // tenon depth, in millimeters
        0.0,  // rectangular edge fillet
        0.15, // clearance added around the mortise
        0.3,  // mortise-mouth chamfer size
        0.5,  // mortise-mouth chamfer depth
        Some(12.0), // frustum side angle from vertical; None keeps the legacy tip
    );

    if !preview.fits {
        eprintln!("{}", preview.detail);
    }
}
```

For a cut request, the TypeScript contract accepts independently placed frustum
plugs like this (the same object shape is used in each contour loop's `plugs` array):

```json
{
  "mode": "plane",
  "tenonPlugs": [
    {
      "tenonWidthMm": 3.0,
      "tenonDepthMm": 4.0,
      "tenonShape": "frustum",
      "tenonFilletMm": 0.0,
      "tenonToleranceMm": 0.15,
      "tenonAnchor": [12.0, 8.0, 5.0],
      "tenonSwapSides": false,
      "tenonTiltRad": 0.0,
      "tenonRollRad": 0.0,
      "tenonChamferSizeMm": 0.3,
      "tenonChamferDepthMm": 0.5,
      "tenonTaperAngleDeg": 12.0
    }
  ]
}
```

The crate's geometry API is behind the `manifold` feature. Callers must pass the
same shape, dimensions, tolerance, side swap, tilt and chamfer settings to preview
and apply; changing one of them invalidates the preview. Width is converted to a
1.25:1 rectangular footprint for frustums and rectangular prisms. For cylinders it
is the diameter. Depth is the protrusion height. The dome keeps its existing
width/depth behavior and ignores chamfer settings.

## Shape behavior

| Shape | Geometry | Fit measurement |
| --- | --- | --- |
| `Frustum` | Tapered rectangular body; defaults to the historical half-size tip and supports an optional 0°–45° side angle. | Base width and length, depth, then leaned containment. |
| `Rectangular` | Vertical rectangular walls with the same footprint ratio; supports the edge fillet. | Width and length, depth, then leaned containment. |
| `Cylinder` | 32-sided circular body; width is its diameter. | Diameter, depth, then eight cap-edge samples and center containment. |
| `Dome` | Existing oblong half-ellipsoid. | Semi-axes, bulge depth, then leaned containment. |

All shapes include a small overlap at the cut face for a reliable union. The mortise
is expanded by fit tolerance and cut from the other half. When enabled, the mouth
chamfer is unioned with that mortise before subtraction. A failed fit is surfaced to
the user and blocks the cut, so the preview cannot silently become a different size
or shape than the result.

## Boundaries and related pages

Contour loops can carry several registration plugs, and a plane cut can carry the
same list. Every plug uses its own anchor and geometry settings; `Both sides`
expands one UI plug into two backend entries with the same anchor and opposite side
settings. A failed plug is
reported without discarding other plugs or the cut. The cylinder is polygonal and
uses a fixed segment count. The edge fillet applies to the frustum and rectangular
prism. The entrance chamfer applies to frustum, rectangular and cylinder mortises.
The taper-angle control applies only to frustums; omitting it preserves the legacy
half-size tip for old callers and saved request payloads.
Plug placement and cut operations require the crate's `manifold` feature.
UI labels and accessible names go through Lingui; after changing them, run
`npm run i18n:extract` and `npm run i18n:compile`.

Related: [Organic Cut surface redesign](organic-cut-surface-redesign.md),
[Tauri IPC and native bridge](tauri-ipc-bridge.md), and
[ADR-0037](../adr/0037-cut-the-surface-not-a-volume.md).
