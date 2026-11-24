# VoxelDance Tango support comparison

Research captured 2026-11-17 to evaluate Tango's resin-support workflow against
the current Rambutan Slicer source.

## Evidence and limits

VoxelDance's current public feature sheet lists configurable support scripts,
manual placement and editing, support areas, no-support areas, island detection,
support scaling, automatic bracing and other support controls. Its Tango 4.0
announcement specifically describes applying different support scripts to
areas of one model and a branching tree-support script.

The product behavior below is based only on VoxelDance's public documentation.
No Tango software was inspected, and no VoxelDance code or asset is used in this
project.

## Feature comparison

| Tango support workflow | Rambutan Slicer status | Notes |
| --- | --- | --- |
| Automatic supports with editable, importable/exportable scripts | Available, different format | Rambutan Slicer's Auto-Support Presets save, duplicate, import and export run settings. Support Studio separately imports and exports manual support geometry presets. Tango script files and cloud synchronization are not supported. |
| Apply different scripts to custom areas of one model | Manual workflow available; not Tango-script compatible | Support Projection paints a model-surface patch, previews projected contacts, applies independent border and infill Support Studio profiles, and saves reusable local projection presets. Paint and apply each area separately. The official Tango 4.0 page describes this as **Powerful Manual Support**; it does not establish that its area scripts are a one-click automatic-support batch. |
| Tree supports | Available as automatic tree-like branching; no separate tree script | The auto-support generator fans leaves/branches into eligible hosts and consolidates nearby overhang pillars into chunk trees. Consolidation is bounded by geometry, collision, distance and angle checks; optimization is also exposed in Magic Prepare. This provides branching support structures, but users cannot choose Tango-style Tree as an independent script/preset, and the algorithm is different. |
| Manual support placement, editing and removal | Available | Support Painting, Inline Supports, Support Projection, selection, per-support settings, relative scaling and deletion provide corresponding workflows. |
| Mark regions that must stay support-free | Available | Support Blockers paint model-space triangles that auto-support refuses and the orientation advisor avoids. |
| Interior/exterior support scope | Available, classifier differs | Auto-Support can target combined, interior-only or exterior-only regions. The classifier and placement algorithm are Rambutan Slicer's. |
| Lowest-point reinforcement | Available, different algorithm | Auto-Support has mesh-minima reinforcement and stability anchors. These are geometric methods, not Tango's implementation. |

The closest existing workflow is already implemented in Support Projection:
paint a patch, choose its border and infill profiles, review the preview, and
apply it; then repeat on another patch with different profiles. It creates
area-specific support geometry and tags without running the island-driven auto
support generator. This matches the manual area workflow described in the Tango
4.0 overview at a workflow level, but is not algorithm or file-format parity.
See
[`support-projection.md`](../dev/support-projection.md),
[`auto-support-presets.md`](../dev/auto-support-presets.md),
[`support-painting.md`](../dev/support-painting.md) and
[`auto-supports.md`](../dev/auto-supports.md).

## Implementation decision

No new support algorithm was added in this evaluation: the core functions are
already present. Auto-support includes actual branching/fan-out and a tested
consolidation pass that turns eligible generated pillars into tree-like hosts;
this is more than a visual similarity, but is not Tango's selectable Tree
script. Support Projection already paints surface areas and applies separate
saved manual-support profiles per area, one area at a time. Batch-queuing
multiple painted areas would be a convenience improvement, not a capability
clearly missing from Tango's documented manual-area workflow.

Importing native Tango support scripts remains unsupported. The script format
is not publicly documented, and inventing a converter without a published
specification would risk silently changing support geometry. The Support Projection interface has not received a
dedicated end-to-end desktop verification and remains **experimental**.

## Feasibility of other Tango features

The Tango comparison is based on VoxelDance's public feature sheet and user
guides, cross-checked against the current Rambutan source. Tango is not
installed in the inspected Windows program locations or registered in the
uninstall inventory, so REA could not inspect its binary or live interface.
These results do not claim internal Tango behavior or file-format compatibility.

| Tango feature | Rambutan status | Feasibility and implementation boundary |
| --- | --- | --- |
| One-click 2D nesting | Available as 2.5D arrange | `src/features/scene/arrange/highPrecisionArrange.ts` and `useArrangeManager.ts` already pack parts on the plate with geometry-aware collision checks. Keep the existing workflow; improve speed or simple one-click access only if user feedback calls for it. |
| Honeycomb internal structure | No honeycomb pattern; configurable square 2D infill exists for hollow cavities | High feasibility for honeycomb infill inside hollow cavities by extending the existing layer-mask pipeline. Medium feasibility for matching Tango's one-click feature across solid parts because the public feature description does not explain its geometry operation. A full solid-part version may need a 3D interior-volume and shell pipeline rather than only replacing the current 2D cavity pattern. |
| Dedicated selectable V-support | Not a named support type; branching and fan-out trees are available | Medium-to-high feasibility. The current support graph and branch builders can carry connected structures. A V-support preset can be added over those primitives, but its shape, contact/removal behavior, collision rules, and editing/export round-trip need their own implementation and validation. It would not reproduce Tango's proprietary generator. |
| Reusable support scripts for painted regions | Partially available | Support Projection applies saved border and infill profiles to one painted area at a time. Queueing multiple painted regions and applying them together is feasible using the existing preset path. Direct import of Tango script files cannot be scoped until VoxelDance documents the format or supplies a public sample specification. |
| Adaptive layer height and per-height slicing scripts | Missing; one fixed layer height is used per slicing job | Medium-to-high effort. It changes layer-boundary generation, raster sampling, preview/indexing, layer-count estimates, and format encoders. Each printer format also needs evidence that its file structure and firmware accept variable layer heights. This is technically feasible, but should follow a printer-by-printer compatibility matrix. |
| Auto orientation by print time, support area, or safety | Available with different scoring | `orientationAdvisor.ts` ranks for support contact, height, scarring, or physical safety, and can compare layer-area profiles. This is a functional match at the objective level; scoring parity is not claimed. |
| Lowest-point support reinforcement | Available with a different algorithm | Auto-support includes mesh-minima reinforcement and stability anchors. No separate Tango-compatible settings or scripts are provided. |
| Automatic repair and hollowing/drain holes | Available with different pipelines | Rambutan has native mesh repair, shrink-wrap, hollowing, and drain-hole placement/verification. Geometry results and repair classifications are not guaranteed to match Tango. |
| Cloud synchronization of scripts/settings | Missing | Technically straightforward only after choosing and operating a sync service, account model, conflict policy, and data-retention behavior. The source app can store local profiles and backups, but this repo has no configured Rambutan cloud backend. |

The most useful distinct Tango additions to consider are **honeycomb infill for
hollow cavities**, a **selectable V-support preset**, and (after choosing
compatible printers) **adaptive layer height**. Batch application of region
presets is a workflow improvement over a core capability Rambutan already has.
Tango-script compatibility remains a separate, currently unscopable import task.

The tree-support claim is covered by `src/supports/__tests__/autoPlace.test.ts`
and `src/supports/__tests__/fanHost.test.ts`. Its placement and consolidation
are source-verified; Tango compatibility and algorithm parity are not claimed.

## Official sources

- [VoxelDance Tango feature sheet](https://voxeldance.com/mobile/tangognlb.html)
- [VoxelDance Tango 4.0 overview](https://voxeldance.com/Tango4.0)
- [VoxelDance Tango 4.0 release announcement](https://voxeldance.com/newsinfo/23062615.html)
- [Automatic support generation and script tutorial](https://voxeldance.com/mobile/3039561.html)
