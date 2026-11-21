#!/usr/bin/env npx tsx
/**
 * Golden File Exporter — runs the production RLE and layer-scan modules on test
 * meshes, then dumps the stages using a lightweight tracker for Rust parity.
 *
 * Usage:
 *   npx tsx scripts/island-debug-export.ts --mesh fixtures/meshes/cube.stl --output fixtures/island-scan/cube/
 *   npx tsx scripts/island-debug-export.ts --synthetic cube --output fixtures/island-scan/cube/
 *   npx tsx scripts/island-debug-export.ts --synthetic all  --output fixtures/island-scan/
 *
 * Synthetic mesh types: cube, two-cubes, t-overhang, bridge, hollow
 */

import * as fs from 'fs';
import * as path from 'path';

import { rleEncode, rleLabelComponents, type RleLabels, type RleMask } from '../src/volumeAnalysis/IslandScan/rle';
import { scanLayer } from '../src/volumeAnalysis/IslandScan/island';
import type { ComponentInfo, Island } from '../src/volumeAnalysis/IslandScan/types';

// ---------------------------------------------------------------------------
// The RLE and per-layer scan above are shared with production. Keep this small
// tracker local: the fixture exporter only needs a compact parity reference.
// ---------------------------------------------------------------------------

class IslandTracker {
  private islands: Map<number, Island> = new Map();
  private nextId = 1;
  private px_mm: number;
  private minOverlapPx: number;
  private overlapNeighborhoodPx: number;
  private pendingMerges: Array<{
    mergeLayer: number;
    candidateIds: number[];
    mergedIslandId: number;
    overlapCounts: Map<number, number>;
    preMergeLabels: RleLabels;
  }> = [];
  private readonly MERGE_EVAL_WINDOW = 30;

  constructor(px_mm: number, opts?: { minOverlapPx?: number; overlapNeighborhoodPx?: number }) {
    this.px_mm = px_mm;
    this.minOverlapPx = Math.max(1, opts?.minOverlapPx ?? 1);
    this.overlapNeighborhoodPx = Math.max(0, opts?.overlapNeighborhoodPx ?? 1);
  }

  processLayer(
    layerIndex: number,
    currentLabels: RleLabels,
    currentComponents: ComponentInfo[],
    prevIslandLabels: RleLabels | null,
    solidMask: RleMask,
  ): RleLabels {
    const { width, height } = currentLabels;
    const islandLabelRows: Int32Array[] = new Array(height);

    if (!prevIslandLabels) {
      const componentIdToIslandId = new Map<number, number>();
      for (const comp of currentComponents) {
        const areaMm2 = comp.area_px * this.px_mm * this.px_mm;
        const assignedId = this.createNewIsland(layerIndex, areaMm2, comp);
        componentIdToIslandId.set(comp.id, assignedId);
      }
      for (let y = 0; y < height; y++) {
        const row = currentLabels.rows[y];
        const newRow: number[] = [];
        for (let i = 0; i < row.length; i += 3) {
          const start = row[i], len = row[i + 1], compId = row[i + 2];
          const islandId = componentIdToIslandId.get(compId) || 0;
          if (islandId > 0) newRow.push(start, len, islandId);
        }
        islandLabelRows[y] = new Int32Array(newRow);
      }
    } else {
      const { labels: solidLabels, components: solidComps } = rleLabelComponents(solidMask, 4);
      const solidCompIdToIslandId = new Map<number, number>();

      for (const component of solidComps) {
        const prevIdOverlapCounts = this.findOverlappingIslandIdsRle(component.id, solidLabels, prevIslandLabels);
        const prevIds = new Set<number>();
        for (const [id, count] of prevIdOverlapCounts) {
          if (count >= this.minOverlapPx) prevIds.add(id);
        }
        const activePrevIds = new Set<number>();
        for (const id of prevIds) {
          const island = this.islands.get(id);
          if (island && island.status === 'active') activePrevIds.add(id);
        }
        const resolveParent = (startId: number): number => {
          let currentId = startId;
          const visited = new Set<number>();
          while (true) {
            if (visited.has(currentId)) break;
            visited.add(currentId);
            const isl = this.islands.get(currentId);
            if (!isl || isl.parentId === undefined) break;
            currentId = isl.parentId;
          }
          return currentId;
        };
        const areaMm2 = component.area_px * this.px_mm * this.px_mm;
        let assignedId: number;

        if (activePrevIds.size === 0) {
          if (prevIds.size > 0) {
            const firstPrevId = prevIds.values().next().value as number;
            const targetId = resolveParent(firstPrevId);
            assignedId = targetId;
            this.updateIsland(assignedId, layerIndex, areaMm2, component);
          } else {
            assignedId = this.createNewIsland(layerIndex, areaMm2, component);
          }
        } else if (activePrevIds.size === 1) {
          assignedId = Array.from(activePrevIds)[0];
          this.updateIsland(assignedId, layerIndex, areaMm2, component);
        } else {
          const resolvedIds = new Set<number>();
          for (const id of activePrevIds) resolvedIds.add(resolveParent(id));
          assignedId = this.mergeIslands(layerIndex, resolvedIds, prevIslandLabels, areaMm2, component);
        }

        solidCompIdToIslandId.set(component.id, assignedId);
        this.trackPendingMergeOverlapsRle(layerIndex, component.id, solidLabels, prevIslandLabels);
      }

      for (let y = 0; y < height; y++) {
        const row = solidLabels.rows[y];
        const newRow: number[] = [];
        for (let i = 0; i < row.length; i += 3) {
          const start = row[i], len = row[i + 1], compId = row[i + 2];
          const islandId = solidCompIdToIslandId.get(compId) || 0;
          if (islandId > 0) newRow.push(start, len, islandId);
        }
        islandLabelRows[y] = new Int32Array(newRow);
      }
    }

    this.evaluatePendingMerges(layerIndex);
    return { rows: islandLabelRows, width, height };
  }

