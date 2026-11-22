import * as THREE from 'three';
import { BucketedSlicer } from '@/components/analysis/Slice2D';
import { rasterizeLoopsToExistingGridScanline } from '@/volumeAnalysis/IslandScan/scanline';
import type { Mask } from '@/volumeAnalysis/IslandScan/types';
import type { AdvisorMesh, OrientationCandidate } from './orientationAdvisor';

export type OrientationLayerAnalysis = {
    layerAreasMm2: number[];
    sampleHeightMm: number;
    requestedLayerCount: number;
    peakAreaMm2: number;
    peakPeelLoadProxy: number;
    peakAreaIncreaseMm2: number;
    peakTrappedAreaMm2: number;
    unsupportedIslands: number;
    supportDemandMm3: number;
};

/** Estimate the layer profile at analysis resolution, in the advisor's tilt frame. */
export function analyzeOrientationLayers(
    mesh: AdvisorMesh,
    candidate: OrientationCandidate,
    layerHeightMm: number,
    raised: boolean,
): OrientationLayerAnalysis {
    const rotation = new THREE.Euler(candidate.rotXRad, candidate.rotYRad, 0, 'YXZ');
    const bounds = new THREE.Box3();
    const point = new THREE.Vector3();
    const count = Math.floor((mesh.index?.length ?? mesh.positions.length / 3) / 3) * 3;
    const triangles = new Float32Array(count * 3);
    // Keep the same precision for bounds and the slice input.
    for (let i = 0; i < count; i++) {
        const v = (mesh.index?.[i] ?? i) * 3;
        point.set(mesh.positions[v], mesh.positions[v + 1], mesh.positions[v + 2]).applyEuler(rotation);
        point.toArray(triangles, i * 3);
        bounds.expandByPoint(point.fromArray(triangles, i * 3));
    }
    const size = bounds.getSize(point);
    const px = Math.max(0.08, Math.max(size.x, size.y) / 96);
    const requestedStep = Number.isFinite(layerHeightMm) ? Math.max(0.001, layerHeightMm) : 0.05;
    const requestedLayerCount = Math.max(1, Math.ceil(size.z / requestedStep));
    const sampleCount = Math.min(160, requestedLayerCount);
    const step = size.z / sampleCount;
    const width = Math.ceil(size.x / px) + 2;
    const height = Math.ceil(size.y / px) + 2;
    const grid: Mask = {
        width, height, originX: bounds.min.x - px, originZ: -bounds.max.y - px,
        px_mm: px, data: new Uint8Array(width * height),
    };
    const slicer = new BucketedSlicer(triangles);
    const layerAreasMm2: number[] = [];
    const queue = new Int32Array(grid.data.length);
    const lastSolidLayer = new Int32Array(grid.data.length).fill(-1);
    let previous = grid.data;
    let previousAir: Uint8Array | undefined;
    let previousArea = 0;
    let peakAreaMm2 = 0;
    let peakAreaIncreaseMm2 = 0;
    let peakTrappedAreaMm2 = 0;
    let unsupportedIslands = 0;
    let supportDemandMm3 = 0;
    let peakPeelLoadProxy = 0;

    for (let layer = 0; layer < sampleCount; layer++) {
        const loops = slicer.slice(bounds.min.z + (layer + 0.5) * step);
        const solid = rasterizeLoopsToExistingGridScanline(loops, grid, 'even-odd').data;
        const visited = new Uint8Array(solid.length);
        const vented = new Uint8Array(solid.length);
        let solidPixels = 0;
        let trappedPixels = 0;
        for (let start = 0; start < solid.length; start++) {
            if (visited[start]) continue;
            const value = solid[start];
            let connected = layer === 0 && (value === 1 ? !raised : raised);
            let head = 0;
            let tail = 1;
            queue[0] = start;
            visited[start] = 1;
            const visit = (i: number) => {
                if (visited[i] || solid[i] !== value) return;
                visited[i] = 1;
                queue[tail++] = i;
            };
            while (head < tail) {
                const i = queue[head++];
                const x = i % width;
                const y = Math.floor(i / width);
                if (value) {
                    connected ||= previous[i] === 1;
                    const supportedNearby = previous[i] || (x > 0 && previous[i - 1])
                        || (x < width - 1 && previous[i + 1]) || previous[i - width] || previous[i + width];
                    if (!supportedNearby && (layer > 0 || raised)) {
                        supportDemandMm3 += (layer - lastSolidLayer[i]) * step * px * px;
                    }
                    lastSolidLayer[i] = layer;
                } else {
                    connected ||= x === 0 || x === width - 1 || y === 0 || y === height - 1 || previousAir?.[i] === 1;
                }
                if (x > 0) visit(i - 1);
                if (x < width - 1) visit(i + 1);
                if (y > 0) visit(i - width);
                if (y < height - 1) visit(i + width);
            }
            if (value) {
                solidPixels += tail;
                if (!connected && tail * px * px >= 0.1) unsupportedIslands++;
            } else if (connected) {
                for (let i = 0; i < tail; i++) vented[queue[i]] = 1;
            } else {
                trappedPixels += tail;
            }
        }
        const area = solidPixels * px * px;
        layerAreasMm2.push(area);
        peakAreaMm2 = Math.max(peakAreaMm2, area);
        peakAreaIncreaseMm2 = Math.max(peakAreaIncreaseMm2, area - previousArea);
        peakTrappedAreaMm2 = Math.max(peakTrappedAreaMm2, trappedPixels * px * px);
        peakPeelLoadProxy = Math.max(peakPeelLoadProxy, area + 3 * trappedPixels * px * px);
        previous = solid;
        previousAir = vented;
        previousArea = area;
    }
    // Reconstruct the area at the midpoint of every requested layer from the
    // sampled curve. Risk and island counts still refer to measured sections.
    const areaByLayer = Array.from({ length: requestedLayerCount }, (_, i) => {
        if (step <= 0) return 0;
        const z = (Math.min(size.z, (i + 1) * requestedStep) + i * requestedStep) * 0.5;
        const sample = Math.max(0, Math.min(sampleCount - 1, z / step - 0.5));
        const lower = Math.floor(sample);
        const upper = Math.min(sampleCount - 1, lower + 1);
        return THREE.MathUtils.lerp(layerAreasMm2[lower], layerAreasMm2[upper], sample - lower);
    });
    return { layerAreasMm2: areaByLayer, sampleHeightMm: step, requestedLayerCount, peakAreaMm2, peakAreaIncreaseMm2, peakTrappedAreaMm2, unsupportedIslands, peakPeelLoadProxy, supportDemandMm3 };
}
