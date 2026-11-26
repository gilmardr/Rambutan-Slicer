'use no memo';
import React from 'react';
import * as THREE from 'three';
import type { LoadedModel } from '@/features/scene/useSceneCollectionManager';
import type { CameraProjectionMode } from '@/components/settings/cameraProjectionPreferences';
import type { CameraFeelPreset } from '@/components/settings/cameraFeelPreferences';
import { DIAGNOSTICS_BENCHMARK_PROGRESS_EVENT, DIAGNOSTICS_BENCHMARK_REQUEST_EVENT, type DiagnosticsBenchmarkPhaseName, type DiagnosticsBenchmarkPhaseResult, type DiagnosticsBenchmarkProgressDetail, type DiagnosticsBenchmarkRequestDetail, type DiagnosticsBenchmarkResult, type DiagnosticsBenchmarkStats, type DiagnosticsBenchmarkStressProfile } from '@/components/modals/diagnosticsBenchmarkEvents';

/**
 * The diagnostics viewport benchmark: answers a request event from the
 * diagnostics panel by sweeping the camera around the scene and reporting
 * frame-time statistics back through a progress event. Part of SceneCanvas.
 */
export function useDiagnosticsOrbitBenchmark({
  cameraRef,
  orbitControlsRef,
  orbitInteractionActiveRef,
  orbitInteractionMovedRef,
  setIsOrbitInteracting,
  cameraFeelPreset,
  navigationResumeDelayMs,
  cameraProjectionMode,
  modelWorldBounds,
  models,
  onCameraChange,
  onCameraEnd,
  updateCameraBelowBuildPlate,
  updateOrbitControlSpeeds,
}: {
  cameraRef: React.RefObject<THREE.Camera | null>;
  orbitControlsRef: React.RefObject<{ target: THREE.Vector3; rotateSpeed: number; panSpeed: number; zoomSpeed: number; update: () => void; enabled?: boolean } | null>;
  orbitInteractionActiveRef: React.RefObject<boolean>;
  orbitInteractionMovedRef: React.RefObject<boolean>;
  setIsOrbitInteracting: React.Dispatch<React.SetStateAction<boolean>>;
  cameraFeelPreset: CameraFeelPreset;
  navigationResumeDelayMs: number;
  cameraProjectionMode: CameraProjectionMode;
  modelWorldBounds: Map<string, THREE.Box3>;
  models: LoadedModel[];
  onCameraChange: (() => void) | undefined;
  onCameraEnd: (() => void) | undefined;
  updateCameraBelowBuildPlate: () => void;
  updateOrbitControlSpeeds: () => void;
}) {
  const benchmarkRunIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    const dispatchProgress = (detail: DiagnosticsBenchmarkProgressDetail) => {
      window.dispatchEvent(new CustomEvent(DIAGNOSTICS_BENCHMARK_PROGRESS_EVENT, { detail }));
    };

    const computeStats = (samplesMs: number[], durationMs: number): DiagnosticsBenchmarkStats => {
      const cleaned = samplesMs.filter((v) => Number.isFinite(v) && v > 0);
      if (cleaned.length === 0) {
        return {
          sampleCount: 0,
          durationMs,
          fpsAvg: 0,
          fpsMin: 0,
          fpsMax: 0,
          frameTimeAvgMs: 0,
          frameTimeP95Ms: 0,
          frameTimeMaxMs: 0,
        };
      }

      const sorted = [...cleaned].sort((a, b) => a - b);
      const sum = cleaned.reduce((acc, v) => acc + v, 0);
      const avg = sum / cleaned.length;
      const max = sorted[sorted.length - 1] ?? 0;
      const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
      const p95 = sorted[p95Index] ?? max;
      const minFrame = sorted[0] ?? avg;
      const avgFps = avg > 0 ? 1000 / avg : 0;
      const minFps = max > 0 ? 1000 / max : 0;
      const maxFps = minFrame > 0 ? 1000 / minFrame : 0;

      return {
        sampleCount: cleaned.length,
        durationMs,
        fpsAvg: avgFps,
        fpsMin: minFps,
        fpsMax: maxFps,
        frameTimeAvgMs: avg,
        frameTimeP95Ms: p95,
        frameTimeMaxMs: max,
      };
    };

    const runBenchmark = async (requestId: string, stressProfile: DiagnosticsBenchmarkStressProfile) => {
      const controls = orbitControlsRef.current;
      const camera = cameraRef.current;

      if (!controls || !camera) {
        dispatchProgress({
          requestId,
          status: 'error',
          message: 'Scene controls are not ready yet. Try again in a moment.',
        });
        return;
      }

      if (benchmarkRunIdRef.current) {
        dispatchProgress({
          requestId,
          status: 'error',
          message: 'A benchmark run is already in progress.',
        });
        return;
      }

      if (models.length === 0) {
        dispatchProgress({
          requestId,
          status: 'error',
          message: 'Benchmark requires at least one loaded model.',
        });
        return;
      }

      benchmarkRunIdRef.current = requestId;
      dispatchProgress({ requestId, status: 'started', message: `Preparing ${stressProfile} 3D orbit sweeps…` });

      const startedAt = performance.now();
      const startedAtIso = new Date().toISOString();
      const controlsSnapshot = {
        enabled: (controls as any).enabled !== false,
        position: camera.position.clone(),
        target: controls.target.clone(),
        zoom: camera instanceof THREE.OrthographicCamera ? camera.zoom : null,
      };

      const restoreControls = () => {
        camera.position.copy(controlsSnapshot.position);
        controls.target.copy(controlsSnapshot.target);
        if (camera instanceof THREE.OrthographicCamera && controlsSnapshot.zoom != null) {
          camera.zoom = controlsSnapshot.zoom;
          camera.updateProjectionMatrix();
        }
        (controls as any).enabled = controlsSnapshot.enabled;
        controls.update();
      };

      try {
        (controls as any).enabled = false;
        orbitInteractionActiveRef.current = true;
        orbitInteractionMovedRef.current = true;
        setIsOrbitInteracting(true);
        window.dispatchEvent(new Event('picking-orbit-start'));

        const visibleBounds = models
          .filter((model) => model.visible)
          .map((model) => modelWorldBounds.get(model.id))
          .filter((box): box is THREE.Box3 => !!box && !box.isEmpty());

        const center = new THREE.Vector3();
        if (visibleBounds.length > 0) {
          const union = visibleBounds[0].clone();
          for (let i = 1; i < visibleBounds.length; i += 1) {
            union.union(visibleBounds[i]);
          }
          union.getCenter(center);
        } else {
          center.copy(controls.target);
        }

        const initialOffset = camera.position.clone().sub(controls.target);
        if (initialOffset.lengthSq() < 1e-6) {
          initialOffset.set(0, -120, 80);
        }

        const baseRadius3d = Math.max(18, initialOffset.length());
        const initialAzimuth = Math.atan2(initialOffset.y, initialOffset.x);
        const horizontalRadius = Math.max(1e-6, Math.hypot(initialOffset.x, initialOffset.y));
        const initialElevation = Math.atan2(initialOffset.z, horizontalRadius);

        const phaseProfilesByStress: Record<DiagnosticsBenchmarkStressProfile, Array<{
          phase: DiagnosticsBenchmarkPhaseName;
          durationMs: number;
          azimuthTurns: number;
          elevationCycles: number;
          elevationAmplitudeDeg: number;
          radialPulseCycles: number;
          radialAmplitude: number;
        }>> = {
          quick: [
            { phase: 'slow', durationMs: 3500, azimuthTurns: 0.8, elevationCycles: 0.8, elevationAmplitudeDeg: 18, radialPulseCycles: 0.6, radialAmplitude: 0.04 },
            { phase: 'medium', durationMs: 2600, azimuthTurns: 1.1, elevationCycles: 1.1, elevationAmplitudeDeg: 24, radialPulseCycles: 0.85, radialAmplitude: 0.055 },
            { phase: 'fast', durationMs: 2000, azimuthTurns: 1.45, elevationCycles: 1.35, elevationAmplitudeDeg: 30, radialPulseCycles: 1.2, radialAmplitude: 0.07 },
          ],
          standard: [
            { phase: 'slow', durationMs: 9000, azimuthTurns: 1.1, elevationCycles: 1.0, elevationAmplitudeDeg: 22, radialPulseCycles: 0.8, radialAmplitude: 0.05 },
            { phase: 'medium', durationMs: 6000, azimuthTurns: 1.5, elevationCycles: 1.4, elevationAmplitudeDeg: 28, radialPulseCycles: 1.15, radialAmplitude: 0.07 },
            { phase: 'fast', durationMs: 4200, azimuthTurns: 2.1, elevationCycles: 1.9, elevationAmplitudeDeg: 34, radialPulseCycles: 1.6, radialAmplitude: 0.09 },
          ],
          torture: [
            { phase: 'slow', durationMs: 14000, azimuthTurns: 1.6, elevationCycles: 1.35, elevationAmplitudeDeg: 26, radialPulseCycles: 1.1, radialAmplitude: 0.07 },
            { phase: 'medium', durationMs: 10500, azimuthTurns: 2.4, elevationCycles: 2.0, elevationAmplitudeDeg: 34, radialPulseCycles: 1.8, radialAmplitude: 0.1 },
            { phase: 'fast', durationMs: 8200, azimuthTurns: 3.35, elevationCycles: 2.7, elevationAmplitudeDeg: 40, radialPulseCycles: 2.4, radialAmplitude: 0.13 },
          ],
        };

        const phases = phaseProfilesByStress[stressProfile] ?? phaseProfilesByStress.standard;

        const phaseResults: DiagnosticsBenchmarkPhaseResult[] = [];
        const allSamplesMs: number[] = [];

        let phaseStartAzimuth = initialAzimuth;
        for (const phaseConfig of phases) {
          if (benchmarkRunIdRef.current !== requestId) {
            throw new Error('Benchmark interrupted.');
          }

          const phaseSamples: number[] = [];
          const phaseStartTime = performance.now();
          let lastFrameTs: number | null = null;

          await new Promise<void>((resolve) => {
            const tick = (now: number) => {
              if (benchmarkRunIdRef.current !== requestId) {
                resolve();
                return;
              }

              const elapsed = now - phaseStartTime;
              const t = Math.min(1, elapsed / phaseConfig.durationMs);

              if (lastFrameTs != null) {
                const dt = Math.max(0, now - lastFrameTs);
                if (dt > 0) {
                  phaseSamples.push(dt);
                  allSamplesMs.push(dt);
                }
              }
              lastFrameTs = now;

              const azimuth = phaseStartAzimuth + (t * phaseConfig.azimuthTurns * Math.PI * 2);
              const elevationSwing = Math.sin((t * phaseConfig.elevationCycles * Math.PI * 2) + (phaseConfig.azimuthTurns * 0.5));
              const elevationAmp = THREE.MathUtils.degToRad(phaseConfig.elevationAmplitudeDeg);
              const elevation = THREE.MathUtils.clamp(
                initialElevation + (elevationSwing * elevationAmp),
                THREE.MathUtils.degToRad(-72),
                THREE.MathUtils.degToRad(72),
              );
              const radialPulse = 1 + (Math.sin((t * phaseConfig.radialPulseCycles * Math.PI * 2) + (phaseConfig.elevationCycles * 0.7)) * phaseConfig.radialAmplitude);
              const radius = baseRadius3d * radialPulse;

              const cosElevation = Math.cos(elevation);
              const x = Math.cos(azimuth) * cosElevation * radius;
              const y = Math.sin(azimuth) * cosElevation * radius;
              const z = Math.sin(elevation) * radius;

              camera.position.set(center.x + x, center.y + y, center.z + z);
              controls.target.copy(center);
              controls.update();
              updateOrbitControlSpeeds();
              updateCameraBelowBuildPlate();
              onCameraChange?.();
              window.dispatchEvent(new Event('picking-orbit-change'));

              if (t < 1) {
                requestAnimationFrame(tick);
              } else {
                resolve();
              }
            };

            requestAnimationFrame(tick);
          });

          const phaseDuration = Math.max(0, performance.now() - phaseStartTime);
          const phaseStats = computeStats(phaseSamples, phaseDuration);
          phaseResults.push({ phase: phaseConfig.phase, stats: phaseStats });
          dispatchProgress({
            requestId,
            status: 'phase-complete',
            phase: phaseConfig.phase,
            message: `${phaseConfig.phase} sweep complete`,
          });

          phaseStartAzimuth += phaseConfig.azimuthTurns * Math.PI * 2;
        }

        const totalDurationMs = Math.max(0, performance.now() - startedAt);
        const finishedAtIso = new Date().toISOString();

        const result: DiagnosticsBenchmarkResult = {
          requestId,
          stressProfile,
          startedAtIso,
          finishedAtIso,
          totalDurationMs,
          projectionMode: cameraProjectionMode,
          cameraFeelPreset,
          phases: phaseResults,
          overall: computeStats(allSamplesMs, totalDurationMs),
        };

        dispatchProgress({ requestId, status: 'completed', result, message: 'Benchmark complete.' });
      } catch (error) {
        dispatchProgress({
          requestId,
          status: 'error',
          message: error instanceof Error ? error.message : 'Benchmark failed.',
        });
      } finally {
        restoreControls();
        orbitInteractionActiveRef.current = false;
        orbitInteractionMovedRef.current = false;
        setIsOrbitInteracting(false);
        updateCameraBelowBuildPlate();
        onCameraEnd?.();
        window.dispatchEvent(new CustomEvent('picking-orbit-end', {
          detail: { resumeAfterMs: navigationResumeDelayMs },
        }));
        benchmarkRunIdRef.current = null;
      }
    };

    const onBenchmarkRequest = (event: Event) => {
      const customEvent = event as CustomEvent<DiagnosticsBenchmarkRequestDetail>;
      const requestId = customEvent.detail?.requestId;
      const stressProfile = customEvent.detail?.stressProfile ?? 'standard';
      if (!requestId) return;
      void runBenchmark(requestId, stressProfile);
    };

    window.addEventListener(DIAGNOSTICS_BENCHMARK_REQUEST_EVENT, onBenchmarkRequest as EventListener);
    return () => {
      window.removeEventListener(DIAGNOSTICS_BENCHMARK_REQUEST_EVENT, onBenchmarkRequest as EventListener);
      benchmarkRunIdRef.current = null;
    };
  }, [
    cameraFeelPreset,
    navigationResumeDelayMs,
    cameraProjectionMode,
    modelWorldBounds,
    models,
    onCameraChange,
    onCameraEnd,
    updateCameraBelowBuildPlate,
    updateOrbitControlSpeeds,
    cameraRef,
    orbitControlsRef,
    orbitInteractionActiveRef,
    orbitInteractionMovedRef,
    setIsOrbitInteracting,
  ]);
}
