'use no memo';
/**
 * The global mesh appearance settings (lighting, shader, heatmap, tint and mesh
 * colour): their state, the hydration from localStorage on mount, and the write
 * back whenever any of them changes. Part of useSceneCollectionManager, which
 * returns every value and setter unchanged.
 */
import { useEffect, useState } from 'react';
import { DEFAULT_BAKED_OCCLUSION_INTENSITY, setBakedOcclusionIntensity } from '@/features/scene/bakedOcclusion';
import type { MatcapVariant, MeshShaderType } from '@/features/shaders/mesh';
import {
  DEFAULT_AMBIENT_INTENSITY,
  DEFAULT_DIRECTIONAL_INTENSITY,
  DEFAULT_FLAT_USE_VERTEX_COLORS,
  DEFAULT_HEATMAP_COLORS,
  DEFAULT_HEATMAP_MAX_ANGLE,
  DEFAULT_HEATMAP_MIN_ANGLE,
  DEFAULT_HOVER_TINT_STRENGTH,
  DEFAULT_MATCAP_VARIANT,
  DEFAULT_MATERIAL_ROUGHNESS,
  DEFAULT_MESH_COLOR,
  DEFAULT_SELECTED_TINT_STRENGTH,
  DEFAULT_SHADER_TYPE,
  DEFAULT_WIREFRAME_THICKNESS_PX,
  DEFAULT_XRAY_OPACITY,
  readMeshAppearanceFromLocalStorage,
  writeMeshAppearanceToLocalStorage,
} from './meshAppearanceSettings';

