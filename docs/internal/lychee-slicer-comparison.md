# Lychee Slicer Resin feature comparison

## Scope and method

Compares the current Rambutan Slicer (DragonFruit-based) source and developer
documentation with Lychee Slicer Resin's **public** feature pages, help
documentation and changelogs (see Sources). Lychee's behaviour is described only
as its public documentation describes it. No Lychee code, identifier or asset is
used in this project.

At the time of writing, the public changelog lists Lychee Slicer 8.0.5
(November 2026), which adds 35 mm and 75 mm Auto Support presets and Wi-Fi
printing for some Halot models; 8.0.4 introduced AI-powered auto-orientation and
new voxel hollowing infill types.

## Feature map

| Lychee Resin feature | DragonFruit status | Notes |
| --- | --- | --- |
| Magic Button Tool (Free) | Partial equivalent, integrated flow added | **Magic Prepare** exposes independent orientation, Light/Medium/Heavy support generation, Optimize Supports, Bracing Supports, and Raft stages. An applied rotation rescans islands before support placement. Optimization consolidates only unattached auto-generated hosts after the passes and runs in the worker when available; its changes share the support sequence's undo entry. Bracing is part of the support sequence or runs against the current support snapshot when placement is off. Raft setup enables a raft only when the current mode is off, preserving existing solid or line settings. The orientation algorithm remains a geometric proxy rather than Lychee's AI model. |
| Auto-Orientation | Available, algorithm differs | DragonFruit has a dedicated geometric auto-orientation workflow and editable no-support blockers. Lychee 8.0.5 retains the AI-powered orientation introduced in 8.0.4; DragonFruit's advisor is a geometric proxy, so this is workflow coverage rather than algorithm parity. |
| Voxel hollowing and cavity blockers | Implemented equivalent, analysis differs | DragonFruit has editable voxel hollowing, brush and lasso blockers, drain-hole tooling, lattice, double-lattice and pillar infill, plus a standalone Suction Cups tool in the Support rail. The detector highlights possible resin-trapping regions and focuses the camera without changing the mesh. Its voxel ray and spill-path analysis is an approximation; manual drain holes still need to be placed separately. Hollowing's optional pocket filling remains a distinct operation. |
| Slice-only 2D hollowing (Pro) | Implemented partial equivalent | Enable the per-model modifier to retain a configurable wall in each rasterized cross-section while leaving the 3D mesh, supports and raft unchanged. The pixel-distance wall is resolution-dependent. Configurable 2D infill density, grid spacing and grayscale intensity are available; the infill uses a square grid rather than Lychee's exact method. |
| Multi-plate workflow | Available | DragonFruit's current scene collection supports multiple plates. Older ADR text predates the implementation. |
| Grid supports | Available | Grid placement and spacing are configurable in Support Studio. |
| Auto-support | Available, experiment-gated | DragonFruit has a multi-phase generator, island analysis, merge/consolidation and automatic bracing; raft output follows the current model raft settings. Access depends on the `auto-supports` experiment. Lychee 8.0.5 adds 35 mm and 75 mm presets and defaults the support grid on for Plus subscribers; DragonFruit does not import Lychee's preset files. |
| Internal auto-support scope (Lychee 8) | Implemented, classifier differs | Generate Supports, Magic Support, and Magic Prepare can filter candidates to combined, exterior-only, or interior-only scope. The Auto Support presets include Interior Pillar: interior-only, sparse grid density, a 1.5 mm shaft/contact tip and 2 mm tip length. Classification uses five geometric rays and omits ambiguous surfaces in filtered modes; placement uses DragonFruit's existing cavity-aware pipeline rather than Lychee's native algorithm. |
| Support preset import/export (Pro) | Implemented in this work | Manual support presets now round-trip through a versioned DragonFruit JSON file in desktop and web builds. Import adds a unique custom preset and applies it; Lychee preset files and `.lys` scenes are not converted. |
| Copy support parameters to selected supports (Pro) | Implemented in this work | Copy the active editable support's geometry settings, select two or more supports, then apply the copied settings as one undoable edit. This covers DragonFruit's shared editable support profile; it does not convert Lychee-specific parameters. |
| Relative support parameter scaling (Pro) | Implemented, partial mapping | Scale Tip, Shaft, Base, or all represented support dimensions by 10–300% on each selected support, preserving each one's own starting profile and recording one undo action. The current support model does not expose Lychee's absolute-millimetre mode or separate Base Tip profile. |
| Support Painting | Implemented in this work | The tool filters downward-facing surfaces by angle, spaces placements in millimetres, skips nearby existing contacts when enabled, previews accepted points during the drag, and records a whole stroke as one undo action. |
| Inline Supports (Plus) | Implemented in this work | Support Studio now has a dedicated two-point preview: click the start and destination on the active model, then place the evenly spaced intermediate contacts as one undoable pair. The path samples the visible surface along the straight screen-space line; it is camera-dependent rather than a geodesic solver. |
| Proximity Detection (Plus) | Implemented in this work | The Support tool rail and Analysis both expose the check. It scans support shafts against readable visible model meshes in a worker, reports estimated shaft-to-surface clearance, ignores 2.5 mm next to contact endpoints, highlights flagged shafts red while the report is current, and lets the user select the support and model from each result. The default threshold is 0.5 mm and can be adjusted from 0.1–3 mm. The scan remains on-demand and clears its highlights when the result becomes stale. |
| Suction Cup Detector (Pro) | Implemented geometric equivalent | The Support tool rail scans the active model, estimates build-Z spill paths in a bounded voxel grid, lists possible pockets, highlights sampled surface points in yellow and focuses the camera when a result is shown. Results are non-destructive; the user must still add a drain hole or edit the model. Open meshes, reduced previews and sub-voxel pockets can make results uncertain. |
| 3D Drain Hole Verification (Pro/Premium) | Implemented approximate check | The Hollow panel casts each punch axis against the unpunched hollow source, reports whether the cavity wall falls within the configured depth, and marks inconclusive geometry for manual review. The ray check is not a manifold proof and may be uncertain for open shells or infill. |
| Assembly Keys | Implemented equivalent | Organic Cut provides independently positioned plugs per loop and for plane cuts, with tapered, rectangular, cylindrical or domed geometry, fit tolerance, Above/Below/Both direction selection, aim, and an offset opposite-side action. Both expands the selected plug into two opposite-direction keys at the same anchor in preview and cut. Mortise-mouth chamfer is available for the first three shapes; frustums also support an optional taper angle, while omitted values preserve the historical 50% tip. |
| Projection Supports | Implemented in this work | Brush-select a surface patch, project a world-XY pattern onto selected faces, review candidate contacts before applying, filter by face angle, choose independent border/infill intervals and Support Studio presets, select grid, concentric-ring, or random pattern, optionally add a second border row with an offset, snap nearby projected contacts onto detected unsupported islands using a configurable influence radius, apply per-zone tags, select their support groups, toggle visibility per tag, and save reusable local settings presets. Each applied projection routes through manual placement and is one undo action. Tag visibility is session-only and does not edit support data. |
| Measure and scale from two points | Implemented in this work | Lychee documents measuring two points and entering a target distance to uniformly scale the object. DragonFruit now applies that target when both points belong to the same model and that model is the only selected active model; scaling preserves its bottom and follows the existing support safeguards and undo history. |
| Community-shared resin profiles | Partial, file-based | Printer/material libraries and plugin profile packs can be installed or shared as files. There is no hosted community catalog, ratings, or account-based synchronization. |
| Cloud backup | Partial, Google Drive for desktop folder mirror | Local snapshots and history remain separate. When enabled, the app writes a second copy to a user-selected Drive for desktop folder, which that Google client uploads. There is no direct Google API/OAuth integration or remote restore browser. |
| Pre-supported model catalog | Local saved-model library only | The backup screen indexes local saved model and scene files, including scenes that may contain supports. It is not a curated online catalog and has no licensing, preview, or purchase flow. |

