# VoxelDance Tango support comparison

Research captured 2026-11-17 to evaluate Tango's resin-support workflow against
the current Rambutan Slicer source.

## Evidence and limits

VoxelDance's current public feature sheet lists configurable support scripts,
manual placement and editing, support areas, no-support areas, island detection,
support scaling, automatic bracing and other support controls. Its Tango 4.0
announcement specifically describes applying different support scripts to
areas of one model and a branching tree-support script.

No Tango executable appeared in the available installed-app inventory or in
the Program Files locations checked on this computer. REA therefore could not
inspect a local Tango package or observe its runtime; the product behavior below
is based on VoxelDance's public documentation, not a local reverse-engineering
capture.

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

Importing native Tango support scripts remains unsupported. Tango is not
installed on this machine, so REA could not inspect its package or the script
format; inventing a converter without format evidence would risk silently
changing support geometry. The Support Projection interface has not received a
dedicated end-to-end desktop verification and remains **experimental**.

The tree-support claim is covered by `src/supports/__tests__/autoPlace.test.ts`
and `src/supports/__tests__/fanHost.test.ts`. Its placement and consolidation
are source-verified; Tango compatibility and algorithm parity are not claimed.

## Official sources

- [VoxelDance Tango feature sheet](https://voxeldance.com/mobile/tangognlb.html)
- [VoxelDance Tango 4.0 overview](https://voxeldance.com/Tango4.0)
- [VoxelDance Tango 4.0 release announcement](https://voxeldance.com/newsinfo/23062615.html)
- [Automatic support generation and script tutorial](https://voxeldance.com/mobile/3039561.html)
