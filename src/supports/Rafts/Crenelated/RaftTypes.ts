import * as THREE from 'three';

export type RaftBottomMode = 'off' | 'solid' | 'line';

/** Minimum solid bridge left between two base-relief openings. */
export const RAFT_BASE_RELIEF_MIN_WEB_MM = 0.8;

export function minimumRaftReliefPitch(diameter: number, pattern: RaftSettings['baseReliefPattern']): number {
  // The staggered hex grid places neighboring faces parallel, with 0.7 mm left between them.
  return pattern === 'staggered-hex'
    ? diameter * Math.sqrt(3) / 2 + 0.7
    : diameter + RAFT_BASE_RELIEF_MIN_WEB_MM;
}

export interface RaftSettings {
  bottomMode: RaftBottomMode;
  wallEnabled: boolean;
  thickness: number;           // mm
  chamferAngle: number;        // degrees (45-90)
  wallHeight: number;          // mm
  wallThickness: number;       // mm
  crenulationGapWidth: number; // mm
  crenulationSpacing: number;  // mm
  lineWidthMm: number;         // mm
  lineHeightMm: number;        // mm
  baseReliefEnabled: boolean;
  baseReliefPattern?: 'square-round' | 'staggered-round' | 'staggered-hex';
  baseReliefHoleDiameterMm: number; // mm
  baseReliefPitchMm: number;   // mm, center to center
  showFootprintBorder: boolean; // Show combined model+raft footprint border
  footprintBorderMargin: number; // mm - margin beyond raft/model edge
  /** contour: hug the support bases (gaps up to ~6 mm bridged); hull: one convex outline. */
  footprintMode?: 'contour' | 'hull';
}

export interface RaftGeometry {
  baseProfile: THREE.Vector2[];      // 2D footprint points
  baseMesh: THREE.Mesh;         // Main raft plate
  wallMesh: THREE.Mesh;         // Perimeter wall with crenulations
  boundingBox: THREE.Box3;      // For collision detection
}

// Input representation for a support base footprint circle
export interface SupportBaseCircle {
  x: number;   // center X in mm
  y: number;   // center Y in mm
  r: number;   // radius in mm (half of base diameter)
}

// Options for computing raft footprint from support base circles
export interface ComputeFootprintOptions {
  marginMm?: number;       // additional outward buffer beyond circle radius
  samplesPerCircle?: number; // number of points to sample per circle (>=8)
}

export type FootprintProfile = THREE.Vector2[];
