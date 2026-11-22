import * as THREE from 'three';
import type { HomeSupportCollectionsSnapshot } from '@/features/supports/supportSnapshotHelpers';
import type { PlateRect } from '@/features/scene/arrange/plateFreeSpace';
import type { GeometryWithBounds } from '@/hooks/useStlGeometry';
import { computeFootprint } from '@/supports/Rafts/Crenelated/geometry/computeFootprint';
import { raftBandTopMm } from '@/supports/Rafts/Crenelated/geometry/computeRaftFootprint';
import { computeRaftOuterBoundary } from '@/supports/Rafts/Crenelated/geometry/computeRaftOuterBoundary';
import type { getRaftSettings, getRaftSettingsForModel } from '@/supports/Rafts/Crenelated/RaftState';
import type { SupportBaseCircle } from '@/supports/Rafts/Crenelated/RaftTypes';
import { modelIdOfParentShaft } from '@/supports/PlacementLogic/SupportModelLinker';
import { knotFields } from '@/supports/interaction/shared/selection/selectedIdsByType';
import { contactEndpointsFor, SUPPORT_TYPES, type SupportCollectionKey } from '@/supports/supportTypeRegistry';
import type { Segment } from '@/supports/types';
import { computePreciseModelWorldBounds } from '@/utils/modelBounds';
import { eulerFromGlobalEuler, quaternionFromGlobalEuler } from '@/utils/rotation';

/**
 * Arrange geometry of the Home page, moved verbatim out of src/app/page.tsx so the page holds only the
 * Home component's own state and wiring.
 */

export function getLongPartPlateYaw(
  geometry: GeometryWithBounds,
  transform: Parameters<typeof computePreciseModelWorldBounds>[1],
  plate: PlateRect,
): number {
  const plateWidth = plate.maxX - plate.minX;
  const plateDepth = plate.maxY - plate.minY;
  const position = geometry.geometry.getAttribute('position');
  if (!position || position.count < 3 || Math.abs(plateWidth - plateDepth) < 0.01) return 0;

  // Find the long axis of the projected mesh, including diagonal poses.
  const rotation = quaternionFromGlobalEuler(transform.rotation);
  const vertex = new THREE.Vector3();
  const stride = Math.max(1, Math.floor(position.count / 2048));
  let count = 0;
  let x = 0;
  let y = 0;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (let i = 0; i < position.count; i += stride) {
    vertex.fromBufferAttribute(position, i).sub(geometry.center).multiply(transform.scale).applyQuaternion(rotation);
    x += vertex.x;
    y += vertex.y;
    xx += vertex.x * vertex.x;
    xy += vertex.x * vertex.y;
    yy += vertex.y * vertex.y;
    count += 1;
  }
  const axis = Math.atan2(2 * (xy - x * y / count), (xx - x * x / count) - (yy - y * y / count)) / 2;
  if (!Number.isFinite(axis)) return 0;
  const { x: rx, y: ry, z: rz } = transform.rotation;
  const size = computePreciseModelWorldBounds(geometry, {
    ...transform,
    rotation: eulerFromGlobalEuler({ x: rx, y: ry, z: rz - axis }),
  }).getSize(vertex);
  if (size.x < 1.6 * Math.max(size.y, size.z, 0.01)) return 0;

  const target = plateWidth > plateDepth ? 0 : Math.PI / 2;
  // The axis has no direction. Choose the equivalent turn closest to the current pose.
  return THREE.MathUtils.euclideanModulo(target - axis + Math.PI / 2, Math.PI) - Math.PI / 2;
}

