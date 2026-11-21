use crate::rle::{emit_row, expand_rle_to_mask, RleAccum, RleRun};
use crate::types::{ModelSliceRangeV1, SliceJobV3};

const DISTANCE_SCALE: f32 = 2.0;
const MAX_DISTANCE: u8 = u8::MAX;

#[derive(Clone, Copy)]
pub(crate) struct ToleranceSettings {
    pub build_width_mm: f32,
    pub build_depth_mm: f32,
    pub bottom_layer_count: u32,
    pub inner_diameter_mm: f32,
    pub outer_diameter_mm: f32,
    pub bottom_enabled: bool,
    pub bottom_inner_diameter_mm: f32,
    pub bottom_outer_diameter_mm: f32,
}

impl ToleranceSettings {
    pub(crate) fn from_job(job: &SliceJobV3) -> Self {
        Self {
            build_width_mm: job.build_width_mm,
            build_depth_mm: job.build_depth_mm,
            bottom_layer_count: job.bottom_layer_count,
            inner_diameter_mm: job.inner_diameter_tolerance_mm,
            outer_diameter_mm: job.outer_diameter_tolerance_mm,
            bottom_enabled: job.bottom_tolerance_enabled,
            bottom_inner_diameter_mm: job.bottom_inner_diameter_tolerance_mm,
            bottom_outer_diameter_mm: job.bottom_outer_diameter_tolerance_mm,
        }
    }
}

pub(crate) fn has_tolerance_compensation(job: &SliceJobV3) -> bool {
    job.inner_diameter_tolerance_mm != 0.0
        || job.outer_diameter_tolerance_mm != 0.0
        || (job.bottom_tolerance_enabled
            && (job.bottom_inner_diameter_tolerance_mm != 0.0
                || job.bottom_outer_diameter_tolerance_mm != 0.0))
}

pub(crate) fn has_slice_hollowing(job: &SliceJobV3) -> bool {
    job.model_slice_ranges.iter().any(|range| {
        range.triangle_count > 0
            && range.wall_thickness_mm.is_finite()
            && range.wall_thickness_mm > 0.0
    })
}

pub(crate) fn apply_slice_hollowing_to_mask(
    job: &SliceJobV3,
    range: &ModelSliceRangeV1,
    pixels: &mut [u8],
) -> bool {
    let width = job.effective_render_width_px() as usize;
    let height = job.source_height_px as usize;
    let wall_thickness_mm = range.wall_thickness_mm;
    if width == 0
        || height == 0
        || pixels.len() != width.saturating_mul(height)
        || !wall_thickness_mm.is_finite()
        || wall_thickness_mm <= 0.0
    {
        return false;
    }

    let pitch_x_mm = job.build_width_mm / width as f32;
    let pitch_y_mm = job.build_depth_mm / height as f32;
    let min_pitch_mm = pitch_x_mm.min(pitch_y_mm);
    if !pitch_x_mm.is_finite()
        || pitch_x_mm <= 0.0
        || !pitch_y_mm.is_finite()
        || pitch_y_mm <= 0.0
        || !min_pitch_mm.is_finite()
    {
        return false;
    }

    let wall_pixels = wall_thickness_mm / min_pitch_mm;
    let scale = (32767.0 / wall_pixels.max(1.0)).floor().clamp(1.0, 64.0);
    let x_cost = ((pitch_x_mm / min_pitch_mm) * scale)
        .round()
        .clamp(1.0, 32767.0) as u16;
    let y_cost = ((pitch_y_mm / min_pitch_mm) * scale)
        .round()
        .clamp(1.0, 32767.0) as u16;
    let diagonal_cost = (((x_cost as f32).powi(2) + (y_cost as f32).powi(2)).sqrt())
        .round()
        .clamp(1.0, u16::MAX as f32 - 1.0) as u16;
    let threshold = (wall_pixels * scale)
        .ceil()
        .clamp(1.0, u16::MAX as f32 - 1.0) as u16;
    let max_distance = u16::MAX;
    let mut distances = vec![max_distance; pixels.len()];

    for y in 0..height {
        for x in 0..width {
            let index = y * width + x;
            if pixels[index] < 128 {
                distances[index] = 0;
                continue;
            }
            let mut boundary_distance = max_distance;
            if x == 0 || x + 1 == width {
                boundary_distance = boundary_distance.min((x_cost / 2).max(1));
            }
            if y == 0 || y + 1 == height {
                boundary_distance = boundary_distance.min((y_cost / 2).max(1));
            }
            distances[index] = boundary_distance;
        }
    }

    for y in 0..height {
        for x in 0..width {
            let index = y * width + x;
            let mut best = distances[index];
            if x > 0 {
                best = best.min(distances[index - 1].saturating_add(x_cost));
            }
            if y > 0 {
                best = best.min(distances[index - width].saturating_add(y_cost));
                if x > 0 {
                    best = best.min(distances[index - width - 1].saturating_add(diagonal_cost));
                }
                if x + 1 < width {
                    best = best.min(distances[index - width + 1].saturating_add(diagonal_cost));
                }
            }
            distances[index] = best;
        }
    }

    for y in (0..height).rev() {
        for x in (0..width).rev() {
            let index = y * width + x;
            let mut best = distances[index];
            if x + 1 < width {
                best = best.min(distances[index + 1].saturating_add(x_cost));
            }
            if y + 1 < height {
                best = best.min(distances[index + width].saturating_add(y_cost));
                if x > 0 {
                    best = best.min(distances[index + width - 1].saturating_add(diagonal_cost));
                }
                if x + 1 < width {
                    best = best.min(distances[index + width + 1].saturating_add(diagonal_cost));
                }
            }
            distances[index] = best;
        }
    }

    for (pixel, &distance) in pixels.iter_mut().zip(distances.iter()) {
        *pixel = if *pixel >= 128 && distance <= threshold {
            255
        } else {
            0
        };
    }
    true
}

