import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

/** Owned copies of the displayed mesh; worldMatrix includes the centering offset. */
export type CollisionMeshInput = {
  id: string;
  plateId: string;
  positions: Float32Array;
  indices?: Uint32Array;
  worldMatrix: number[];
  reducedPreview: boolean;
};

export type CollisionPair = {
  modelIds: [string, string];
  location?: [number, number, number];
  kind: 'surface-contact' | 'containment' | 'uncertain';
};

export type CollisionReport = {
  pairs: CollisionPair[];
  checkedModelIds: string[];
  openModelIds: string[];
  skippedModelIds: string[];
  previewModelIds: string[];
};

export type CollisionWorkerResponse = { report: CollisionReport } | { error: true };

type PreparedMesh = {
  input: CollisionMeshInput;
  geometry: THREE.BufferGeometry;
  bvh: MeshBVH;
  closed: boolean;
  samples: THREE.Vector3[];
  epsilon: number;
};

// Welding exact positions handles STL triangle soup without closing real gaps.
// One sample per connected component also catches a small contained shell when
// the first shell in the same model is outside the other model.
function inspectTopology(geometry: THREE.BufferGeometry) {
  const positions = geometry.getAttribute('position');
  const indices = geometry.index;
  const vertices = new Map<string, number>();
  const vertexIds: number[] = [];
  const parents: number[] = [];
  const points: THREE.Vector3[] = [];
  const edges = new Map<string, { count: number; direction: number }>();
  for (let i = 0; i < positions.count; i += 1) {
    const point = new THREE.Vector3().fromBufferAttribute(positions, i);
    const key = `${point.x},${point.y},${point.z}`;
    let id = vertices.get(key);
    if (id === undefined) {
      id = points.length;
      vertices.set(key, id);
      parents.push(id);
      points.push(point);
    }
    vertexIds.push(id);
  }
  const root = (id: number): number => {
    while (parents[id] !== id) {
      parents[id] = parents[parents[id]];
      id = parents[id];
    }
    return id;
  };
  const used = new Set<number>();
  const count = indices?.count ?? positions.count;
  let closed = true;
  for (let i = 0; i < count; i += 3) {
    const ids = [0, 1, 2].map((j) => vertexIds[indices ? indices.getX(i + j) : i + j]);
    if (new Set(ids).size < 3) closed = false;
    for (let j = 0; j < 3; j += 1) {
      const a = ids[j];
      const b = ids[(j + 1) % 3];
      used.add(a);
      parents[root(b)] = root(a);
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const edge = edges.get(key) ?? { count: 0, direction: 0 };
      edge.count += 1;
      edge.direction += a < b ? 1 : -1;
      edges.set(key, edge);
    }
  }
  closed &&= [...edges.values()].every((edge) => edge.count === 2 && edge.direction === 0);
  const samples = new Map<number, THREE.Vector3>();
  for (const id of used) samples.set(root(id), points[id]);
  return { closed, samples: [...samples.values()] };
}

function prepare(input: CollisionMeshInput): PreparedMesh | null {
  const count = input.indices?.length ?? input.positions.length / 3;
  if (input.positions.length === 0 || input.positions.length % 3 !== 0 || count < 3 || count % 3 !== 0
    || !input.positions.every(Number.isFinite) || input.worldMatrix.length !== 16
    || !input.worldMatrix.every(Number.isFinite)
    || input.indices?.some((index) => index >= input.positions.length / 3)) return null;
  const matrix = new THREE.Matrix4().fromArray(input.worldMatrix);
  if (Math.abs(matrix.determinant()) < 1e-15) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(input.positions.slice(), 3));
  if (input.indices) geometry.setIndex(new THREE.BufferAttribute(input.indices.slice(), 1));
  geometry.applyMatrix4(matrix);
  geometry.computeBoundingBox();
  const topology = inspectTopology(geometry);
  const epsilon = Math.max(1e-7, geometry.boundingBox!.getSize(new THREE.Vector3()).length() * 1e-7);
  const bvh = new MeshBVH(geometry, { maxLeafTris: 10 });
  return { input, geometry, bvh, epsilon, ...topology };
}

