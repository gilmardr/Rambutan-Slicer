# CHITUBOX Pro feature comparison

Research captured 2026-11-13 to guide a gap assessment of Rambutan Slicer (DragonFruit-based). It relies on CHITUBOX's public documentation (see Sources). No CHITUBOX code or asset is used in this project. The official CHITUBOX documentation identifies Pro 2.0.8 on its introduction page and says that the page is not the latest documentation. These pages describe the public Pro feature set; they do not prove how any specific installer behaves.

## Comparison

| CHITUBOX Pro capability | DragonFruit status in this worktree | Evidence or remaining gap |
| --- | --- | --- |
| Automatic model layout | Existing | Standard and high-precision placement, selected/all models and plate anchors are in docs/workflows/arrange-models.md. |
| Automatic orientation | Existing | The first optimization stages are implemented; drainage work remains planned in docs/dev/auto-orientation.md. |
| Hollowing and drain holes | Existing | Voxel hollowing, infill, open face and hole punching are described in docs/workflows/hollowing.md. |
| Boolean union, difference and intersection | Implemented in this worktree | New Solid Operations panel operates on selected printable solids. |
| Split model | Partial | Existing 3MF-body and drawn-cut splitting remains; this work adds disconnected-solid splitting for closed meshes. |
| Model collision detection | Implemented in this worktree | New Analyze panel checks surface intersections and closed-solid containment, with explicit uncertain cases. |
| Point and plane measurement | Point-to-point available; other modes experimental | `DistanceMeasurementCard` and `DistanceMeasurementOverlay` provide point-to-point, point-to-plane, and parallel-plane measurements. Math and store tests cover valid and degenerate plane cases. Point-to-plane and parallel-plane scene picking have not been verified end-to-end in the desktop app; these modes are labeled experimental. |
| Scale compensation | Implemented in this worktree | Material percentages now scale each model and its associated supports/raft during mesh preparation, preserve the plate contact height, and are recorded in the slice manifest and LUMEN metadata. |
| Inner/outer tolerance compensation per layer | Partial equivalent implemented in this worktree | Material profiles now carry signed inner/outer diameter adjustments with optional bottom-layer overrides. Native slicing offsets enclosed holes and exterior contours per layer using a pixel-grid chamfer approximation; exact CHITUBOX topology/units parity has not been established. |
| Text tags and Boolean editing tools | Partial, experimental in this worktree | The Prepare panel creates a separate extruded text mesh that can be positioned and combined with the existing Union/Difference operations. Text does not conform to curved faces, and raster/image tags, font styling, and automatic engraving placement are not included. |
| Cavity risk detection | Partial | Hollowing now exposes automatic resin-trap and interior-suction-cup detection/fill using a build-axis flood approximation; it does not reproduce CHITUBOX's classifier. |
| Edit pixels and remove islands after slicing | Implemented for plain CTB V2–V5 | Printing preview edits pixels on one layer and can scan the entire file for islands, then remove them and save. The cleanup works from the first layer upward. Encrypted CTB needs separate editing support. |
| Multi-parameter CTB slicing | Model intensity and layer exposure | Model grayscale is saved in the VOXL project and composed per object. Rules by height or area specify the shared exposure time of a normal layer. The current CHITUBOX documentation also describes model grayscale as the alternative to individual exposure times. |
| ChituAction automation | Partial equivalent | Magic Prepare adds optional arrangement, VOXL project save and active-plate print export. On desktop the user selects both destinations before preparation. Automatic support preparation remains single-model. |

The public Pro manual groups split, auto layout, tags, Boolean operations, hollowing and hole creation under Model Processing; collision and cavity checks under Risk Detection; and geometric measurements under Analyze/Measure. The feature list should be treated as a gap inventory, not a claim that every capability is absent from DragonFruit.

## Sources

- [CHITUBOX Pro introduction](https://docs.chitubox.com/en-US/chitubox-pro/latest/introduction)
- [CHITUBOX Pro model processing](https://docs.chitubox.com/en-US/chitubox-pro/latest/model-processing)
- [CHITUBOX Pro risk detection](https://docs.chitubox.com/en-US/chitubox-pro/latest/risk-detection)
- [CHITUBOX Pro analyze and measure](https://docs.chitubox.com/en-US/chitubox-pro/latest/analyze-and-measure)
- [CHITUBOX Pro printer configuration](https://docs.chitubox.com/en-US/chitubox-pro/latest/printer-management/printer-configuration)
- [CHITUBOX slicing modes](https://docs.chitubox.com/en-US/chitubox/latest/export)
- [ChituAction](https://docs.chitubox.com/en-US/chitubox-pro/latest/chitu-action)