Lychee's documented Magic Button stages are Auto Orientation, Auto Supports,
Optimize Supports, Bracing Supports and Raft. DragonFruit's Magic Prepare exposes
each of these as a selectable stage, using its own geometric orientation and
support algorithms. Optimization targets only unattached hosts stamped as
auto-generated; it preserves hand supports and records one undoable support
change. The multi-pass path runs that optimizer in the worker when available,
then includes the result in the support sequence's undo entry. When support
generation is off, it can optimize previously generated supports in the scene.
Automatic bracing remains in the support sequence, or can be applied to the
current support snapshot as a separate undoable edit when placement is off. The
Raft stage enables a raft if its setting is off and otherwise retains the user's
current solid or line mode and configuration. Hollowing is a separate Lychee
workflow, not a Magic Button stage. Cancelling the confirmation to discard
supports after orientation cancels the remaining selected stages. The combined
operation uses scene history for rotation and support history for support edits.

The implemented Support Painting flow stages valid surface hits during a drag,
previews accepted contact points, skips points near existing contacts when the
setting is enabled, and sends them through DragonFruit's existing manual trunk
placement route on release. The Projection Supports flow selects nearby mesh
triangles with a sphere brush, samples a projected world-XY lattice, previews
contacts that meet the angle and clipping filters, and applies them through the
same manual placement route on request. Border and infill intervals thin their own projected candidates
independently. The concentric pattern erodes the sampled cell mask to emit inward
rings; it is a grid approximation rather than exact contour offsets. Projection
strokes adapt spacing on larger areas to cap one stroke at 256 candidates. Both
tools group the whole stroke into one undo action.