const DIRECTIONS = [
  new THREE.Vector3(1, 0.371, 0.173).normalize(),
  new THREE.Vector3(0.219, 1, 0.413).normalize(),
  new THREE.Vector3(0.317, 0.193, 1).normalize(),
];

function pointInside(point: THREE.Vector3, mesh: PreparedMesh): boolean | null {
  if (!mesh.geometry.boundingBox!.containsPoint(point)) return false;
  const nearest = mesh.bvh.closestPointToPoint(point, undefined, 0, mesh.epsilon);
  if (nearest && nearest.distance <= mesh.epsilon) return null;
  const votes = DIRECTIONS.map((direction) => {
    const hits = mesh.bvh.raycast(new THREE.Ray(point, direction), THREE.DoubleSide)
      .sort((a, b) => a.distance - b.distance);
    let crossings = 0;
    let previous = -Infinity;
    for (const hit of hits) {
      // A ray through a shared edge sees several triangles at one crossing.
      if (hit.distance - previous > mesh.epsilon) crossings += 1;
      previous = hit.distance;
    }
    return crossings % 2 === 1;
  });
  return votes.every((value) => value === votes[0]) ? votes[0] : null;
}

/** Surface contact is not proof of positive overlapping volume. No input mutates. */
export function scanModelCollisions(inputs: readonly CollisionMeshInput[]): CollisionReport {
  const report: CollisionReport = {
    pairs: [], checkedModelIds: [], openModelIds: [], skippedModelIds: [], previewModelIds: [],
  };
  const meshes: PreparedMesh[] = [];
  try {
    for (const input of inputs) {
      const mesh = prepare(input);
      if (!mesh) {
        report.skippedModelIds.push(input.id);
        continue;
      }
      meshes.push(mesh);
      report.checkedModelIds.push(input.id);
      if (!mesh.closed) report.openModelIds.push(input.id);
      if (input.reducedPreview) report.previewModelIds.push(input.id);
    }
    const identity = new THREE.Matrix4();
    for (let i = 0; i < meshes.length; i += 1) {
      const a = meshes[i];
      for (let j = i + 1; j < meshes.length; j += 1) {
        const b = meshes[j];
        if (a.input.plateId !== b.input.plateId
          || !a.geometry.boundingBox!.intersectsBox(b.geometry.boundingBox!)) continue;
        const modelIds: [string, string] = [a.input.id, b.input.id];
        const overlap = a.geometry.boundingBox!.clone().intersect(b.geometry.boundingBox!);
        const location = overlap.getCenter(new THREE.Vector3()).toArray();
        const contact = new THREE.Line3();
        if (a.bvh.bvhcast(b.bvh, identity, {
          intersectsTriangles: (left, right) => {
            if (!left.intersectsTriangle(right, contact)) return false;
            const midpoint = contact.getCenter(new THREE.Vector3());
            if (overlap.containsPoint(midpoint)) midpoint.toArray(location);
            return true;
          },
        })) {
          report.pairs.push({ modelIds, location, kind: 'surface-contact' });
          continue;
        }
        if (!a.closed || !b.closed) {
          report.pairs.push({ modelIds, location, kind: 'uncertain' });
          continue;
        }
        const classifications = [
          ...a.samples.map((point) => pointInside(point, b)),
          ...b.samples.map((point) => pointInside(point, a)),
        ];
        if (classifications.includes(true)) report.pairs.push({ modelIds, location, kind: 'containment' });
        else if (classifications.includes(null)) report.pairs.push({ modelIds, location, kind: 'uncertain' });
      }
    }
    return report;
  } finally {
    for (const mesh of meshes) mesh.geometry.dispose();
  }
}