export function useMeshAppearanceState() {
  // Lighting controls (Global)
  const [ambientIntensity, setAmbientIntensity] = useState<number>(DEFAULT_AMBIENT_INTENSITY);
  const [directionalIntensity, setDirectionalIntensity] = useState<number>(DEFAULT_DIRECTIONAL_INTENSITY);
  const [materialRoughness, setMaterialRoughness] = useState<number>(DEFAULT_MATERIAL_ROUGHNESS);
  const [bakedAoIntensity, setBakedAoIntensity] = useState<number>(DEFAULT_BAKED_OCCLUSION_INTENSITY);

  // Geometry prep runs outside React and bakes before a model reaches the scene,
  // so it reads the intensity from the module rather than from this state.
  useEffect(() => {
    setBakedOcclusionIntensity(bakedAoIntensity);
  }, [bakedAoIntensity]);

  // Shader-specific settings (Global)
  const [shaderType, setShaderType] = useState<MeshShaderType>(DEFAULT_SHADER_TYPE);
  // What the Mesh settings tab edits. Deliberately separate from shaderType:
  // the camera dropdown owns what the viewport renders, the settings tab owns
  // which type's options it is showing.
  const [configuredShaderType, setConfiguredShaderType] = useState<MeshShaderType>(DEFAULT_SHADER_TYPE);
  const [matcapVariant, setMatcapVariant] = useState<MatcapVariant>(DEFAULT_MATCAP_VARIANT);
  const [flatUseVertexColors, setFlatUseVertexColors] = useState<boolean>(DEFAULT_FLAT_USE_VERTEX_COLORS);
  const [wireframeThicknessPx, setWireframeThicknessPx] = useState<number>(DEFAULT_WIREFRAME_THICKNESS_PX);
  const [xrayOpacity, setXrayOpacity] = useState<number>(DEFAULT_XRAY_OPACITY);
  const [heatmapMinAngle, setHeatmapMinAngle] = useState<number>(DEFAULT_HEATMAP_MIN_ANGLE);
  const [heatmapMaxAngle, setHeatmapMaxAngle] = useState<number>(DEFAULT_HEATMAP_MAX_ANGLE);
  const [heatmapColors, setHeatmapColors] = useState<string[]>(DEFAULT_HEATMAP_COLORS);
  const [preferredMeshColor, setPreferredMeshColor] = useState<string>(DEFAULT_MESH_COLOR);
  const [hoverTintStrength, setHoverTintStrength] = useState<number>(DEFAULT_HOVER_TINT_STRENGTH);
  const [selectedTintStrength, setSelectedTintStrength] = useState<number>(DEFAULT_SELECTED_TINT_STRENGTH);

  // Hydrated after mount, not in the initial state, so the first render matches
  // the server render (which has no localStorage). Moved verbatim from
  // useSceneCollectionManager, where the compiler lint did not analyse it.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const persistedAppearance = readMeshAppearanceFromLocalStorage();
    if (persistedAppearance) {
      setShaderType(persistedAppearance.shaderType);
      setConfiguredShaderType(persistedAppearance.configuredShaderType);
      setMatcapVariant(persistedAppearance.matcapVariant);
      setFlatUseVertexColors(persistedAppearance.flatUseVertexColors);
      setAmbientIntensity(persistedAppearance.ambientIntensity);
      setDirectionalIntensity(persistedAppearance.directionalIntensity);
      setMaterialRoughness(persistedAppearance.materialRoughness);
      setBakedAoIntensity(persistedAppearance.bakedAoIntensity);
      setWireframeThicknessPx(persistedAppearance.wireframeThicknessPx);
      setXrayOpacity(persistedAppearance.xrayOpacity);
      setHeatmapMinAngle(persistedAppearance.heatmapMinAngle ?? DEFAULT_HEATMAP_MIN_ANGLE);
      setHeatmapMaxAngle(persistedAppearance.heatmapMaxAngle ?? DEFAULT_HEATMAP_MAX_ANGLE);
      setHeatmapColors(persistedAppearance.heatmapColors ?? DEFAULT_HEATMAP_COLORS);
      setPreferredMeshColor(persistedAppearance.meshColor);
      setHoverTintStrength(persistedAppearance.hoverTintStrength);
      setSelectedTintStrength(persistedAppearance.selectedTintStrength);
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // The whole appearance record is persisted whenever any of it changes, so
  // settings survive a reload: the view mode the camera dropdown picks, the
  // type the Mesh tab is configuring, and every parameter either of them edits.
  useEffect(() => {
    writeMeshAppearanceToLocalStorage({
      v: 2,
      shaderType,
      configuredShaderType,
      matcapVariant,
      flatUseVertexColors,
      ambientIntensity,
      directionalIntensity,
      materialRoughness,
      bakedAoIntensity,
      wireframeThicknessPx,
      xrayOpacity,
      heatmapMinAngle,
      heatmapMaxAngle,
      heatmapColors,
      meshColor: preferredMeshColor,
      hoverTintStrength,
      selectedTintStrength,
    });
  }, [
    shaderType,
    configuredShaderType,
    matcapVariant,
    flatUseVertexColors,
    ambientIntensity,
    directionalIntensity,
    materialRoughness,
    bakedAoIntensity,
    wireframeThicknessPx,
    xrayOpacity,
    heatmapMinAngle,
    heatmapMaxAngle,
    heatmapColors,
    preferredMeshColor,
    hoverTintStrength,
    selectedTintStrength,
  ]);

  return {
    ambientIntensity,
    setAmbientIntensity,
    directionalIntensity,
    setDirectionalIntensity,
    materialRoughness,
    setMaterialRoughness,
    bakedAoIntensity,
    setBakedAoIntensity,
    shaderType,
    setShaderType,
    configuredShaderType,
    setConfiguredShaderType,
    matcapVariant,
    setMatcapVariant,
    flatUseVertexColors,
    setFlatUseVertexColors,
    wireframeThicknessPx,
    setWireframeThicknessPx,
    xrayOpacity,
    setXrayOpacity,
    heatmapMinAngle,
    setHeatmapMinAngle,
    heatmapMaxAngle,
    setHeatmapMaxAngle,
    heatmapColors,
    setHeatmapColors,
    preferredMeshColor,
    setPreferredMeshColor,
    hoverTintStrength,
    setHoverTintStrength,
    selectedTintStrength,
    setSelectedTintStrength,
  };
}
