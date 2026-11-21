import * as THREE from 'three';
import { cloneSupportState, getSnapshot, getSupports, getSupportTypeOf, type SupportState } from '@/supports/state';
import { SUPPORT_PROJECTION } from '@/supports/history/actionTypes';
import { beginSupportHistoryBatch, pushSupportHistory } from '@/supports/history/supportHistory';
import { getPresetById } from '@/supports/Settings/presets';
import type { SupportSettings } from '@/supports/Settings/types';
import { updateSupportEntity } from '@/supports/supportTypeRegistry';

export type SupportProjectionPattern = 'grid' | 'concentric' | 'random' | 'contour';
export type SupportProjectionSymmetryAxis = 'none' | 'x' | 'y';

export interface SupportProjectionSettings {
  brushRadiusMm: number;
  borderIntervalMm: number;
  infillIntervalMm: number;
  maxAngleDeg: number;
  borderEnabled: boolean;
  infillEnabled: boolean;
  doubleBorderEnabled: boolean;
  doubleBorderOffsetMm: number;
  islandInfluenceEnabled: boolean;
  islandInfluenceMm: number;
  pattern: SupportProjectionPattern;
  symmetryAxis: SupportProjectionSymmetryAxis;
  borderSupportPresetId: string | null;
  infillSupportPresetId: string | null;
  borderTag: string | null;
  infillTag: string | null;
}

export interface SupportProjectionIslandContact {
  point: { x: number; y: number; z: number };
}

export interface SupportProjectionPreset {
  id: string;
  name: string;
  settings: SupportProjectionSettings;
}

interface ProjectionStroke {
  modelId: string;
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  triangles: Set<number>;
  lastDab: THREE.Vector3 | null;
  before: SupportState;
  settings: SupportProjectionSettings;
  place: (hit: THREE.Intersection, settingsOverride?: SupportSettings) => void;
  presetSettings: Partial<Record<ProjectionZone, SupportSettings>>;
  clipLower: number | null | undefined;
  clipUpper: number | null | undefined;
  islandContacts: SupportProjectionIslandContact[];
}

interface ProjectionPreview {
  stroke: ProjectionStroke;
  candidates: ProjectedCandidate[];
  points: THREE.Vector3[];
}

type ProjectionZone = 'border' | 'infill' | 'island';

interface ProjectedCandidate {
  hit: THREE.Intersection;
  zone: ProjectionZone;
}

interface ProjectedCell {
  hit: THREE.Intersection;
}

const STORAGE_KEY = 'support-projection-settings';
const PRESETS_STORAGE_KEY = 'support-projection-presets';
const DEFAULT_SETTINGS: SupportProjectionSettings = {
  brushRadiusMm: 5,
  borderIntervalMm: 5,
  infillIntervalMm: 5,
  maxAngleDeg: 70,
  borderEnabled: true,
  infillEnabled: true,
  doubleBorderEnabled: false,
  doubleBorderOffsetMm: 5,
  islandInfluenceEnabled: true,
  islandInfluenceMm: 5,
  pattern: 'grid',
  symmetryAxis: 'none',
  borderSupportPresetId: null,
  infillSupportPresetId: null,
  borderTag: null,
  infillTag: null,
};
const DOWN = new THREE.Vector3(0, 0, -1);
const listeners = new Set<() => void>();
const emptyTriangles = new Set<number>();
const raycaster = new THREE.Raycaster();
const rayOrigin = new THREE.Vector3();
const rayDirection = new THREE.Vector3(0, 0, 1);
const vertexScratch = new THREE.Vector3();
const triangleVertexB = new THREE.Vector3();
const triangleVertexC = new THREE.Vector3();
const brushTriangle = new THREE.Triangle();
const brushClosestPoint = new THREE.Vector3();
const triangleNormalMatrix = new THREE.Matrix3();
const rayHits: THREE.Intersection[] = [];
const MAX_PROJECTION_CELLS = 256;
const DAB_SPACING_FRACTION = 0.45;

let settings = DEFAULT_SETTINGS;
let presets: SupportProjectionPreset[] = [];
let settingsLoaded = false;
let version = 0;
let stroke: ProjectionStroke | null = null;
let pendingPreview: ProjectionPreview | null = null;
let islandContactsModelId: string | null = null;
let islandContacts: SupportProjectionIslandContact[] = [];

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
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

