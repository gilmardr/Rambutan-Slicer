import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { CollisionMeshInput } from '@/features/model-collision/modelCollision';

export type ProximitySegmentInput = {
  modelId: string;
  supportId: string;
  diameterMm: number;
  start: [number, number, number];
  end: [number, number, number];
  controlPoints?: [[number, number, number], [number, number, number]];
  ignoreStartMm: number;
  ignoreEndMm: number;
};

export type SupportProximityInput = {
  models: CollisionMeshInput[];
  segments: ProximitySegmentInput[];
  clearanceThresholdMm: number;
};

export type SupportProximityIssue = {
  modelId: string;
  supportId: string;
  clearanceMm: number;
};

export type SupportProximityReport = {
  issues: SupportProximityIssue[];
  checkedModelIds: string[];
  skippedModelIds: string[];
};

export type SupportProximityWorkerResponse = { report: SupportProximityReport } | { error: true };

type PreparedMesh = {
  geometry: THREE.BufferGeometry;
  bvh: MeshBVH;
};

const SAMPLE_SPACING_MM = 0.5;
const MAX_SAMPLE_COUNT = 8192;

function prepareMesh(input: CollisionMeshInput): PreparedMesh | null {
  const vertexCount = input.positions.length / 3;
  const indexCount = input.indices?.length ?? vertexCount;
  if (vertexCount < 3 || !Number.isInteger(vertexCount) || indexCount < 3 || indexCount % 3 !== 0
    || input.positions.some((value) => !Number.isFinite(value))
    || input.indices?.some((index) => index >= vertexCount)
    || input.worldMatrix.length !== 16 || !input.worldMatrix.every(Number.isFinite)) return null;

  const matrix = new THREE.Matrix4().fromArray(input.worldMatrix);
  if (Math.abs(matrix.determinant()) < 1e-15) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(input.positions.slice(), 3));
  if (input.indices) geometry.setIndex(new THREE.BufferAttribute(input.indices.slice(), 1));
  geometry.applyMatrix4(matrix);
  geometry.computeBoundingBox();
  if (!geometry.boundingBox) {
    geometry.dispose();
    return null;
  }
  return { geometry, bvh: new MeshBVH(geometry, { maxLeafTris: 10 }) };
}

function toVector(point: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(point[0], point[1], point[2]);
}

function makeCurve(segment: ProximitySegmentInput): THREE.Curve<THREE.Vector3> {
  const start = toVector(segment.start);
  const end = toVector(segment.end);
  if (!segment.controlPoints) return new THREE.LineCurve3(start, end);
  return new THREE.CubicBezierCurve3(
    start,
    toVector(segment.controlPoints[0]),
    toVector(segment.controlPoints[1]),
    end,
  );
}

/** Checks sampled shaft surfaces against the displayed meshes; source arrays are never mutated. */
export function scanSupportProximity(input: SupportProximityInput): SupportProximityReport {
  const report: SupportProximityReport = { issues: [], checkedModelIds: [], skippedModelIds: [] };
  const meshes = new Map<string, PreparedMesh>();
  const issueBySupport = new Map<string, SupportProximityIssue>();

  try {
    for (const model of input.models) {
      const prepared = prepareMesh(model);
      if (!prepared) {
        report.skippedModelIds.push(model.id);
        continue;
      }
      meshes.set(model.id, prepared);
      report.checkedModelIds.push(model.id);
    }

    const threshold = Number.isFinite(input.clearanceThresholdMm)
      ? Math.max(0, input.clearanceThresholdMm)
      : 0.5;

    for (const segment of input.segments) {
      const mesh = meshes.get(segment.modelId);
      if (!mesh || !Number.isFinite(segment.diameterMm) || segment.diameterMm <= 0) continue;

      const curve = makeCurve(segment);
      const length = curve.getLength();
      if (!Number.isFinite(length) || length <= 1e-6) continue;
      const steps = Math.min(MAX_SAMPLE_COUNT, Math.max(1, Math.ceil(length / SAMPLE_SPACING_MM)));
      const startStep = Math.min(steps, Math.ceil(Math.max(0, segment.ignoreStartMm) / length * steps));
      const endStep = Math.max(0, steps - Math.ceil(Math.max(0, segment.ignoreEndMm) / length * steps));
      if (startStep > endStep) continue;

      const radius = segment.diameterMm / 2;
      const searchDistance = radius + threshold + SAMPLE_SPACING_MM / 2;
      const point = new THREE.Vector3();
      for (let step = startStep; step <= endStep; step += 1) {
        curve.getPointAt(step / steps, point);
        if (mesh.geometry.boundingBox!.distanceToPoint(point) > searchDistance) continue;
        const nearest = mesh.bvh.closestPointToPoint(point, undefined, 0, searchDistance);
        if (!nearest) continue;

        const clearanceMm = nearest.distance - radius;
        if (clearanceMm > threshold + SAMPLE_SPACING_MM / 2) continue;
        const previous = issueBySupport.get(segment.supportId);
        if (!previous || clearanceMm < previous.clearanceMm) {
          issueBySupport.set(segment.supportId, {
            modelId: segment.modelId,
            supportId: segment.supportId,
            clearanceMm,
          });
        }
      }
    }

    report.issues = [...issueBySupport.values()].sort((a, b) => a.clearanceMm - b.clearanceMm);
    return report;
  } finally {
    for (const mesh of meshes.values()) mesh.geometry.dispose();
  }
}
