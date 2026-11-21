import * as THREE from 'three';
import { cloneSupportState, getSnapshot, type SupportState } from '@/supports/state';
import { SUPPORT_PAINT_STROKE } from '@/supports/history/actionTypes';
import { beginSupportHistoryBatch, pushSupportHistory } from '@/supports/history/supportHistory';

export interface SupportPaintingSettings {
  intervalMm: number;
  maxAngleDeg: number;
  avoidExistingEnabled: boolean;
}

const STORAGE_KEY = 'support-painting-settings';
const DEFAULT_SETTINGS: SupportPaintingSettings = { intervalMm: 2.5, maxAngleDeg: 45, avoidExistingEnabled: true };
const DOWN = new THREE.Vector3(0, 0, -1);
const listeners = new Set<() => void>();
let settings = DEFAULT_SETTINGS;
let settingsLoaded = false;
let strokeActive = false;
let strokeModelId: string | null = null;
let strokeBefore: SupportState | null = null;
let lastAcceptedPoint: THREE.Vector3 | null = null;
let version = 0;
let existingContactPoints: THREE.Vector3[] = [];
let pendingHits: Array<{
  hit: THREE.Intersection;
  previewPoint: THREE.Vector3;
  place: (hit: THREE.Intersection) => void;
}> = [];

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function collectExistingContactPoints(snapshot: SupportState, modelId: string): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const add = (entity: { modelId?: string; contactCone?: { pos?: { x: number; y: number; z: number } } }, pos = entity.contactCone?.pos) => {
    if (entity.modelId !== modelId || !pos) return;
    points.push(new THREE.Vector3(pos.x, pos.y, pos.z));
  };

  Object.values(snapshot.trunks ?? {}).forEach((entity) => add(entity));
  Object.values(snapshot.branches ?? {}).forEach((entity) => add(entity));
  Object.values(snapshot.leaves ?? {}).forEach((entity) => add(entity));
  Object.values(snapshot.stumps ?? {}).forEach((entity) => add(entity));
  Object.values(snapshot.twigs ?? {}).forEach((entity) => {
    add(entity, entity.contactDiskA?.pos);
    add(entity, entity.contactDiskB?.pos);
  });
  Object.values(snapshot.sticks ?? {}).forEach((entity) => {
    add(entity, entity.contactConeA?.pos);
    add(entity, entity.contactConeB?.pos);
  });
  return points;
}

function normalizeSnapshot(source: SupportState): SupportState {
  const snapshot = cloneSupportState(source);
  snapshot.selectedId = null;
  snapshot.selectedCategory = null;
  snapshot.hoveredId = null;
  snapshot.hoveredCategory = 'none';
  return snapshot;
}

function cloneHit(hit: THREE.Intersection): THREE.Intersection {
  return {
    ...hit,
    point: hit.point.clone(),
    uv: hit.uv?.clone(),
    face: hit.face ? { ...hit.face, normal: hit.face.normal.clone() } : hit.face,
  };
}

export function subscribeSupportPainting(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSupportPaintingSettings(): SupportPaintingSettings {
  return settings;
}

export function getSupportPaintingVersion(): number {
  return version;
}

/** World-independent contact markers in the painted model mesh's local coordinates. */
export function getSupportPaintingPreviewPoints(modelId: string): readonly THREE.Vector3[] {
  if (!strokeActive || strokeModelId !== modelId) return [];
  return pendingHits.map(({ previewPoint }) => previewPoint);
}

export function loadSupportPaintingSettings(): void {
  if (settingsLoaded || typeof window === 'undefined') return;
  settingsLoaded = true;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<SupportPaintingSettings>;
      settings = {
        intervalMm: clamp(parsed.intervalMm, DEFAULT_SETTINGS.intervalMm, 0.5, 10),
        maxAngleDeg: clamp(parsed.maxAngleDeg, DEFAULT_SETTINGS.maxAngleDeg, 0, 90),
        avoidExistingEnabled: typeof parsed.avoidExistingEnabled === 'boolean'
          ? parsed.avoidExistingEnabled
          : DEFAULT_SETTINGS.avoidExistingEnabled,
      };
      notify();
    }
  } catch {
    // Invalid or unavailable local settings leave the built-in defaults active.
  }
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function setSupportPaintingSettings(next: SupportPaintingSettings): void {
  const normalized = {
    intervalMm: clamp(next.intervalMm, settings.intervalMm, 0.5, 10),
    maxAngleDeg: clamp(next.maxAngleDeg, settings.maxAngleDeg, 0, 90),
    avoidExistingEnabled: next.avoidExistingEnabled,
  };
  if (
    normalized.intervalMm === settings.intervalMm
    && normalized.maxAngleDeg === settings.maxAngleDeg
    && normalized.avoidExistingEnabled === settings.avoidExistingEnabled
  ) return;
  settings = normalized;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Keep the setting for this session when storage is unavailable.
  }
  notify();
}

