"use client";

import React from 'react';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';
import { Check } from 'lucide-react';
import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import type { FontData } from 'three/addons/loaders/FontLoader.js';
import helvetikerRegular from 'three/examples/fonts/helvetiker_regular.typeface.json';
import { Button, Card, CardHeader, Input } from '@/components/atoms';
import { PanelCollapseToggle } from '@/components/atoms/PanelCollapseToggle';
import { useFloatingPanelCollapse } from '@/components/layout/FloatingPanelStack';
import { useLocaleFormat } from '@/hooks/useLocaleFormat';
import type { useSceneCollectionManager } from '@/features/scene/useSceneCollectionManager';
import type { ModelTransform } from '@/hooks/useModelTransform';
import { conformEngravingGeometryToSurface } from '@/features/text-labels/conformTextGeometryToSurface';
import { createImageCutterGeometry } from '@/features/text-labels/createImageCutterGeometry';
import { geometryFromSolidMesh, snapshotSolidOperationSource, solidMeshForModel } from '@/features/mesh-boolean/geometryAdapter';
import { runSolidMeshOperation } from '@/features/mesh-boolean/solidMeshOperationsClient';
import { setEngravingPreviewHighlight } from '@/features/text-labels/engravingPreviewHighlight';
import { pickOpenFilesWithNativeDialog, readPrintArtifactBytesFromPath } from '@/features/slicing/tauri/nativeSlicerBridge';
import { loadTauriCore } from '@/utils/tauriMeshBridge';
import { isTauriRuntime } from '@/utils/tauriRuntime';

import { isRayVector, makeSurfaceRaycastTarget, pickEngravingSurfaceFromRay, type SurfacePick } from '@/features/text-labels/engravingSurfacePicking';
import { solidMeshVolume } from '@/features/mesh-boolean/solidMeshVolume';

type Props = { scene: ReturnType<typeof useSceneCollectionManager> };
type EngravingMode = 'engraving' | 'relief';
type EngravingSourceModel = NonNullable<Props['scene']['activeModel']>;
type EngravingRotationBaseline = {
  cutterId: string;
  normal: THREE.Vector3;
  transform: ModelTransform;
  degrees: number;
};
type EngravingDragState = {
  pointerId: number;
  sourceId: string;
  cutterId: string;
  source: EngravingSourceModel;
  startPick: SurfacePick;
  lastPick: SurfacePick;
  startTransform: ModelTransform;
  targetMesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  moved: boolean;
};
type EngravingPointerDetail = {
  phase?: unknown;
  modelId?: unknown;
  pointerId?: unknown;
  button?: unknown;
  rayOrigin?: unknown;
  rayDirection?: unknown;
  dragging?: boolean;
};
function hasUnappliedModifiers(modifiers: NonNullable<Props['scene']['activeModel']>['meshModifiers'] | null): boolean {
  return !!(
    (modifiers?.hollowing?.enabled && !modifiers.hollowing.bakedIntoGeometry)
    || (modifiers?.holePunches?.length && !modifiers.holePunchesBakedIntoGeometry)
  );
}

