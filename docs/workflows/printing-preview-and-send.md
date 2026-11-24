# Printing Preview and Send Workflow

Use Printing mode to inspect generated slice layers and export/send the final print artifact.

## 1) Enter Printing mode

Printing mode is available when printing workspace data exists.

If scene changes invalidate the current slice, DragonFruit can require re-slicing before continuing.

## 2) Scrub layers

Use the vertical layer slider to inspect layers:

- drag upper (and optional lower) thumb
- wheel to nudge layers
- Shift for fine movement during drag
- optionally toggle cross-section rendering mode (`smooth`/`rasterized`)

During scrubbing, DragonFruit can use fast preview rendering paths to keep interaction responsive.
After slicing completes, the app opens Printing mode with the first layer selected. Layer
images are smoothed for on-screen readability; this display filtering does not change the
printer-resolution pixels stored in the exported artifact.

For plain CTB V2–V5 files, use **Edit layer pixels** to paint or erase pixels on the selected
layer, or remove unsupported islands from it. Apply the edit to save the layer.
To review the whole file, choose **Scan all layers**. The result gives the island count,
affected layers and the first layer with an island. **Remove all islands and save** applies
the reported cleanup to the file. The scan starts above the first layer and checks each
connected region against the corrected layer directly below it. Review thin details before
printing, since removing an island also affects regions that depended on it. The saved
CTB is replaced after all affected layers are written. Encrypted CTB files require separate support.

For CTB output, open **CTB multi-parameter slicing**. **Grayscale by model (%)** adjusts
each model's pixels from 1% to 100% before the printer profile's grayscale processing.
This applies to the model geometry, including its 2D infill, across all layers.
Supports and rafts use the standard intensity. Where geometry overlaps, the brighter
pixel wins. The per-model settings travel with the VOXL project.
Add rules by height in millimeters or illuminated cross-section area in square
millimeters to change the exposure time shared by the entire physical layer.
Rules apply after the bottom and transition layers, with the last matching rule
taking precedence. These rules are saved locally for the selected printer and resin.

## 3) Review print summary

In the Printing panel, confirm:

- printer profile
- resin profile
- estimated print time
- estimated volume
- generated file name/format/size

## 4) Export or send

Available actions depend on slice intent and connected integrations:

- **Export as file**
- **Send to printer** (with optional target picker)
- **Retry/Cancel** during send operations

If file intent was used, DragonFruit can reveal the saved file location in desktop runtime.

## Practical checks

- Verify key support-heavy layers before sending.
- Re-slice after geometry/support modifications.
- Confirm final file format and target printer compatibility.

## Related workflows

- [Raft and Export](./raft-and-export.md)
- [Island Analysis Workflow](./island-analysis-workflow.md)

![Printing workflow placeholder](../assets/placeholders/workflow-printing-preview-send.png)

> Screenshot placeholder: Printing mode with layer scrub slider and printing action panel.
