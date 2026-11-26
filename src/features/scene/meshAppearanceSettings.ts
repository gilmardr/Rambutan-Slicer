/** Mesh appearance settings persisted in localStorage, with their defaults and clamping. */
import { DEFAULT_BAKED_OCCLUSION_INTENSITY } from '@/features/scene/bakedOcclusion';
import { MESH_SHADER_TYPES, type MatcapVariant, type MeshShaderType } from '@/features/shaders/mesh';

export type PersistedMeshAppearance = {
  v: 2;
  /** The view mode the camera dropdown shows, which is also the shader the viewport renders. */
  shaderType: MeshShaderType;
  /** The type the Mesh settings tab is configuring. Independent of what the viewport renders. */
  configuredShaderType: MeshShaderType;
  matcapVariant: MatcapVariant;
  flatUseVertexColors: boolean;
  ambientIntensity: number;
  directionalIntensity: number;
  materialRoughness: number;
  /** Multiplier on the baked occlusion's strength; 0 disables the bake. */
  bakedAoIntensity: number;
  wireframeThicknessPx: number;
  xrayOpacity: number;
  heatmapMinAngle: number;
  heatmapMaxAngle: number;
  heatmapColors: string[];
  meshColor: string;
  hoverTintStrength: number;
  selectedTintStrength: number;
};

export const MESH_APPEARANCE_STORAGE_KEY = 'mesh-appearance-settings';

export const DEFAULT_MESH_COLOR = '#f3f0e8';
export const LEGACY_DEFAULT_MESH_COLORS = new Set(['#a3a3a3', '#ed0921']);
// Split so the Mesh tab's derived sliders read Lightness 1.40, Contrast 0.80
// (contrast = directional / (ambient + directional)).
export const DEFAULT_AMBIENT_INTENSITY = 0.28;
export const DEFAULT_DIRECTIONAL_INTENSITY = 1.12;
export const DEFAULT_MATERIAL_ROUGHNESS = 0.55;
export const DEFAULT_WIREFRAME_THICKNESS_PX = 1.5;
export const DEFAULT_XRAY_OPACITY = 0.25;
export const DEFAULT_HEATMAP_MIN_ANGLE = 0;
export const DEFAULT_HEATMAP_MAX_ANGLE = 45;
export const DEFAULT_HEATMAP_COLORS = ['#E55959', '#E5A559', '#D9D959', '#73D973', '#666666'];
export const DEFAULT_SHADER_TYPE: MeshShaderType = 'soft_clay';
export const DEFAULT_MATCAP_VARIANT: MatcapVariant = 'neutral';
export const DEFAULT_FLAT_USE_VERTEX_COLORS = true;
export const DEFAULT_HOVER_TINT_STRENGTH = 0.5;
export const DEFAULT_SELECTED_TINT_STRENGTH = 0.70;

export function clampNumber(input: unknown, min: number, max: number, fallback: number): number {
  const n = typeof input === 'number' ? input : Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function clampHexColor(input: unknown, fallback: string): string {
  if (typeof input !== 'string') return fallback;
  const s = input.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s) || /^#[0-9a-fA-F]{3}$/.test(s)) return s;
  return fallback;
}

export function clampMatcapVariant(input: unknown, fallback: MatcapVariant): MatcapVariant {
  return input === 'neutral' || input === 'cool' || input === 'warm' ? input : fallback;
}

export function clampPersistedMeshShaderType(input: unknown, fallback: MeshShaderType): MeshShaderType {
  return typeof input === 'string' && (MESH_SHADER_TYPES as readonly string[]).includes(input)
    ? (input as MeshShaderType)
    : fallback;
}

export function clampBoolean(input: unknown, fallback: boolean): boolean {
  return typeof input === 'boolean' ? input : fallback;
}

export function clampInt(input: unknown, min: number, max: number, fallback: number): number {
  const n = typeof input === 'number' ? input : Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function readMeshAppearanceFromLocalStorage(): PersistedMeshAppearance | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(MESH_APPEARANCE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedMeshAppearance>;

    const shaderType = clampPersistedMeshShaderType(parsed.shaderType, DEFAULT_SHADER_TYPE);

    return {
      v: 2,
      shaderType,
      configuredShaderType: clampPersistedMeshShaderType(parsed.configuredShaderType ?? parsed.shaderType, DEFAULT_SHADER_TYPE),
      matcapVariant: clampMatcapVariant(parsed.matcapVariant, DEFAULT_MATCAP_VARIANT),
      flatUseVertexColors: clampBoolean(parsed.flatUseVertexColors, DEFAULT_FLAT_USE_VERTEX_COLORS),
      ambientIntensity: clampNumber(parsed.ambientIntensity, 0, 4, DEFAULT_AMBIENT_INTENSITY),
      directionalIntensity: clampNumber(parsed.directionalIntensity, 0, 4, DEFAULT_DIRECTIONAL_INTENSITY),
      materialRoughness: clampNumber(parsed.materialRoughness, 0, 1, DEFAULT_MATERIAL_ROUGHNESS),
      bakedAoIntensity: clampNumber(parsed.bakedAoIntensity, 0, 2, DEFAULT_BAKED_OCCLUSION_INTENSITY),
      wireframeThicknessPx: clampNumber(parsed.wireframeThicknessPx, 0.5, 6, DEFAULT_WIREFRAME_THICKNESS_PX),
      xrayOpacity: clampNumber(parsed.xrayOpacity, 0.02, 0.85, DEFAULT_XRAY_OPACITY),
      heatmapMinAngle: clampNumber(parsed.heatmapMinAngle, 0, 90, DEFAULT_HEATMAP_MIN_ANGLE),
      heatmapMaxAngle: clampNumber(parsed.heatmapMaxAngle, 0, 90, DEFAULT_HEATMAP_MAX_ANGLE),
      heatmapColors: Array.isArray(parsed.heatmapColors) && parsed.heatmapColors.length === 5 ? parsed.heatmapColors : DEFAULT_HEATMAP_COLORS,
      meshColor: parsed.v !== 2
        ? DEFAULT_MESH_COLOR
        : LEGACY_DEFAULT_MESH_COLORS.has(clampHexColor(parsed.meshColor, DEFAULT_MESH_COLOR).toLowerCase())
        ? DEFAULT_MESH_COLOR
        : clampHexColor(parsed.meshColor, DEFAULT_MESH_COLOR),
      hoverTintStrength: clampNumber(parsed.hoverTintStrength, 0, 1, DEFAULT_HOVER_TINT_STRENGTH),
      selectedTintStrength: clampNumber(parsed.selectedTintStrength, 0, 1, DEFAULT_SELECTED_TINT_STRENGTH),
    };
  } catch {
    return null;
  }
}

export function writeMeshAppearanceToLocalStorage(next: PersistedMeshAppearance): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(MESH_APPEARANCE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}
