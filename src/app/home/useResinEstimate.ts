import React from 'react';
import * as THREE from 'three';
import type { useLingui } from '@lingui/react';
import type { getActiveMaterialProfile } from '@/features/profiles/profileStore';
import type { useSceneCollectionManager } from '@/features/scene/useSceneCollectionManager';
import type { HomeSupportCollectionsSnapshot } from '@/features/supports/supportSnapshotHelpers';
import type { SliceExportArtifact } from '@/features/slicing/sliceExportOrchestrator';
import type { useLocaleFormat } from '@/hooks/useLocaleFormat';
import { getBezierPointAtT } from '@/supports/Curves/BezierUtils';
import { computeRaftFootprintPolygons, raftBandTopMm } from '@/supports/Rafts/Crenelated/geometry/computeRaftFootprint';
import { computeRaftOuterBoundary } from '@/supports/Rafts/Crenelated/geometry/computeRaftOuterBoundary';
import { isUntrimmedFootprint } from '@/supports/Rafts/Crenelated/geometry/generateRaftFromFootprint';
import { collectModelPlateFootprint } from '@/supports/Rafts/Crenelated/geometry/modelPlateFootprint';
import { polygonSetAreaMm2 } from '@/supports/Rafts/Crenelated/geometry/polygonSet2d';
import type { getRaftSettings } from '@/supports/Rafts/Crenelated/RaftState';
import type { SupportBaseCircle } from '@/supports/Rafts/Crenelated/RaftTypes';
import { calculateDiskThickness } from '@/supports/SupportPrimitives/ContactDisk/contactDiskUtils';
import { resolveSegmentEndpoints, type ShaftEntity } from '@/supports/SupportPrimitives/Knot/segmentEndpoints';
import { getSnapshot as getSupportSnapshot } from '@/supports/state';
import { contactEndpointsFor, SUPPORT_TYPES, type SupportCollectionKey, type SupportTypeId } from '@/supports/supportTypeRegistry';
import type { Segment } from '@/supports/types';
import {
  computeApproxModelWorldBounds,
  computePreciseModelWorldBounds,
  isBoundsDisjointFromVolume,
  isBoundsOutsideVolume,
} from '@/utils/modelBounds';
import { formatApproxPrintTimeLabel } from './homeFormatters';

const RESIN_ESTIMATE_BACKGROUND_REFRESH_MS = 12_000;

type HomeScene = ReturnType<typeof useSceneCollectionManager>;

export type UseResinEstimateInput = {
  _: ReturnType<typeof useLingui>['_'];
  fmt: ReturnType<typeof useLocaleFormat>;
  scene: HomeScene;
  printingArtifact: SliceExportArtifact | null;
  printingPreviewTotalLayers: number;
  activeMaterialProfile: ReturnType<typeof getActiveMaterialProfile>;
  activePlateModelIds: Set<string>;
  volumeBoundsForModel: (model: HomeScene['models'][number]) => THREE.Box3 | null;
  supportStateSnapshot: HomeSupportCollectionsSnapshot;
  raftSettingsSnapshot: ReturnType<typeof getRaftSettings>;
};

/**
 * Resin and print-time estimates for the Home page: the build-volume model
 * sets, the support and raft volumes, the background model-volume pass and the
 * labels the model card shows. Moved verbatim out of src/app/page.tsx.
 */