#[cfg(test)]
mod tests {
    use super::apply_slice_hollowing_to_mask;
    use crate::types::{ModelSliceRangeV1, SliceJobV3};

    fn job_for_mask(width: u32, height: u32) -> SliceJobV3 {
        SliceJobV3 {
            source_width_px: width,
            source_height_px: height,
            width_px: width,
            height_px: height,
            build_width_mm: width as f32,
            build_depth_mm: height as f32,
            ..SliceJobV3::default()
        }
    }

    fn filled_rectangle(
        width: usize,
        height: usize,
        left: usize,
        top: usize,
        right: usize,
        bottom: usize,
    ) -> Vec<u8> {
        let mut pixels = vec![0; width * height];
        for y in top..bottom {
            for x in left..right {
                pixels[y * width + x] = 255;
            }
        }
        pixels
    }

    #[test]
    fn slice_hollowing_retains_the_configured_shell_and_removes_the_interior() {
        let job = job_for_mask(21, 21);
        let range = ModelSliceRangeV1 {
            start_triangle: 0,
            triangle_count: 12,
            wall_thickness_mm: 3.0,
        };
        let mut pixels = filled_rectangle(21, 21, 0, 0, 21, 21);

        assert!(apply_slice_hollowing_to_mask(&job, &range, &mut pixels));
        assert_eq!(pixels[10 * 21 + 10], 0, "the interior is hollow");
        assert_eq!(pixels[10 * 21 + 1], 255, "the configured wall stays solid");
        assert_eq!(pixels[10 * 21], 255, "the outer contour stays solid");
    }

    #[test]
    fn each_layer_uses_its_own_cross_section_contour() {
        let job = job_for_mask(21, 21);
        let range = ModelSliceRangeV1 {
            start_triangle: 0,
            triangle_count: 12,
            wall_thickness_mm: 2.0,
        };
        let mut lower_layer = filled_rectangle(21, 21, 0, 0, 21, 21);
        let mut upper_layer = filled_rectangle(21, 21, 6, 6, 15, 15);

        assert!(apply_slice_hollowing_to_mask(
            &job,
            &range,
            &mut lower_layer
        ));
        assert!(apply_slice_hollowing_to_mask(
            &job,
            &range,
            &mut upper_layer
        ));

        assert_eq!(lower_layer[10 * 21 + 10], 0);
        assert_eq!(upper_layer[10 * 21 + 10], 0);
        assert_eq!(upper_layer[10 * 21 + 6], 255);
        assert_ne!(
            lower_layer, upper_layer,
            "the shell follows each layer's actual outline"
        );
    }

    #[test]
    fn invalid_slice_hollowing_does_not_change_the_layer_mask() {
        let job = job_for_mask(3, 3);
        let range = ModelSliceRangeV1 {
            start_triangle: 0,
            triangle_count: 12,
            wall_thickness_mm: f32::NAN,
        };
        let mut pixels = vec![255; 9];

        assert!(!apply_slice_hollowing_to_mask(&job, &range, &mut pixels));
        assert_eq!(pixels, vec![255; 9]);
    }
}