export function subscribeSupportProjection(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSupportProjectionVersion(): number {
  return version;
}

export function getSupportProjectionSettings(): SupportProjectionSettings {
  return settings;
}

export function getSupportProjectionPresets(): readonly SupportProjectionPreset[] {
  return presets;
}

/** Provide the current model's unsupported island contacts for projection strokes. */
export function setSupportProjectionIslandContacts(
  modelId: string | null,
  contacts: readonly SupportProjectionIslandContact[],
): void {
  islandContactsModelId = modelId;
  islandContacts = contacts.map(({ point }) => ({ point: { ...point } }));
}

export function loadSupportProjectionSettings(): void {
  if (settingsLoaded || typeof window === 'undefined') return;
  settingsLoaded = true;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<SupportProjectionSettings> & { intervalMm?: number };
      const legacyInterval = clamp(parsed.intervalMm, DEFAULT_SETTINGS.borderIntervalMm, 1, 20);
      settings = {
        brushRadiusMm: clamp(parsed.brushRadiusMm, DEFAULT_SETTINGS.brushRadiusMm, 1, 20),
        borderIntervalMm: clamp(parsed.borderIntervalMm, legacyInterval, 1, 20),
        infillIntervalMm: clamp(parsed.infillIntervalMm, legacyInterval, 1, 20),
        maxAngleDeg: clamp(parsed.maxAngleDeg, DEFAULT_SETTINGS.maxAngleDeg, 0, 90),
        borderEnabled: typeof parsed.borderEnabled === 'boolean' ? parsed.borderEnabled : DEFAULT_SETTINGS.borderEnabled,
        infillEnabled: typeof parsed.infillEnabled === 'boolean' ? parsed.infillEnabled : DEFAULT_SETTINGS.infillEnabled,
        doubleBorderEnabled: typeof parsed.doubleBorderEnabled === 'boolean' ? parsed.doubleBorderEnabled : DEFAULT_SETTINGS.doubleBorderEnabled,
        doubleBorderOffsetMm: clamp(parsed.doubleBorderOffsetMm, DEFAULT_SETTINGS.doubleBorderOffsetMm, 1, 20),
        islandInfluenceEnabled: typeof parsed.islandInfluenceEnabled === 'boolean' ? parsed.islandInfluenceEnabled : DEFAULT_SETTINGS.islandInfluenceEnabled,
        islandInfluenceMm: clamp(parsed.islandInfluenceMm, DEFAULT_SETTINGS.islandInfluenceMm, 1, 20),
        pattern: parsed.pattern === 'concentric' || parsed.pattern === 'random' || parsed.pattern === 'contour' ? parsed.pattern : 'grid',
        symmetryAxis: parsed.symmetryAxis === 'x' || parsed.symmetryAxis === 'y' ? parsed.symmetryAxis : 'none',
        borderSupportPresetId: typeof parsed.borderSupportPresetId === 'string' ? parsed.borderSupportPresetId : null,
        infillSupportPresetId: typeof parsed.infillSupportPresetId === 'string' ? parsed.infillSupportPresetId : null,
        borderTag: typeof parsed.borderTag === 'string' ? parsed.borderTag : null,
        infillTag: typeof parsed.infillTag === 'string' ? parsed.infillTag : null,
      };
    }
    const storedPresets = window.localStorage.getItem(PRESETS_STORAGE_KEY);
    if (storedPresets) {
      const parsedPresets = JSON.parse(storedPresets) as unknown;
      if (Array.isArray(parsedPresets)) {
        presets = parsedPresets.flatMap((entry): SupportProjectionPreset[] => {
          if (!entry || typeof entry !== 'object') return [];
          const candidate = entry as Partial<SupportProjectionPreset>;
          const candidateSettings = candidate.settings;
          if (
            typeof candidate.id !== 'string'
            || typeof candidate.name !== 'string'
            || !candidateSettings
            || typeof candidateSettings !== 'object'
          ) return [];
          return [{
            id: candidate.id,
            name: candidate.name,
            settings: {
              brushRadiusMm: clamp(candidateSettings.brushRadiusMm, DEFAULT_SETTINGS.brushRadiusMm, 1, 20),
              borderIntervalMm: clamp(candidateSettings.borderIntervalMm, DEFAULT_SETTINGS.borderIntervalMm, 1, 20),
              infillIntervalMm: clamp(candidateSettings.infillIntervalMm, DEFAULT_SETTINGS.infillIntervalMm, 1, 20),
              maxAngleDeg: clamp(candidateSettings.maxAngleDeg, DEFAULT_SETTINGS.maxAngleDeg, 0, 90),
              borderEnabled: typeof candidateSettings.borderEnabled === 'boolean' ? candidateSettings.borderEnabled : DEFAULT_SETTINGS.borderEnabled,
              infillEnabled: typeof candidateSettings.infillEnabled === 'boolean' ? candidateSettings.infillEnabled : DEFAULT_SETTINGS.infillEnabled,
              doubleBorderEnabled: typeof candidateSettings.doubleBorderEnabled === 'boolean' ? candidateSettings.doubleBorderEnabled : DEFAULT_SETTINGS.doubleBorderEnabled,
              doubleBorderOffsetMm: clamp(candidateSettings.doubleBorderOffsetMm, DEFAULT_SETTINGS.doubleBorderOffsetMm, 1, 20),
              islandInfluenceEnabled: typeof candidateSettings.islandInfluenceEnabled === 'boolean' ? candidateSettings.islandInfluenceEnabled : DEFAULT_SETTINGS.islandInfluenceEnabled,
              islandInfluenceMm: clamp(candidateSettings.islandInfluenceMm, DEFAULT_SETTINGS.islandInfluenceMm, 1, 20),
              pattern: candidateSettings.pattern === 'concentric' || candidateSettings.pattern === 'random' || candidateSettings.pattern === 'contour' ? candidateSettings.pattern : 'grid',
              symmetryAxis: candidateSettings.symmetryAxis === 'x' || candidateSettings.symmetryAxis === 'y' ? candidateSettings.symmetryAxis : 'none',
              borderSupportPresetId: typeof candidateSettings.borderSupportPresetId === 'string' ? candidateSettings.borderSupportPresetId : null,
              infillSupportPresetId: typeof candidateSettings.infillSupportPresetId === 'string' ? candidateSettings.infillSupportPresetId : null,
              borderTag: typeof candidateSettings.borderTag === 'string' ? candidateSettings.borderTag : null,
              infillTag: typeof candidateSettings.infillTag === 'string' ? candidateSettings.infillTag : null,
            },
          }];
        });
      }
    }
    notify();
  } catch {
    // Invalid or unavailable local settings leave the built-in defaults active.
  }
}

