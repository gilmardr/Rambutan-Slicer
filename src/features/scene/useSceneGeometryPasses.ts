'use no memo';
/**
 * Geometry passes that run on idle callbacks after models are in the scene:
 * the higher-contrast edge overlay for models loaded before the setting was
 * turned on, and the baked ambient occlusion sweep. Part of
 * useSceneCollectionManager.
 */
import { useEffect, useRef, useSyncExternalStore, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import * as THREE from 'three';
import { buildModelEdgeGeometry } from '@/hooks/useStlGeometry';
import { getWorkspaceCameraSettingsServerSnapshot, getWorkspaceCameraSettingsSnapshot, subscribeToWorkspaceCameraSettings } from '@/components/settings/workspaceCameraPreferences';
import { BAKED_OCCLUSION_ATTRIBUTE, bakeOcclusionForGeometry, bumpBakedOcclusionVersion, canBakeOcclusion } from '@/features/scene/bakedOcclusion';
import type { LoadedModel } from './loadedModel';

/**
 * Ambient-occlusion bakes in flight at once (see the scheduling comment in the
 * bake effect). Each command is internally parallel across vertices, so this is
 * about hiding the serial phases — weld, tree build, IPC — of one model behind
 * another model's ray pass, not about using more cores per model.
 */
const AO_BAKE_CONCURRENCY = 2;

export function useHigherContrastEdgeBackfill(
  modelsRef: MutableRefObject<LoadedModel[]>,
  setModels: Dispatch<SetStateAction<LoadedModel[]>>,
) {
  /**
   * The Higher Contrast Model Edges setting can be enabled after models are
   * already loaded, and those models have no overlay geometry — import only
   * builds one while the setting is on. Fill them in here, one model per idle
   * callback: each build is ~2 s for a 500k-triangle mesh, so a batch would
   * freeze the app, and the overlay is worth nothing until it is looked at.
   * The result is cached on the geometry, so it is built exactly once.
   */
  const higherContrastModelEdges = useSyncExternalStore(
    subscribeToWorkspaceCameraSettings,
    getWorkspaceCameraSettingsSnapshot,
    getWorkspaceCameraSettingsServerSnapshot,
  ).higherContrastModelEdges;

  useEffect(() => {
    if (!higherContrastModelEdges) return;

    const queue = modelsRef.current
      .filter((model) => !model.geometry.edgeGeometry && model.geometry.geometry.getAttribute('position'))
      .map((model) => model.id);
    if (queue.length === 0) return;

    let cancelled = false;
    const scheduleIdle = (cb: () => void) => {
      if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(cb, { timeout: 500 });
      } else {
        setTimeout(cb, 16);
      }
    };

    const step = () => {
      if (cancelled) return;
      const id = queue.shift();
      if (!id) return;

      const model = modelsRef.current.find((m) => m.id === id);
      if (model) {
        const edges = buildModelEdgeGeometry(model.geometry.geometry);
        if (edges) {
          setModels((prev) => prev.map((m) => (
            m.id === id && m.geometry === model.geometry
              ? { ...m, geometry: { ...m.geometry, edgeGeometry: edges } }
              : m
          )));
        }
      }
      if (queue.length > 0) scheduleIdle(step);
    };

    scheduleIdle(step);
    return () => { cancelled = true; };
  }, [higherContrastModelEdges, modelsRef, setModels]);
}