fn layer_values(settings: &ToleranceSettings, layer_index: u32) -> (f32, f32) {
    if settings.bottom_enabled && layer_index < settings.bottom_layer_count {
        (
            settings.bottom_inner_diameter_mm,
            settings.bottom_outer_diameter_mm,
        )
    } else {
        (settings.inner_diameter_mm, settings.outer_diameter_mm)
    }
}

pub(crate) fn apply_to_rle_layer(
    settings: &ToleranceSettings,
    layer_index: u32,
    runs: &[RleRun],
    width: usize,
    height: usize,
) -> Vec<RleRun> {
    let (inner_mm, outer_mm) = layer_values(settings, layer_index);
    if inner_mm == 0.0 && outer_mm == 0.0 {
        return runs.to_vec();
    }

    let mut pixels = expand_rle_to_mask(runs, width.saturating_mul(height));
    if !apply_to_mask(settings, layer_index, &mut pixels, width, height) {
        return runs.to_vec();
    }

    let mut accumulator = RleAccum::new();
    for row in pixels.chunks(width.max(1)) {
        emit_row(&mut accumulator, row);
    }
    accumulator.finish()
}

pub(crate) fn apply_to_mask(
    settings: &ToleranceSettings,
    layer_index: u32,
    pixels: &mut [u8],
    width: usize,
    height: usize,
) -> bool {
    let (inner_mm, outer_mm) = layer_values(settings, layer_index);
    if (inner_mm == 0.0 && outer_mm == 0.0)
        || width == 0
        || height == 0
        || pixels.len() != width.saturating_mul(height)
    {
        return false;
    }

    let pitch_x_mm = settings.build_width_mm / width as f32;
    let pitch_y_mm = settings.build_depth_mm / height as f32;
    let min_pitch_mm = pitch_x_mm.min(pitch_y_mm);
    if !(pitch_x_mm.is_finite()
        && pitch_x_mm > 0.0
        && pitch_y_mm.is_finite()
        && pitch_y_mm > 0.0
        && min_pitch_mm.is_finite())
    {
        return false;
    }

    let len = pixels.len();
    let solid: Vec<bool> = pixels.iter().map(|&value| value >= 128).collect();
    let mut exterior = vec![false; len];
    flood_exterior(&solid, &mut exterior, width, height);

    // Replace the flood result with enclosed background pixels, then fill those
    // holes in a second mask so outer contours can move independently.
    let mut holes = exterior;
    for index in 0..len {
        holes[index] = !solid[index] && !holes[index];
    }
    let mut filled_solid = solid;
    for (filled, &hole) in filled_solid.iter_mut().zip(holes.iter()) {
        *filled |= hole;
    }

    let mut distances = vec![MAX_DISTANCE; len];
    offset_mask(
        &mut filled_solid,
        &mut distances,
        width,
        height,
        pitch_x_mm,
        pitch_y_mm,
        outer_mm / 2.0,
    );
    let mut adjusted_holes = holes;
    offset_mask(
        &mut adjusted_holes,
        &mut distances,
        width,
        height,
        pitch_x_mm,
        pitch_y_mm,
        -inner_mm / 2.0,
    );

    for index in 0..len {
        let is_solid = filled_solid[index] && !adjusted_holes[index];
        if is_solid {
            if pixels[index] == 0 {
                pixels[index] = 255;
            }
        } else {
            pixels[index] = 0;
        }
    }
    true
}

pub(crate) fn nonzero_bounds(
    pixels: &[u8],
    width: usize,
    height: usize,
) -> Option<(usize, usize, usize, usize)> {
    let mut min_x = width;
    let mut min_y = height;
    let mut max_x = 0usize;
    let mut max_y = 0usize;
    let mut any = false;
    for y in 0..height {
        for x in 0..width {
            if pixels.get(y * width + x).copied().unwrap_or(0) == 0 {
                continue;
            }
            any = true;
            min_x = min_x.min(x);
            min_y = min_y.min(y);
            max_x = max_x.max(x);
            max_y = max_y.max(y);
        }
    }
    any.then_some((min_x, max_x, min_y, max_y))
}