export function isSupportPaintingStrokeActive(): boolean {
  return strokeActive;
}

export function beginSupportPaintingStroke(modelId: string): void {
  if (strokeActive || !modelId) return;
  strokeActive = true;
  strokeModelId = modelId;
  strokeBefore = normalizeSnapshot(getSnapshot());
  lastAcceptedPoint = null;
  pendingHits = [];
  existingContactPoints = collectExistingContactPoints(getSnapshot(), modelId);
  notify();
}

function acceptSupportPaintingHit(
  modelId: string,
  hit: THREE.Intersection,
  place: (hit: THREE.Intersection) => void,
): boolean {
  if (!strokeActive || modelId !== strokeModelId || !hit.face) return false;

  const normal = hit.face.normal
    .clone()
    .applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
    .normalize();
  const angleDeg = THREE.MathUtils.radToDeg(normal.angleTo(DOWN));
  if (angleDeg > settings.maxAngleDeg) return false;
  if (lastAcceptedPoint && lastAcceptedPoint.distanceTo(hit.point) < settings.intervalMm) return false;
  if (
    settings.avoidExistingEnabled
    && existingContactPoints.some((point) => point.distanceTo(hit.point) < settings.intervalMm)
  ) return false;

  const copiedHit = cloneHit(hit);
  const previewWorldPoint = copiedHit.point.clone().addScaledVector(normal, 0.025);
  const previewPoint = copiedHit.object.worldToLocal(previewWorldPoint);
  pendingHits.push({ hit: copiedHit, previewPoint, place });
  lastAcceptedPoint = copiedHit.point;
  return true;
}

export function recordSupportPaintingHit(
  modelId: string,
  hit: THREE.Intersection,
  place: (hit: THREE.Intersection) => void,
): void {
  if (acceptSupportPaintingHit(modelId, hit, place)) notify();
}

/** Replace the preview path while keeping its original before-state for undo. */
export function replaceSupportPaintingPreviewPath(
  modelId: string,
  hits: readonly THREE.Intersection[],
  place: (hit: THREE.Intersection) => void,
): void {
  if (!strokeActive || modelId !== strokeModelId) return;
  pendingHits = [];
  lastAcceptedPoint = null;
  for (const hit of hits) acceptSupportPaintingHit(modelId, hit, place);
  notify();
}

/** Discard an uncommitted paint or inline preview without adding history. */
export function cancelSupportPaintingStroke(): void {
  if (!strokeActive) return;
  strokeActive = false;
  strokeModelId = null;
  strokeBefore = null;
  lastAcceptedPoint = null;
  existingContactPoints = [];
  pendingHits = [];
  notify();
}

export function finishSupportPaintingStroke(): void {
  if (!strokeActive) return;
  const before = strokeBefore;
  const hits = pendingHits;
  strokeActive = false;
  strokeModelId = null;
  strokeBefore = null;
  lastAcceptedPoint = null;
  existingContactPoints = [];
  pendingHits = [];
  notify();

  if (!before || hits.length === 0) return;
  const endBatch = beginSupportHistoryBatch();
  try {
    for (const { hit, place } of hits) place(hit);
  } finally {
    endBatch();
  }

  const after = normalizeSnapshot(getSnapshot());
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  pushSupportHistory({ type: SUPPORT_PAINT_STROKE, payload: { before, after } });
}