export function useBakedOcclusionPass({
  models,
  modelsRef,
  bakedAoIntensity,
  pendingAoBakeRef,
  pendingAoQueueRef,
}: {
  models: LoadedModel[];
  modelsRef: MutableRefObject<LoadedModel[]>;
  bakedAoIntensity: number;
  pendingAoBakeRef: MutableRefObject<number>;
  pendingAoQueueRef: MutableRefObject<string[]>;
}) {
  // Geometries with a bake in flight. The attribute lands only when the bake
  // resolves, so without this the queue rebuilt on a later `models` change would
  // send the same soup a second time — measured as 25 bakes of one mesh in three
  // seconds under a models-change storm, and as the one-second pair on a restored
  // model. Keyed on the geometry, so a repair that swaps in a new one is not
  // skipped.
  const pendingAoGeometriesRef = useRef<Set<THREE.BufferGeometry>>(new Set());

  /**
   * Baked ambient occlusion.
   *
   * One native bake per model, on an idle callback, off the main thread:
   * `dragonfruit-mesh-core::vertex_occlusion` fires a hemisphere fan per vertex
   * from the mesh's own normal, which measures 12-263 ms for 40k-640k triangle
   * meshes. The result is attached to the geometry as `aBakedAo`, so nothing is
   * paid per frame afterwards.
   */
  useEffect(() => {
    // Whatever the last run left, this one owns the queue from here: cleared
    // before any early return, because a stale one keeps
    // `hasPendingBackgroundGeometryWork()` true for work nobody will do (the
    // modifier-apply overlay polls it to clear its spinner).
    pendingAoQueueRef.current = [];

    // Zero intensity means off, so there is nothing to bake for: raising the
    // slider later re-runs this and the geometries that never got an attribute
    // are the ones that get baked.
    if (!canBakeOcclusion() || bakedAoIntensity <= 0) return;

    const queue = modelsRef.current
      .filter((model) => {
        const geometry = model.geometry.geometry;
        if (!geometry.getAttribute('position')) return false;
        if (geometry.userData.skipBakedOcclusion === true) return false;
        // Re-bake when the geometry was replaced (repair, boolean cut, hole
        // punch): the attribute lives on the old geometry, so without this the
        // new shape would be shaded with the old shape's occlusion.
        if (geometry.getAttribute(BAKED_OCCLUSION_ATTRIBUTE) !== undefined) return false;
        // A bake already in flight for this geometry has not attached yet, so it
        // would look identical to "never baked" and be sent a second time.
        return !pendingAoGeometriesRef.current.has(geometry);
      })
      .map((model) => model.id);
    if (queue.length === 0) return;

    // What this run still has to bake, as a ref as well as a local: the workers
    // below shift the same array, so the ref is the live remainder and
    // `hasPendingBackgroundGeometryWork` can read it without the run's own
    // bookkeeping. Re-derived on every run, so a superseded run cannot leave
    // anything counted.
    pendingAoQueueRef.current = queue;

    let cancelled = false;

    const scheduleIdle = (cb: () => void) => {
      if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(cb, { timeout: 500 });
      } else {
        setTimeout(cb, 16);
      }
    };

    const bakeOne = async () => {
      if (cancelled) return;
      const id = queue.shift();
      if (!id) return;
      // Taken, so in flight: the counter rides the take, not the whole queue. It
      // used to be `+= queue.length` at the top of the run and decremented per
      // bake, so the items a superseded run never took stayed counted — and every
      // `models` change while a bake was queued (a hollowing apply patches them,
      // the idle plane pass patches them again) leaked one. The "finalizing"
      // overlay then waited out its 20 s cap after every hollow, with all the
      // work done in the first 200 ms.
      pendingAoBakeRef.current += 1;
      const model = modelsRef.current.find((m) => m.id === id);
      const geometry = model?.geometry.geometry;
      if (geometry) pendingAoGeometriesRef.current.add(geometry);
      try {
        if (geometry) {
          const occlusion = await bakeOcclusionForGeometry(geometry);
          // Attach whatever came back even if this run was superseded: the
          // values belong to this geometry, and discarding them is what left
          // it looking unbaked and re-queueable on the next `models` change.
          if (occlusion) {
            const attribute = new THREE.BufferAttribute(occlusion, 1);
            attribute.setUsage(THREE.StaticDrawUsage);
            geometry.setAttribute(BAKED_OCCLUSION_ATTRIBUTE, attribute);
            // The store, not the `models` array: replacing that array here
            // invalidated everything derived from it — the clearance map and
            // the raft rebuilt on every bake that landed. See
            // `bumpBakedOcclusionVersion`.
            bumpBakedOcclusionVersion(geometry);
          }
        }
      } catch (error) {
        // A failed bake is not worth surfacing: the model simply keeps the
        // unoccluded look it has today.
        console.warn('[ao] bake failed', error);
      } finally {
        if (geometry) pendingAoGeometriesRef.current.delete(geometry);
        pendingAoBakeRef.current = Math.max(0, pendingAoBakeRef.current - 1);
        // One model per idle callback, not a loop over the queue. The soup copy
        // and the attribute attach are main-thread work, so chaining bakes back to
        // back is what made a fifteen-model scene stutter for the whole drain
        // rather than between models. Interaction always outranks this.
        scheduleIdle(() => void bakeOne());
      }
    };

    // Two bakes in flight, not one. The ray pass saturates the pool on its own,
    // but the weld, the tree build and the IPC transfer of each model are serial
    // phases — on a print-sized model that is about a quarter of its bake, and in
    // a loaded scene it is a quarter of *every* model's bake spent with fifteen
    // cores idle. Both commands share one rayon pool, so overlapping them lets
    // one model's serial phase run during another's ray pass. Two rather than
    // more: each in-flight bake holds its soup and its output, and past a couple
    // the pool is oversubscribed for no further gain.
    for (let worker = 0; worker < Math.min(AO_BAKE_CONCURRENCY, queue.length); worker += 1) {
      scheduleIdle(() => void bakeOne());
    }
    return () => { cancelled = true; };
  }, [models, bakedAoIntensity, modelsRef, pendingAoBakeRef, pendingAoQueueRef]);
}