fn flood_exterior(solid: &[bool], exterior: &mut [bool], width: usize, height: usize) {
    if width == 0 || height == 0 {
        return;
    }

    let mut spans = Vec::<(usize, usize)>::new();
    for x in 0..width {
        spans.push((x, 0));
        if height > 1 {
            spans.push((x, height - 1));
        }
    }
    for y in 1..height.saturating_sub(1) {
        spans.push((0, y));
        if width > 1 {
            spans.push((width - 1, y));
        }
    }

    while let Some((seed_x, y)) = spans.pop() {
        let seed_index = y * width + seed_x;
        if solid[seed_index] || exterior[seed_index] {
            continue;
        }

        let mut left = seed_x;
        while left > 0 {
            let index = y * width + left - 1;
            if solid[index] || exterior[index] {
                break;
            }
            left -= 1;
        }
        let mut right = seed_x;
        while right + 1 < width {
            let index = y * width + right + 1;
            if solid[index] || exterior[index] {
                break;
            }
            right += 1;
        }
        for x in left..=right {
            exterior[y * width + x] = true;
        }

        for neighbor_y in [y.checked_sub(1), (y + 1 < height).then_some(y + 1)]
            .into_iter()
            .flatten()
        {
            let mut x = left;
            while x <= right {
                let index = neighbor_y * width + x;
                if !solid[index] && !exterior[index] {
                    spans.push((x, neighbor_y));
                    while x <= right {
                        let next = neighbor_y * width + x;
                        if solid[next] || exterior[next] {
                            break;
                        }
                        x += 1;
                    }
                }
                x += 1;
            }
        }
    }
}

fn offset_mask(
    mask: &mut [bool],
    distances: &mut [u8],
    width: usize,
    height: usize,
    pitch_x_mm: f32,
    pitch_y_mm: f32,
    signed_radius_mm: f32,
) {
    if signed_radius_mm == 0.0 {
        return;
    }

    let dilate = signed_radius_mm > 0.0;
    let radius_units = ((signed_radius_mm.abs() / pitch_x_mm.min(pitch_y_mm)) * DISTANCE_SCALE
        + 1.0)
        .floor()
        .clamp(1.0, MAX_DISTANCE as f32) as u8;
    let unit_pitch = pitch_x_mm.min(pitch_y_mm);
    let x_cost = ((pitch_x_mm / unit_pitch) * DISTANCE_SCALE)
        .round()
        .clamp(1.0, 254.0) as u8;
    let y_cost = ((pitch_y_mm / unit_pitch) * DISTANCE_SCALE)
        .round()
        .clamp(1.0, 254.0) as u8;
    let diagonal = ((((x_cost as f32).powi(2) + (y_cost as f32).powi(2)).sqrt()).round())
        .clamp(1.0, 254.0) as u8;

    for (index, &inside) in mask.iter().enumerate() {
        distances[index] = if inside == dilate { 0 } else { MAX_DISTANCE };
    }
    if !dilate {
        for x in 0..width {
            distances[x] = distances[x].min(x_cost / 2);
            let bottom = (height - 1) * width + x;
            distances[bottom] = distances[bottom].min(x_cost / 2);
        }
        for y in 0..height {
            let left = y * width;
            let right = left + width - 1;
            distances[left] = distances[left].min(y_cost / 2);
            distances[right] = distances[right].min(y_cost / 2);
        }
    }

    for y in 0..height {
        for x in 0..width {
            let index = y * width + x;
            let mut best = distances[index];
            if x > 0 {
                best = best.min(distances[index - 1].saturating_add(x_cost));
            }
            if y > 0 {
                best = best.min(distances[index - width].saturating_add(y_cost));
                if x > 0 {
                    best = best.min(distances[index - width - 1].saturating_add(diagonal));
                }
                if x + 1 < width {
                    best = best.min(distances[index - width + 1].saturating_add(diagonal));
                }
            }
            distances[index] = best;
        }
    }
    for y in (0..height).rev() {
        for x in (0..width).rev() {
            let index = y * width + x;
            let mut best = distances[index];
            if x + 1 < width {
                best = best.min(distances[index + 1].saturating_add(x_cost));
            }
            if y + 1 < height {
                best = best.min(distances[index + width].saturating_add(y_cost));
                if x > 0 {
                    best = best.min(distances[index + width - 1].saturating_add(diagonal));
                }
                if x + 1 < width {
                    best = best.min(distances[index + width + 1].saturating_add(diagonal));
                }
            }
            distances[index] = best;
        }
    }

    for (inside, &distance) in mask.iter_mut().zip(distances.iter()) {
        if dilate {
            *inside |= distance <= radius_units;
        } else {
            *inside &= distance > radius_units;
        }
    }
}