export function saveSupportProjectionPreset(name: string): string | null {
  const normalizedName = name.trim();
  if (!normalizedName) return null;
  const existing = presets.find((preset) => preset.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase());
  const id = existing?.id ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const nextPreset: SupportProjectionPreset = {
    id,
    name: normalizedName,
    settings: { ...settings },
  };
  presets = existing
    ? presets.map((preset) => preset.id === id ? nextPreset : preset)
    : [...presets, nextPreset];
  try {
    window.localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Keep the preset for this session when storage is unavailable.
  }
  notify();
  return id;
}

export function applySupportProjectionPreset(id: string): boolean {
  const preset = presets.find((candidate) => candidate.id === id);
  if (!preset) return false;
  setSupportProjectionSettings({ ...preset.settings });
  return true;
}

export function deleteSupportProjectionPreset(id: string): boolean {
  if (!presets.some((preset) => preset.id === id)) return false;
  presets = presets.filter((preset) => preset.id !== id);
  try {
    window.localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Keep the change for this session when storage is unavailable.
  }
  notify();
  return true;
}

export function setSupportProjectionSettings(next: SupportProjectionSettings): void {
  const normalized: SupportProjectionSettings = {
    brushRadiusMm: clamp(next.brushRadiusMm, settings.brushRadiusMm, 1, 20),
    borderIntervalMm: clamp(next.borderIntervalMm, settings.borderIntervalMm, 1, 20),
    infillIntervalMm: clamp(next.infillIntervalMm, settings.infillIntervalMm, 1, 20),
    maxAngleDeg: clamp(next.maxAngleDeg, settings.maxAngleDeg, 0, 90),
    borderEnabled: next.borderEnabled,
    infillEnabled: next.infillEnabled,
    doubleBorderEnabled: next.doubleBorderEnabled,
    doubleBorderOffsetMm: clamp(next.doubleBorderOffsetMm, settings.doubleBorderOffsetMm, 1, 20),
    islandInfluenceEnabled: next.islandInfluenceEnabled,
    islandInfluenceMm: clamp(next.islandInfluenceMm, settings.islandInfluenceMm, 1, 20),
    pattern: next.pattern === 'concentric' || next.pattern === 'random' || next.pattern === 'contour' ? next.pattern : 'grid',
    symmetryAxis: next.symmetryAxis === 'x' || next.symmetryAxis === 'y' ? next.symmetryAxis : 'none',
    borderSupportPresetId: typeof next.borderSupportPresetId === 'string' ? next.borderSupportPresetId : null,
    infillSupportPresetId: typeof next.infillSupportPresetId === 'string' ? next.infillSupportPresetId : null,
    borderTag: typeof next.borderTag === 'string' && next.borderTag.trim() ? next.borderTag.trim() : null,
    infillTag: typeof next.infillTag === 'string' && next.infillTag.trim() ? next.infillTag.trim() : null,
  };
  if (JSON.stringify(normalized) === JSON.stringify(settings)) return;
  settings = normalized;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Keep the setting for this session when storage is unavailable.
  }
  notify();
}

export function isSupportProjectionStrokeActive(): boolean {
  return stroke !== null;
}

