"use client";

import React from 'react';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';
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
import { refineEngravingTriangulation } from '@/features/mesh-boolean/refineEngravingTriangulation';
import { setEngravingPreviewHighlight } from '@/features/text-labels/engravingPreviewHighlight';

type Props = { scene: ReturnType<typeof useSceneCollectionManager> };
type SurfacePick = { modelId: string; point: THREE.Vector3; normal: THREE.Vector3 };
type SolidMeshData = { positions: Float32Array; indices?: Uint32Array };
type EngravingSourceModel = NonNullable<Props['scene']['activeModel']>;
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
type RayVector = readonly [number, number, number];

function isRayVector(value: unknown): value is RayVector {
  return Array.isArray(value) && value.length === 3
    && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

function makeSurfaceRaycastTarget(model: EngravingSourceModel): { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial } {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(model.geometry.geometry, material);
  const matrix = new THREE.Matrix4().compose(
    model.transform.position,
    new THREE.Quaternion().setFromEuler(model.transform.rotation),
    model.transform.scale,
  ).multiply(new THREE.Matrix4().makeTranslation(
    -model.geometry.center.x,
    -model.geometry.center.y,
    -model.geometry.center.z,
  ));
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(matrix);
  mesh.matrixWorld.copy(matrix);
  return { mesh, material };
}

function pickEngravingSurfaceFromRay(
  source: EngravingSourceModel,
  targetMesh: THREE.Mesh,
  raycaster: THREE.Raycaster,
  rayOrigin: readonly number[],
  rayDirection: readonly number[],
): SurfacePick | null {
  raycaster.set(
    new THREE.Vector3(rayOrigin[0], rayOrigin[1], rayOrigin[2]),
    new THREE.Vector3(rayDirection[0], rayDirection[1], rayDirection[2]).normalize(),
  );
  const hit = raycaster.intersectObject(targetMesh, false)[0];
  if (!hit?.face) return null;
  const matrix = targetMesh.matrixWorld;
  const normal = hit.face.normal.clone()
    .applyMatrix3(new THREE.Matrix3().getNormalMatrix(matrix))
    .normalize();
  return { modelId: source.id, point: hit.point.clone(), normal };
}

function solidMeshVolume(mesh: SolidMeshData): number {
  const indices = mesh.indices ?? Uint32Array.from({ length: mesh.positions.length / 3 }, (_, index) => index);
  let volume = 0;
  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index] * 3;
    const b = indices[index + 1] * 3;
    const c = indices[index + 2] * 3;
    volume += mesh.positions[a] * (mesh.positions[b + 1] * mesh.positions[c + 2] - mesh.positions[b + 2] * mesh.positions[c + 1])
      + mesh.positions[a + 1] * (mesh.positions[b + 2] * mesh.positions[c] - mesh.positions[b] * mesh.positions[c + 2])
      + mesh.positions[a + 2] * (mesh.positions[b] * mesh.positions[c + 1] - mesh.positions[b + 1] * mesh.positions[c]);
  }
  return Math.abs(volume / 6);
}

function hasUnappliedModifiers(modifiers: NonNullable<Props['scene']['activeModel']>['meshModifiers'] | null): boolean {
  return !!(
    (modifiers?.hollowing?.enabled && !modifiers.hollowing.bakedIntoGeometry)
    || (modifiers?.holePunches?.length && !modifiers.holePunchesBakedIntoGeometry)
  );
}

const font = new FontLoader().parse(helvetikerRegular as FontData);