  private findOverlappingIslandIdsRle(compId: number, solidLabels: RleLabels, prevIslandLabels: RleLabels): Map<number, number> {
    const prevIdOverlapCounts = new Map<number, number>();
    const { height } = solidLabels;
    for (let y = 0; y < height; y++) {
      const solidRow = solidLabels.rows[y];
      if (solidRow.length === 0) continue;
      for (let i = 0; i < solidRow.length; i += 3) {
        if (solidRow[i + 2] !== compId) continue;
        const start = solidRow[i], len = solidRow[i + 1], end = start + len;
        const searchStart = start - this.overlapNeighborhoodPx;
        const searchEnd = end + this.overlapNeighborhoodPx;
        const yStart = Math.max(0, y - this.overlapNeighborhoodPx);
        const yEnd = Math.min(height - 1, y + this.overlapNeighborhoodPx);
        for (let py = yStart; py <= yEnd; py++) {
          const pRow = prevIslandLabels.rows[py];
          if (pRow.length === 0) continue;
          for (let j = 0; j < pRow.length; j += 3) {
            const pStart = pRow[j], pLen = pRow[j + 1], pId = pRow[j + 2], pEnd = pStart + pLen;
            const overlapStart = Math.max(searchStart, pStart);
            const overlapEnd = Math.min(searchEnd, pEnd);
            if (overlapStart < overlapEnd && pId > 0) {
              prevIdOverlapCounts.set(pId, (prevIdOverlapCounts.get(pId) ?? 0) + (overlapEnd - overlapStart));
            }
            if (pStart >= searchEnd) break;
          }
        }
      }
    }
    return prevIdOverlapCounts;
  }

  private trackPendingMergeOverlapsRle(_layerIndex: number, compId: number, solidLabels: RleLabels, _prevIslandLabels: RleLabels): void {
    if (this.pendingMerges.length === 0) return;
    for (const pending of this.pendingMerges) {
      const overlapCounts = this.findOverlappingIslandIdsRle(compId, solidLabels, pending.preMergeLabels);
      for (const [id, count] of overlapCounts) {
        if (!pending.overlapCounts.has(id)) continue;
        pending.overlapCounts.set(id, (pending.overlapCounts.get(id) ?? 0) + count);
      }
    }
  }