export function isSupportProjectionPreviewReady(): boolean {
  return pendingPreview !== null;
}

export function getSupportProjectionTriangles(modelId: string): Set<number> {
  if (stroke?.modelId === modelId) return stroke.triangles;
  return pendingPreview?.stroke.modelId === modelId ? pendingPreview.stroke.triangles : emptyTriangles;
}

export function getSupportProjectionPreviewPoints(modelId: string): readonly THREE.Vector3[] {
  return pendingPreview?.stroke.modelId === modelId ? pendingPreview.points : [];
}

export function createSupportProjectionTag(zone: ProjectionZone): string {
  const used = new Set<string>();
  for (const entity of Object.values(getSupports())) {
    for (const tag of entity.supportTags ?? []) used.add(tag);
  }
  for (const tag of [settings.borderTag, settings.infillTag]) {
    if (tag) used.add(tag);
  }
  let sequence = 1;
  let tag = `projectionSupport${sequence}_${zone}`;
  while (used.has(tag)) {
    sequence += 1;
    tag = `projectionSupport${sequence}_${zone}`;
  }
  return tag;
}

function triangleVertexIndices(geometry: THREE.BufferGeometry, triangleIndex: number): [number, number, number] {
  const index = geometry.index;
  const offset = triangleIndex * 3;
  return index
    ? [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)]
    : [offset, offset + 1, offset + 2];
}

export function beginSupportProjectionStroke({
  modelId,
  mesh,
  place,
  clipLower,
  clipUpper,
}: {
  modelId: string;
  mesh: THREE.Mesh;
  place: (hit: THREE.Intersection, settingsOverride?: SupportSettings) => void;
  clipLower?: number | null;
  clipUpper?: number | null;
}): void {
  if (stroke || pendingPreview || !modelId || !mesh.geometry) return;
  const borderPreset = settings.borderSupportPresetId
    ? getPresetById(settings.borderSupportPresetId)
    : undefined;
  const infillPreset = settings.infillSupportPresetId
    ? getPresetById(settings.infillSupportPresetId)
    : undefined;
  stroke = {
    modelId,
    mesh,
    geometry: mesh.geometry,
    triangles: new Set(),
    lastDab: null,
    before: normalizeSnapshot(getSnapshot()),
    settings: { ...settings },
    place,
    presetSettings: {
      ...(borderPreset ? { border: borderPreset.settings } : {}),
      ...(infillPreset ? { infill: infillPreset.settings } : {}),
      ...(borderPreset ? { island: borderPreset.settings } : {}),
    },
    clipLower,
    clipUpper,
  islandContacts: islandContactsModelId === modelId ? islandContacts : [],
  };
  notify();
}

/** Select nearby surface triangles with the projection brush. */
export function paintSupportProjectionSurface(modelId: string, localPoint: THREE.Vector3): void {
  const active = stroke;
  if (!active || active.modelId !== modelId) return;
  const positions = active.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!positions) return;
  const index = active.geometry.index;
  const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(positions.count / 3);
  if (triangleCount <= 0) return;

  if (active.lastDab && active.lastDab.distanceTo(localPoint) < active.settings.brushRadiusMm * DAB_SPACING_FRACTION) return;
  active.lastDab = localPoint.clone();

  const radiusSquared = active.settings.brushRadiusMm * active.settings.brushRadiusMm;
  let added = 0;
  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
    if (active.triangles.has(triangleIndex)) continue;
    const [a, b, c] = triangleVertexIndices(active.geometry, triangleIndex);
    if (a >= positions.count || b >= positions.count || c >= positions.count) continue;
    brushTriangle.set(
      vertexScratch.set(positions.getX(a), positions.getY(a), positions.getZ(a)),
      triangleVertexB.set(positions.getX(b), positions.getY(b), positions.getZ(b)),
      triangleVertexC.set(positions.getX(c), positions.getY(c), positions.getZ(c)),
    );
    brushTriangle.closestPointToPoint(localPoint, brushClosestPoint);
    if (brushClosestPoint.distanceToSquared(localPoint) <= radiusSquared) {
      active.triangles.add(triangleIndex);
      added++;
    }
  }
  if (added > 0) notify();
}

function deterministicJitter(ix: number, iy: number, axis: number): number {
  let hash = Math.imul(ix + 374761393, 668265263) ^ Math.imul(iy + axis * 1442695041, 2246822519);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295 - 0.5;
}

