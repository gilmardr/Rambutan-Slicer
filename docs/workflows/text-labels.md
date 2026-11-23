# Engrave or raise text and images on a model

The **Engraving** panel in Prepare creates a text or image preview on a picked
point of the model. Choose **Engraving** to subtract the preview from the source,
or **Relief** to union raised text or image geometry with it.

1. Select the model and open **Prepare**.
2. Select the **Engraving** icon after **Smooth** in the tool rail.
3. Choose **Text** or **Image**. Both use the same content area: Text opens a
   multiline box, while Image shows the selected image thumbnail and a control
   to replace it. Choose a PNG, JPEG or WebP for Image.
4. Choose **Engraving** or **Relief**. For text, set its height and engraving
   depth or relief height. For an image, set its width and maximum cut or relief
   height.
   Set **Engraving rotation** with the angle field; the allowed angle is -180°
   to 180°. Use the **0°** button to reset the angle.
5. Choose **Pick engraving surface** or **Pick relief surface**, then click the
   spot on the active model where the operation should be centered. The click
   also sets its facing direction.
6. Choose **Create engraving preview** or **Create relief preview** and inspect
   how it sits against the model. Adjust **Engraving rotation** while the
   preview is visible to turn it for alignment; the angle updates as you edit
   the field, then conforms to the surface when you leave it. Drag the
   preview across the model surface to move it; release to conform it to the
   new position. You can also choose **Choose a new position on the model**,
   click a surface point, then choose **Update engraving preview** or **Update
   relief preview**. The old preview stays in place if the
   replacement cannot be created.
   Selecting another Prepare tool discards an unconfirmed preview.
7. Choose **Apply engraving** to run Difference, or **Apply relief** to run
   Union. The source and preview are replaced by the result in one undoable
   scene edit. The app also adds subtle local triangulation near the operation
   without smoothing or moving the original surface. Choose **Discard preview**
   to cancel instead.

Image aspect ratio is preserved. Transparent pixels are left untouched. In
Engraving mode, darker pixels create deeper cuts; in Relief mode, darker pixels
raise farther from the surface. A transparent PNG works best for logos; an
opaque photo fills its full rectangular area. Images are reduced to at most 512
pixels on their longest side for the preview mesh, using high-quality
resampling to preserve smoother borders.

If the whole footprint does not land on the selected surface, reduce its size
or choose a flatter, wider patch. A very curved or folded surface can make the
preview intersect another wall, so inspect the result and undo it if needed. If
the preview does not intersect the source, the app keeps it and asks you to
increase the depth or height, or pick the surface again.
