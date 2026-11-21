# Support Placement Workflow

DragonFruit support authoring is modifier-key aware and target-driven.

## Core placement logic

Support type is determined by:

1. Modifier keys currently held.
2. The first valid clicked target (model or support shaft).

## Recommended user workflow

1. Place foundational trunks for major overhangs.
2. Add branches to reduce extra roots and material.
3. Use braces/kickstands where lateral stability is needed.
4. Validate support angles and warnings before finalizing.

## Reuse support presets

In **Support Studio**, choose **Import** to load a DragonFruit support preset
file. The imported preset is added to the list and applied immediately. Choose
**Export** to save the active preset as a JSON file for another DragonFruit
desktop or web session.

## Copy settings between supports

Select one support and choose **Copy settings** in Support Studio. Select two
or more supports and choose **Paste to selected** to apply that support's
geometry settings to the selection. The batch is one undoable edit.

## Check support proximity

In **Analyze**, use **Support Proximity** to find shafts whose surface is within
the selected clearance of a visible model. The scan ignores the contact area at
the end of each support. Select a report row to activate its model and select
the support. Current results highlight affected shafts red in the viewport;
rerun the scan after editing the scene to refresh the highlight.

## Place supports inline

Choose **Inline** from the Support tool rail, then click the first point on the
active model, move the pointer to preview evenly spaced intermediate contacts,
and click the destination to place them. The tool settings remain in **Support
Studio**. The pair uses the same interval, angle, and existing-contact filters
as Support Painting and can be undone as a single action. The surface path
follows the straight line between the two screen positions, so rotate the model
first when a different visible surface path is needed.

The rail also opens **Paint** for dragging support contacts across a surface and
**Projection** for previewing contacts projected from a painted region. Each
tool opens Support Studio with its settings; selecting another Support panel or
canvas tool exits the current interaction mode.

## Supports below the build plate

A trunk whose contact cone or socket joint extends below Z=0 is shown as an
invalid red preview with **Cannot Place Support** feedback. An ordinary click
does not add it, with or without grid snapping. The slicer does not automatically
shorten the cone or move the support to hide the problem. Adjust the cone length
or model height until the support clears the plate. As with other invalid
placements, the existing explicit force-place override remains available.

To check this case, raise a model 5 mm, set the contact-cone length to 6 mm, and
hover beneath a near-horizontal underside. The below-plate preview must be
invalid and an ordinary click must leave the support count unchanged. Repeat
with grid mode on and off; reducing the cone length enough to clear the plate
must restore valid placement.


## Hotkey families (summary)

- **No modifier**: default trunk/root placement.
- **Alt**: branch/brace family (first-click dependent).
- **Ctrl**: kickstand family.
- **Ctrl+Alt**: leaf family (highest precedence).

For the full matrix, see [Hotkeys](../reference/hotkeys.md).

## Interaction precedence

During editing, higher-priority tools suppress lower-priority interactions:

1. Explicit gizmos (joint/knot/bezier)
2. Placement tools
3. Support hover/selection
4. Canvas/model fallback

## Tips for stable results

- Prefer cleaner trunk anchors before dense branching.
- In crowded scenes, verify the intended snapped shaft before clicking.
- Re-run a quick visual inspection after major joint edits.

## Related workflows

- [Model Preparation](./model-preparation.md)
- [Island Analysis Workflow](./island-analysis-workflow.md)
- [Raft and Export](./raft-and-export.md)

![Support placement placeholder](../assets/placeholders/support-placement-flow.png)

> Screenshot placeholder: branch placement sequence with snapped shaft target and preview.