function getSelectedBoundaryEdges(active: ProjectionStroke): Array<[THREE.Vector3, THREE.Vector3]> {
  const positions = active.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!positions) return [];
  const edgeTriangles = new Map<string, { a: THREE.Vector3; b: THREE.Vector3; selectedCount: number }>();
  const index = active.geometry.index;
  const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(positions.count / 3);
  const vertex = (vertexIndex: number) => new THREE.Vector3(
    positions.getX(vertexIndex),
    positions.getY(vertexIndex),
    positions.getZ(vertexIndex),
  ).applyMatrix4(active.mesh.matrixWorld);
  const vertexKey = (point: THREE.Vector3) => `${Math.round(point.x * 100000)}:${Math.round(point.y * 100000)}:${Math.round(point.z * 100000)}`;

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
    if (!active.triangles.has(triangleIndex)) continue;
    const indices = triangleVertexIndices(active.geometry, triangleIndex);
    if (indices.some((vertexIndex) => vertexIndex >= positions.count)) continue;
    const points = indices.map(vertex) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
    for (const [aIndex, bIndex] of [[0, 1], [1, 2], [2, 0]] as const) {
      const a = points[aIndex];
      const b = points[bIndex];
      const aKey = vertexKey(a);
      const bKey = vertexKey(b);
      const key = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
      const existing = edgeTriangles.get(key);
      if (existing) existing.selectedCount++;
      else edgeTriangles.set(key, { a, b, selectedCount: 1 });
    }
  }

  return [...edgeTriangles.values()]
    .filter((edge) => edge.selectedCount === 1)
    .map(({ a, b }) => [a, b]);
}

function projectContourBorder(active: ProjectionStroke, intervalMm: number, maxCells: number): ProjectedCandidate[] {
  const edges = getSelectedBoundaryEdges(active);
  const perimeter = edges.reduce((sum, [a, b]) => sum + Math.hypot(b.x - a.x, b.y - a.y), 0);
  if (perimeter <= 1e-6) return [];
  const spacing = Math.max(intervalMm, perimeter / maxCells);
  const boundsMinZ = edges.reduce((min, [a, b]) => Math.min(min, a.z, b.z), Infinity);
  const candidates: Array<{ hit: THREE.Intersection; x: number; y: number; zone: ProjectionZone }> = [];
  let sampledCount = 0;
  for (const [a, b] of edges) {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(length / spacing));
    for (let step = 0; step < steps && sampledCount < maxCells; step++) {
      sampledCount++;
      const t = step / steps;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      rayOrigin.set(x, y, boundsMinZ - 1);
      raycaster.set(rayOrigin, rayDirection);
      rayHits.length = 0;
      raycaster.intersectObject(active.mesh, false, rayHits);
      const hit = rayHits.find((candidate) => {
        if (candidate.faceIndex == null || !active.triangles.has(candidate.faceIndex)) return false;
        if (active.clipLower != null && candidate.point.z < active.clipLower) return false;
        if (active.clipUpper != null && candidate.point.z > active.clipUpper) return false;
        if (!candidate.face) return false;
        const normal = candidate.face.normal.clone().applyMatrix3(triangleNormalMatrix).normalize();
        return THREE.MathUtils.radToDeg(normal.angleTo(DOWN)) <= active.settings.maxAngleDeg;
      });
      if (hit) candidates.push({ hit: cloneHit(hit), x, y, zone: 'border' });
    }
    if (sampledCount >= maxCells) break;
  }
  return applyProjectedSpacing(candidates, intervalMm);
}

function projectSymmetricCandidates(
  active: ProjectionStroke,
  candidates: ProjectedCandidate[],
  center: { x: number; y: number },
  minimumZ: number,
  maximumZ: number,
): ProjectedCandidate[] {
  if (active.settings.symmetryAxis === 'none') return candidates;
  raycaster.far = Math.max(1, maximumZ - minimumZ + 2);
  const result = [...candidates];
  const known = new Set(candidates.map(({ hit }) => `${Math.round(hit.point.x * 1000)}:${Math.round(hit.point.y * 1000)}:${Math.round(hit.point.z * 1000)}`));

  for (const candidate of candidates) {
    const x = active.settings.symmetryAxis === 'x' ? 2 * center.x - candidate.hit.point.x : candidate.hit.point.x;
    const y = active.settings.symmetryAxis === 'y' ? 2 * center.y - candidate.hit.point.y : candidate.hit.point.y;
    if (Math.hypot(x - candidate.hit.point.x, y - candidate.hit.point.y) < 0.001) continue;
    rayOrigin.set(x, y, minimumZ - 1);
    raycaster.set(rayOrigin, rayDirection);
    rayHits.length = 0;
    raycaster.intersectObject(active.mesh, false, rayHits);
    const hit = rayHits.find((intersection) => {
      if (active.clipLower != null && intersection.point.z < active.clipLower) return false;
      if (active.clipUpper != null && intersection.point.z > active.clipUpper) return false;
      if (!intersection.face) return false;
      const normal = intersection.face.normal.clone().applyMatrix3(triangleNormalMatrix).normalize();
      return THREE.MathUtils.radToDeg(normal.angleTo(DOWN)) <= active.settings.maxAngleDeg;
    });
    if (!hit) continue;
    const key = `${Math.round(hit.point.x * 1000)}:${Math.round(hit.point.y * 1000)}:${Math.round(hit.point.z * 1000)}`;
    if (known.has(key)) continue;
    known.add(key);
    result.push({ hit: cloneHit(hit), zone: candidate.zone });
  }
  return result;
}

