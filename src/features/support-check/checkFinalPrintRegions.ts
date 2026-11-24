import type { LoadedModel } from '@/features/scene/useSceneCollectionManager';
import type { UseIslandsReturn } from '@/volumeAnalysis/Islands/useIslands';
import { buildSupportCheckWorld } from '@/features/slicing/rasterLayerZipExport';
import { detectVoxelIslands } from '@/volumeAnalysis/Islands/detect';
import { classifySupportCheckIslands, supportCheckBounds, SUPPORT_CHECK_REACH_MM } from './supportCheck';

type ScanOptions = Pick<UseIslandsReturn, 'layerHeightMm' | 'pxMm' | 'minAreaMm2' | 'connectivity'>;

export async function checkFinalPrintRegions(model: LoadedModel, options: ScanOptions) {
  const world = buildSupportCheckWorld([model]);
  if (!world.positions.length) throw Error('Missing geometry');
  const reachMm = SUPPORT_CHECK_REACH_MM.defaultValue;
  const bbox = supportCheckBounds(world.bbox);
  const raw = await detectVoxelIslands({ positions: world.positions, bbox }, options.layerHeightMm, {
    pxMm: options.pxMm, minAreaMm2: options.minAreaMm2, connectivity: options.connectivity, supportBufferMm: reachMm,
  });
  const result = classifySupportCheckIslands(raw, world.modelPositions, {
    baseZ: bbox.min.z, layerHeightMm: options.layerHeightMm, pxMm: options.pxMm, reachMm,
  });
  return [...result.modelIslands, ...result.supportIslands].map(island => island.contact);
}