export function computeArrangeSupportBounds(
  supportStateSnapshot: HomeSupportCollectionsSnapshot,
  raftSettingsSnapshot: ReturnType<typeof getRaftSettings>,
  resolveModelRaftSettings?: typeof getRaftSettingsForModel,
) {
  const boundsByModelId = new Map<string, THREE.Box3>();
  const supportOnlyBoundsByModelId = new Map<string, THREE.Box3>();
  const raftBoundsByModelId = new Map<string, THREE.Box3>();

  const expandInto = (
    target: Map<string, THREE.Box3>,
    modelId: string | null | undefined,
    pos: { x: number; y: number; z: number } | null | undefined,
    radiusMm = 0,
  ) => {
    if (!modelId || !pos) return;
    let bounds = target.get(modelId);
    if (!bounds) {
      bounds = new THREE.Box3();
      target.set(modelId, bounds);
    }
    const radius = Math.max(0, radiusMm);
    bounds.expandByPoint(new THREE.Vector3(pos.x - radius, pos.y - radius, pos.z - radius));
    bounds.expandByPoint(new THREE.Vector3(pos.x + radius, pos.y + radius, pos.z + radius));
  };

  const expand = (modelId: string | null | undefined, pos: { x: number; y: number; z: number } | null | undefined, radiusMm = 0) => {
    expandInto(boundsByModelId, modelId, pos, radiusMm);
    expandInto(supportOnlyBoundsByModelId, modelId, pos, radiusMm);
  };

  const expandRaft = (modelId: string, pos: { x: number; y: number; z: number }) => {
    expandInto(boundsByModelId, modelId, pos);
    expandInto(raftBoundsByModelId, modelId, pos);
  };

  // Which model each knot belongs to, from the `hostedBy knots` edges every
  // type declares. A brace lands under both its ends because it declares two.
  const knotModelById = new Map<string, string>();
  for (const descriptor of SUPPORT_TYPES) {
    const fields = knotFields(descriptor);
    if (fields.length === 0) continue;

    const collection = supportStateSnapshot[descriptor.location.key as SupportCollectionKey] as unknown as
      Record<string, Record<string, unknown>>;
    for (const entity of Object.values(collection ?? {})) {
      const modelId = entity.modelId as string | undefined;
      if (!modelId) continue;
      for (const field of fields) {
        const knotId = entity[field];
        if (typeof knotId === 'string') knotModelById.set(knotId, modelId);
      }
    }
  }

  for (const root of Object.values(supportStateSnapshot.roots)) {
    expand(root.modelId, root.transform?.pos, Math.max(0.001, root.diameter / 2));
    expand(root.modelId, {
      x: root.transform.pos.x,
      y: root.transform.pos.y,
      z: root.transform.pos.z + Math.max(0, root.diskHeight) + Math.max(0, root.coneHeight),
    }, Math.max(0.001, root.diameter / 2));
  }

  if (resolveModelRaftSettings || raftSettingsSnapshot.bottomMode !== 'off') {
    const rootsByModel = new Map<string, SupportBaseCircle[]>();

    for (const root of Object.values(supportStateSnapshot.roots)) {
      if (!root.modelId) continue;
      if (!rootsByModel.has(root.modelId)) rootsByModel.set(root.modelId, []);
      rootsByModel.get(root.modelId)!.push({
        x: root.transform.pos.x,
        y: root.transform.pos.y,
        r: root.diameter / 2,
      });
    }

    for (const [modelId, circles] of rootsByModel) {
      const raft = resolveModelRaftSettings?.(modelId) ?? raftSettingsSnapshot;
      if (circles.length === 0 || raft.bottomMode === 'off') continue;

      const thickness = raft.bottomMode === 'line' ? raft.lineHeightMm : raft.thickness;
      const chamferInset = Math.max(0, thickness) * Math.tan((Math.PI / 180) * (90 - Math.min(90, Math.max(45, raft.chamferAngle))));
      const wallInset = raft.wallEnabled ? Math.max(0, raft.wallThickness) : 0;
      const dynamicMargin = 0.2 + Math.max(chamferInset, wallInset);

      const baseProfile = computeFootprint(circles, {
        marginMm: dynamicMargin,
        samplesPerCircle: 24,
      });

      if (!baseProfile || baseProfile.length < 3) continue;

      const outerProfile = raft.wallEnabled
        ? computeRaftOuterBoundary(baseProfile, raft)
        : baseProfile;

      const raftMaxZ = raftBandTopMm(raft);

      for (const p of outerProfile) {
        expandRaft(modelId, { x: p.x, y: p.y, z: 0 });
        expandRaft(modelId, { x: p.x, y: p.y, z: raftMaxZ });
      }
    }
  }

  // Every type's joints and declared contacts, so each one grows the bounds.
  for (const descriptor of SUPPORT_TYPES) {
    const collection = supportStateSnapshot[descriptor.location.key as SupportCollectionKey] as unknown as
      Record<string, { modelId?: string; segments?: Segment[] }>;

    for (const entity of Object.values(collection ?? {})) {
      const modelId = entity.modelId;
      if (!modelId) continue;

      for (const seg of entity.segments ?? []) {
        expand(modelId, seg.topJoint?.pos, Math.max(0.001, (seg.topJoint?.diameter ?? seg.diameter) / 2));
        expand(modelId, seg.bottomJoint?.pos, Math.max(0.001, (seg.bottomJoint?.diameter ?? seg.diameter) / 2));
      }

      for (const { kind, field } of contactEndpointsFor(descriptor.id)) {
        const contact = (entity as unknown as Record<string, unknown>)[field];
        if (!contact) continue;
        // A disk carries its contact diameter directly; a cone in its profile.
        const c = contact as { pos: { x: number; y: number; z: number }; contactDiameterMm?: number; profile?: { contactDiameterMm?: number } };
        const diameter = kind === 'disk' ? c.contactDiameterMm : c.profile?.contactDiameterMm;
        expand(modelId, c.pos, Math.max(0.001, (diameter ?? 0.002) / 2));
      }
    }
  }

  // A knot with no hosting entity falls back to the shaft it sits on.
  for (const knot of Object.values(supportStateSnapshot.knots)) {
    const modelId = knotModelById.get(knot.id)
      ?? modelIdOfParentShaft(supportStateSnapshot, knot.parentShaftId);
    expand(modelId, knot.pos, Math.max(0.001, (knot.diameter ?? 1.2) / 2));
  }

  return { all: boundsByModelId, supports: supportOnlyBoundsByModelId, rafts: raftBoundsByModelId };
}