function getConcentricRingDepths(cells: Map<string, ProjectedCell>): Map<string, number> {
  const depths = new Map<string, number>();
  const queue: Array<{ ix: number; iy: number; key: string }> = [];
  const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;

  for (const key of cells.keys()) {
    const [ix, iy] = key.split(':').map(Number);
    if (neighbors.every(([dx, dy]) => cells.has(`${ix + dx}:${iy + dy}`))) continue;
    depths.set(key, 0);
    queue.push({ ix, iy, key });
  }

  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    const nextDepth = (depths.get(current.key) ?? 0) + 1;
    for (const [dx, dy] of neighbors) {
      const ix = current.ix + dx;
      const iy = current.iy + dy;
      const key = `${ix}:${iy}`;
      if (!cells.has(key) || depths.has(key)) continue;
      depths.set(key, nextDepth);
      queue.push({ ix, iy, key });
    }
  }

  return depths;
}

function applyProjectedSpacing(
  cells: Array<{ hit: THREE.Intersection; x: number; y: number; zone: ProjectionZone }>,
  intervalMm: number,
): ProjectedCandidate[] {
  const accepted: Array<{ hit: THREE.Intersection; x: number; y: number; zone: ProjectionZone }> = [];
  const minDistanceSquared = intervalMm * intervalMm;
  for (const candidate of cells) {
    if (accepted.some((placed) => {
      const dx = candidate.x - placed.x;
      const dy = candidate.y - placed.y;
      return dx * dx + dy * dy < minDistanceSquared;
    })) continue;
    accepted.push(candidate);
  }
  return accepted.map(({ hit, zone }) => ({ hit, zone }));
}