  private createNewIsland(layerIndex: number, areaMm2: number, comp?: ComponentInfo): number {
    const id = this.nextId++;
    const island: Island = {
      id, firstLayer: layerIndex, lastLayer: layerIndex, status: 'active',
      totalAreaMm2: areaMm2, perLayerAreaMm2: new Map([[layerIndex, areaMm2]]),
      parentId: undefined, childIds: [],
      maxAreaMm2: areaMm2, maxAreaLayer: layerIndex,
      centroidSumX: comp?.centroidSumX ?? 0,
      centroidSumY: comp?.centroidSumY ?? 0,
      centroidSumZ: comp ? comp.size * layerIndex : 0,
      centroidCount: comp ? comp.size : 0,
      lastLayerCentroid: (comp && comp.size > 0) ? {
        x: comp.centroidSumX / comp.size, y: comp.centroidSumY / comp.size, z: layerIndex,
      } : undefined,
    };
    this.islands.set(id, island);
    return id;
  }

  private updateIsland(id: number, layerIndex: number, areaMm2: number, comp?: ComponentInfo): void {
    const island = this.islands.get(id);
    if (!island) return;
    island.lastLayer = layerIndex;
    island.totalAreaMm2 += areaMm2;
    island.perLayerAreaMm2.set(layerIndex, areaMm2);
    if (!island.maxAreaMm2 || areaMm2 > island.maxAreaMm2) {
      island.maxAreaMm2 = areaMm2; island.maxAreaLayer = layerIndex;
    }
    if (comp) {
      island.centroidSumX += comp.centroidSumX;
      island.centroidSumY += comp.centroidSumY;
      island.centroidSumZ += comp.size * layerIndex;
      island.centroidCount += comp.size;
      if (comp.size > 0) {
        island.lastLayerCentroid = {
          x: comp.centroidSumX / comp.size, y: comp.centroidSumY / comp.size, z: layerIndex,
        };
      }
    }
  }

  private mergeIslands(layerIndex: number, prevIds: Set<number>, prevIslandLabels: RleLabels, areaMm2: number, comp?: ComponentInfo): number {
    const preMergeLabels: RleLabels = {
      width: prevIslandLabels.width, height: prevIslandLabels.height,
      rows: prevIslandLabels.rows.map(row => new Int32Array(row)),
    };
    for (const id of prevIds) {
      const island = this.islands.get(id);
      if (island) { island.status = 'complete'; island.lastLayer = layerIndex - 1; }
    }
    const mergedId = this.createNewIsland(layerIndex, areaMm2, comp);
    const mergedIsland = this.islands.get(mergedId);
    if (mergedIsland) mergedIsland.isMergedPlaceholder = true;
    const pending = {
      mergeLayer: layerIndex,
      candidateIds: Array.from(prevIds),
      mergedIslandId: mergedId,
      overlapCounts: new Map<number, number>(),
      preMergeLabels,
    };
    for (const id of prevIds) pending.overlapCounts.set(id, 0);
    this.pendingMerges.push(pending);
    return mergedId;
  }

  private evaluatePendingMerges(currentLayer: number): void {
    const toFinalize: number[] = [];
    for (let i = 0; i < this.pendingMerges.length; i++) {
      const pending = this.pendingMerges[i];
      if (currentLayer - pending.mergeLayer >= this.MERGE_EVAL_WINDOW) {
        let parentId = 0, maxOverlap = -1;
        for (const [id, count] of pending.overlapCounts) {
          if (count > maxOverlap) { maxOverlap = count; parentId = id; }
        }
        for (const candidateId of pending.candidateIds) {
          if (candidateId !== parentId) {
            const child = this.islands.get(candidateId);
            if (child) child.parentId = parentId;
          }
        }
        const mergedIsland = this.islands.get(pending.mergedIslandId);
        if (mergedIsland) mergedIsland.parentId = parentId;
        const parent = this.islands.get(parentId);
        if (parent && mergedIsland) {
          for (const candidateId of pending.candidateIds) {
            if (candidateId !== parentId && !parent.childIds.includes(candidateId)) parent.childIds.push(candidateId);
          }
          if (!parent.childIds.includes(pending.mergedIslandId)) parent.childIds.push(pending.mergedIslandId);
          parent.lastLayer = mergedIsland.lastLayer;
          parent.status = mergedIsland.status;
          for (const [layer, areaMm2] of mergedIsland.perLayerAreaMm2) {
            parent.perLayerAreaMm2.set(layer, areaMm2);
            parent.totalAreaMm2 += areaMm2;
            if (!parent.maxAreaMm2 || areaMm2 > parent.maxAreaMm2) {
              parent.maxAreaMm2 = areaMm2; parent.maxAreaLayer = layer;
            }
          }
          if (mergedIsland.centroidCount > 0) {
            parent.centroidSumX += mergedIsland.centroidSumX;
            parent.centroidSumY += mergedIsland.centroidSumY;
            parent.centroidSumZ += mergedIsland.centroidSumZ;
            parent.centroidCount += mergedIsland.centroidCount;
          }
          if (mergedIsland.lastLayerCentroid) parent.lastLayerCentroid = { ...mergedIsland.lastLayerCentroid };
        }
        toFinalize.push(i);
      }
    }
    for (let i = toFinalize.length - 1; i >= 0; i--) this.pendingMerges.splice(toFinalize[i], 1);
  }