export function useResinEstimate({
  _,
  fmt,
  scene,
  printingArtifact,
  printingPreviewTotalLayers,
  activeMaterialProfile,
  activePlateModelIds,
  volumeBoundsForModel,
  supportStateSnapshot,
  raftSettingsSnapshot,
}: UseResinEstimateInput) {
  // Home is not compiled by the React Compiler (it bails out on it), and this
  // code ran there with its useMemo/useCallback dependency lists honoured as
  // written. Compiled, a memo keeps only what its body reads and drops a
  // dependency listed to force a refresh (the resin estimate stopped updating
  // in the Support tab). Opting out keeps the behaviour it had inside Home.
  'use no memo';
  const [printingEstimatedResinMl, setPrintingEstimatedResinMl] = React.useState<number | null>(null);
  /** The same estimate over every plate, shown beside the per-plate one. */
  const [printingEstimatedResinTotalMl, setPrintingEstimatedResinTotalMl] = React.useState<number | null>(null);
  const [printingEstimatedModelMl, setPrintingEstimatedModelMl] = React.useState<number | null>(null);
  const [printingEstimatedSupportsMl, setPrintingEstimatedSupportsMl] = React.useState<number | null>(null);
  const [printingEstimatedRaftMl, setPrintingEstimatedRaftMl] = React.useState<number | null>(null);
  const printingEstimatedResinMlRef = React.useRef<number | null>(null);
  const [isPrintingEstimatedResinBusy, setIsPrintingEstimatedResinBusy] = React.useState(false);
  const [resinEstimateRefreshTick, setResinEstimateRefreshTick] = React.useState(0);
  const printingBaseResinMlCacheRef = React.useRef<Map<string, number | null>>(new Map());
  const printingInFlightBaseResinMlRef = React.useRef<Map<string, Promise<number | null>>>(new Map());
  const lastCompletedResinEstimateSignatureRef = React.useRef<string>('');

  const yieldResinEstimateToMainThread = React.useCallback(async () => {
    await new Promise<void>((resolve) => {
      if (typeof window !== 'undefined' && typeof (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback === 'function') {
        (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback?.(() => resolve(), { timeout: 16 });
        return;
      }
      setTimeout(resolve, 0);
    });
  }, []);

  const computeBaseResinMlChunked = React.useCallback(async (
    position: { getX: (i: number) => number; getY: (i: number) => number; getZ: (i: number) => number; count: number },
    index: { getX: (i: number) => number; count: number } | null,
  ): Promise<number | null> => {
    let signedVolume = 0;

    const vax = { x: 0, y: 0, z: 0 };
    const vbx = { x: 0, y: 0, z: 0 };
    const vcx = { x: 0, y: 0, z: 0 };

    const readVertex = (i: number, out: { x: number; y: number; z: number }) => {
      out.x = position.getX(i);
      out.y = position.getY(i);
      out.z = position.getZ(i);
    };

    const addTriangle = (ia: number, ib: number, ic: number) => {
      readVertex(ia, vax);
      readVertex(ib, vbx);
      readVertex(ic, vcx);

      signedVolume += (
        vax.x * (vbx.y * vcx.z - vbx.z * vcx.y)
        - vax.y * (vbx.x * vcx.z - vbx.z * vcx.x)
        + vax.z * (vbx.x * vcx.y - vbx.y * vcx.x)
      ) / 6;
    };

    const yieldEveryTriangles = 4096;
    let processedTriangles = 0;

    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        addTriangle(index.getX(i), index.getX(i + 1), index.getX(i + 2));
        processedTriangles += 1;
        if (processedTriangles % yieldEveryTriangles === 0) {
          await yieldResinEstimateToMainThread();
        }
      }
    } else {
      for (let i = 0; i < position.count; i += 3) {
        addTriangle(i, i + 1, i + 2);
        processedTriangles += 1;
        if (processedTriangles % yieldEveryTriangles === 0) {
          await yieldResinEstimateToMainThread();
        }
      }
    }

    const baseVolumeMm3 = Math.abs(signedVolume);
    return Number.isFinite(baseVolumeMm3) ? (baseVolumeMm3 / 1000) : null;
  }, [yieldResinEstimateToMainThread]);

  const getOrComputeBaseResinMl = React.useCallback(async (model: (typeof scene.models)[number]): Promise<number | null> => {
    const geometry = model.geometry.geometry;
    const positionAttr = geometry.getAttribute('position');
    if (!positionAttr) return null;

    const sourceKey = String(geometry.userData?.resinVolumeSourceKey ?? geometry.uuid);
    geometry.userData = {
      ...geometry.userData,
      resinVolumeSourceKey: sourceKey,
    };

    const position = positionAttr as {
      getX: (i: number) => number;
      getY: (i: number) => number;
      getZ: (i: number) => number;
      count: number;
      version?: number;
      data?: { version?: number };
    };
    const index = geometry.getIndex() as ({ getX: (i: number) => number; count: number; version?: number } | null);

    const positionVersion = position.version ?? position.data?.version ?? 0;
    const indexVersion = index?.version ?? 0;
    const cacheKey = `${sourceKey}:${positionVersion}:${indexVersion}`;

    const cached = printingBaseResinMlCacheRef.current.get(cacheKey);
    if (cached !== undefined) return cached;

    const inFlight = printingInFlightBaseResinMlRef.current.get(cacheKey);
    if (inFlight) return inFlight;

    const promise = computeBaseResinMlChunked(position, index)
      .then((result) => {
        printingBaseResinMlCacheRef.current.set(cacheKey, result);
        printingInFlightBaseResinMlRef.current.delete(cacheKey);
        return result;
      })
      .catch(() => {
        printingInFlightBaseResinMlRef.current.delete(cacheKey);
        return null;
      });

    printingInFlightBaseResinMlRef.current.set(cacheKey, promise);
    return promise;
  }, [computeBaseResinMlChunked]);

  // Keep the estimate current while editing and before a print artifact exists.
  const shouldCalculateSupportAndRaftVolumes = !printingArtifact || scene.mode !== 'printing';
  const resinBuildVolumeBounds = React.useMemo(() => {
    if (!scene.view3dSettings.enabled) return null;

    const width = scene.view3dSettings.widthMm;
    const depth = scene.view3dSettings.depthMm;
    const minX = scene.view3dSettings.originMode === 'front_left' ? 0 : -width * 0.5;
    const minY = scene.view3dSettings.originMode === 'front_left' ? 0 : -depth * 0.5;

    return new THREE.Box3(
      new THREE.Vector3(minX, minY, 0),
      new THREE.Vector3(minX + width, minY + depth, scene.view3dSettings.maxZMm),
    );
  }, [
    scene.view3dSettings.depthMm,
    scene.view3dSettings.enabled,
    scene.view3dSettings.maxZMm,
    scene.view3dSettings.originMode,
    scene.view3dSettings.widthMm,
  ]);

  const resinInBoundsModelIdSet = React.useMemo(() => {
    const visibleModels = scene.models.filter((model) => model.visible);
    if (visibleModels.length === 0) return new Set<string>();
    if (!resinBuildVolumeBounds) return new Set(visibleModels.map((model) => model.id));

    const BUILD_VOLUME_BOUNDS_EPS_MM = 0.01;
    const inBoundsModelIds = new Set<string>();

    for (const model of visibleModels) {
      // Use stored transform — bounds don't change on selection.
      // Previously depended on scene.activeModelId, causing recomputation
      // (including computePreciseModelWorldBounds, O(vertices)) on every click.
      const volume = volumeBoundsForModel(model) ?? resinBuildVolumeBounds;
      const approxBounds = computeApproxModelWorldBounds(model.geometry, model.transform);
      const bounds = isBoundsOutsideVolume(approxBounds, volume, BUILD_VOLUME_BOUNDS_EPS_MM)
        ? computePreciseModelWorldBounds(model.geometry, model.transform)
        : approxBounds;

      if (!isBoundsOutsideVolume(bounds, volume, BUILD_VOLUME_BOUNDS_EPS_MM)) {
        inBoundsModelIds.add(model.id);
      }
    }

    return inBoundsModelIds;
  }, [
    resinBuildVolumeBounds,
    scene.models,
    volumeBoundsForModel,
  ]);

  /**
   * Models that contribute to a slice. A model that only partly overlaps the
   * build volume keeps its closed surface; the raster crops the filled spans.
   * Exclusion is only for models with no overlap at all.
   */
  const sliceableModelIdSet = React.useMemo(() => {
    const visibleModels = scene.models.filter((model) => model.visible);
    if (visibleModels.length === 0) return new Set<string>();
    if (!resinBuildVolumeBounds) return new Set(visibleModels.map((model) => model.id));

    const BUILD_VOLUME_BOUNDS_EPS_MM = 0.01;
    const sliceableModelIds = new Set<string>();

    for (const model of visibleModels) {
      // The plate the model stands on is the volume that counts: any plate is a
      // valid build volume, so a model on the second one is not "outside" just
      // for being on the second one.
      const volume = volumeBoundsForModel(model) ?? resinBuildVolumeBounds;
      const approxBounds = computeApproxModelWorldBounds(model.geometry, model.transform);
      if (isBoundsDisjointFromVolume(approxBounds, volume, BUILD_VOLUME_BOUNDS_EPS_MM)) continue;
      // Rotated bounding boxes can overlap even when the actual mesh does not.
      const bounds = isBoundsOutsideVolume(approxBounds, volume, BUILD_VOLUME_BOUNDS_EPS_MM)
        ? computePreciseModelWorldBounds(model.geometry, model.transform)
        : approxBounds;
      if (!isBoundsDisjointFromVolume(bounds, volume, BUILD_VOLUME_BOUNDS_EPS_MM)) {
        sliceableModelIds.add(model.id);
      }
    }

    return sliceableModelIds;
  }, [
    resinBuildVolumeBounds,
    scene.models,
    volumeBoundsForModel,
  ]);

  const visibleResinModels = React.useMemo(() => {
    return scene.models.filter(
      (model) => model.visible && resinInBoundsModelIdSet.has(model.id) && activePlateModelIds.has(model.id),
    );
  }, [activePlateModelIds, resinInBoundsModelIdSet, scene.models]);

  /** Every plate's models, for the scene-wide total beside the per-plate estimate. */
  const sceneResinModels = React.useMemo(() => {
    return scene.models.filter((model) => model.visible && resinInBoundsModelIdSet.has(model.id));
  }, [resinInBoundsModelIdSet, scene.models]);
  const shouldEstimateResinInBackground = visibleResinModels.length > 0
    && (scene.mode !== 'printing' || !printingArtifact);

  const resinEstimateComputationSignature = React.useMemo(() => {
    if (visibleResinModels.length === 0) return '';
    // Stable signature — only changes when geometry or scale actually changes,
    // NOT when selection changes. Prevents the resin estimate useEffect from
    // firing extra state updates on every model click.
    const parts = visibleResinModels.map((model) => {
      const geometry = model.geometry.geometry;
      const positionAttr = geometry.getAttribute('position') as ({ version?: number; data?: { version?: number } } | null);
      const indexAttr = geometry.getIndex() as ({ version?: number } | null);

      const sourceKey = String(geometry.userData?.resinVolumeSourceKey ?? geometry.uuid);
      const positionVersion = positionAttr?.version ?? positionAttr?.data?.version ?? 0;
      const indexVersion = indexAttr?.version ?? 0;

      const sx = Math.abs(model.transform.scale.x || 1).toFixed(6);
      const sy = Math.abs(model.transform.scale.y || 1).toFixed(6);
      const sz = Math.abs(model.transform.scale.z || 1).toFixed(6);

      return `${model.id}:${sourceKey}:${positionVersion}:${indexVersion}:${sx}:${sy}:${sz}`;
    });

    parts.sort((a, b) => a.localeCompare(b));
    return parts.join('|');
  }, [visibleResinModels]);

  const supportAndRaftVolumes = React.useMemo(() => {
    const empty = {
      active: 0,
      total: 0,
      activeSupports: 0,
      activeRaft: 0,
    };
    if (!shouldCalculateSupportAndRaftVolumes) return empty;
    // The support workspace intentionally gives the Home tree an empty
    // collection snapshot to avoid rerendering it for every support edit.
    // Resin accounting still needs the real store values in that workspace.
    const supportVolumeSnapshot = scene.mode === 'support'
      ? getSupportSnapshot()
      : supportStateSnapshot;

    const calculate = (visibleModelIds: Set<string>) => {
    if (visibleModelIds.size === 0) return { supports: 0, raft: 0 };

    const mm3ToMl = (mm3: number) => Math.max(0, mm3) / 1000;
    const circleArea = (radiusMm: number) => Math.PI * radiusMm * radiusMm;
    const sphereVolumeMm3 = (radiusMm: number) => (4 / 3) * Math.PI * radiusMm * radiusMm * radiusMm;
    const cylinderVolumeMm3 = (radiusMm: number, heightMm: number) => circleArea(radiusMm) * Math.max(0, heightMm);
    const frustumVolumeMm3 = (r1: number, r2: number, heightMm: number) => {
      const h = Math.max(0, heightMm);
      return (Math.PI * h / 3) * ((r1 * r1) + (r1 * r2) + (r2 * r2));
    };
    const distanceMm = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => {
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dz = a.z - b.z;
      return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
    };
    const sampleBezierLengthMm = (
      p0: { x: number; y: number; z: number },
      p1: { x: number; y: number; z: number },
      p2: { x: number; y: number; z: number },
      p3: { x: number; y: number; z: number },
      samples: number,
    ) => {
      let length = 0;
      let prev = p0;
      const steps = Math.max(4, samples);
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        const next = getBezierPointAtT(p0, p1, p2, p3, t);
        length += distanceMm(prev, next);
        prev = next;
      }
      return length;
    };

    const contactConeVolumeMl = (cone: {
      profile: {
        contactDiameterMm: number;
        bodyDiameterMm: number;
        lengthMm: number;
        type?: 'disk' | 'sphere';
      };
      normal: { x: number; y: number; z: number };
      surfaceNormal?: { x: number; y: number; z: number };
      diskLengthOverride?: number;
    }) => {
      const contactRadius = Math.max(0.001, cone.profile.contactDiameterMm / 2);
      const bodyRadius = Math.max(0.001, cone.profile.bodyDiameterMm / 2);
      const coneLen = Math.max(0, cone.profile.lengthMm);
      const coneMm3 = frustumVolumeMm3(contactRadius, bodyRadius, coneLen);

      let diskMm3 = 0;
      if (cone.profile.type === 'disk') {
        const surfaceNormal = cone.surfaceNormal ?? cone.normal;
        const diskProfile = {
          type: 'disk' as const,
          diskThicknessMm: Math.max(0.01, Number((cone.profile as { diskThicknessMm?: number }).diskThicknessMm ?? 0.1)),
          maxStandoffMm: Math.max(0.01, Number((cone.profile as { maxStandoffMm?: number }).maxStandoffMm ?? 0.35)),
          standoffAngleThreshold: Number((cone.profile as { standoffAngleThreshold?: number }).standoffAngleThreshold ?? (Math.PI / 4)),
        };
        const diskThickness = cone.diskLengthOverride ?? calculateDiskThickness(surfaceNormal, cone.normal, diskProfile);
        diskMm3 = cylinderVolumeMm3(contactRadius, Math.max(0, diskThickness));
      }

      return mm3ToMl(coneMm3 + diskMm3);
    };

    const contactDiskVolumeMl = (disk: {
      contactDiameterMm: number;
      profile: {
        type?: 'disk';
        standoffAngleThreshold?: number;
        diskThicknessMm?: number;
        maxStandoffMm?: number;
      };
      surfaceNormal: { x: number; y: number; z: number };
      coneAxis: { x: number; y: number; z: number };
      diskLengthOverride?: number;
    }) => {
      const radius = Math.max(0.001, disk.contactDiameterMm / 2);
      const diskProfile = {
        type: 'disk' as const,
        diskThicknessMm: Math.max(0.01, Number(disk.profile.diskThicknessMm ?? 0.1)),
        maxStandoffMm: Math.max(0.01, Number(disk.profile.maxStandoffMm ?? 0.35)),
        standoffAngleThreshold: Number(disk.profile.standoffAngleThreshold ?? (Math.PI / 4)),
      };
      const thickness = disk.diskLengthOverride ?? calculateDiskThickness(disk.surfaceNormal, disk.coneAxis, diskProfile);
      return mm3ToMl(cylinderVolumeMm3(radius, Math.max(0, thickness)));
    };

    const segmentVolumeMl = (
      segment: {
        diameter: number;
        type?: 'straight' | 'bezier';
        controlPoint1?: { x: number; y: number; z: number };
        controlPoint2?: { x: number; y: number; z: number };
        resolution?: number;
      },
      start: { x: number; y: number; z: number },
      end: { x: number; y: number; z: number },
    ) => {
      const radius = Math.max(0.001, segment.diameter / 2);
      const length = segment.type === 'bezier' && segment.controlPoint1 && segment.controlPoint2
        ? sampleBezierLengthMm(start, segment.controlPoint1, segment.controlPoint2, end, segment.resolution ?? 16)
        : distanceMm(start, end);
      return mm3ToMl(cylinderVolumeMm3(radius, length));
    };

    const polygonAreaMm2 = (profile: THREE.Vector2[]) => {
      if (profile.length < 3) return 0;
      let sum = 0;
      for (let i = 0; i < profile.length; i += 1) {
        const a = profile[i];
        const b = profile[(i + 1) % profile.length];
        sum += (a.x * b.y) - (b.x * a.y);
      }
      return Math.abs(sum) * 0.5;
    };
    const polygonPerimeterMm = (profile: THREE.Vector2[]) => {
      if (profile.length < 2) return 0;
      let sum = 0;
      for (let i = 0; i < profile.length; i += 1) {
        const a = profile[i];
        const b = profile[(i + 1) % profile.length];
        sum += a.distanceTo(b);
      }
      return sum;
    };

    const topDiameterByRootId = new Map<string, number>();
    for (const trunk of Object.values(supportVolumeSnapshot.trunks)) {
      const firstDiameter = trunk.baseDiameterMm ?? trunk.segments[0]?.diameter;
      if (firstDiameter && firstDiameter > 0) {
        topDiameterByRootId.set(trunk.rootId, firstDiameter);
      }
    }
    for (const kickstand of Object.values(supportVolumeSnapshot.kickstands)) {
      const firstDiameter = kickstand.profile.terminalStartDiameterMm
        || kickstand.segments[0]?.diameter
        || kickstand.profile.bodyDiameterMm;
      if (firstDiameter && firstDiameter > 0) {
        topDiameterByRootId.set(kickstand.rootId, firstDiameter);
      }
    }

    let supportMl = 0;

    const addRootVolume = (root: { id: string; modelId: string; diameter: number; diskHeight: number; coneHeight: number }) => {
      if (!visibleModelIds.has(root.modelId)) return;

      const rootRadius = Math.max(0.001, root.diameter / 2);
      const topDiameter = topDiameterByRootId.get(root.id) ?? Math.max(0.1, root.diameter * 0.35);
      const topRadius = Math.max(0.001, topDiameter / 2);

      const effectiveDiskHeight = Math.max(0, root.diskHeight);
      const coneHeight = Math.max(0, root.coneHeight);

      const diskMm3 = cylinderVolumeMm3(rootRadius, effectiveDiskHeight);
      const coneMm3 = frustumVolumeMm3(rootRadius, topRadius, coneHeight);
      const capSphereMm3 = coneHeight > 0 ? sphereVolumeMm3(topRadius) : 0;
      supportMl += mm3ToMl(diskMm3 + coneMm3 + capSphereMm3);
    };

    // One pass: kickstand roots are a view of state.roots, so walking both
    // counted every kickstand root twice.
    for (const root of Object.values(supportVolumeSnapshot.roots)) {
      addRootVolume(root);
    }

    // Every type with segments or contacts, by its declared segments and
    // contacts. A brace has neither (its shaft is a curve between two knots),
    // so the guard below skips it and it is summed on its own below.
    for (const descriptor of SUPPORT_TYPES) {
      if (!descriptor.hasSegments && descriptor.contactFields.length === 0) continue;

      const collection = supportVolumeSnapshot[descriptor.location.key as SupportCollectionKey] as unknown as Record<string, {
        id: string; typeId?: SupportTypeId; modelId: string; segments?: Segment[]; rootId?: string; parentKnotId?: string; hostKnotId?: string;
      }>;

      for (const entity of Object.values(collection ?? {})) {
        if (!visibleModelIds.has(entity.modelId)) continue;

        const hosts = {
          root: descriptor.ownsRoot ? supportVolumeSnapshot.roots[entity.rootId ?? ''] : undefined,
          hostKnot: supportVolumeSnapshot.knots[entity.parentKnotId ?? entity.hostKnotId ?? ''],
        };

        const segments = entity.segments ?? [];
        for (let i = 0; i < segments.length; i += 1) {
          const endpoints = resolveSegmentEndpoints(entity as ShaftEntity, segments[i], i, hosts);
          if (!endpoints) continue;
          supportMl += segmentVolumeMl(segments[i], endpoints.start, endpoints.end);
        }

        for (const { kind, field } of contactEndpointsFor(descriptor.id)) {
          const contact = (entity as unknown as Record<string, unknown>)[field];
          if (!contact) continue;
          supportMl += kind === 'disk'
            ? contactDiskVolumeMl(contact as Parameters<typeof contactDiskVolumeMl>[0])
            : contactConeVolumeMl(contact as Parameters<typeof contactConeVolumeMl>[0]);
        }
      }
    }

    for (const brace of Object.values(supportVolumeSnapshot.braces)) {
      if (!visibleModelIds.has(brace.modelId)) continue;
      const startKnot = supportVolumeSnapshot.knots[brace.startKnotId];
      const endKnot = supportVolumeSnapshot.knots[brace.endKnotId];
      if (!startKnot || !endKnot) continue;

      const length = brace.curve?.type === 'bezier'
        ? sampleBezierLengthMm(startKnot.pos, brace.curve.controlPoint1, brace.curve.controlPoint2, endKnot.pos, brace.curve.resolution ?? 16)
        : distanceMm(startKnot.pos, endKnot.pos);
      supportMl += mm3ToMl(cylinderVolumeMm3(Math.max(0.001, brace.profile.diameter / 2), length));
    }

    let raftMl = 0;
    if (raftSettingsSnapshot.bottomMode !== 'off') {
      const rootsByModel = new Map<string, SupportBaseCircle[]>();
      for (const root of Object.values(supportVolumeSnapshot.roots)) {
        if (!visibleModelIds.has(root.modelId)) continue;
        if (!rootsByModel.has(root.modelId)) rootsByModel.set(root.modelId, []);
        rootsByModel.get(root.modelId)!.push({
          x: root.transform.pos.x,
          y: root.transform.pos.y,
          r: root.diameter / 2,
        });
      }

      // The raft is trimmed where a model stands on the plate, so the estimate
      // measures the same footprint the viewport and the slicer build.
      const clearance = collectModelPlateFootprint(
        scene.models.filter((model) => model.visible),
        raftBandTopMm(raftSettingsSnapshot),
      );

      for (const circles of rootsByModel.values()) {
        if (circles.length === 0) continue;

        const thickness = raftSettingsSnapshot.bottomMode === 'line' ? raftSettingsSnapshot.lineHeightMm : raftSettingsSnapshot.thickness;

        const footprint = computeRaftFootprintPolygons({
          circles,
          raft: raftSettingsSnapshot,
          clearance,
        });
        if (footprint.length === 0) continue;

        const untrimmed = isUntrimmedFootprint(footprint);
        const baseProfile = untrimmed ? footprint[0].outer : [];
        const areaMm2 = untrimmed ? polygonAreaMm2(baseProfile) : polygonSetAreaMm2(footprint);
        const perimeterMm = untrimmed
          ? polygonPerimeterMm(baseProfile)
          : footprint.reduce((total, poly) => total + polygonPerimeterMm(poly.outer), 0);

        const baseMm3 = raftSettingsSnapshot.bottomMode === 'line'
          ? (perimeterMm * Math.max(0, raftSettingsSnapshot.lineWidthMm) * Math.max(0, raftSettingsSnapshot.lineHeightMm))
          : (areaMm2 * Math.max(0, raftSettingsSnapshot.thickness));

        let wallMm3 = 0;
        if (raftSettingsSnapshot.wallEnabled && raftSettingsSnapshot.wallHeight > 0 && raftSettingsSnapshot.wallThickness > 0) {
          const outerProfile = untrimmed ? computeRaftOuterBoundary(baseProfile, raftSettingsSnapshot) : [];
          const wallPerimeterMm = untrimmed && outerProfile.length >= 3
            ? polygonPerimeterMm(outerProfile)
            : perimeterMm;
          wallMm3 = wallPerimeterMm * Math.max(0, raftSettingsSnapshot.wallThickness) * Math.max(0, raftSettingsSnapshot.wallHeight);
        }

        raftMl += mm3ToMl(baseMm3 + wallMm3);
      }
    }

    return { supports: supportMl, raft: raftMl };
    };
    const activeIds = new Set([...resinInBoundsModelIdSet].filter((id) => activePlateModelIds.has(id)));
    const active = calculate(activeIds);
    const total = calculate(resinInBoundsModelIdSet);
    return {
      active: active.supports + active.raft,
      total: total.supports + total.raft,
      activeSupports: active.supports,
      activeRaft: active.raft,
    };
  }, [
    activePlateModelIds,
    resinInBoundsModelIdSet,
    resinEstimateRefreshTick,
    scene.mode,
    shouldCalculateSupportAndRaftVolumes,
    computeRaftFootprintPolygons,
    computeRaftOuterBoundary,
    isUntrimmedFootprint,
    raftSettingsSnapshot,
    scene.models,
    supportStateSnapshot,
  ]);
  const supportAndRaftResinMl = supportAndRaftVolumes.active;

  React.useEffect(() => {
    if (!shouldEstimateResinInBackground) return;

    const intervalId = window.setInterval(() => {
      setResinEstimateRefreshTick((previous) => previous + 1);
    }, RESIN_ESTIMATE_BACKGROUND_REFRESH_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [shouldEstimateResinInBackground]);

  React.useEffect(() => {
    let cancelled = false;

    if (!shouldEstimateResinInBackground) {
      if (sceneResinModels.length === 0) {
        lastCompletedResinEstimateSignatureRef.current = '';
        printingEstimatedResinMlRef.current = null;
        setPrintingEstimatedResinMl(null);
        setPrintingEstimatedResinTotalMl(null);
        setPrintingEstimatedModelMl(null);
        setPrintingEstimatedSupportsMl(null);
        setPrintingEstimatedRaftMl(null);
      }
      setIsPrintingEstimatedResinBusy(false);
      return () => {
        cancelled = true;
      };
    }

    const visibleModels = visibleResinModels;
    const compositeSignature = `${resinEstimateComputationSignature}::supports:${supportAndRaftResinMl.toFixed(6)}:${supportAndRaftVolumes.total.toFixed(6)}`;
    const hasChangedSinceLastSuccess = compositeSignature !== lastCompletedResinEstimateSignatureRef.current;
    const hadPriorValue = printingEstimatedResinMlRef.current != null;
    if (hadPriorValue && hasChangedSinceLastSuccess) {
      setIsPrintingEstimatedResinBusy(true);
    }

    const run = async () => {
      let totalMl = 0;
      let sceneTotalMl = 0;
      let found = false;

      // One pass over every plate's models: the active plate's share is the
      // per-plate figure, and the whole sum is the scene total beside it.
      for (const model of sceneResinModels) {
        if (cancelled) return;
        const baseMl = await getOrComputeBaseResinMl(model);
        if (cancelled) return;
        if (baseMl == null) continue;

        const sx = Math.abs(model.transform.scale.x || 1);
        const sy = Math.abs(model.transform.scale.y || 1);
        const sz = Math.abs(model.transform.scale.z || 1);
        const contribution = baseMl * sx * sy * sz;
        sceneTotalMl += contribution;
        if (activePlateModelIds.has(model.id)) totalMl += contribution;
        found = true;
      }

      if (cancelled) return;
      const totalWithSupports = totalMl + supportAndRaftResinMl;
      const nextValue = found || totalWithSupports > 0 ? totalWithSupports : null;
      printingEstimatedResinMlRef.current = nextValue;
      setPrintingEstimatedResinMl(nextValue);
      setPrintingEstimatedResinTotalMl(found || sceneTotalMl > 0 ? sceneTotalMl + supportAndRaftVolumes.total : null);
      setPrintingEstimatedModelMl(found ? totalMl : null);
      setPrintingEstimatedSupportsMl(supportAndRaftVolumes.activeSupports);
      setPrintingEstimatedRaftMl(supportAndRaftVolumes.activeRaft);
      lastCompletedResinEstimateSignatureRef.current = compositeSignature;
      setIsPrintingEstimatedResinBusy(false);
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [
    getOrComputeBaseResinMl,
    resinEstimateComputationSignature,
    resinEstimateRefreshTick,
    shouldEstimateResinInBackground,
    supportAndRaftResinMl,
    supportAndRaftVolumes.total,
    supportAndRaftVolumes.activeSupports,
    supportAndRaftVolumes.activeRaft,
    sceneResinModels,
    activePlateModelIds,
    visibleResinModels,
  ]);

  const estimatedVolumeMlLabel = React.useMemo(() => {
    const visible = scene.models.filter((model) => model.visible);
    if (visible.length === 0) return '—';
    // An empty plate is a real answer, not an unknown: it holds no resin. The
    // scene-wide row beside it still carries the whole figure.
    if (visibleResinModels.length === 0) return fmt.quantity(0, 2, 'ml');
    if (isPrintingEstimatedResinBusy && printingEstimatedResinMl == null) return 'Calculating…';
    if (printingEstimatedResinMl == null) return '—';
    return fmt.quantity(printingEstimatedResinMl, 2, 'ml');
  }, [isPrintingEstimatedResinBusy, printingEstimatedResinMl, scene.models, visibleResinModels.length, fmt]);

  const estimatedModelVolumeMlLabel = React.useMemo(() => {
    if (visibleResinModels.length === 0) return fmt.quantity(0, 2, 'ml');
    if (isPrintingEstimatedResinBusy && printingEstimatedModelMl == null) return 'Calculating…';
    if (printingEstimatedModelMl == null) return '—';
    return fmt.quantity(printingEstimatedModelMl, 2, 'ml');
  }, [fmt, isPrintingEstimatedResinBusy, printingEstimatedModelMl, visibleResinModels.length]);
  const estimatedSupportsVolumeMlLabel = React.useMemo(() => {
    if (visibleResinModels.length === 0) return fmt.quantity(0, 2, 'ml');
    if (isPrintingEstimatedResinBusy && printingEstimatedSupportsMl == null) return 'Calculating…';
    if (printingEstimatedSupportsMl == null) return '—';
    return fmt.quantity(printingEstimatedSupportsMl, 2, 'ml');
  }, [fmt, isPrintingEstimatedResinBusy, printingEstimatedSupportsMl, visibleResinModels.length]);
  const estimatedRaftVolumeMlLabel = React.useMemo(() => {
    if (visibleResinModels.length === 0) return fmt.quantity(0, 2, 'ml');
    if (isPrintingEstimatedResinBusy && printingEstimatedRaftMl == null) return 'Calculating…';
    if (printingEstimatedRaftMl == null) return '—';
    return fmt.quantity(printingEstimatedRaftMl, 2, 'ml');
  }, [fmt, isPrintingEstimatedResinBusy, printingEstimatedRaftMl, visibleResinModels.length]);


  /** The same figure for every plate, shown beside the per-plate one. */
  const estimatedResinTotalLabel = React.useMemo(() => {
    if (sceneResinModels.length === 0) return null;
    if (printingEstimatedResinTotalMl == null) return null;
    return fmt.quantity(printingEstimatedResinTotalMl, 2, 'ml');
  }, [printingEstimatedResinTotalMl, sceneResinModels.length, fmt]);


  const estimatedPrintTimeLabel = React.useMemo(() => {
    if (!activeMaterialProfile || printingPreviewTotalLayers <= 0) return '—';

    const totalLayers = printingPreviewTotalLayers;
    const bottomLayers = Math.max(0, Math.min(totalLayers, Math.round(activeMaterialProfile.bottomLayerCount)));
    const normalLayers = Math.max(0, totalLayers - bottomLayers);

    if (activeMaterialProfile.printTimeOverride?.enabled) {
      const override = activeMaterialProfile.printTimeOverride;
      return formatApproxPrintTimeLabel(_, bottomLayers * override.bottomSeconds + normalLayers * override.normalSeconds);
    }

    const liftSec = activeMaterialProfile.liftSpeedMmMin > 0
      ? (activeMaterialProfile.liftDistanceMm / activeMaterialProfile.liftSpeedMmMin) * 60
      : 0;
    const retractSec = activeMaterialProfile.retractSpeedMmMin > 0
      ? (activeMaterialProfile.liftDistanceMm / activeMaterialProfile.retractSpeedMmMin) * 60
      : 0;
    const travelSecPerLayer = Math.max(0, liftSec + retractSec);

    const totalSec = (
      bottomLayers * (activeMaterialProfile.bottomExposureSec + travelSecPerLayer)
      + normalLayers * (activeMaterialProfile.normalExposureSec + travelSecPerLayer)
    );

    return formatApproxPrintTimeLabel(_, totalSec);
  }, [_, activeMaterialProfile, printingPreviewTotalLayers]);

  return {
    sliceableModelIdSet,
    supportAndRaftResinMl,
    printingEstimatedResinMlRef,
    printingBaseResinMlCacheRef,
    setPrintingEstimatedResinMl,
    estimatedVolumeMlLabel,
    estimatedModelVolumeMlLabel,
    estimatedSupportsVolumeMlLabel,
    estimatedRaftVolumeMlLabel,
    estimatedResinTotalLabel,
    estimatedPrintTimeLabel,
  };
}