function projectSelectedSurface(active: ProjectionStroke): ProjectedCandidate[] {
  const positions = active.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!positions || active.triangles.size === 0) return [];
  const index = active.geometry.index;
  const triangleCount = index ? Math.floor(index.count / 3) : Math.floor(positions.count / 3);
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  if (active.mesh.matrixAutoUpdate) active.mesh.updateWorldMatrix(true, false);

  for (const triangleIndex of active.triangles) {
    if (triangleIndex < 0 || triangleIndex >= triangleCount) continue;
    const vertices = triangleVertexIndices(active.geometry, triangleIndex);
    for (const vertexIndex of vertices) {
      if (vertexIndex >= positions.count) continue;
      vertexScratch.set(positions.getX(vertexIndex), positions.getY(vertexIndex), positions.getZ(vertexIndex)).applyMatrix4(active.mesh.matrixWorld);
      bounds.minX = Math.min(bounds.minX, vertexScratch.x);
      bounds.maxX = Math.max(bounds.maxX, vertexScratch.x);
      bounds.minY = Math.min(bounds.minY, vertexScratch.y);
      bounds.maxY = Math.max(bounds.maxY, vertexScratch.y);
      bounds.minZ = Math.min(bounds.minZ, vertexScratch.z);
      bounds.maxZ = Math.max(bounds.maxZ, vertexScratch.z);
    }
  }
  if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY)) return [];

  const width = Math.max(0, bounds.maxX - bounds.minX);
  const depth = Math.max(0, bounds.maxY - bounds.minY);
  const baseInterval = Math.min(active.settings.borderIntervalMm, active.settings.infillIntervalMm);
  let spacing = active.settings.pattern === 'concentric' ? baseInterval / 2 : baseInterval;
  const estimateCells = () => Math.max(1, Math.ceil(width / spacing)) * Math.max(1, Math.ceil(depth / spacing));
  if (estimateCells() > MAX_PROJECTION_CELLS) spacing *= Math.sqrt(estimateCells() / MAX_PROJECTION_CELLS);
  while (estimateCells() > MAX_PROJECTION_CELLS) spacing *= 1.05;
  const columns = Math.max(1, Math.ceil(width / spacing));
  const rows = Math.max(1, Math.ceil(depth / spacing));
  const startX = columns === 1 ? (bounds.minX + bounds.maxX) / 2 : bounds.minX + (width - (columns - 1) * spacing) / 2;
  const startY = rows === 1 ? (bounds.minY + bounds.maxY) / 2 : bounds.minY + (depth - (rows - 1) * spacing) / 2;
  const cells = new Map<string, ProjectedCell>();
  (raycaster as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = false;
  raycaster.near = 0;
  raycaster.far = Math.max(1, bounds.maxZ - bounds.minZ + 2);
  triangleNormalMatrix.getNormalMatrix(active.mesh.matrixWorld);

  for (let iy = 0; iy < rows; iy++) {
    for (let ix = 0; ix < columns; ix++) {
      const jitterX = active.settings.pattern === 'random' ? deterministicJitter(ix, iy, 0) * spacing * 0.55 : 0;
      const jitterY = active.settings.pattern === 'random' ? deterministicJitter(ix, iy, 1) * spacing * 0.55 : 0;
      const x = THREE.MathUtils.clamp(startX + ix * spacing + jitterX, bounds.minX, bounds.maxX);
      const y = THREE.MathUtils.clamp(startY + iy * spacing + jitterY, bounds.minY, bounds.maxY);
      rayOrigin.set(x, y, bounds.minZ - 1);
      raycaster.set(rayOrigin, rayDirection);
      rayHits.length = 0;
      raycaster.intersectObject(active.mesh, false, rayHits);
      const hit = rayHits.find((candidate) => {
        if (candidate.faceIndex == null || !active.triangles.has(candidate.faceIndex)) return false;
        if (active.clipLower != null && candidate.point.z < active.clipLower) return false;
        if (active.clipUpper != null && candidate.point.z > active.clipUpper) return false;
        if (!candidate.face) return false;
        const normal = candidate.face.normal.clone().applyMatrix3(triangleNormalMatrix).normalize();
        return THREE.MathUtils.radToDeg(normal.angleTo(DOWN)) <= active.settings.maxAngleDeg;
      });
      if (hit) cells.set(`${ix}:${iy}`, { hit: cloneHit(hit) });
    }
  }

  const borderCandidates: Array<{ hit: THREE.Intersection; x: number; y: number; zone: ProjectionZone }> = [];
  const secondBorderCandidates: Array<{ hit: THREE.Intersection; x: number; y: number; zone: ProjectionZone }> = [];
  const infillCandidates: Array<{ hit: THREE.Intersection; x: number; y: number; zone: ProjectionZone }> = [];
  const ringDepths = active.settings.pattern === 'concentric' || active.settings.doubleBorderEnabled
    ? getConcentricRingDepths(cells)
    : null;
  const ringSpacingCells = Math.max(1, Math.round(active.settings.infillIntervalMm / spacing));
  const secondBorderDepth = Math.max(1, Math.round(active.settings.doubleBorderOffsetMm / spacing));
  for (const [key, cell] of cells) {
    const [ix, iy] = key.split(':').map(Number);
    const isBorder = !cells.has(`${ix - 1}:${iy}`)
      || !cells.has(`${ix + 1}:${iy}`)
      || !cells.has(`${ix}:${iy - 1}`)
      || !cells.has(`${ix}:${iy + 1}`);
    const depth = ringDepths?.get(key);
    if (active.settings.pattern === 'concentric') {
      if (depth === 0 && active.settings.borderEnabled) {
        borderCandidates.push({ hit: cell.hit, x: cell.hit.point.x, y: cell.hit.point.y, zone: 'border' });
      } else if (depth === secondBorderDepth && active.settings.borderEnabled && active.settings.doubleBorderEnabled) {
        secondBorderCandidates.push({ hit: cell.hit, x: cell.hit.point.x, y: cell.hit.point.y, zone: 'border' });
      } else if (depth != null && depth > 0 && depth % ringSpacingCells === 0 && active.settings.infillEnabled) {
        infillCandidates.push({ hit: cell.hit, x: cell.hit.point.x, y: cell.hit.point.y, zone: 'infill' });
      }
    } else {
      if (isBorder && active.settings.borderEnabled) {
        borderCandidates.push({ hit: cell.hit, x: cell.hit.point.x, y: cell.hit.point.y, zone: 'border' });
      } else if (depth === secondBorderDepth && active.settings.borderEnabled && active.settings.doubleBorderEnabled) {
        secondBorderCandidates.push({ hit: cell.hit, x: cell.hit.point.x, y: cell.hit.point.y, zone: 'border' });
      } else if (!isBorder && active.settings.infillEnabled) {
        infillCandidates.push({ hit: cell.hit, x: cell.hit.point.x, y: cell.hit.point.y, zone: 'infill' });
      }
    }
  }

  const candidates = [
    ...(active.settings.pattern === 'contour' && active.settings.borderEnabled
      ? projectContourBorder(active, active.settings.borderIntervalMm, MAX_PROJECTION_CELLS)
      : applyProjectedSpacing(borderCandidates, active.settings.borderIntervalMm)),
    ...applyProjectedSpacing(secondBorderCandidates, active.settings.borderIntervalMm),
    ...applyProjectedSpacing(infillCandidates, active.settings.infillIntervalMm),
  ];
  const modelBounds = new THREE.Box3().setFromObject(active.mesh);
  const modelCenter = modelBounds.getCenter(new THREE.Vector3());
  const symmetricCandidates = projectSymmetricCandidates(active, candidates, modelCenter, modelBounds.min.z, modelBounds.max.z);

  if (!active.settings.islandInfluenceEnabled || active.islandContacts.length === 0 || symmetricCandidates.length === 0) {
    return symmetricCandidates;
  }

  const influenceSquared = active.settings.islandInfluenceMm * active.settings.islandInfluenceMm;
  const acceptedIslandPoints: THREE.Vector3[] = [];
  for (const island of active.islandContacts) {
    const islandPoint = new THREE.Vector3(island.point.x, island.point.y, island.point.z);
    if (acceptedIslandPoints.some((point) => point.distanceToSquared(islandPoint) < 0.09)) continue;

    let nearestIndex = -1;
    let nearestDistanceSquared = Infinity;
    for (let index = 0; index < symmetricCandidates.length; index++) {
      const candidate = symmetricCandidates[index];
      if (candidate.zone === 'island') continue;
      const dx = candidate.hit.point.x - islandPoint.x;
      const dy = candidate.hit.point.y - islandPoint.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared < nearestDistanceSquared) {
        nearestIndex = index;
        nearestDistanceSquared = distanceSquared;
      }
    }
    if (nearestIndex < 0 || nearestDistanceSquared > influenceSquared) continue;

    rayOrigin.set(islandPoint.x, islandPoint.y, bounds.minZ - 1);
    raycaster.set(rayOrigin, rayDirection);
    rayHits.length = 0;
    raycaster.intersectObject(active.mesh, false, rayHits);
    const hit = rayHits.find((candidate) => {
      if (candidate.faceIndex == null || !active.triangles.has(candidate.faceIndex)) return false;
      if (active.clipLower != null && candidate.point.z < active.clipLower) return false;
      if (active.clipUpper != null && candidate.point.z > active.clipUpper) return false;
      if (!candidate.face) return false;
      const normal = candidate.face.normal.clone().applyMatrix3(triangleNormalMatrix).normalize();
      return THREE.MathUtils.radToDeg(normal.angleTo(DOWN)) <= active.settings.maxAngleDeg;
    });
    if (!hit) continue;

    symmetricCandidates[nearestIndex] = { hit: cloneHit(hit), zone: 'island' };
    acceptedIslandPoints.push(islandPoint);
  }

  return symmetricCandidates;
}

