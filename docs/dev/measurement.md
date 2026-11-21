# Distance measurement

The Analyze panel's measurement tool measures between two picked surface points,
from a picked point to a plane, or between two parallel planes. Use it when a
dimension is easier to read from the model than from its overall bounds.

## Public surface

- `distanceMeasurementStore.ts` owns the active mode, picked world-space points,
  and click sequence. `startDistanceMeasurement(mode)` starts a fresh sequence;
  `setDistanceMeasurementMode(mode)` selects a mode and clears the current picks.
- `distanceMeasurementMath.ts` exports `DistanceMeasurementMode`,
  `calculateMeasurement(mode, points)`, and the result segment used by both the
  panel and scene overlay.
- `DistanceMeasurementCard.tsx` selects modes and shows the current result.
- `DistanceMeasurementOverlay.tsx` draws picks, the defined plane triangles,
  the perpendicular segment, and its distance label.

```ts
const result = calculateMeasurement('point-to-plane', [
  { modelId: 'part', position: [1, 2, 4] },
  { modelId: 'part', position: [0, 0, 0] },
  { modelId: 'part', position: [1, 0, 0] },
  { modelId: 'part', position: [0, 1, 0] },
]);
// result.distance === 4; result.segment joins the point to its projection.
```

## Constraints

- Points are captured in scene coordinates from mesh surface clicks. The
  point-to-plane mode takes one point followed by three points on a plane.
- Parallel-plane mode takes three points for each plane. Degenerate triples are
  rejected. Plane normals must be within one degree of parallel; otherwise the
  result is `null`. This tolerance accommodates click placement, so the reported
  separation is an approximation when the picked planes differ slightly.
- After a complete measurement, the next click starts another sequence in the
  same mode. Selecting another mode clears the picks.
- Point-to-plane and parallel-plane scene interaction are marked experimental
  until verified through a complete desktop model workflow.
- Only point-to-point measurements can scale a model to a target distance.

## Related pages

- [Model preparation](../workflows/model-preparation.md)
- [Model collision analysis](model-collision.md)
- [State and stores](state-and-stores.md)
