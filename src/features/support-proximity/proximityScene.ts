import type { LoadedModel } from '@/features/scene/useSceneCollectionManager';
import type { PlateFrame } from '@/features/scene/plates/plateLayout';
import { getUnappliedModifiers } from '@/features/mesh-modifiers/unappliedModifiers';
import { createCollisionInputs } from '@/features/model-collision/collisionScene';
import type { SupportEntityAny, SupportState, Vec3 } from '@/supports/types';
import { getSupportTypeDescriptor, resolveSupportTypeIdOf } from '@/supports/supportTypeRegistry';
import { resolveSegmentEndpoints, type EndpointHosts, type ShaftEntity } from '@/supports/SupportPrimitives/Knot/segmentEndpoints';
import type { ProximitySegmentInput, SupportProximityInput } from './supportProximity';

const CONTACT_ENDPOINT_CLEARANCE_MM = 2.5;

function tuple(point: Vec3): [number, number, number] {
  return [point.x, point.y, point.z];
}

function isContactEndpoint(kind: string | undefined): boolean {
  return kind === 'cone' || kind === 'disk';
}

function getEndpointHosts(entity: SupportEntityAny, supportState: SupportState): EndpointHosts {
  const typeId = resolveSupportTypeIdOf(entity);
  if (!typeId) return {};
  const descriptor = getSupportTypeDescriptor(typeId);
  const record = entity as unknown as Record<string, unknown>;
  const rootEdge = descriptor.edges.find((edge) => edge.to === 'roots');
  const knotEdge = descriptor.edges.find((edge) => edge.to === 'knots' && edge.ownership === 'hostedBy');
  const rootId = rootEdge ? record[rootEdge.field] : undefined;
  const knotId = knotEdge ? record[knotEdge.field] : undefined;
  return {
    root: typeof rootId === 'string' ? supportState.roots[rootId] ?? null : undefined,
    hostKnot: typeof knotId === 'string' ? supportState.knots[knotId] ?? null : undefined,
  };
}

function createSupportSegments(supportState: SupportState, modelIds: ReadonlySet<string>): ProximitySegmentInput[] {
  const entities = supportState.supports
    ? Object.values(supportState.supports)
    : [];
  const segments: ProximitySegmentInput[] = [];

  for (const entity of entities) {
    const shaftEntity = entity as SupportEntityAny & { segments?: ShaftEntity['segments'] };
    if (!modelIds.has(entity.modelId) || !Array.isArray(shaftEntity.segments)) continue;
    const typeId = resolveSupportTypeIdOf(entity);
    const descriptor = typeId ? getSupportTypeDescriptor(typeId) : null;
    const hosts = getEndpointHosts(entity, supportState);
    const lowerContact = isContactEndpoint(descriptor?.lower.kind);
    const upperContact = isContactEndpoint(descriptor?.upper.kind);
    const lastIndex = shaftEntity.segments.length - 1;

    shaftEntity.segments.forEach((segment, index) => {
      const resolved = typeId
        ? resolveSegmentEndpoints(shaftEntity as ShaftEntity, segment, index, hosts)
        : null;
      const start = resolved?.start ?? segment.bottomJoint?.pos;
      const end = resolved?.end ?? segment.topJoint?.pos;
      if (!start || !end) return;

      const line: ProximitySegmentInput = {
        modelId: entity.modelId,
        supportId: entity.id,
        diameterMm: segment.diameter,
        start: tuple(start),
        end: tuple(end),
        ignoreStartMm: lowerContact && index === 0 ? CONTACT_ENDPOINT_CLEARANCE_MM : 0,
        ignoreEndMm: upperContact && index === lastIndex ? CONTACT_ENDPOINT_CLEARANCE_MM : 0,
      };
      if (segment.type === 'bezier') {
        line.controlPoints = [tuple(segment.controlPoint1), tuple(segment.controlPoint2)];
      }
      segments.push(line);
    });
  }
  return segments;
}

/** Copies only visible, readable model geometry and the current support shafts for an on-demand scan. */
export function createSupportProximityInput(
  models: readonly LoadedModel[],
  plateFrames: readonly PlateFrame[],
  supportState: SupportState,
  clearanceThresholdMm: number,
  getModifiers?: (modelId: string) => LoadedModel['meshModifiers'] | undefined,
): SupportProximityInput {
  const readableModels = models.filter((model) => {
    if (!model.visible || model.isSupportGeometry) return false;
    const unapplied = getUnappliedModifiers(getModifiers?.(model.id) ?? model.meshModifiers);
    return !unapplied.hollowing && !unapplied.holePunches;
  });
  const modelIds = new Set(readableModels.map((model) => model.id));
  return {
    models: createCollisionInputs(readableModels, plateFrames),
    segments: createSupportSegments(supportState, modelIds),
    clearanceThresholdMm,
  };
}