  getIslands(): Island[] {
    const islands = Array.from(this.islands.values());
    for (const island of islands) {
      if (island.centroidCount > 0) {
        island.centroid = {
          x: island.centroidSumX / island.centroidCount,
          y: island.centroidSumY / island.centroidCount,
          z: island.centroidSumZ / island.centroidCount,
        };
      }
    }
    return islands;
  }
}

// ---------------------------------------------------------------------------
// Synthetic Mesh Generators
// ---------------------------------------------------------------------------

type SyntheticMesh = {
  name: string;
  description: string;
  width: number;
  height: number;
  layers: Uint8Array[];
  px_mm: number;
  layer_height_mm: number;
  support_buffer_mm: number;
  connectivity: 4 | 8;
};

function generateCube(): SyntheticMesh {
  const w = 20, h = 20, numLayers = 10;
  const layers: Uint8Array[] = [];
  for (let l = 0; l < numLayers; l++) {
    const data = new Uint8Array(w * h);
    for (let y = 5; y < 15; y++) {
      for (let x = 5; x < 15; x++) {
        data[y * w + x] = 1;
      }
    }
    layers.push(data);
  }
  return { name: 'cube', description: 'Simple 10x10 cube, no islands after layer 0', width: w, height: h, layers, px_mm: 0.05, layer_height_mm: 0.05, support_buffer_mm: 0.1, connectivity: 4 };
}

function generateTwoCubes(): SyntheticMesh {
  const w = 30, h = 10, numLayers = 8;
  const layers: Uint8Array[] = [];
  for (let l = 0; l < numLayers; l++) {
    const data = new Uint8Array(w * h);
    // Cube 1: x=[2,8), y=[2,8)
    for (let y = 2; y < 8; y++) for (let x = 2; x < 8; x++) data[y * w + x] = 1;
    // Cube 2: x=[20,26), y=[2,8)
    for (let y = 2; y < 8; y++) for (let x = 20; x < 26; x++) data[y * w + x] = 1;
    layers.push(data);
  }
  return { name: 'two-cubes', description: 'Two separated cubes — two distinct islands', width: w, height: h, layers, px_mm: 0.05, layer_height_mm: 0.05, support_buffer_mm: 0.1, connectivity: 4 };
}

function generateTOverhang(): SyntheticMesh {
  const w = 20, h = 10, numLayers = 10;
  const layers: Uint8Array[] = [];
  for (let l = 0; l < numLayers; l++) {
    const data = new Uint8Array(w * h);
    // Stem: x=[8,12), y=[2,8) on all layers
    for (let y = 2; y < 8; y++) for (let x = 8; x < 12; x++) data[y * w + x] = 1;
    // T-top: x=[3,17), y=[3,7) appears from layer 5 onwards
    if (l >= 5) {
      for (let y = 3; y < 7; y++) for (let x = 3; x < 17; x++) data[y * w + x] = 1;
    }
    layers.push(data);
  }
  return { name: 't-overhang', description: 'T-shape with overhang starting at layer 5', width: w, height: h, layers, px_mm: 0.05, layer_height_mm: 0.05, support_buffer_mm: 0.0, connectivity: 4 };
}

