import * as THREE from 'three';
import type { GeometryWithBounds } from '@/hooks/useStlGeometry';
import { quaternionFromGlobalEuler } from '@/utils/rotation';
import { getSettings } from '@/supports/Settings/state';
import { classifyIntersection } from './intersection';
import { detectVoxelIslands } from './detect';
import { scanMeshMinima } from './meshMinima';
import { mergeOverhangRegions, overhangRegionToIsland } from './useIslands';
import type { DetectedIsland, OverhangScan } from './types';

export interface ScanModelIslandsInput {
  geom: GeometryWithBounds;
  transform: { position: THREE.Vector3; rotation: THREE.Euler; scale: THREE.Vector3 };
  layerHeightMm: number;
  pxMm: number;
  supportBufferMm: number;
  connectivity: 4 | 8;
  minAreaMm2: number;
  minimaK: number;
  hasRaft: boolean;
  onProgress?: (progress: { phase: string; done: number; total: number }) => void;
}

/** Scan one non-active model in the same world-space frame as useIslands. */
export async function scanModelIslands(input: ScanModelIslandsInput): Promise<DetectedIsland[]> {
  const geometry = input.geom.geometry.clone();
  let world: { positions: Float32Array; bbox: THREE.Box3 };
  try {
    const bounds = geometry.boundingBox ?? new THREE.Box3().setFromBufferAttribute(
      geometry.getAttribute('position') as THREE.BufferAttribute,
    );
    const center = bounds.getCenter(new THREE.Vector3());
    geometry.translate(-center.x, -center.y, -center.z);
    const matrix = new THREE.Matrix4().compose(
      input.transform.position.clone(),
      quaternionFromGlobalEuler(input.transform.rotation),
      input.transform.scale.clone(),
    );
    geometry.applyMatrix4(matrix);
    const soup = geometry.index ? geometry.toNonIndexed() : geometry;
    try {
      soup.computeBoundingBox();
      world = {
        positions: (soup.getAttribute('position').array as Float32Array).slice(),
        bbox: soup.boundingBox!.clone(),
      };
    } finally {
      if (soup !== geometry) soup.dispose();
    }
  } finally {
    geometry.dispose();
  }

  const [voxelResult, minimaResult, overhangResult] = await Promise.allSettled([
    detectVoxelIslands(world, input.layerHeightMm, {
      pxMm: input.pxMm,
      supportBufferMm: input.supportBufferMm,
      connectivity: input.connectivity,
      minAreaMm2: input.minAreaMm2,
    }, (done, total, phase) => {
      if (phase) input.onProgress?.({ phase, done, total });
    }),
    scanMeshMinima(world.positions, input.minimaK),
    (async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<OverhangScan>('scan_overhangs', {
        positions: Array.from(world.positions),
        selfSupportAngleDeg: getSettings().autoSupport?.overhangSelfSupportAngleDeg ?? 45,
        pxMm: 0.25,
        label: null,
        hasRaft: input.hasRaft,
      });
    })(),
  ]);

  const voxels = voxelResult.status === 'fulfilled'
    ? voxelResult.value.filter((island) => (island.areaMm2 ?? 0) >= input.minAreaMm2)
    : [];
  const minima = minimaResult.status === 'fulfilled' ? minimaResult.value : [];
  const overhangs = overhangResult.status === 'fulfilled'
    ? overhangResult.value.regions.map(overhangRegionToIsland)
    : [];
  const classified = classifyIntersection(voxels, minima, {
    xyToleranceMm: 0.5,
    zBandMm: input.layerHeightMm,
  }).islands;
  return mergeOverhangRegions(classified, overhangs);
}
