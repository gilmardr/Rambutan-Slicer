import type { DistanceMeasurementMode } from './distanceMeasurementMath';

export type MeasurementPoint = {
  modelId: string;
  position: [number, number, number];
};

export type DistanceMeasurementState = {
  enabled: boolean;
  mode: DistanceMeasurementMode;
  points: MeasurementPoint[];
};

const EMPTY_STATE: DistanceMeasurementState = { enabled: false, mode: 'point-to-point', points: [] };
let state = EMPTY_STATE;
const listeners = new Set<() => void>();

function publish(next: DistanceMeasurementState) {
  state = next;
  listeners.forEach((listener) => listener());
}

export function subscribeToDistanceMeasurement(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDistanceMeasurementSnapshot() {
  return state;
}

export function getDistanceMeasurementServerSnapshot() {
  return EMPTY_STATE;
}

export function startDistanceMeasurement(mode: DistanceMeasurementMode = 'point-to-point') {
  publish({ enabled: true, mode, points: [] });
}

export function setDistanceMeasurementMode(mode: DistanceMeasurementMode) {
  if (state.mode === mode && state.enabled && state.points.length === 0) return;
  publish({ enabled: true, mode, points: [] });
}

export function stopDistanceMeasurement() {
  if (!state.enabled) return;
  publish({ ...state, enabled: false });
}

export function clearDistanceMeasurement() {
  if (state.points.length === 0) return;
  publish({ ...state, points: [] });
}

export function recordDistanceMeasurementPoint(modelId: string, position: [number, number, number]) {
  if (!state.enabled || !position.every(Number.isFinite)) return;

  const requiredPoints = state.mode === 'point-to-point' ? 2 : state.mode === 'point-to-plane' ? 4 : 6;
  // After a complete measurement, the next click starts another in the active mode.
  const points = state.points.length >= requiredPoints ? [] : state.points;
  publish({ ...state, points: [...points, { modelId, position }] });
}
