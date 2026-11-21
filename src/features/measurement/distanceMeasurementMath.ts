import type { MeasurementPoint } from './distanceMeasurementStore';

export type DistanceMeasurementMode = 'point-to-point' | 'point-to-plane' | 'plane-to-plane';
export type MeasurementVector = [number, number, number];

export type DistanceMeasurementResult = {
  distance: number;
  segment: [MeasurementVector, MeasurementVector];
};

const PARALLEL_TOLERANCE_COS = Math.cos(Math.PI / 180);

function subtract(a: MeasurementVector, b: MeasurementVector): MeasurementVector {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function addScaled(point: MeasurementVector, direction: MeasurementVector, scale: number): MeasurementVector {
  return [
    point[0] + direction[0] * scale,
    point[1] + direction[1] * scale,
    point[2] + direction[2] * scale,
  ];
}

function dot(a: MeasurementVector, b: MeasurementVector) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: MeasurementVector, b: MeasurementVector): MeasurementVector {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(vector: MeasurementVector): MeasurementVector | null {
  const length = Math.hypot(...vector);
  if (!Number.isFinite(length) || length < 1e-8) return null;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function positionAt(points: readonly MeasurementPoint[], index: number) {
  return points[index]?.position;
}

function planeNormal(points: readonly MeasurementPoint[], start: number) {
  const origin = positionAt(points, start);
  const second = positionAt(points, start + 1);
  const third = positionAt(points, start + 2);
  if (!origin || !second || !third) return null;
  return normalize(cross(subtract(second, origin), subtract(third, origin)));
}

function makeResult(segment: [MeasurementVector, MeasurementVector]): DistanceMeasurementResult {
  return { distance: Math.hypot(...subtract(segment[1], segment[0])), segment };
}

export function calculateMeasurement(
  mode: DistanceMeasurementMode,
  points: readonly MeasurementPoint[],
): DistanceMeasurementResult | null {
  if (mode === 'point-to-point') {
    if (points.length !== 2) return null;
    const first = positionAt(points, 0);
    const second = positionAt(points, 1);
    return first && second ? makeResult([first, second]) : null;
  }

  if (mode === 'point-to-plane') {
    if (points.length !== 4) return null;
    const point = positionAt(points, 0);
    const planeOrigin = positionAt(points, 1);
    const normal = planeNormal(points, 1);
    if (!point || !planeOrigin || !normal) return null;
    const signedDistance = dot(subtract(point, planeOrigin), normal);
    const projection = addScaled(point, normal, -signedDistance);
    return makeResult([point, projection]);
  }

  if (points.length !== 6) return null;
  const firstPlaneOrigin = positionAt(points, 0);
  const secondPlaneOrigin = positionAt(points, 3);
  const firstNormal = planeNormal(points, 0);
  const secondNormal = planeNormal(points, 3);
  if (!firstPlaneOrigin || !secondPlaneOrigin || !firstNormal || !secondNormal) return null;
  if (Math.abs(dot(firstNormal, secondNormal)) < PARALLEL_TOLERANCE_COS) return null;

  const signedDistance = dot(subtract(secondPlaneOrigin, firstPlaneOrigin), firstNormal);
  const closestPoint = addScaled(firstPlaneOrigin, firstNormal, signedDistance);
  return makeResult([firstPlaneOrigin, closestPoint]);
}