export function TextLabelCard({ scene }: Props) {
  const { _ } = useLingui();
  const fmt = useLocaleFormat();
  const [expanded, setExpanded] = useFloatingPanelCollapse(true);
  const [text, setText] = React.useState('');
  const [engravingMode, setEngravingMode] = React.useState<'text' | 'image'>('text');
  const [heightMm, setHeightMm] = React.useState(5);
  const [thicknessMm, setThicknessMm] = React.useState(0.6);
  const [imageFile, setImageFile] = React.useState<File | null>(null);
  const [imageWidthMm, setImageWidthMm] = React.useState(20);
  const [imageDepthMm, setImageDepthMm] = React.useState(0.6);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [surfacePickArmed, setSurfacePickArmed] = React.useState(false);
  const [surfacePick, setSurfacePick] = React.useState<SurfacePick | null>(null);
  const [pendingCutter, setPendingCutter] = React.useState<{ sourceId: string; cutterId: string } | null>(null);
  const pendingCutterRef = React.useRef(pendingCutter);
  const deleteModelRef = React.useRef(scene.deleteModel);
  const baseGeometryRef = React.useRef<THREE.BufferGeometry | null>(null);
  const projectionDimensionsRef = React.useRef<{ footprintMm: number; depthMm: number } | null>(null);
  const dragRef = React.useRef<EngravingDragState | null>(null);
  const dragRaycasterRef = React.useRef(new THREE.Raycaster());
  const active = scene.activeModel;
  const activeModelId = active?.id;
  const activeModifiers = active ? scene.getModelMeshModifiers(active.id) : null;
  const canCreate = !!active && active.visible && !active.isSupportGeometry
    && !active.geometry.nativePreview && !scene.isModelPlateLocked(active)
    && !hasUnappliedModifiers(activeModifiers);
  const hasSurfacePick = !!active && surfacePick?.modelId === active.id;
  const pendingCutterModel = pendingCutter
    ? scene.models.find((model) => model.id === pendingCutter.cutterId && model.visible && !model.isSupportGeometry)
    : undefined;

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
    const pending = pendingCutterRef.current;
    dragRef.current?.material.dispose();
    dragRef.current = null;
    baseGeometryRef.current?.dispose();
    baseGeometryRef.current = null;
    if (pending) deleteModelRef.current(pending.cutterId);
  }, []);

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
      );
      if (!conformed || !scene.replaceModelGeometry(
        drag.cutterId,
        conformed.geometry,
        msg`Move engraving preview`,
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
      setSurfacePick(drag.lastPick);
      setError(null);
    };

    window.addEventListener('engraving-preview-pointer', handlePreviewPointer);
    return () => window.removeEventListener('engraving-preview-pointer', handlePreviewPointer);
  }, [pendingCutter, scene]);

  const createLabel = React.useCallback(async () => {
    const model = scene.activeModel;
    const label = text.trim();
    const imageName = imageFile?.name.replace(/\.[^.]+$/, '').trim() || _(msg`Image engraving`);
    const validText = engravingMode === 'text' && !!label && label.length <= 120
      && Number.isFinite(heightMm) && heightMm > 0 && heightMm <= 100
      && Number.isFinite(thicknessMm) && thicknessMm > 0 && thicknessMm <= 20;
    const validImage = engravingMode === 'image' && !!imageFile && imageFile.size <= 20 * 1024 * 1024
      && Number.isFinite(imageWidthMm) && imageWidthMm > 0 && imageWidthMm <= 100
      && Number.isFinite(imageDepthMm) && imageDepthMm >= 0.1 && imageDepthMm <= 5;
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
        engravingMode === 'text' ? msg`Create text label cutter` : msg`Create image engraving cutter`,
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
      geometry = null;
      if (pendingCutter && pendingCutter.cutterId !== id) {
        scene.deleteModel(pendingCutter.cutterId);
      }
      baseGeometryRef.current?.dispose();
      baseGeometryRef.current = baseGeometry;
      projectionDimensionsRef.current = { footprintMm, depthMm };
      baseGeometry = null;
      setPendingCutter({ sourceId: model.id, cutterId: id });
      scene.setSelectedModelIds([model.id, id]);
    } catch {
      geometry?.dispose();
      baseGeometry?.dispose();
      setError('create-failed');
    } finally {
      bitmap?.close();
      setBusy(false);
    }
  }, [_, busy, canCreate, engravingMode, heightMm, imageDepthMm, imageFile, imageWidthMm, pendingCutter, scene, surfacePick, text, thicknessMm]);

  const applyEngraving = React.useCallback(async () => {
    if (busy || !pendingCutter) return;
    const source = scene.models.find((model) => model.id === pendingCutter.sourceId);
    const cutter = scene.models.find((model) => model.id === pendingCutter.cutterId);
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
      const cutterBounds = { min: [Infinity, Infinity, Infinity] as [number, number, number], max: [-Infinity, -Infinity, -Infinity] as [number, number, number] };
      for (let index = 0; index < cutterMesh.positions.length; index += 3) {
        for (let axis = 0; axis < 3; axis += 1) {
          cutterBounds.min[axis] = Math.min(cutterBounds.min[axis], cutterMesh.positions[index + axis]);
          cutterBounds.max[axis] = Math.max(cutterBounds.max[axis], cutterMesh.positions[index + axis]);
        }
      }
      const [result] = await runSolidMeshOperation('difference', [
        sourceMesh,
        cutterMesh,
      ]);
      const resultVolume = solidMeshVolume(result);
      if (resultVolume >= sourceVolume - Math.max(1e-6, sourceVolume * 1e-8)) {
        setError('no-overlap');
        return;
      }
      const geometry = geometryFromSolidMesh(refineEngravingTriangulation(result, cutterBounds));
      if (!scene.commitSolidOperationResult(geometry, snapshots, 'difference')) {
        geometry.dispose();
        setError('stale-scene');
        return;
      }
      setPendingCutter(null);
      setSurfacePick(null);
      baseGeometryRef.current?.dispose();
      baseGeometryRef.current = null;
      projectionDimensionsRef.current = null;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'operation-failed');
    } finally {
      setBusy(false);
    }
  }, [busy, pendingCutter, scene]);

  const discardEngravingPreview = React.useCallback(() => {
    if (busy || !pendingCutter) return;
    scene.deleteModel(pendingCutter.cutterId);
    setPendingCutter(null);
    setError(null);
    scene.setSelectedModelIds([pendingCutter.sourceId]);
    baseGeometryRef.current?.dispose();
    baseGeometryRef.current = null;
    projectionDimensionsRef.current = null;
  }, [busy, pendingCutter, scene]);

  const errorMessage = error === 'no-overlap'
    ? _(msg`The cutter did not reach the model. Increase the engraving depth or select the surface again.`)
    : error === 'not-manifold'
      ? _(msg`Repair the source mesh before applying the engraving.`)
      : error === 'empty-result'
        ? _(msg`The engraving would remove the entire model. Reduce its size or depth.`)
        : error === 'invalid-input'
          ? _(msg`The source or cutter geometry could not be read.`)
          : error === 'stale-scene'
            ? _(msg`A source model or preview changed. Create the preview again.`)
            : error === 'create-failed'
              ? engravingMode === 'text'
                ? _(msg`Could not project this text onto the selected surface. Pick a flatter area or reduce the text height.`)
                : _(msg`Could not create the image cutter. Choose a smaller image, a transparent PNG, and a flatter surface.`)
              : error
                ? _(msg`The engraving failed. Repair the mesh and try again.`)
                : '';

  return (
    <Card>
      <CardHeader
        left={(
          <>
            <PanelCollapseToggle expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>
              {_(msg`Surface engraving (experimental)`)}
            </h3>
          </>
        )}
      />
      {expanded && (
        <div className="space-y-2 px-2.5 pb-3">
          <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            <Trans>Choose text or an image, pick a point on the model, create a surface preview, then confirm to cut the engraving into the model.</Trans>
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <Button size="xs" variant={engravingMode === 'text' ? 'accent' : 'secondary'} aria-pressed={engravingMode === 'text'} onClick={() => setEngravingMode('text')}>
              <Trans>Text</Trans>
            </Button>
            <Button size="xs" variant={engravingMode === 'image' ? 'accent' : 'secondary'} aria-pressed={engravingMode === 'image'} onClick={() => setEngravingMode('image')}>
              <Trans>Image</Trans>
            </Button>
          </div>
          {engravingMode === 'text' ? (
            <label className="block space-y-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
              <span><Trans>Text</Trans></span>
              <Input
                value={text}
                maxLength={120}
                onChange={(event) => setText(event.currentTarget.value)}
                placeholder={_(msg`Up to 120 characters`)}
                aria-label={_(msg`Text label`)}
              />
            </label>
          ) : (
            <>
              <label className="block space-y-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                <span><Trans>Image file</Trans></span>
                <Input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="w-full text-[10px]"
                  aria-label={_(msg`Image file`)}
                  onChange={(event) => {
                    setImageFile(event.currentTarget.files?.[0] ?? null);
                    setError(null);
                  }}
                />
              </label>
              <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                <Trans>Use an image under 20 MB. Dark pixels engrave deeper. Transparent pixels are left untouched; use a transparent PNG for logos.</Trans>
              </p>
            </>
          )}
          <Button
            size="xs"
            className="w-full"
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
                ? _(msg`Choose a new position on the model`)
                : _(msg`Pick engraving surface`)}
          </Button>
          {surfacePickArmed && <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}><Trans>Click the active model to choose the engraving center and direction.</Trans></p>}
          {hasSurfacePick && <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}><Trans>Surface selected</Trans></p>}
          {engravingMode === 'text' ? (
            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                <span><Trans>Text height</Trans></span>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min="0.1" max="100" step="0.1" value={heightMm}
                    onChange={(event) => setHeightMm(Number(event.currentTarget.value))}
                    aria-label={_(msg`Text height in millimetres`)} />
                  <span>{fmt.unit('mm', '')}</span>
                </div>
              </label>
              <label className="block space-y-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                <span><Trans>Engraving depth</Trans></span>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min="0.1" max="20" step="0.1" value={thicknessMm}
                    onChange={(event) => setThicknessMm(Number(event.currentTarget.value))}
                    aria-label={_(msg`Text engraving depth in millimetres`)} />
                  <span>{fmt.unit('mm', '')}</span>
                </div>
              </label>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                <span><Trans>Image width</Trans></span>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min="1" max="100" step="0.5" value={imageWidthMm}
                    onChange={(event) => setImageWidthMm(Number(event.currentTarget.value))}
                    aria-label={_(msg`Image width in millimetres`)} />
                  <span>{fmt.unit('mm', '')}</span>
                </div>
              </label>
              <label className="block space-y-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                <span><Trans>Maximum depth</Trans></span>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min="0.1" max="5" step="0.1" value={imageDepthMm}
                    onChange={(event) => setImageDepthMm(Number(event.currentTarget.value))}
                    aria-label={_(msg`Maximum image engraving depth in millimetres`)} />
                  <span>{fmt.unit('mm', '')}</span>
                </div>
              </label>
            </div>
          )}
          {engravingMode === 'text' && <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            <Trans>Text height:</Trans> {fmt.quantity(heightMm, 1, 'mm')} · <Trans>depth:</Trans> {fmt.quantity(thicknessMm, 1, 'mm')}
          </p>}
          {errorMessage && (
            <p role="alert" className="text-[10px] leading-relaxed text-[var(--status-danger)]">
              {errorMessage}
            </p>
          )}
          {pendingCutterModel && pendingCutter && (
            <div className="space-y-1.5 rounded border p-2" style={{ borderColor: 'var(--border-subtle)' }}>
              <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                <Trans>Preview ready: <strong>{pendingCutterModel.name}</strong>. Confirm to cut it into the source model.</Trans>
              </p>
              <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                <Trans>Drag the preview across the model surface to reposition it.</Trans>
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                <Button size="xs" variant="primary" disabled={busy} onClick={() => void applyEngraving()}>
                  {busy ? _(msg`Processing…`) : _(msg`Confirm engraving`)}
                </Button>
                <Button size="xs" disabled={busy} onClick={discardEngravingPreview}>
                  <Trans>Discard preview</Trans>
                </Button>
              </div>
            </div>
          )}
          <Button size="xs" className="w-full" disabled={!canCreate || !hasSurfacePick || surfacePickArmed || busy
            || (engravingMode === 'text' ? !text.trim() || !Number.isFinite(heightMm) || heightMm <= 0 || heightMm > 100 || !Number.isFinite(thicknessMm) || thicknessMm <= 0 || thicknessMm > 20
              : !imageFile || imageFile.size > 20 * 1024 * 1024 || !Number.isFinite(imageWidthMm) || imageWidthMm <= 0 || imageWidthMm > 100 || !Number.isFinite(imageDepthMm) || imageDepthMm < 0.1 || imageDepthMm > 5)} onClick={() => void createLabel()}>
            {busy
              ? _(msg`Creating…`)
              : pendingCutterModel
                ? _(msg`Update engraving preview`)
                : _(msg`Create engraving preview`)}
          </Button>
        </div>
      )}
    </Card>
  );
}
