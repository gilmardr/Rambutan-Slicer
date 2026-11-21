# Drain Hole Verification

The hole punching panel can check whether each placed punch reaches the cavity
of the current hollowed source mesh. Use this when changing the check, its ray
geometry, or its panel integration.

## Public surface

- `src/features/hole-punching/holePunchVerification.ts` exports
  `verifyHolePunchPlacements` and its result/status types.
- `src/features/hole-punching/useHolePunchManager.ts` selects the unpunched
  hollow geometry and runs the check for the active model's placements.
- `src/features/hole-punching/HolePunchPanel.tsx` presents the per-hole result.

The checker casts a ray along each hole axis. It reports a connection when it
finds four distinct shell surfaces through a cavity and the second surface is
within the punch depth. It reports insufficient depth when a hollow path exists
but that wall lies past the requested depth. Other geometries are reported as
uncertain.

```ts
const results = verifyHolePunchPlacements(
  hollowSourceGeometry,
  model.geometry.center,
  model.transform,
  placements,
);
```

## Constraints

- Pass the hollowed source mesh **before** the punches being checked. When
  punches are baked, the manager restores the saved pre-punch position snapshot;
  otherwise it uses the active hollow geometry or preview.
- Results are geometric estimates, not a manifold or resin-flow proof. Open
  faces, self-intersections, sharp curvature, or internal infill can produce an
  uncertain result and require visual review.
- The check is on demand. Placement, geometry, or transform changes clear the
  prior report so it cannot be mistaken for a current result.

## Related pages

- [Hollowing and Hole Punch Workflow](../workflows/hollowing.md)
- [Voxel Hollowing](hollowing-infill.md)
- [Tauri IPC and Native Bridge](tauri-ipc-bridge.md)
