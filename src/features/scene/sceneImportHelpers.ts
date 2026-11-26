/** Helpers for scene and plugin imports: names, hashes, id remapping and payload validation. */
import * as THREE from 'three';
import { type VoxlDocumentV1 } from '@/features/scene/voxl';
import type { DragonfruitImportFormat } from '@/supports/types';
import type { ModelMeshModifiers } from '@/features/mesh-modifiers/types';
import { SUPPORT_COLLECTION_KEYS } from '@/supports/supportTypeRegistry';
import { getRaftSettings, applyImportDefaultRaftSettings } from '@/supports/Rafts/Crenelated/RaftState';
import { getImportDefaultsRaftPatch, getSavedImportDefaultsSettings } from '@/features/scene/importDefaultsPreferences';

export function sanitizeImportedModelDisplayName(rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed) return 'model';

  let base = trimmed;
  while (true) {
    const dotIndex = base.lastIndexOf('.');
    if (dotIndex <= 0) break;
    base = base.slice(0, dotIndex).trim();
    if (!base) return 'model';
  }

  return base;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('SHA-256 hashing is unavailable in this environment.');
  }

  const digestInput = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(digestInput).set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', digestInput);
  const digestBytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < digestBytes.length; i += 1) {
    hex += digestBytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export function remapModelIdsInPayload<T>(value: T, idMap: Map<string, string>): T {
  const visit = (input: unknown, key?: string): unknown => {
    if (Array.isArray(input)) {
      return input.map((item) => visit(item));
    }

    if (!input || typeof input !== 'object') {
      if (key === 'modelId' && typeof input === 'string') {
        return idMap.get(input) ?? input;
      }
      return input;
    }

    const source = input as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(source)) {
      out[childKey] = visit(childValue, childKey);
    }
    return out;
  };

  return visit(value) as T;
}

/** Whether a serialized scene carries any support at all. */
export function voxlSupportsContainData(document: VoxlDocumentV1): boolean {
  return payloadCollections(document.supports).some((entities) => entities.length > 0);
}

/** A payload's collections as arrays, keyed by the registry's collection names. */
export function payloadCollections(payload: DragonfruitImportFormat): unknown[][] {
  const record = payload as unknown as Record<string, unknown[] | undefined>;
  return SUPPORT_COLLECTION_KEYS.map((key) => record[key] ?? []);
}

export function countSupportEntries(payload: DragonfruitImportFormat | null | undefined): number {
  if (!payload) return 0;
  return payloadCollections(payload).reduce((total, entities) => total + entities.length, 0);
}

export function applyImportDefaultsToRaftState() {
  const defaults = getSavedImportDefaultsSettings();
  const patch = getImportDefaultsRaftPatch(defaults);
  // Merge with current settings to preserve non-raft-specific settings
  const merged = { ...getRaftSettings(), ...patch };
  // Apply without marking as manually modified, so manual changes in the same session can override
  applyImportDefaultRaftSettings(merged);
}

export type PluginSceneImportPayload = {
  geometry: THREE.BufferGeometry;
  transform: {
    position: THREE.Vector3;
    rotation: THREE.Euler;
    scale: THREE.Vector3;
  };
  modelId?: string;
  /**
   * Display name from the SOURCE file, where the format carries one (LYS object
   * `name`, Chitubox per-model filename). Preferred over deriving a name from
   * the imported filename, which cannot distinguish models inside one container
   * and falls back to numeric suffixes ("project (2)", "project (3)").
   */
  objName?: string;
  supportData?: DragonfruitImportFormat | null;
  meshModifiers?: ModelMeshModifiers;
};

export function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function toVector3(value: unknown): THREE.Vector3 | null {
  if (value instanceof THREE.Vector3) {
    return value.clone();
  }

  if (!value || typeof value !== 'object') return null;
  const source = value as { x?: unknown; y?: unknown; z?: unknown };
  const x = toFiniteNumber(source.x);
  const y = toFiniteNumber(source.y);
  const z = toFiniteNumber(source.z);
  if (x == null || y == null || z == null) return null;
  return new THREE.Vector3(x, y, z);
}

export function toEuler(value: unknown): THREE.Euler | null {
  if (value instanceof THREE.Euler) {
    return value.clone();
  }

  if (!value || typeof value !== 'object') return null;
  const source = value as { x?: unknown; y?: unknown; z?: unknown };
  const x = toFiniteNumber(source.x);
  const y = toFiniteNumber(source.y);
  const z = toFiniteNumber(source.z);
  if (x == null || y == null || z == null) return null;
  return new THREE.Euler(x, y, z);
}

export function asDragonfruitImportFormat(value: unknown): DragonfruitImportFormat | null {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Partial<DragonfruitImportFormat>;
  const requiredArrayKeys: Array<keyof DragonfruitImportFormat> = [
    'roots',
    'trunks',
    'branches',
    'leaves',
    'braces',
    'knots',
  ];

  if (!requiredArrayKeys.every((key) => Array.isArray(candidate[key]))) {
    return null;
  }

  // Every optional collection the registry declares; the required ones are
  // checked above.
  const collections = candidate as unknown as Record<string, unknown>;
  for (const key of SUPPORT_COLLECTION_KEYS) {
    const value = collections[key];
    if (value != null && !Array.isArray(value)) return null;
  }

  return candidate as DragonfruitImportFormat;
}

export function normalizePluginSceneImportPayload(payload: unknown): PluginSceneImportPayload | null {
  if (!payload || typeof payload !== 'object') return null;

  const source = payload as {
    geometry?: unknown;
    transform?: unknown;
    modelId?: unknown;
    objName?: unknown;
    supportData?: unknown;
    meshModifiers?: unknown;
  };

  if (!(source.geometry instanceof THREE.BufferGeometry)) return null;
  if (!source.transform || typeof source.transform !== 'object') return null;

  const transformSource = source.transform as {
    position?: unknown;
    rotation?: unknown;
    scale?: unknown;
  };

  const position = toVector3(transformSource.position);
  const rotation = toEuler(transformSource.rotation);
  const scale = toVector3(transformSource.scale);

  if (!position || !rotation || !scale) return null;

  let meshModifiers: ModelMeshModifiers | undefined;
  if (source.meshModifiers && typeof source.meshModifiers === 'object') {
    // Accept the modifiers as-is — they are plain objects that match the interface.
    meshModifiers = source.meshModifiers as ModelMeshModifiers;
  }

  return {
    geometry: source.geometry,
    transform: {
      position,
      rotation,
      scale,
    },
    modelId: typeof source.modelId === 'string' && source.modelId.trim().length > 0
      ? source.modelId
      : undefined,
    objName: typeof source.objName === 'string' && source.objName.trim().length > 0
      ? source.objName.trim()
      : undefined,
    supportData: asDragonfruitImportFormat(source.supportData),
    meshModifiers,
  };
}
