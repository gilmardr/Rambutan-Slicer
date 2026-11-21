# Engrave text or an image on a model

The **Surface engraving** panel in Prepare creates a cutter preview conforming
to a picked point on the model. Confirm the preview to subtract it from the
source and create the printable engraved model.

1. Select the model and open **Prepare**.
2. Select the **Engraving** icon after **Smooth** in the tool rail.
3. Choose **Text** or **Image**. For text, enter the label, height and depth.
   For an image, select a PNG, JPEG or WebP, set its width and maximum depth.
4. Choose **Pick engraving surface**, then click the spot on the active model
   where the engraving should be centered. The click also sets its facing
   direction.
5. Choose **Create engraving preview** and inspect how it sits against the
   model. Drag the preview across the model surface to move it; release to
   conform it to the new position. You can also choose **Choose a new position
   on the model**, click a surface point, then choose **Update engraving
   preview**. The old preview stays in place if the replacement cannot be
   created.
   Selecting another Prepare tool discards an unconfirmed preview.
6. Choose **Confirm engraving** to run Difference. The source and preview are
   replaced by the carved result in one undoable scene edit. The app also adds
   subtle local triangulation near the cut without smoothing or moving the
   model surface. Choose **Discard preview** to cancel instead.

Image aspect ratio is preserved. Transparent pixels are left untouched, while
darker pixels create deeper cuts. A transparent PNG works best for logos; an
opaque photo engraves its full rectangular area. Images are reduced to at most
512 pixels on their longest side for the cutter mesh, using high-quality
resampling to preserve smoother borders.

If the whole footprint does not land on the selected surface, reduce its size
or choose a flatter, wider patch. A very curved or folded surface can make the
cutter intersect another wall, so inspect the carved result and undo it if
needed. If the preview does not intersect the source, the app keeps the preview
and asks you to increase the depth or pick the surface again.