Projection Supports now also offers a double-border toggle and inward row offset.
The second row uses morphological depth on the projected cell mask; its spacing is
quantized to the raster grid and each border row is spaced independently. This
provides the second perimeter row described in Lychee's Projection Supports guide,
without claiming exact geometric offsets.

The Organic Cut registration choice includes a straight-sided rectangular
prism and a 32-sided cylinder. Both the preview and boolean cut use the same
shape plan, and the cut creates the matching mortise with the selected tolerance.
Frustum, rectangular and cylinder mortises can also receive a configurable
entrance chamfer; the tenon itself keeps its original dimensions.
The width field is the cylinder diameter; rectangular width keeps the existing
1.25:1 footprint ratio. Organic Cut now also has an ordered plug list per active
cut loop (and for a flat cut), with selection, add/remove, independent shape and
size, fit tolerance, chamfer size/depth, side, aim and an anchor gizmo. The preview aggregates all
enabled plugs and the cut applies them in the same order. A newly added plug starts
beside the selected plug when a placement frame is available; the user can move it
with the existing gizmo.

## Parity notes

These are equivalents, not full Lychee parity. Tag visibility now applies in both
the detailed scene renderer and the instanced proxy path. Separate border and
infill profiles apply on the standard trunk placement route; island-influenced
supports use the border profile, and alternate placement handlers keep their
existing settings.

## Sources

- [Lychee Slicer 8.0.0 changelog](https://lychee.mango3d.io/changelogs/lychee-slicer-8-0-0)
- [Lychee Slicer 8.0.4 changelog](https://lychee.co/changelogs/lychee-slicer-8-0-4)
- [Lychee Slicer 8.0.5 changelog](https://lychee.co/changelogs/lychee-slicer-8-0-5)
- [Lychee Slicer downloads and current editions](https://lychee.co/download-lychee-slicer)
- [Lychee Magic Button documentation](https://doc.mango3d.io/doc/resin-documentation/resin-prepare/magic-button/)
- [Lychee editions and feature comparison](https://lychee.mango3d.io/download-lychee-slicer)
- [Lychee current editions and feature list](https://lychee.co/pricing-and-subscription)
- [Lychee current feature definitions](https://lychee.co/lychee-slicer-features)
- [Lychee Support Tags](https://doc.mango3d.io/doc/resin-documentation/resin-layout/support-tags/)
- [Lychee support visibility options](https://support.mango3d.io/support/solutions/articles/79000150276-supports-view-options-in-lychee-slicer)
- [Lychee Resin Projection Supports](https://docs.mango3d.io/doc/resin-documentation/resin-support/projection-supports/)
- [Lychee 3D Drain Holes Verification](https://docs.mango3d.io/doc/resin-documentation/resin-holes/3d-drain-holes-verification/)
- [Lychee 3D Drain Hole Conversion](https://docs.mango3d.io/doc/resin-documentation/resin-holes/3d-drain-holes-conversion/)
- [Lychee manual supports](https://docs.mango3d.io/doc/resin-documentation/resin-support/manual-supports/)
- [Lychee 2D hollowing](https://docs.mango3d.io/doc/resin-documentation/hollow/hollowing-2d/)
- [Lychee support components and relative calculator](https://docs.mango3d.io/doc/resin-documentation/resin-support/support-components/)
- [J3D-Tech's Lychee support guide: Interior Pillar dimensions](https://docs.mango3d.io/doc/j3d-tech-s-guide-to-resin-printing/print-settings/introduction-to-supporting/)
- [Lychee tools panel and measure tool](https://docs.mango3d.io/doc/resin-documentation/resin-layout/tools-panel/)
- [Lychee Support Painting documentation](https://docs.mango3d.io/doc/filament-documentation/fdm-supports/manual-manual-supports-support-painting-inline-supports/)
- [Lychee Suction Cup Detector documentation](https://docs.mango3d.io/doc/resin-documentation/resin-holes/suction-cup-detector/)
- DragonFruit implementation references: `src/supports/autoSupport/` (including `orientationAdvisor.ts` and `supportBlockers.ts`), `src/features/hollowing/`, `src/features/scene/`, `src/supports/PlacementLogic/Grid/`, and `src/features/organicCut/`.
