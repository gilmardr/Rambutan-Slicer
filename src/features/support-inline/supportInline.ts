import * as THREE from 'three';
import {
  beginSupportPaintingStroke,
  cancelSupportPaintingStroke,
  finishSupportPaintingStroke,
  getSupportPaintingSettings,
  isSupportPaintingStrokeActive,
  replaceSupportPaintingPreviewPath,
} from '@/features/support-paint/supportPainting';

type InlineAnchor = {
  modelId: string;
  pointer: THREE.Vector2;
  place: (hit: THREE.Intersection) => void;
};

type SurfaceSample = {
  pointer: THREE.Vector2;
  hit: THREE.Intersection;
  distance: number;
};

const SAMPLE_SPACING_PX = 12;
const MAX_PATH_SAMPLES = 96;
const PREVIEW_THROTTLE_MS = 40;
let anchor: InlineAnchor | null = null;
let lastPreviewUpdateAt = 0;

export function isSupportInlinePairActive(): boolean {
  return anchor !== null;
}

export function clearSupportInlinePreview(modelId: string): void {
  if (!anchor || anchor.modelId !== modelId) return;
  replaceSupportPaintingPreviewPath(modelId, [], anchor.place);
}

export function beginSupportInlinePair(
  modelId: string,
  pointer: THREE.Vector2,
  place: (hit: THREE.Intersection) => void,
): void {
  if (!modelId || anchor) return;
  beginSupportPaintingStroke(modelId);
  if (!isSupportPaintingStrokeActive()) return;
  anchor = { modelId, pointer: pointer.clone(), place };
  lastPreviewUpdateAt = 0;
}

export function updateSupportInlinePreview(
  modelId: string,
  pointer: THREE.Vector2,
  viewport: { width: number; height: number },
  raycastAtPointer: (pointer: THREE.Vector2) => THREE.Intersection | null,
  force = false,
): void {
  if (!anchor || anchor.modelId !== modelId) return;
  const now = performance.now();
  if (!force && now - lastPreviewUpdateAt < PREVIEW_THROTTLE_MS) return;
  lastPreviewUpdateAt = now;

  const deltaX = (pointer.x - anchor.pointer.x) * viewport.width / 2;
  const deltaY = (pointer.y - anchor.pointer.y) * viewport.height / 2;
  const screenDistance = Math.hypot(deltaX, deltaY);
  const sampleCount = Math.min(
    MAX_PATH_SAMPLES,
    Math.max(2, Math.ceil(screenDistance / SAMPLE_SPACING_PX)),
  );
  const samples: SurfaceSample[] = [];
  const segmentDistances: number[] = [];
  let distance = 0;
  const intervalMm = getSupportPaintingSettings().intervalMm;

  for (let index = 0; index <= sampleCount; index += 1) {
    const t = index / sampleCount;
    const samplePointer = anchor.pointer.clone().lerp(pointer, t);
    const hit = raycastAtPointer(samplePointer);
    if (!hit?.face || (samples.length > 0 && hit.object !== samples[0].hit.object)) {
      replaceSupportPaintingPreviewPath(modelId, [], anchor.place);
      return;
    }
    if (samples.length > 0) {
      const segmentDistance = hit.point.distanceTo(samples[samples.length - 1].hit.point);
      segmentDistances.push(segmentDistance);
      distance += segmentDistance;
    }
    samples.push({ pointer: samplePointer, hit, distance });
  }

  const sortedSegmentDistances = [...segmentDistances].sort((a, b) => a - b);
  const medianSegmentDistance = sortedSegmentDistances[Math.floor(sortedSegmentDistances.length / 2)] ?? 0;
  if (segmentDistances.some((segmentDistance) => (
    segmentDistance > medianSegmentDistance * 5 && segmentDistance > intervalMm * 2
  ))) {
    replaceSupportPaintingPreviewPath(modelId, [], anchor.place);
    return;
  }

  const candidateHits: THREE.Intersection[] = [];
  let segmentIndex = 1;
  for (let targetDistance = intervalMm; targetDistance < distance; targetDistance += intervalMm) {
    while (segmentIndex < samples.length - 1 && samples[segmentIndex].distance < targetDistance) {
      segmentIndex += 1;
    }
    const previous = samples[segmentIndex - 1];
    const next = samples[segmentIndex];
    const segmentDistance = next.distance - previous.distance;
    const segmentT = segmentDistance > 0
      ? (targetDistance - previous.distance) / segmentDistance
      : 0;
    const candidatePointer = previous.pointer.clone().lerp(next.pointer, segmentT);
    const hit = raycastAtPointer(candidatePointer);
    if (!hit?.face || hit.object !== samples[0].hit.object) {
      replaceSupportPaintingPreviewPath(modelId, [], anchor.place);
      return;
    }
    candidateHits.push(hit);
  }

  replaceSupportPaintingPreviewPath(modelId, candidateHits, anchor.place);
}

export function completeSupportInlinePair(
  modelId: string,
  pointer: THREE.Vector2,
  viewport: { width: number; height: number },
  raycastAtPointer: (pointer: THREE.Vector2) => THREE.Intersection | null,
): void {
  if (!anchor || anchor.modelId !== modelId) return;
  updateSupportInlinePreview(modelId, pointer, viewport, raycastAtPointer, true);
  anchor = null;
  lastPreviewUpdateAt = 0;
  finishSupportPaintingStroke();
}

export function cancelSupportInlinePair(): void {
  if (!anchor) return;
  anchor = null;
  lastPreviewUpdateAt = 0;
  cancelSupportPaintingStroke();
}
