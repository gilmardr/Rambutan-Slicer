/** Screen projection for the marquee hit test, and the trackpad gesture mapping. */
import * as THREE from 'three';
import { type MarqueePoint, type ProjectedMesh } from './marqueeHitTest';
import { type CameraTrackpadModifierKey, type CameraTrackpadPrimaryAction } from '@/components/settings/cameraTrackpadPreferences';
import { type WheelDevice } from '@/components/scene/SceneCanvas/wheelDeviceClassifier';
import { type TrackpadGestureAction } from '@/components/scene/camera/trackpadGesturePose';

/**
 * Projects a model's mesh to container pixels for the marquee hit test. Runs
 * once per drag — the camera cannot move while the marquee is up — and the
 * result is reused for every pointer move.
 */
export function projectModelMesh(
  positions: Float32Array,
  modelMatrix: THREE.Matrix4,
  camera: THREE.Camera,
  rect: DOMRect,
): ProjectedMesh {
  const clip = new THREE.Matrix4()
    .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    .multiply(modelMatrix);
  const m = clip.elements;

  const count = positions.length / 3;
  const xs = new Float32Array(count);
  const ys = new Float32Array(count);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let dropped = false;

  for (let i = 0; i < count; i += 1) {
    const px = positions[i * 3];
    const py = positions[(i * 3) + 1];
    const pz = positions[(i * 3) + 2];

    const w = (m[3] * px) + (m[7] * py) + (m[11] * pz) + m[15];
    if (w <= 0) {
      // Behind the camera: no screen position to compare against.
      xs[i] = NaN;
      ys[i] = NaN;
      dropped = true;
      continue;
    }

    const ndcX = ((m[0] * px) + (m[4] * py) + (m[8] * pz) + m[12]) / w;
    const ndcY = ((m[1] * px) + (m[5] * py) + (m[9] * pz) + m[13]) / w;

    const x = ((ndcX + 1) * 0.5) * rect.width;
    const y = ((1 - ndcY) * 0.5) * rect.height;

    xs[i] = x;
    ys[i] = y;

    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  return {
    xs,
    ys,
    count,
    bounds: minX > maxX ? null : { minX, minY, maxX, maxY },
    dropped,
  };
}

/**
 * Projects support positions to container pixels for the marquee hit test.
 * Points that fall outside clip space come back as null.
 */
export function makeSupportPointProjector(rect: DOMRect, camera: THREE.Camera) {
  const point = new THREE.Vector3();
  const projected = new THREE.Vector3();

  return (positions: Array<{ x: number; y: number; z: number }>): Array<MarqueePoint | null> => (
    positions.map((position) => {
      projected.copy(point.set(position.x, position.y, position.z)).project(camera);

      if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || !Number.isFinite(projected.z)) {
        return null;
      }
      if (projected.z < -1 || projected.z > 1) return null;

      return {
        x: ((projected.x + 1) * 0.5) * rect.width,
        y: ((1 - projected.y) * 0.5) * rect.height,
      };
    })
  );
}

export function isTrackpadModifierPressed(event: WheelEvent, modifierKey: CameraTrackpadModifierKey): boolean {
  return modifierKey === 'shift' ? event.shiftKey : event.altKey;
}

export function resolveTrackpadGestureAction(
  event: WheelEvent,
  device: WheelDevice,
  primaryAction: CameraTrackpadPrimaryAction,
  modifierKey: CameraTrackpadModifierKey,
): TrackpadGestureAction | null {
  if (primaryAction === 'off') return null;
  if (event.ctrlKey || event.metaKey) return null;
  if (device !== 'trackpad') return null;

  const modifierPressed = isTrackpadModifierPressed(event, modifierKey);
  if (!modifierPressed) return primaryAction;
  return primaryAction === 'pan' ? 'orbit' : 'pan';
}
