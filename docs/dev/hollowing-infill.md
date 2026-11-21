# Voxel Hollowing

The voxel hollowing contract selects internal support geometry and optional
pocket filling. Use it when changing hollow mesh generation, persisted
hollowing modifiers, or the UI for infill and pocket detection.

## Public surface

- `src/utils/meshHollowing.ts`: `InfillMode` and `HollowOptions` form the
  TypeScript request sent through the Tauri bridge.
- `src/features/mesh-modifiers/types.ts`:
  `MeshModifierInfillMode` and `ModelHollowingModifier` are the persisted scene
  modifier values, including the optional `detectResinTraps` and
  `detectInteriorSuctionCups` flags.
- `rust/dragonfruit-mesh-repair/src/hollowing.rs`: the public serde enum
  `InfillMode` and `HollowOptions` define the native representation. Serde
  encodes the variants in snake case and the options in camel case.
- `src/features/hollowing/HollowingPanel.tsx` selects the active infill pattern
  and pocket-filling options.

The internal `build_smooth_infill_mesh` function in the Rust module builds the
beams before the cavity mesh is merged.

## Patterns

| Value | Geometry |
| --- | --- |
| `lattice` | Four diagonal beam families sampled inside the carved cavity. |
| `double_lattice` | The same beam families plus a second pass shifted by half a cell along both transverse lattice axes. |
| `pillar` | Vertical columns aligned to the configured scene rotation. |

The Double Lattice implementation is DragonFruit's geometric equivalent. The
installed Lychee UI declares `lattice2x`, but its geometry is delegated to a
native addon that was not recovered; the two implementations are not claimed
to be algorithm-identical.

## Minimal Rust usage

```rust
use dragonfruit_mesh_repair::hollowing::{HollowMode, HollowOptions, InfillMode};

let options = HollowOptions {
    mode: HollowMode::Infill,
    infill_mode: InfillMode::DoubleLattice,
    ..HollowOptions::default()
};
```

The UI maps its infill density control to `infill_cell_mm`; smaller spacing
increases the number of beams. `infill_beam_radius_mm` controls beam thickness.
The preview and apply paths receive the same `HollowOptions` value.

## Pocket detection

`HollowOptions.detect_resin_traps` fills cavity voxels whose path to an exterior
opening must rise above their current height. `detect_interior_suction_cups`
runs the same spill-path check from the opposite Z direction. Both options use
`pocket_detection_vents` as simulated vent corridors; these do not cut the
output mesh. The desktop adapter builds those corridors from the active model's
manual hole punches. Existing openings already present in the source mesh also
participate in the voxel flood.

```rust
let options = HollowOptions {
    detect_resin_traps: true,
    detect_interior_suction_cups: true,
    pocket_detection_vents: vec![vent],
    ..HollowOptions::default()
};
```

The flood uses the voxel grid's Z axis as the build direction and fills only
removed source-material voxels connected to an outside opening. A sealed cavity
with no drain path is left unchanged. This is a geometric approximation of
Lychee's native detector; its thresholds and native implementation were not
recovered. Pocket options default to `false` so older scenes keep their prior
geometry until the user enables detection.

## Compatibility constraints

- Keep the serialized values `lattice`, `double_lattice` and `pillar` stable.
- Missing `infillMode` values in older scenes continue to default to `lattice`.
- Pillars use the rotation-aligned voxel grid; lattice beam directions use that
  same mesh-local grid and are transformed back with the rest of the output.
- Add new variants to both the TypeScript scene type and native Rust enum so
  scene persistence and IPC cannot disagree.
- Keep pocket detection off for shell-open-face mode. Hole punch placements
  passed as pocket vents are analysis inputs only; `drain_holes` remains the
  native operation that actually carves a hole.

## Related pages

- [Voxel Hollowing Architecture](../adr/0029-voxel-hollowing-architecture.md)
- [Hollowing and Hole Punch Workflow](../workflows/hollowing.md)
- [Tauri IPC and Native Bridge](tauri-ipc-bridge.md)
- [Data Storage](data-storage.md)
