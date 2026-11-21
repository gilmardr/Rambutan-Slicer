# Support Proximity Analysis

The Support Proximity panel reports support shafts whose outer surface is too
close to a visible model. It is an on-demand diagnostic and does not edit
supports or model geometry. Shafts in a current report are highlighted red in
the viewport; highlights clear when the scene, supports, or threshold makes the
report stale.

## Public surface

- `createSupportProximityInput` in
  `src/features/support-proximity/proximityScene.ts` copies readable model
  meshes and resolves support segment endpoints from the support registry.
- `SupportProximityInput`, `SupportProximityReport`, and
  `SupportProximityWorkerResponse` in
  `src/features/support-proximity/supportProximity.ts` define the worker
  message and result.
- `scanSupportProximity` in that file runs the analysis. The UI calls it from
  `supportProximity.worker.ts`, so BVH construction and point-to-surface queries
  stay off the main thread.
- `SupportProximityPanel` in `src/components/controls/SupportProximityPanel.tsx`
  owns the threshold, report lifecycle, stale-scene warning, and row selection.
- `setSupportProximityHighlightedIds`,
  `getSupportProximityHighlightedIds`, and
  `subscribeSupportProximityHighlights` in
  `src/features/support-proximity/supportProximityHighlights.ts` publish the
  current report's flagged support IDs to both the detailed and proxy renderers.

## Measurement rules

The panel checks visible models with readable geometry and excludes models
whose hollowing or hole-punch edits have not been baked into that geometry.
Support geometry models are also excluded. Support shafts use their resolved
world-space endpoints and curve controls; the scan samples each shaft at no more
than 0.5 mm intervals and subtracts half of its diameter from the nearest
sample-to-mesh distance. The displayed clearance is therefore an estimate, with
up to 0.25 mm sampling error.

For a support endpoint attached through a contact cone or disk, the scan ignores
the first or last 2.5 mm of that shaft. Those regions intentionally meet the
model. A reported clearance at or below the adjustable threshold means the
remaining shaft surface may be too close or intersect the displayed model.
Negative clearance means the sampled shaft centerline is within the model
surface by at least its radius.

The scan uses the current displayed mesh, not unbaked hollowing, holes, support
tips, or raft geometry. It works on open triangle surfaces because it measures
surface distance; it does not classify inside/outside volume. A skipped model is
shown separately and cannot support a clean-report conclusion.

## Minimal use

```ts
const input = createSupportProximityInput(models, plateFrames, supportState, 0.5, getModelMeshModifiers);
const report = scanSupportProximity(input);
for (const issue of report.issues) {
  console.log(issue.supportId, issue.clearanceMm);
}
```

The default UI threshold is 0.5 mm and accepts values from 0.1 to 3 mm. Model
buffers in the input are owned copies, so the scan does not mutate the live
scene. Highlighting is a shaft overlay in the lazy proxy renderer and a red
support color in the detailed renderer. After a model or support edit, rerun the
scan; a previous result is a point-in-time report.

The renderer-facing highlight store is read-only to subscribers. The panel sets
its snapshot from the current report; renderers subscribe and resolve the
support ID against that snapshot:

```ts
setSupportProximityHighlightedIds(report.issues.map((issue) => issue.supportId));
const highlightedIds = useSyncExternalStore(
  subscribeSupportProximityHighlights,
  getSupportProximityHighlightedIds,
  getSupportProximityHighlightedIds,
);
```

Consumers must not mutate the returned set. Clear it with
`setSupportProximityHighlightedIds([])` when the report is discarded or stale.

The panel is available in both **Analysis** and **Support**. In Support mode,
choose **Proximity** on the tool rail; its separate panel keeps the clearance
check alongside support placement and editing without mixing it into the manual
support settings.

Related: [Model Collision Analysis](model-collision.md),
[Support System](support-system.md), and
[Support Placement Workflow](../workflows/support-placement.md).
