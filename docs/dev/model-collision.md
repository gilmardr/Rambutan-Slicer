# Model collision analysis

The collision scan reports when two visible models on the same build plate touch or overlap. Use it before slicing to find model placements that may print as one solid. It does not change geometry or block slicing.

## User flow

Open **Analyze**, then **Model Collision Check**, and run **Check for collisions**. Each reported pair names the two models; selecting a row selects both models and activates the first. Run the scan again after moving, hiding, replacing, or changing a model.

The report distinguishes intersecting surfaces, one solid contained inside another, and uncertain pairs. Uncertain pairs occur when open meshes have overlapping bounds but no reliable closed-volume test is available. Bounds overlap alone is not reported as a confirmed collision.

## Analysis boundary

The scene adapter in src/features/model-collision/collisionScene.ts copies visible model geometry into plate coordinates and creates a scene key for stale-report warnings. It excludes models explicitly marked as support geometry. The scan in modelCollision.ts welds coincident STL vertices for a topology check, builds MeshBVH trees, uses a bounds test, then checks surface intersections and closed-volume containment. modelCollision.worker.ts runs the scan outside the UI thread. ModelCollisionPanel.tsx presents results and selects a reported pair.

The scan uses displayed mesh geometry. It does not inspect support structures, rafts, pending hollowing or hole modifiers, nor geometry hidden inside reduced-detail import previews. Open or reduced meshes can make a result incomplete; the panel says when those inputs were present.

## Minimal use

    const inputs = createCollisionInputs(models, plateFrames);
    const report = scanModelCollisions(inputs);
    for (const pair of report.pairs) {
      console.log(pair.modelIds, pair.kind);
    }

CollisionMeshInput owns position/index array copies and a world matrix. scanModelCollisions does not mutate them. CollisionReport.checkedModelIds names examined meshes; openModelIds, previewModelIds and skippedModelIds record coverage limits. surface-contact means triangle surfaces intersect or touch; containment means at least one point is inside the other closed mesh; uncertain means the bounds overlap but open surfaces prevent a volume conclusion.

The UI recomputes the scene key from model geometry identities and versions, transforms, visibility, plate membership, and modifier snapshots. A report is a point-in-time diagnostic, not a live lock on the scene.

## Related pages

- [Model preparation](../workflows/model-preparation.md)
- [Island detection](island-detection.md)
- [Slice job assembly](slice-job-assembly.md)
