import * as THREE from 'three';
import type { RaftSettings, SupportBaseCircle } from '../RaftTypes';
import { minimumRaftReliefPitch, RAFT_BASE_RELIEF_MIN_WEB_MM } from '../RaftTypes';
import {
  differencePolygonSets,
  offsetPolygonSet,
  polygonSetAreaMm2,
  polygonSetContains,
  type PolygonWithHoles,
} from './polygonSet2d';

const MAX_RELIEF_OPENINGS = 2500;

type ReliefSettings = Pick<RaftSettings,
  'baseReliefEnabled' | 'baseReliefPattern' | 'baseReliefHoleDiameterMm' | 'baseReliefPitchMm'>;

function openingRing(x: number, y: number, radius: number, sides: number): THREE.Vector2[] {
  return Array.from({ length: sides }, (_, index) => {
    const angle = (index / sides) * Math.PI * 2;
    return new THREE.Vector2(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
  });
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * Adds a grid of material-relief openings to a solid raft footprint.
 * The openings stay clear of the perimeter and support feet, and the minimum
 * web and pitch prevent the boolean from leaving fragile slivers.
 */
export function applyRaftBaseRelief(
  footprint: readonly PolygonWithHoles[],
  supportBases: readonly SupportBaseCircle[],
  settings: ReliefSettings,
): PolygonWithHoles[] {
  if (!settings.baseReliefEnabled || footprint.length === 0) return [...footprint];

  const requestedDiameter = Number.isFinite(settings.baseReliefHoleDiameterMm)
    ? settings.baseReliefHoleDiameterMm
    : 2;
  const diameter = Math.min(8, Math.max(0.5, requestedDiameter));
  const radius = diameter / 2;
  const minimumWeb = RAFT_BASE_RELIEF_MIN_WEB_MM;
  const requestedPitch = Number.isFinite(settings.baseReliefPitchMm)
    ? settings.baseReliefPitchMm
    : 6;
  const pattern = settings.baseReliefPattern;
  const staggered = pattern === 'staggered-round' || pattern === 'staggered-hex';
  const sides = pattern === 'staggered-hex' ? 6 : pattern === 'staggered-round' ? 12 : 24;
  const basePitch = Math.max(minimumRaftReliefPitch(diameter, pattern), requestedPitch);
  const columnPitch = basePitch * (staggered ? Math.sqrt(3) / 2 : 1);

  // Erosion produces the safe center region: an opening is placed only where
  // its edge can retain the minimum web from the raft boundary and any holes.
  const safeCenters = offsetPolygonSet(footprint, -(radius + minimumWeb));
  if (safeCenters.length === 0) return [...footprint];

  const safeArea = Math.max(0, polygonSetAreaMm2(safeCenters));
  const estimatedOpenings = safeArea / (columnPitch * basePitch);
  const gridStride = Math.max(1, Math.ceil(Math.sqrt(estimatedOpenings / MAX_RELIEF_OPENINGS)));

  const points = safeCenters.flatMap((poly) => poly.outer);
  if (points.length === 0) return [...footprint];
  const bounds = points.reduce((current, point) => ({
    minX: Math.min(current.minX, point.x),
    maxX: Math.max(current.maxX, point.x),
    minY: Math.min(current.minY, point.y),
    maxY: Math.max(current.maxY, point.y),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  const { minX, maxX, minY, maxY } = bounds;

  const rootRadii = supportBases.map((base) => Math.max(0, Number.isFinite(base.r) ? base.r : 0));
  const maxRootRadius = rootRadii.reduce((maximum, rootRadius) => Math.max(maximum, rootRadius), 0);
  const rootCellSize = Math.max(0.01, maxRootRadius + radius + minimumWeb);
  const rootsByCell = new Map<string, Array<{ x: number; y: number; radius: number }>>();
  supportBases.forEach((base, index) => {
    if (!Number.isFinite(base.x) || !Number.isFinite(base.y)) return;
    const cellX = Math.floor(base.x / rootCellSize);
    const cellY = Math.floor(base.y / rootCellSize);
    const key = cellKey(cellX, cellY);
    const cell = rootsByCell.get(key) ?? [];
    cell.push({ x: base.x, y: base.y, radius: rootRadii[index] });
    rootsByCell.set(key, cell);
  });

  const blockedBySupportFoot = (x: number, y: number): boolean => {
    const cellX = Math.floor(x / rootCellSize);
    const cellY = Math.floor(y / rootCellSize);
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (const base of rootsByCell.get(cellKey(cellX + offsetX, cellY + offsetY)) ?? []) {
          const keepOutRadius = base.radius + radius + minimumWeb;
          const dx = x - base.x;
          const dy = y - base.y;
          if (dx * dx + dy * dy <= keepOutRadius * keepOutRadius) return true;
        }
      }
    }
    return false;
  };

  const openings: PolygonWithHoles[] = [];
  const dx = columnPitch * gridStride;
  const dy = basePitch * gridStride;
  for (let gridX = Math.ceil(minX / dx); gridX <= Math.floor(maxX / dx) && openings.length < MAX_RELIEF_OPENINGS; gridX += 1) {
    const x = gridX * dx;
    const rowOffset = staggered && gridX % 2 !== 0 ? dy / 2 : 0;
    for (let gridY = Math.ceil((minY - rowOffset) / dy); gridY <= Math.floor((maxY - rowOffset) / dy) && openings.length < MAX_RELIEF_OPENINGS; gridY += 1) {
      const y = gridY * dy + rowOffset;
      if (!polygonSetContains(safeCenters, x, y) || blockedBySupportFoot(x, y)) continue;
      openings.push({ outer: openingRing(x, y, radius, sides), holes: [] });
    }
  }

  return openings.length > 0 ? differencePolygonSets(footprint, openings) : [...footprint];
}
