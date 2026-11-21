"use client";

import React from 'react';
import * as THREE from 'three';
import { Html, Line } from '@react-three/drei';
import { calculateMeasurement } from './distanceMeasurementMath';
import {
  getDistanceMeasurementServerSnapshot,
  getDistanceMeasurementSnapshot,
  subscribeToDistanceMeasurement,
} from './distanceMeasurementStore';
import { useLocaleFormat } from '@/hooks/useLocaleFormat';

export function DistanceMeasurementOverlay() {
  const measurement = React.useSyncExternalStore(
    subscribeToDistanceMeasurement,
    getDistanceMeasurementSnapshot,
    getDistanceMeasurementServerSnapshot,
  );
  const fmt = useLocaleFormat();
  const points = measurement.points;
  const result = calculateMeasurement(measurement.mode, points);
  const vectors = points.map(({ position }) => new THREE.Vector3(...position));
  const planes = React.useMemo(() => {
    const planePointSets = measurement.mode === 'point-to-plane' && points.length === 4
      ? [points.slice(1, 4)]
      : measurement.mode === 'plane-to-plane' && points.length === 6
        ? [points.slice(0, 3), points.slice(3, 6)]
        : [];
    return planePointSets.map((plane, index) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setFromPoints(plane.map(({ position }) => new THREE.Vector3(...position)));
      geometry.setIndex([0, 1, 2]);
      geometry.computeVertexNormals();
      return { geometry, color: measurement.mode === 'plane-to-plane' && index === 0 ? '#42d7f5' : '#ffb454' };
    });
  }, [measurement.mode, points]);
  React.useEffect(() => () => planes.forEach(({ geometry }) => geometry.dispose()), [planes]);

  if (points.length === 0) return null;

  const segment = result?.segment.map((position) => new THREE.Vector3(...position)) ?? null;
  const midpoint = segment ? segment[0].clone().add(segment[1]).multiplyScalar(0.5) : null;

  return (
    <group raycast={() => null}>
      {planes.map(({ geometry, color }, index) => (
        <mesh key={`measurement-plane-${index}`} geometry={geometry} renderOrder={10018}>
          <meshBasicMaterial color={color} transparent opacity={0.2} side={THREE.DoubleSide} depthTest={false} depthWrite={false} />
        </mesh>
      ))}
      {vectors.map((point, index) => (
        <mesh key={`${points[index].modelId}-${index}`} position={point} renderOrder={10020}>
          <sphereGeometry args={[0.32, 12, 8]} />
          <meshBasicMaterial
            color={measurement.mode === 'plane-to-plane' ? (index < 3 ? '#42d7f5' : '#ffb454') : index === 0 ? '#54e39b' : '#ffb454'}
            depthTest={false}
            toneMapped={false}
          />
        </mesh>
      ))}
      {segment && result && (
        <>
          <Line points={segment} color="#3bd2c6" lineWidth={2.5} depthTest={false} />
          {midpoint && (
            <Html position={midpoint} center distanceFactor={12} style={{ pointerEvents: 'none' }}>
              <div className="rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow whitespace-nowrap">
                {fmt.quantity(result.distance, 2, 'mm')}
              </div>
            </Html>
          )}
        </>
      )}
    </group>
  );
}