export function finishSupportProjectionStroke(): void {
  const completed = stroke;
  if (!completed) return;
  const projectedHits = projectSelectedSurface(completed);
  stroke = null;
  pendingPreview = projectedHits.length > 0
    ? {
      stroke: completed,
      candidates: projectedHits,
      points: projectedHits.map(({ hit }) => {
        const normal = hit.face
          ? hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize()
          : new THREE.Vector3(0, 0, 1);
        const point = hit.point.clone().addScaledVector(normal, 0.025);
        return hit.object.worldToLocal(point);
      }),
    }
    : null;
  notify();
}

export function cancelSupportProjectionPreview(): boolean {
  if (!pendingPreview) return false;
  pendingPreview = null;
  notify();
  return true;
}

export function applySupportProjectionPreview(): boolean {
  const preview = pendingPreview;
  if (!preview) return false;
  pendingPreview = null;
  notify();

  const endBatch = beginSupportHistoryBatch();
  const knownIds = new Set(Object.keys(getSupports()));
  try {
    for (const candidate of preview.candidates) {
      preview.stroke.place(candidate.hit, preview.stroke.presetSettings[candidate.zone]);
      const tag = candidate.zone === 'infill'
        ? preview.stroke.settings.infillTag
        : preview.stroke.settings.borderTag;
      for (const [id, entity] of Object.entries(getSupports())) {
        if (knownIds.has(id)) continue;
        knownIds.add(id);
        if (!tag) continue;
        const typeId = getSupportTypeOf(id);
        if (!typeId) continue;
        updateSupportEntity(typeId, {
          ...entity,
          supportTags: Array.from(new Set([...(entity.supportTags ?? []), tag])),
        });
      }
    }
  } finally {
    endBatch();
  }

  const after = normalizeSnapshot(getSnapshot());
  if (JSON.stringify(preview.stroke.before) === JSON.stringify(after)) return true;
  pushSupportHistory({ type: SUPPORT_PROJECTION, payload: { before: preview.stroke.before, after } });
  return true;
}
