# Model Preparation Workflow

Model preparation sets up reliable geometry and orientation before supports.

## Recommended sequence

1. Import model.
2. Inspect scale and orientation.
3. Rotate for printability and drainage strategy.
4. Apply lift/position policy to clear the build plate.
5. [Optional] Hollow the model and add hole punches for drainage.
6. Verify bounding behavior and placement.

The Prepare tool rail also has **Engraving** and **Solid Operations** icons
after **Smooth**. Select one to open its panel and activate that workflow.
These tools are available in Prepare only.

## Read the build-plate dimensions

In the top bar, click the ruler button labeled **Millimeter ruler: Off** to
show both millimeter scales on the active plate. Click it again to hide them.
The X scale is cyan and the Y scale is amber; their numbered marks advance in
10 mm steps, and the final label on each edge gives that axis's total usable
build dimension in millimeters. Shorter tick marks between the labels aid
positioning.

The scale tracks sit on the plate's outer rear and right borders. Their
measurements follow the printer's usable X and Y build dimensions, even though
the drawn plate rim extends slightly beyond that printable area. Only the
active plate shows the scales. The toggle starts off each time the workspace is
opened.

## Practical checks

- Overhang-heavy regions are accessible for support contact.
- Critical details are not aimed directly into peel-heavy failure zones.
- Model is not unintentionally intersecting the plate.
- Hollow shell thickness meets minimum print requirements.

## Multi-model notes

When multiple models are loaded:

- Confirm the intended active model before transforms.
- Re-check support ownership after model selection changes.
- Transforms and **Repair** apply to every selected model; see
  [Transform and Positioning](./transform-and-positioning.md#several-models-at-once).

## Related workflows

- [Hollowing and Hole Punch](./hollowing.md)
- [Transform and Positioning](./transform-and-positioning.md)
- [Arrange Models](./arrange-models.md)
- [Duplicate Models](./duplicate-models.md)

![Model prep placeholder](../assets/placeholders/model-preparation.png)

> Screenshot placeholder: model transform controls in use with before/after orientation.
