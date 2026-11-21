# CHITUBOX Pro feature comparison and REA notes

Research captured 2026-11-13 to guide a DragonFruit gap assessment. The official CHITUBOX documentation identifies Pro 2.0.8 on its introduction page and says that the page is not the latest documentation. These pages describe the public Pro feature set; they do not prove how any specific installer behaves.

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

The public Pro manual groups split, auto layout, tags, Boolean operations, hollowing and hole creation under Model Processing; collision and cavity checks under Risk Detection; and geometric measurements under Analyze/Measure. The feature list should be treated as a gap inventory, not a claim that every capability is absent from DragonFruit.

## Installed artifact and REA boundary

The available installation is CHITUBOX One / all-in-one **v1.4.0**, not CHITUBOX Pro 2.0.8. Its local config reports product_name chitubox_allinone, product_id cbd_chitubox_allinone, version v1.4.0, and git tag allin-2026-10-13T10_22_33.621513-v1.4.0. uilayout.json declares operator@boolean and operator@split. config.json sets enabled_collision_detect to 1 and enabled_cavity_detection to 0. These are installed configuration/UI declarations, not proof of a successful runtime operation.

REA opened the local PE artifact C:\Program Files\CHITUBOX\librabbit_algorithm.dll using Ghidra. The artifact SHA-256 is 526a3a7b3649c2af757e0c1a05d795ffd3a287d3c3b8af126ddda86342bbbf20. REA's PE export inventory reported 2,323 exports with complete export-table coverage (Evidence ev_bfcfc7602f041ed67a5b04b7eaa82b641c38317e5e4bd417e43a613d83b65b53; parent export inventory ev_c672ef3e1e3d59755fd7df303e3777112565d926a66cc2c7c0826c9159c1756c). The export inventory establishes names and addresses only; it does not establish that an export is called by the UI or reveal its semantics. Names in other bundled resources such as CavityAbstract and collision-state fields are clues for future focused analysis, not behavioral proof.

Focused Ghidra pseudocode for this DLL does establish narrow collision-state behavior: algo::ModelAbstract::IsCollision reads a cached boolean at object offset +0x550 when the backing state exists, and otherwise returns false (Evidence ev_3b745e60d0b6c4833e4212bc856f901af9bc958aacd747892a961651981b5fbe). IsCollisionDirty reads the adjacent +0x551 flag (ev_ed71a2ea55a222e243371f4660a694cd57711c7e8a3e822ff32b33542c816e41), while SetCollisionNoDirty clears that flag (ev_7e549386af94b945b7269eb92a2a9fd2a1aa6f855b1b495f40d791dfd2847f74). SetIsCollision delegates the value to an internal helper (ev_5d49094e718ecaaa8d930288854075a3178dc53411ba310bc7d293257b9ed30e). This supports the interpretation that the model stores cached collision state with a dirty marker. It does not reveal the collision algorithm or prove that CHITUBOX Pro invokes these functions. A procedure-name search for collision, boolean and split surfaced these four state accessors only; Ghidra's retained procedure discovery coverage is unknown, so that search does not establish absence of Boolean or split implementations.

No Pro binary was present in the inspected installation, so this report does not attribute One's binary symbols or config to Pro. The installed DLL is a historical/local reference artifact; runtime behavior was not observed.

## Sources

- [CHITUBOX Pro introduction](https://docs.chitubox.com/en-US/chitubox-pro/latest/introduction)
- [CHITUBOX Pro model processing](https://docs.chitubox.com/en-US/chitubox-pro/latest/model-processing)
- [CHITUBOX Pro risk detection](https://docs.chitubox.com/en-US/chitubox-pro/latest/risk-detection)
- [CHITUBOX Pro analyze and measure](https://docs.chitubox.com/en-US/chitubox-pro/latest/analyze-and-measure)
- [CHITUBOX Pro printer configuration](https://docs.chitubox.com/en-US/chitubox-pro/latest/printer-management/printer-configuration)
