'use no memo';
/**
 * Geometry work deferred to idle time after a swap: the BVH acceleration and
 * disposal queues, plus the counters of flattening-plane and AO bake work that
 * make up hasPendingBackgroundGeometryWork. Part of useSceneCollectionManager.
 */
import { useCallback, useRef } from 'react';
import type * as THREE from 'three';
import type { GeometryWithBounds } from '@/hooks/useStlGeometry';
import { accelerateGeometry, disposeGeometryBVH } from '@/utils/bvh';

export function useBackgroundGeometryWork() {
  const deferredAccelerationQueueRef = useRef<THREE.BufferGeometry[]>([]);
  const deferredAccelerationProcessingRef = useRef(false);
  const deferredAccelerationPausedRef = useRef(false);
  const deferredDisposalQueueRef = useRef<THREE.BufferGeometry[]>([]);
  const deferredDisposalProcessingRef = useRef(false);
  // Count of scheduled-but-unfinished flattening-plane computations (idle
  // callbacks after geometry swaps). Part of hasPendingBackgroundGeometryWork.
  const pendingFlatteningPlanesRef = useRef(0);
  // Models whose AO volume bake is queued or awaiting the native round trip.
  // Part of hasPendingBackgroundGeometryWork.
  const pendingAoBakeRef = useRef(0);
  /** The AO sweep's remaining work, replaced wholesale on every run. */
  const pendingAoQueueRef = useRef<string[]>([]);

  const processDeferredAccelerationQueue = useCallback(() => {
    if (deferredAccelerationProcessingRef.current) return;
    if (deferredAccelerationPausedRef.current) return;
    if (deferredAccelerationQueueRef.current.length === 0) return;

    deferredAccelerationProcessingRef.current = true;

    const scheduleNext = (cb: () => void) => {
      if (typeof window !== 'undefined' && typeof (window as any).requestIdleCallback === 'function') {
        (window as any).requestIdleCallback(cb, { timeout: 120 });
      } else {
        setTimeout(cb, 16);
      }
    };

    const step = () => {
      if (deferredAccelerationPausedRef.current) {
        deferredAccelerationProcessingRef.current = false;
        return;
      }

      const geometry = deferredAccelerationQueueRef.current.shift();
      if (!geometry) {
        deferredAccelerationProcessingRef.current = false;
        return;
      }

      accelerateGeometry(geometry);

      if (deferredAccelerationQueueRef.current.length === 0) {
        deferredAccelerationProcessingRef.current = false;
        return;
      }

      scheduleNext(step);
    };

    scheduleNext(step);
  }, []);

  const deferAccelerateGeometry = useCallback((entries: GeometryWithBounds[]) => {
    if (entries.length === 0) return;

    deferredAccelerationQueueRef.current.push(...entries.map((entry) => entry.geometry));
    processDeferredAccelerationQueue();
  }, [processDeferredAccelerationQueue]);

  const setBackgroundGeometryWorkPaused = useCallback((paused: boolean) => {
    deferredAccelerationPausedRef.current = paused;
    if (!paused) {
      processDeferredAccelerationQueue();
    }
  }, [processDeferredAccelerationQueue]);

  /**
   * True while deferred post-swap geometry work (BVH acceleration builds,
   * deferred geometry disposals, flattening-plane computation, AO bakes) is
   * queued or
   * running. Lets the UI keep a blocking "finalizing" indicator visible
   * until the app is genuinely responsive again after a large geometry swap
   * — the swap itself resolves long before this work drains.
   */
  const hasPendingBackgroundGeometryWork = useCallback(() => (
    deferredAccelerationQueueRef.current.length > 0
    || deferredAccelerationProcessingRef.current
    || deferredDisposalQueueRef.current.length > 0
    || deferredDisposalProcessingRef.current
    || pendingFlatteningPlanesRef.current > 0
    || pendingAoBakeRef.current > 0
    || pendingAoQueueRef.current.length > 0
  ), []);

  const processDeferredDisposalQueue = useCallback(() => {
    if (deferredDisposalProcessingRef.current) return;
    if (deferredDisposalQueueRef.current.length === 0) return;

    deferredDisposalProcessingRef.current = true;

    const scheduleNext = (cb: () => void) => {
      if (typeof window !== 'undefined' && typeof (window as any).requestIdleCallback === 'function') {
        (window as any).requestIdleCallback(cb, { timeout: 120 });
      } else {
        setTimeout(cb, 16);
      }
    };

    const step = () => {
      const geometry = deferredDisposalQueueRef.current.shift();
      if (!geometry) {
        deferredDisposalProcessingRef.current = false;
        return;
      }

      try {
        disposeGeometryBVH(geometry);
      } catch {
        // ignore disposal failures
      }
      try {
        geometry.dispose();
      } catch {
        // ignore disposal failures
      }

      if (deferredDisposalQueueRef.current.length === 0) {
        deferredDisposalProcessingRef.current = false;
        return;
      }

      scheduleNext(step);
    };

    scheduleNext(step);
  }, []);

  const deferDisposeGeometries = useCallback((geometries: THREE.BufferGeometry[]) => {
    if (geometries.length === 0) return;

    deferredDisposalQueueRef.current.push(...geometries);
    processDeferredDisposalQueue();
  }, [processDeferredDisposalQueue]);

  return {
    pendingFlatteningPlanesRef,
    pendingAoBakeRef,
    pendingAoQueueRef,
    deferAccelerateGeometry,
    setBackgroundGeometryWorkPaused,
    hasPendingBackgroundGeometryWork,
    deferDisposeGeometries,
  };
}