function generateBridge(): SyntheticMesh {
  const w = 30, h = 10, numLayers = 10;
  const layers: Uint8Array[] = [];
  for (let l = 0; l < numLayers; l++) {
    const data = new Uint8Array(w * h);
    // Left pillar: x=[3,7), y=[3,7)
    for (let y = 3; y < 7; y++) for (let x = 3; x < 7; x++) data[y * w + x] = 1;
    // Right pillar: x=[23,27), y=[3,7)
    for (let y = 3; y < 7; y++) for (let x = 23; x < 27; x++) data[y * w + x] = 1;
    // Bridge: x=[3,27), y=[4,6) from layer 7 onwards
    if (l >= 7) {
      for (let y = 4; y < 6; y++) for (let x = 3; x < 27; x++) data[y * w + x] = 1;
    }
    layers.push(data);
  }
  return { name: 'bridge', description: 'Bridge between two pillars — merge scenario', width: w, height: h, layers, px_mm: 0.05, layer_height_mm: 0.05, support_buffer_mm: 0.0, connectivity: 4 };
}

function generateHollow(): SyntheticMesh {
  const w = 20, h = 20, numLayers = 8;
  const layers: Uint8Array[] = [];
  for (let l = 0; l < numLayers; l++) {
    const data = new Uint8Array(w * h);
    // Outer ring: fill [3,17) then hollow out [6,14)
    for (let y = 3; y < 17; y++) {
      for (let x = 3; x < 17; x++) {
        if (y >= 6 && y < 14 && x >= 6 && x < 14) continue; // hollow
        data[y * w + x] = 1;
      }
    }
    // Inner block: x=[8,12), y=[8,12) on all layers
    for (let y = 8; y < 12; y++) for (let x = 8; x < 12; x++) data[y * w + x] = 1;
    layers.push(data);
  }
  return { name: 'hollow', description: 'Nested/hollow shape — multiple components per layer', width: w, height: h, layers, px_mm: 0.05, layer_height_mm: 0.05, support_buffer_mm: 0.1, connectivity: 4 };
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

function rleMaskToJson(mask: RleMask): object {
  return {
    width: mask.width,
    height: mask.height,
    rows: mask.rows.map(row => Array.from(row)),
  };
}

function rleLabelsToJson(labels: RleLabels): object {
  return {
    width: labels.width,
    height: labels.height,
    rows: labels.rows.map(row => Array.from(row)),
  };
}

function islandToJson(island: Island): object {
  return {
    id: island.id,
    firstLayer: island.firstLayer,
    lastLayer: island.lastLayer,
    status: island.status,
    totalAreaMm2: island.totalAreaMm2,
    perLayerAreaMm2: Object.fromEntries(island.perLayerAreaMm2),
    parentId: island.parentId ?? null,
    childIds: island.childIds,
    volumeMm3: island.volumeMm3 ?? null,
    maxAreaMm2: island.maxAreaMm2 ?? null,
    maxAreaLayer: island.maxAreaLayer ?? null,
    isMergedPlaceholder: island.isMergedPlaceholder ?? false,
    centroidSumX: island.centroidSumX,
    centroidSumY: island.centroidSumY,
    centroidSumZ: island.centroidSumZ,
    centroidCount: island.centroidCount,
    centroid: island.centroid ?? null,
    lastLayerCentroid: island.lastLayerCentroid ?? null,
  };
}

// ---------------------------------------------------------------------------
// Export pipeline
// ---------------------------------------------------------------------------

function exportMesh(mesh: SyntheticMesh, outputDir: string): void {
  console.log(`\nExporting: ${mesh.name} (${mesh.description})`);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'layers'), { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'tracker-state'), { recursive: true });

  // Write input.json
  const input = {
    px_mm: mesh.px_mm,
    support_buffer_mm: mesh.support_buffer_mm,
    connectivity: mesh.connectivity,
    layer_height_mm: mesh.layer_height_mm,
    width: mesh.width,
    height: mesh.height,
    num_layers: mesh.layers.length,
    min_overlap_px: 1,
    overlap_neighborhood_px: 1,
  };
  fs.writeFileSync(path.join(outputDir, 'input.json'), JSON.stringify(input, null, 2));

  // Encode all layers as RLE masks
  const masks: RleMask[] = mesh.layers.map(data => rleEncode(data, mesh.width, mesh.height));
  const opts = { px_mm: mesh.px_mm, support_buffer_mm: mesh.support_buffer_mm, connectivity: mesh.connectivity as 4 | 8 };

  // Phase 1: Per-layer scan
  const layerResults: Array<{ labels: RleLabels; components: ComponentInfo[]; solidMask: RleMask }> = [];
  for (let i = 0; i < masks.length; i++) {
    const prev = i > 0 ? masks[i - 1] : null;
    const result = scanLayer(masks[i], prev, opts);
    layerResults.push(result);

    const pad = String(i).padStart(3, '0');
    // Write mask
    fs.writeFileSync(
      path.join(outputDir, 'layers', `${pad}-mask.rle.json`),
      JSON.stringify(rleMaskToJson(masks[i]), null, 2),
    );
    // Write candidates (the labeled island candidates)
    fs.writeFileSync(
      path.join(outputDir, 'layers', `${pad}-candidates.rle.json`),
      JSON.stringify(rleLabelsToJson(result.labels), null, 2),
    );
    // Write components
    fs.writeFileSync(
      path.join(outputDir, 'layers', `${pad}-components.json`),
      JSON.stringify(result.components, null, 2),
    );
  }

  // Phase 2: Island tracking
  const tracker = new IslandTracker(mesh.px_mm, {
    minOverlapPx: 1,
    overlapNeighborhoodPx: 1,
  });
  const islandLabelsPerLayer: RleLabels[] = [];

  for (let l = 0; l < layerResults.length; l++) {
    const lr = layerResults[l];
    const prevLabels = l > 0 ? islandLabelsPerLayer[l - 1] : null;
    const islandLabels = tracker.processLayer(l, lr.labels, lr.components, prevLabels, lr.solidMask);
    islandLabelsPerLayer.push(islandLabels);

    const pad = String(l).padStart(3, '0');
    fs.writeFileSync(
      path.join(outputDir, 'layers', `${pad}-island-labels.rle.json`),
      JSON.stringify(rleLabelsToJson(islandLabels), null, 2),
    );

    // Snapshot tracker state
    const trackerIslands = tracker.getIslands();
    fs.writeFileSync(
      path.join(outputDir, 'tracker-state', `${pad}-islands.json`),
      JSON.stringify(trackerIslands.map(islandToJson), null, 2),
    );
  }

  // Final results
  const finalIslands = tracker.getIslands();
  // Calculate volumes
  for (const island of finalIslands) {
    let vol = 0;
    for (const [, areaMm2] of island.perLayerAreaMm2) {
      vol += areaMm2 * mesh.layer_height_mm;
    }
    island.volumeMm3 = vol;
  }

  const result = {
    num_islands: finalIslands.length,
    islands: finalIslands.map(islandToJson),
  };
  fs.writeFileSync(path.join(outputDir, 'result.json'), JSON.stringify(result, null, 2));

  console.log(`  Layers: ${mesh.layers.length}`);
  console.log(`  Islands: ${finalIslands.length}`);
  console.log(`  Output: ${outputDir}`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  let synthetic = '';
  let outputDir = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--synthetic' && i + 1 < args.length) synthetic = args[++i];
    if (args[i] === '--output' && i + 1 < args.length) outputDir = args[++i];
  }

  if (!synthetic) {
    console.log('Usage: npx tsx scripts/island-debug-export.ts --synthetic <cube|two-cubes|t-overhang|bridge|hollow|all> --output <dir>');
    process.exit(1);
  }

  const generators: Record<string, () => SyntheticMesh> = {
    cube: generateCube,
    'two-cubes': generateTwoCubes,
    't-overhang': generateTOverhang,
    bridge: generateBridge,
    hollow: generateHollow,
  };

  if (synthetic === 'all') {
    const baseDir = outputDir || 'fixtures/island-scan';
    for (const [name, gen] of Object.entries(generators)) {
      exportMesh(gen(), path.join(baseDir, name));
    }
  } else {
    const gen = generators[synthetic];
    if (!gen) {
      console.error(`Unknown synthetic mesh: ${synthetic}. Available: ${Object.keys(generators).join(', ')}`);
      process.exit(1);
    }
    const dir = outputDir || path.join('fixtures/island-scan', synthetic);
    exportMesh(gen(), dir);
  }

  console.log('\nDone!');
}

main();