const font = new FontLoader().parse(helvetikerRegular as FontData);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export function TextLabelCard({ scene }: Props) {
  const { _ } = useLingui();
  const fmt = useLocaleFormat();
  const [expanded, setExpanded] = useFloatingPanelCollapse(true);
  const [text, setText] = React.useState('');
  const [engravingMode, setEngravingMode] = React.useState<'text' | 'image'>('text');
  const [operationMode, setOperationMode] = React.useState<EngravingMode>('engraving');
  const [heightMm, setHeightMm] = React.useState(5);
  const [thicknessMm, setThicknessMm] = React.useState(0.6);
  const [imageFile, setImageFile] = React.useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = React.useState<string | null>(null);
  const [loadingImage, setLoadingImage] = React.useState(false);
  const [imageError, setImageError] = React.useState<'too-large' | 'unreadable' | null>(null);
  const imageRequestRef = React.useRef(0);
  const imageInputRef = React.useRef<HTMLInputElement | null>(null);
  const imagePreviewUrlRef = React.useRef<string | null>(null);
  const [imageWidthMm, setImageWidthMm] = React.useState(20);
  const [imageDepthMm, setImageDepthMm] = React.useState(0.6);
  const [rotationDegrees, setRotationDegrees] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [surfacePickArmed, setSurfacePickArmed] = React.useState(false);
  const [surfacePick, setSurfacePick] = React.useState<SurfacePick | null>(null);
  const [pendingCutter, setPendingCutter] = React.useState<{ sourceId: string; cutterId: string; operationMode: EngravingMode } | null>(null);
  const pendingCutterRef = React.useRef(pendingCutter);
  const deleteModelRef = React.useRef(scene.deleteModel);
  const baseGeometryRef = React.useRef<THREE.BufferGeometry | null>(null);
  const projectionDimensionsRef = React.useRef<{ footprintMm: number; depthMm: number; rotationDegrees: number; operationMode: EngravingMode } | null>(null);
  const rotationBaselineRef = React.useRef<EngravingRotationBaseline | null>(null);
  const livePreviewGeometryRef = React.useRef<THREE.BufferGeometry | null>(null);
  const previewSurfacePickRef = React.useRef<SurfacePick | null>(null);
  const latestPreviewModelRef = React.useRef<EngravingSourceModel | null>(null);
  const dragRef = React.useRef<EngravingDragState | null>(null);
  const dragRaycasterRef = React.useRef(new THREE.Raycaster());
  const active = scene.activeModel;
  const activeModelId = active?.id;
  const activeModifiers = active ? scene.getModelMeshModifiers(active.id) : null;
  const canCreate = !!active && active.visible && !active.isSupportGeometry
    && !active.geometry.nativePreview && !scene.isModelPlateLocked(active)
    && !hasUnappliedModifiers(activeModifiers);
  const validRotation = Number.isFinite(rotationDegrees) && rotationDegrees >= -180 && rotationDegrees <= 180;
  const hasSurfacePick = !!active && surfacePick?.modelId === active.id;
  const pendingCutterModel = pendingCutter
    ? scene.models.find((model) => model.id === pendingCutter.cutterId && model.visible && !model.isSupportGeometry)
    : undefined;
  const positionSelected = hasSurfacePick || !!pendingCutter;

  React.useEffect(() => {
    pendingCutterRef.current = pendingCutter;
  }, [pendingCutter]);

  // Tint the preview cutter: green while it is ready to apply, red after a failure.
  const pendingCutterId = pendingCutter?.cutterId ?? null;
  React.useEffect(() => {
    setEngravingPreviewHighlight(pendingCutterId
      ? { cutterId: pendingCutterId, status: error ? 'error' : 'ready' }
      : null);
  }, [pendingCutterId, error]);
  React.useEffect(() => () => setEngravingPreviewHighlight(null), []);

  React.useEffect(() => {
    deleteModelRef.current = scene.deleteModel;
  }, [scene.deleteModel]);

  React.useEffect(() => () => {
    imageRequestRef.current += 1;
    if (imagePreviewUrlRef.current) URL.revokeObjectURL(imagePreviewUrlRef.current);
    const pending = pendingCutterRef.current;
    dragRef.current?.material.dispose();
    dragRef.current = null;
    baseGeometryRef.current?.dispose();
    baseGeometryRef.current = null;
    rotationBaselineRef.current = null;
    livePreviewGeometryRef.current = null;
    if (pending) deleteModelRef.current(pending.cutterId);
  }, []);

  const loadImage = async (readFile: () => Promise<File | null>) => {
    const request = ++imageRequestRef.current;
    setLoadingImage(true);
    setImageError(null);
    try {
      const file = await readFile();
      if (!file || request !== imageRequestRef.current) return;
      if (file.size > MAX_IMAGE_BYTES) {
        setImageError('too-large');
        return;
      }
      const bitmap = await createImageBitmap(file);
      bitmap.close();
      if (request !== imageRequestRef.current) return;
      if (imagePreviewUrlRef.current) URL.revokeObjectURL(imagePreviewUrlRef.current);
      imagePreviewUrlRef.current = URL.createObjectURL(file);
      setImagePreviewUrl(imagePreviewUrlRef.current);
      setImageFile(file);
      setError(null);
    } catch (caught) {
      if (request !== imageRequestRef.current || String(caught).includes('Open cancelled by user')) return;
      setImageError(caught instanceof Error && caught.message === 'image-too-large' ? 'too-large' : 'unreadable');
    } finally {
      if (request === imageRequestRef.current) setLoadingImage(false);
    }
  };

  const chooseImage = () => {
    if (!isTauriRuntime()) {
      imageInputRef.current?.click();
      return;
    }
    void loadImage(async () => {
      const [picked] = await pickOpenFilesWithNativeDialog('image');
      if (!picked) return null;
      const core = await loadTauriCore();
      if (!core) throw new Error('Desktop bridge unavailable');
      const size = await core.invoke<number>('read_print_file_size', { sourcePath: picked.path });
      if (size > MAX_IMAGE_BYTES) throw new Error('image-too-large');
      const bytes = await readPrintArtifactBytesFromPath(picked.path);
      return new File([new Uint8Array(bytes)], picked.name);
    });
  };

  const installLivePreviewGeometry = React.useCallback((
    cutterId: string,
    geometry: THREE.BufferGeometry,
    transform?: ModelTransform,
  ) => {
    const updated = scene.setModelGeometryRaw(cutterId, geometry, transform);
    if (!updated) {
      geometry.dispose();
      return null;
    }
    const previous = livePreviewGeometryRef.current;
    livePreviewGeometryRef.current = geometry;
    latestPreviewModelRef.current = updated;
    if (previous && previous !== geometry) {
      window.requestAnimationFrame(() => previous.dispose());
    }
    return updated;
  }, [scene]);

  const setRotationBaseline = React.useCallback((
    cutterId: string,
    pick: SurfacePick,
    degrees: number,
    transform: ModelTransform,
  ) => {
    rotationBaselineRef.current = {
      cutterId,
      normal: pick.normal.clone(),
      transform: {
        position: transform.position.clone(),
        rotation: transform.rotation.clone(),
        scale: transform.scale.clone(),
      },
      degrees,
    };
    previewSurfacePickRef.current = pick;
  }, []);

  const updateRotationPreview = React.useCallback((degrees: number) => {
    setRotationDegrees(degrees);
    if (!Number.isFinite(degrees) || degrees < -180 || degrees > 180) return;
    const dimensions = projectionDimensionsRef.current;
    if (dimensions) dimensions.rotationDegrees = degrees;
    const pending = pendingCutterRef.current;
    const baseline = rotationBaselineRef.current;
    if (!pending || !baseline || baseline.cutterId !== pending.cutterId) return;
    const rotationDelta = new THREE.Quaternion().setFromAxisAngle(
      baseline.normal,
      THREE.MathUtils.degToRad(degrees - baseline.degrees),
    );
    const rotation = new THREE.Quaternion().setFromEuler(baseline.transform.rotation)
      .premultiply(rotationDelta);
    scene.setModelTransformRaw(pending.cutterId, {
      position: baseline.transform.position.clone(),
      rotation: new THREE.Euler().setFromQuaternion(rotation),
      scale: baseline.transform.scale.clone(),
    });
  }, [scene]);

  const reprojectRotationPreview = React.useCallback((degrees: number) => {
    const pending = pendingCutterRef.current;
    const dimensions = projectionDimensionsRef.current;
    const pick = previewSurfacePickRef.current;
    const baseline = rotationBaselineRef.current;
    const baseGeometry = baseGeometryRef.current;
    if (!pending || !dimensions || !pick || !baseline || !baseGeometry
      || baseline.cutterId !== pending.cutterId || !Number.isFinite(degrees) || degrees < -180 || degrees > 180) return null;
    if (baseline.degrees === degrees) return latestPreviewModelRef.current;

    const source = scene.models.find((model) => model.id === pending.sourceId);
    if (!source) return null;
    const conformed = conformEngravingGeometryToSurface(
      baseGeometry.clone(),
      source.geometry.geometry,
      source.geometry.center,
      source.transform,
      pick.point,
      pick.normal,
      dimensions.footprintMm,
      dimensions.depthMm,
      degrees,
      dimensions.operationMode,
    );
    if (!conformed) {
      setError('create-failed');
      return null;
    }
    const updated = installLivePreviewGeometry(pending.cutterId, conformed.geometry, conformed.transform);
    if (!updated) return null;
    setRotationBaseline(pending.cutterId, pick, degrees, conformed.transform);
    dimensions.rotationDegrees = degrees;
    setError(null);
    return updated;
  }, [installLivePreviewGeometry, scene, setRotationBaseline]);

  React.useEffect(() => {
    const handleSurfacePick = (event: Event) => {
      const detail = (event as CustomEvent<{
        modelId?: unknown;
        point?: unknown;
        normal?: unknown;
      }>).detail;
      if (!expanded || !surfacePickArmed || !activeModelId || detail?.modelId !== activeModelId
        || !Array.isArray(detail.point) || !Array.isArray(detail.normal)
        || detail.point.length !== 3 || detail.normal.length !== 3
        || ![...detail.point, ...detail.normal].every((value) => typeof value === 'number' && Number.isFinite(value))) return;
      const normal = new THREE.Vector3(...detail.normal as [number, number, number]);
      if (normal.lengthSq() < 1e-8) return;
      setSurfacePick({
        modelId: activeModelId,
        point: new THREE.Vector3(...detail.point as [number, number, number]),
        normal: normal.normalize(),
      });
      setSurfacePickArmed(false);
    };
    window.addEventListener('model-surface-picked', handleSurfacePick);
    return () => window.removeEventListener('model-surface-picked', handleSurfacePick);
  }, [activeModelId, expanded, surfacePickArmed]);

  React.useEffect(() => {
    setSurfacePick(null);
    setSurfacePickArmed(false);
  }, [active?.id]);

  React.useEffect(() => {
    if (!expanded) setSurfacePickArmed(false);
  }, [expanded]);

  React.useEffect(() => {
    const handlePreviewPointer = (event: Event) => {
      const detail = (event as CustomEvent<EngravingPointerDetail>).detail;
      const drag = dragRef.current;
      if (!detail || !pendingCutter) return;

      if (detail.phase === 'down') {
        if (detail.modelId !== pendingCutter.cutterId || detail.button !== 0
          || typeof detail.pointerId !== 'number' || !isRayVector(detail.rayOrigin) || !isRayVector(detail.rayDirection)) return;
        const source = scene.models.find((model) => model.id === pendingCutter.sourceId);
        const cutter = scene.models.find((model) => model.id === pendingCutter.cutterId);
        if (!source || !cutter) return;
        const { mesh, material } = makeSurfaceRaycastTarget(source);
        const startPick = pickEngravingSurfaceFromRay(
          source,
          mesh,
          dragRaycasterRef.current,
          detail.rayOrigin,
          detail.rayDirection,
        );
        if (!startPick) {
          material.dispose();
          return;
        }
        dragRef.current = {
          pointerId: detail.pointerId,
          sourceId: source.id,
          cutterId: cutter.id,
          source,
          startPick,
          lastPick: startPick,
          startTransform: {
            position: cutter.transform.position.clone(),
            rotation: cutter.transform.rotation.clone(),
            scale: cutter.transform.scale.clone(),
          },
          targetMesh: mesh,
          material,
          moved: false,
        };
        detail.dragging = true;
        return;
      }

      if (!drag || detail.pointerId !== drag.pointerId || detail.modelId !== drag.cutterId) return;
      detail.dragging = true;
      if ((detail.phase === 'move' || detail.phase === 'up')
        && isRayVector(detail.rayOrigin) && isRayVector(detail.rayDirection)) {
        const nextPick = pickEngravingSurfaceFromRay(
          drag.source,
          drag.targetMesh,
          dragRaycasterRef.current,
          detail.rayOrigin,
          detail.rayDirection,
        );
        if (nextPick) {
          drag.lastPick = nextPick;
          const delta = nextPick.point.clone().sub(drag.startPick.point);
          if (delta.lengthSq() > 0.0009) drag.moved = true;
          scene.setModelTransformRaw(drag.cutterId, {
            position: drag.startTransform.position.clone().add(delta),
            rotation: drag.startTransform.rotation.clone(),
            scale: drag.startTransform.scale.clone(),
          });
        }
      }

      if (detail.phase !== 'up' && detail.phase !== 'cancel') return;
      dragRef.current = null;
      drag.material.dispose();
      if (!drag.moved || detail.phase === 'cancel') {
        scene.setModelTransformRaw(drag.cutterId, drag.startTransform);
        return;
      }

      const baseGeometry = baseGeometryRef.current;
      const dimensions = projectionDimensionsRef.current;
      const source = scene.models.find((model) => model.id === drag.sourceId);
      if (!baseGeometry || !dimensions || !source || source.geometry.geometry !== drag.source.geometry.geometry) {
        scene.setModelTransformRaw(drag.cutterId, drag.startTransform);
        setError('stale-scene');
        return;
      }

      const conformed = conformEngravingGeometryToSurface(
        baseGeometry.clone(),
        source.geometry.geometry,
        source.geometry.center,
        source.transform,
        drag.lastPick.point,
        drag.lastPick.normal,
        dimensions.footprintMm,
        dimensions.depthMm,
        dimensions.rotationDegrees,
        dimensions.operationMode,
      );
      if (!conformed || !scene.replaceModelGeometry(
        drag.cutterId,
        conformed.geometry,
        dimensions.operationMode === 'relief' ? msg`Move relief preview` : msg`Move engraving preview`,
        {
          historyBefore: { transform: drag.startTransform },
          transformAfter: conformed.transform,
        },
      )) {
        conformed?.geometry.dispose();
        scene.setModelTransformRaw(drag.cutterId, drag.startTransform);
        setError('create-failed');
        return;
      }
      const updatedPreview = scene.setModelGeometryRaw(drag.cutterId, conformed.geometry, conformed.transform);
      if (!updatedPreview) {
        setError('stale-scene');
        return;
      }
      livePreviewGeometryRef.current = null;
      setRotationBaseline(drag.cutterId, drag.lastPick, dimensions.rotationDegrees, conformed.transform);
      latestPreviewModelRef.current = updatedPreview;
      setSurfacePick(drag.lastPick);
      setError(null);
    };

    window.addEventListener('engraving-preview-pointer', handlePreviewPointer);
    return () => window.removeEventListener('engraving-preview-pointer', handlePreviewPointer);
  }, [pendingCutter, scene, setRotationBaseline]);

  const createLabel = React.useCallback(async () => {
    const model = scene.activeModel;
    const label = text.trim();
    const imageName = imageFile?.name.replace(/\.[^.]+$/, '').trim() || _(msg`Image engraving`);
    const validText = engravingMode === 'text' && !!label && label.length <= 120
      && Number.isFinite(heightMm) && heightMm > 0 && heightMm <= 100
      && Number.isFinite(thicknessMm) && thicknessMm > 0 && thicknessMm <= 20
      && validRotation;
    const validImage = engravingMode === 'image' && !loadingImage && !!imageFile
      && Number.isFinite(imageWidthMm) && imageWidthMm > 0 && imageWidthMm <= 100
      && Number.isFinite(imageDepthMm) && imageDepthMm >= 0.1 && imageDepthMm <= 5
      && validRotation;
    if (busy || !canCreate || !model || (!validText && !validImage)
      || !surfacePick || surfacePick.modelId !== model.id) return;

    setBusy(true);
    setError(null);
    let geometry: THREE.BufferGeometry | null = null;
    let baseGeometry: THREE.BufferGeometry | null = null;
    let bitmap: ImageBitmap | null = null;
    try {
      let engravingHeightMm = heightMm;
      let depthMm = thicknessMm;
      if (engravingMode === 'text') {
        geometry = new TextGeometry(label, {
          font,
          size: 1,
          depth: 1,
          curveSegments: 5,
          bevelEnabled: false,
        });
        geometry.computeBoundingBox();
        const bounds = geometry.boundingBox;
        const glyphHeight = bounds?.getSize(new THREE.Vector3()).y ?? 0;
        if (!bounds || bounds.isEmpty() || glyphHeight <= 0) {
          geometry.dispose();
          geometry = null;
          setError('create-failed');
          return;
        }

        geometry.scale(heightMm / glyphHeight, heightMm / glyphHeight, thicknessMm);
        geometry.center();
      } else {
        bitmap = await createImageBitmap(imageFile!);
        const maxDimension = 512;
        const ratio = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
        const pixelWidth = Math.max(1, Math.round(bitmap.width * ratio));
        const pixelHeight = Math.max(1, Math.round(bitmap.height * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('image-read-failed');
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.clearRect(0, 0, pixelWidth, pixelHeight);
        context.drawImage(bitmap, 0, 0, pixelWidth, pixelHeight);
        const pixels = context.getImageData(0, 0, pixelWidth, pixelHeight);
        bitmap.close();
        bitmap = null;

        geometry = createImageCutterGeometry(pixels, imageWidthMm, imageDepthMm);
        if (!geometry) {
          setError('create-failed');
          return;
        }
        engravingHeightMm = imageWidthMm * (pixelHeight / pixelWidth);
        depthMm = imageDepthMm;
      }

      if (!geometry) {
        setError('create-failed');
        return;
      }
      baseGeometry = geometry;
      const footprintMm = engravingMode === 'image' ? Math.max(engravingHeightMm, imageWidthMm) : engravingHeightMm;
      geometry = baseGeometry.clone();
      const conformResult = conformEngravingGeometryToSurface(
        geometry,
        model.geometry.geometry,
        model.geometry.center,
        model.transform,
        surfacePick.point,
        surfacePick.normal,
        footprintMm,
        depthMm,
        rotationDegrees,
        operationMode,
      );
      if (!conformResult) {
        geometry = null;
        baseGeometry.dispose();
        baseGeometry = null;
        setError('create-failed');
        return;
      }
      geometry = conformResult.geometry;

      const id = scene.addModelFromGeometry(
        geometry,
        model.id,
        engravingMode === 'text' ? label : imageName,
        operationMode === 'relief'
          ? engravingMode === 'text' ? msg`Create text relief preview` : msg`Create image relief preview`
          : engravingMode === 'text' ? msg`Create text label cutter` : msg`Create image engraving cutter`,
        conformResult.transform,
      );
      if (!id) {
        geometry.dispose();
        geometry = null;
        baseGeometry.dispose();
        baseGeometry = null;
        setError('create-failed');
        return;
      }
      setRotationBaseline(id, surfacePick, rotationDegrees, conformResult.transform);
      livePreviewGeometryRef.current = null;
      latestPreviewModelRef.current = null;
      geometry = null;
      if (pendingCutter && pendingCutter.cutterId !== id) {
        scene.deleteModel(pendingCutter.cutterId);
      }
      baseGeometryRef.current?.dispose();
      baseGeometryRef.current = baseGeometry;
      projectionDimensionsRef.current = { footprintMm, depthMm, rotationDegrees, operationMode };
      baseGeometry = null;
      setPendingCutter({ sourceId: model.id, cutterId: id, operationMode });
      scene.setSelectedModelIds([model.id, id]);
    } catch {
      geometry?.dispose();
      baseGeometry?.dispose();
      setError('create-failed');
    } finally {
      bitmap?.close();
      setBusy(false);
    }
  }, [_, busy, canCreate, engravingMode, heightMm, imageDepthMm, imageFile, imageWidthMm, loadingImage, operationMode, pendingCutter, rotationDegrees, scene, setRotationBaseline, surfacePick, text, thicknessMm, validRotation]);

  const applyEngraving = React.useCallback(async () => {
    if (busy || !pendingCutter || !validRotation) return;
    const source = scene.models.find((model) => model.id === pendingCutter.sourceId);
    let cutter = latestPreviewModelRef.current ?? scene.models.find((model) => model.id === pendingCutter.cutterId);
    const dimensions = projectionDimensionsRef.current;
    if (dimensions && dimensions.rotationDegrees !== rotationBaselineRef.current?.degrees) {
      const updated = reprojectRotationPreview(dimensions.rotationDegrees);
      if (!updated) return;
      cutter = updated;
    } else if (cutter && rotationBaselineRef.current?.cutterId === pendingCutter.cutterId) {
      const updated = scene.setModelGeometryRaw(cutter.id, cutter.geometry.geometry, rotationBaselineRef.current.transform);
      if (updated) {
        cutter = updated;
        latestPreviewModelRef.current = updated;
      }
    }
    if (!source || !cutter || !source.visible || !cutter.visible || source.isSupportGeometry || cutter.isSupportGeometry
      || source.geometry.nativePreview || cutter.geometry.nativePreview
      || scene.isModelPlateLocked(source) || scene.isModelPlateLocked(cutter)
      || scene.resolveModelPlateId(source) !== scene.resolveModelPlateId(cutter)
      || hasUnappliedModifiers(scene.getModelMeshModifiers(source.id))
      || hasUnappliedModifiers(scene.getModelMeshModifiers(cutter.id))) {
      setError('stale-scene');
      return;
    }

    const snapshots = [source, cutter].map((model) => snapshotSolidOperationSource(
      model,
      scene.resolveModelPlateId(model),
      scene.getModelMeshModifiers(model.id),
    ));

    setBusy(true);
    setError(null);
    try {
      const sourceMesh = solidMeshForModel(source);
      const sourceVolume = solidMeshVolume(sourceMesh);
      const cutterMesh = solidMeshForModel(cutter);
      const operation = pendingCutter.operationMode === 'relief' ? 'union' : 'difference';
      const [result] = await runSolidMeshOperation(operation, [
        sourceMesh,
        cutterMesh,
      ]);
      const resultVolume = solidMeshVolume(result);
      const volumeTolerance = Math.max(1e-6, sourceVolume * 1e-8);
      if (operation === 'difference'
        ? resultVolume >= sourceVolume - volumeTolerance
        : resultVolume <= sourceVolume + volumeTolerance) {
        setError('no-overlap');
        return;
      }
      // Keep the boolean mesh intact. Refining by cutter bounds also subdivides
      // long host faces that only partially overlap the engraving.
      const geometry = geometryFromSolidMesh(result);
      // Vertex occlusion spreads shadows from fine engraving details across
      // the long triangles on the surrounding host surface.
      geometry.userData.skipBakedOcclusion = true;
      if (!scene.commitSolidOperationResult(geometry, snapshots, operation)) {
        geometry.dispose();
        setError('stale-scene');
        return;
      }
      setPendingCutter(null);
      setSurfacePick(null);
      baseGeometryRef.current?.dispose();
      baseGeometryRef.current = null;
      projectionDimensionsRef.current = null;
      previewSurfacePickRef.current = null;
      rotationBaselineRef.current = null;
      livePreviewGeometryRef.current = null;
      latestPreviewModelRef.current = null;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'operation-failed');
    } finally {
      setBusy(false);
    }
  }, [busy, pendingCutter, reprojectRotationPreview, scene, validRotation]);

  const discardEngravingPreview = React.useCallback(() => {
    if (busy || !pendingCutter) return;
    scene.deleteModel(pendingCutter.cutterId);
    setPendingCutter(null);
    setError(null);
    scene.setSelectedModelIds([pendingCutter.sourceId]);
    baseGeometryRef.current?.dispose();
    baseGeometryRef.current = null;
    projectionDimensionsRef.current = null;
    previewSurfacePickRef.current = null;
    rotationBaselineRef.current = null;
    livePreviewGeometryRef.current = null;
    latestPreviewModelRef.current = null;
  }, [busy, pendingCutter, scene]);

  const canCreateLabel = canCreate && hasSurfacePick && !surfacePickArmed && !busy && validRotation
    && (engravingMode === 'text'
      ? !!text.trim() && Number.isFinite(heightMm) && heightMm > 0 && heightMm <= 100
        && Number.isFinite(thicknessMm) && thicknessMm > 0 && thicknessMm <= 20
      : !loadingImage && !!imageFile
        && Number.isFinite(imageWidthMm) && imageWidthMm > 0 && imageWidthMm <= 100
        && Number.isFinite(imageDepthMm) && imageDepthMm >= 0.1 && imageDepthMm <= 5);

  const errorMessage = error === 'no-overlap'
    ? pendingCutter?.operationMode === 'relief'
      ? _(msg`The relief did not join the model. Increase its height or select the surface again.`)
      : _(msg`The cutter did not reach the model. Increase the engraving depth or select the surface again.`)
    : error === 'not-manifold'
      ? _(msg`Repair the source mesh before applying this surface operation.`)
      : error === 'empty-result'
        ? pendingCutter?.operationMode === 'relief'
          ? _(msg`The relief result is empty. Increase its height or select another surface.`)
          : _(msg`The engraving would remove the entire model. Reduce its size or depth.`)
        : error === 'invalid-input'
          ? _(msg`The source or cutter geometry could not be read.`)
          : error === 'stale-scene'
            ? _(msg`A source model or preview changed. Create the preview again.`)
            : error === 'create-failed'
              ? engravingMode === 'text'
                ? _(msg`Could not project this text onto the selected surface. Pick a flatter area or reduce the text height.`)
                : _(msg`Could not create the image cutter. Choose a smaller image, a transparent PNG, and a flatter surface.`)
              : error
                ? pendingCutter?.operationMode === 'relief'
                  ? _(msg`The relief failed. Repair the mesh and try again.`)
                  : _(msg`The engraving failed. Repair the mesh and try again.`)
                : '';

  return (
    <Card>
      <CardHeader
        left={(
          <>
            <PanelCollapseToggle expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
            <h3 className="text-lg font-semibold" style={{ color: 'var(--text-strong)' }}>
              {_(msg`Surface engraving (experimental)`)}
            </h3>
          </>
        )}
      />
      {expanded && (
        <div
          className="engraving-panel-content space-y-3 overflow-y-auto px-4 pb-4"
          style={{ maxHeight: 'calc(100dvh - var(--topbar-height) - 60px)' }}
        >
          <section className="space-y-2.5 border-b pb-3" style={{ borderColor: 'var(--border-subtle)' }}>
            <p className="text-base font-semibold" style={{ color: 'var(--text-strong)' }}><Trans>Content</Trans></p>
            <div className="grid grid-cols-2 gap-1 rounded-lg border p-1" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}>
              <Button size="lg" className="engraving-mode-button w-full" variant={engravingMode === 'text' ? 'accent' : 'secondary'} aria-pressed={engravingMode === 'text'} disabled={busy} onClick={() => setEngravingMode('text')}>
                <Trans>Text</Trans>
              </Button>
              <Button size="lg" className="engraving-mode-button w-full" variant={engravingMode === 'image' ? 'accent' : 'secondary'} aria-pressed={engravingMode === 'image'} disabled={busy} onClick={() => setEngravingMode('image')}>
                <Trans>Image</Trans>
              </Button>
            </div>
          </section>
          {engravingMode === 'text' ? (
            <label className="block">
              <span className="sr-only"><Trans>Text label</Trans></span>
              <textarea
                className="engraving-text-input ui-input min-h-28 w-full resize-y text-sm"
                value={text}
                maxLength={120}
                rows={4}
                onChange={(event) => setText(event.currentTarget.value)}
                placeholder={_(msg`Up to 120 characters`)}
                aria-label={_(msg`Text label`)}
              />
            </label>
          ) : (
            <div className="space-y-2.5">
              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                disabled={busy || loadingImage}
                aria-label={_(msg`Image file`)}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0] ?? null;
                  event.currentTarget.value = '';
                  if (file) void loadImage(async () => file);
                }}
              />
              {imageFile && imagePreviewUrl ? (
                <div className="engraving-image-card flex min-w-0 items-center gap-3 rounded-lg border p-2.5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-0)' }}>
                  <div
                    role="img"
                    aria-label={imageFile.name}
                    className="engraving-image-preview h-20 w-24 shrink-0 rounded-md border bg-center bg-no-repeat"
                    style={{
                      borderColor: 'var(--border-subtle)',
                      backgroundColor: 'var(--surface-1)',
                      backgroundImage: `url("${imagePreviewUrl}")`,
                      backgroundSize: 'contain',
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" style={{ color: 'var(--text-strong)' }}>{imageFile.name}</p>
                    <Button size="auto" className="mt-1 !h-auto !border-0 !bg-transparent !px-0 !py-0 text-xs font-medium underline underline-offset-2 shadow-none" onClick={chooseImage} disabled={busy || loadingImage}>
                      <Trans>Change image</Trans>
                    </Button>
                  </div>
                </div>
              ) : (
                <Button size="lg" className="w-full" onClick={chooseImage} disabled={busy || loadingImage}>
                  <Trans>Choose image</Trans>
                </Button>
              )}
              {loadingImage && <p role="status" className="text-xs"><Trans>Reading image…</Trans></p>}
              {imageError && <p role="alert" className="text-xs text-red-400">
                {imageError === 'too-large'
                  ? <Trans>The image exceeds 20 MB. Choose a smaller file.</Trans>
                  : <Trans>Could not read the image. Choose a valid PNG, JPEG, or WebP file.</Trans>}
              </p>}
              <p className="engraving-image-help text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                {operationMode === 'relief'
                  ? <Trans>Use an image under 20 MB. Dark pixels raise higher. Transparent pixels are left untouched; use a transparent PNG for logos.</Trans>
                  : <Trans>Use an image under 20 MB. Dark pixels engrave deeper. Transparent pixels are left untouched; use a transparent PNG for logos.</Trans>}
              </p>
            </div>
          )}
          <section className="space-y-2.5 border-b pb-3" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="grid grid-cols-2 gap-1 rounded-lg border p-1" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}>
              <Button size="lg" className="engraving-mode-button w-full" variant={operationMode === 'engraving' ? 'accent' : 'secondary'} aria-pressed={operationMode === 'engraving'} disabled={busy} onClick={() => setOperationMode('engraving')}>
                <Trans>Engraving</Trans>
              </Button>
              <Button size="lg" className="engraving-mode-button w-full" variant={operationMode === 'relief' ? 'accent' : 'secondary'} aria-pressed={operationMode === 'relief'} disabled={busy} onClick={() => setOperationMode('relief')}>
                <Trans>Relief</Trans>
              </Button>
            </div>
          </section>
          <section className="space-y-2 border-b pb-3" style={{ borderColor: 'var(--border-subtle)' }}>
            <p className="text-base font-semibold" style={{ color: 'var(--text-strong)' }}><Trans>Position on model</Trans></p>
            <div className="flex items-center justify-between gap-2">
              <p className="flex min-w-0 items-center text-sm" style={{ color: positionSelected ? 'var(--text-strong)' : 'var(--text-muted)' }}>
                {positionSelected && <Check className="mr-2 h-5 w-5 shrink-0 rounded bg-[var(--accent)] p-0.5 text-black" aria-hidden="true" />}
                {positionSelected ? <Trans>Surface selected</Trans> : <Trans>Surface not selected</Trans>}
              </p>
              <Button
                size="md"
                className="shrink-0"
                disabled={!canCreate || busy}
                aria-pressed={surfacePickArmed}
                onClick={() => {
                  if (surfacePickArmed) {
                    setSurfacePickArmed(false);
                    return;
                  }
                  setSurfacePick(null);
                  setSurfacePickArmed(true);
                  setError(null);
                }}
              >
                {surfacePickArmed
                  ? _(msg`Cancel surface selection`)
                  : pendingCutterModel
                    ? _(msg`Reposition`)
                    : operationMode === 'relief' ? _(msg`Pick relief surface`) : _(msg`Pick engraving surface`)}
              </Button>
            </div>
            {surfacePickArmed && <p className="text-xs" style={{ color: 'var(--text-muted)' }}><Trans>Click the active model to choose the center and facing direction.</Trans></p>}
          </section>
          <section className="space-y-3 border-b pb-3" style={{ borderColor: 'var(--border-subtle)' }}>
            <p className="text-base font-semibold" style={{ color: 'var(--text-strong)' }}><Trans>Preview</Trans></p>
            {engravingMode === 'text' ? (
              <div className="space-y-2.5">
                <label className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                  <span><Trans>Text height</Trans></span>
                  <div className="engraving-value-field flex h-9 min-w-0 items-center rounded-md border pl-2.5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-0)' }}>
                    <Input type="number" min="0.1" max="100" step="0.1" value={heightMm}
                      className="min-w-0 flex-1 !border-0 !bg-transparent !px-0 !py-0 !shadow-none"
                      onChange={(event) => setHeightMm(Number(event.currentTarget.value))}
                      aria-label={_(msg`Text height in millimetres`)} />
                    <span className="shrink-0 px-2 text-xs">{fmt.unit('mm', '')}</span>
                  </div>
                </label>
                <label className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                  <span>{operationMode === 'relief' ? <Trans>Relief height</Trans> : <Trans>Engraving depth</Trans>}</span>
                  <div className="engraving-value-field flex h-9 min-w-0 items-center rounded-md border pl-2.5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-0)' }}>
                    <Input type="number" min="0.1" max="20" step="0.1" value={thicknessMm}
                      className="min-w-0 flex-1 !border-0 !bg-transparent !px-0 !py-0 !shadow-none"
                      onChange={(event) => setThicknessMm(Number(event.currentTarget.value))}
                      aria-label={operationMode === 'relief'
                        ? _(msg`Text relief height in millimetres`)
                        : _(msg`Text engraving depth in millimetres`)} />
                    <span className="shrink-0 px-2 text-xs">{fmt.unit('mm', '')}</span>
                  </div>
                </label>
              </div>
            ) : (
              <div className="space-y-2.5">
                <label className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                  <span><Trans>Image width</Trans></span>
                  <div className="engraving-value-field flex h-9 min-w-0 items-center rounded-md border pl-2.5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-0)' }}>
                    <Input type="number" min="1" max="100" step="0.5" value={imageWidthMm}
                      className="min-w-0 flex-1 !border-0 !bg-transparent !px-0 !py-0 !shadow-none"
                      onChange={(event) => setImageWidthMm(Number(event.currentTarget.value))}
                      aria-label={_(msg`Image width in millimetres`)} />
                    <span className="shrink-0 px-2 text-xs">{fmt.unit('mm', '')}</span>
                  </div>
                </label>
                <label className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                  <span>{operationMode === 'relief' ? <Trans>Maximum relief height</Trans> : <Trans>Maximum depth</Trans>}</span>
                  <div className="engraving-value-field flex h-9 min-w-0 items-center rounded-md border pl-2.5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-0)' }}>
                    <Input type="number" min="0.1" max="5" step="0.1" value={imageDepthMm}
                      className="min-w-0 flex-1 !border-0 !bg-transparent !px-0 !py-0 !shadow-none"
                      onChange={(event) => setImageDepthMm(Number(event.currentTarget.value))}
                      aria-label={operationMode === 'relief'
                        ? _(msg`Maximum image relief height in millimetres`)
                        : _(msg`Maximum image engraving depth in millimetres`)} />
                    <span className="shrink-0 px-2 text-xs">{fmt.unit('mm', '')}</span>
                  </div>
                </label>
              </div>
            )}
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 text-sm" style={{ color: 'var(--text-muted)' }}>
              <span><Trans>Engraving rotation</Trans></span>
              <div className="flex min-w-0 items-center gap-1.5">
                <div className="flex h-9 min-w-0 flex-1 items-center rounded-md border pl-2.5" style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-0)' }}>
                  <Input type="number" min="-180" max="180" step="1" value={rotationDegrees}
                    className="min-w-0 flex-1 !border-0 !bg-transparent !px-0 !py-0 !shadow-none"
                    onChange={(event) => updateRotationPreview(Number(event.currentTarget.value))}
                    onBlur={() => void reprojectRotationPreview(projectionDimensionsRef.current?.rotationDegrees ?? rotationDegrees)}
                    aria-label={_(msg`Engraving rotation`)}
                    aria-invalid={!validRotation} />
                  <span className="shrink-0 px-2 text-xs">°</span>
                </div>
                <Button
                  size="md"
                  disabled={busy}
                  aria-label={_(msg`Reset engraving rotation to zero`)}
                  title={_(msg`Reset engraving rotation to zero`)}
                  onClick={() => {
                    updateRotationPreview(0);
                    void reprojectRotationPreview(0);
                  }}
                >
                  {fmt.quantity(0, 0, 'degree')}
                </Button>
              </div>
            </div>
            {pendingCutterModel && pendingCutter && (
              <div className="space-y-2 pt-1">
                <p className="text-sm italic" style={{ color: 'var(--text-muted)' }}><Trans>Preview ready</Trans></p>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}><Trans>Drag the preview across the model surface to reposition it.</Trans></p>
                <Button size="md" className="engraving-action-button w-full" disabled={!canCreateLabel} onClick={() => void createLabel()}>
                  {busy
                    ? _(msg`Creating…`)
                    : pendingCutter.operationMode === 'relief' ? _(msg`Update relief preview`) : _(msg`Update engraving preview`)}
                </Button>
              </div>
            )}
          </section>
          {errorMessage && (
            <p role="alert" className="text-xs leading-relaxed text-[var(--status-danger)]">
              {errorMessage}
            </p>
          )}
          {pendingCutterModel && pendingCutter ? (
            <div className="space-y-2.5 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
              <Button size="lg" variant="accent" className="engraving-action-button w-full" disabled={busy || !validRotation} onClick={() => void applyEngraving()}>
                {busy
                  ? _(msg`Processing…`)
                  : pendingCutter.operationMode === 'relief' ? _(msg`Apply relief`) : _(msg`Apply engraving`)}
              </Button>
              <Button size="lg" className="engraving-action-button w-full" disabled={busy} onClick={discardEngravingPreview}>
                <Trans>Discard preview</Trans>
              </Button>
            </div>
          ) : (
            <Button size="lg" variant="accent" className="engraving-action-button w-full" disabled={!canCreateLabel} onClick={() => void createLabel()}>
              {busy
                ? _(msg`Creating…`)
                : operationMode === 'relief' ? _(msg`Create relief preview`) : _(msg`Create engraving preview`)}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
