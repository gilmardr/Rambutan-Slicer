
import React from 'react';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { LoadedModel } from '@/features/scene/useSceneCollectionManager';
import { useIsLinux } from '@/hooks/usePlatform';
import { formatFileSize, formatPolygonCountCompact } from '@/utils/meshStatsFormatting';
import { countConnectedMeshComponents } from '@/utils/geometry';
import { useLocaleFormat } from '@/hooks/useLocaleFormat';
import { splitDurationSeconds } from '@/utils/durationParts';
import { resolveCompositeMaterialLabel } from '@/utils/materialLabel';
import {
  getActiveMaterialProfile,
  getActivePrinterProfile,
  getProfileStoreSnapshot,
  getProfileStoreServerSnapshot,
  subscribeToProfileStore,
} from '@/features/profiles/profileStore';
import {
  getPrinterReachabilityServerSnapshot,
  getPrinterReachabilitySnapshot,
  subscribeToPrinterReachability,
} from '@/features/network/printerReachabilityStore';
import { getProfileNetworkUiAdapter } from '@/features/plugins/pluginRegistry';
import { openProfileSettingsModal } from '@/components/settings/profileModalEvents';
import { Box, Droplet, Layers, Network, Printer } from 'lucide-react';

interface ModelStatsCardProps {
  model: LoadedModel | null;
  models: LoadedModel[];
  selectedModelIds: string[];
  inBoundsModelIds: string[];
  numLayers: number;
  heightMm: number;
  estimatedPrintTimeLabelOverride?: string | null;
  estimatedResinLabelOverride?: string | null;
  estimatedModelResinLabelOverride?: string | null;
  estimatedSupportsResinLabelOverride?: string | null;
  estimatedRaftResinLabelOverride?: string | null;
  /**
   * The plate's layer count, as text. Distinct from `numLayers` because a plate
   * with nothing on it has zero layers, and zero must not fall back to the
   * scene's own count the way an unknown one does.
   */
  estimatedLayerCountLabelOverride?: string | null;
  /** The same estimate for every plate. Absent when there is only one plate. */
  estimatedResinTotalLabel?: string | null;
}

export function ModelStatsCard({
  model,
  models,
  selectedModelIds,
  inBoundsModelIds,
  numLayers,
  heightMm,
  estimatedPrintTimeLabelOverride,
  estimatedResinLabelOverride,
  estimatedModelResinLabelOverride,
  estimatedSupportsResinLabelOverride,
  estimatedRaftResinLabelOverride,
  estimatedLayerCountLabelOverride,
  estimatedResinTotalLabel,
}: ModelStatsCardProps) {
  const { _ } = useLingui();
  const fmt = useLocaleFormat();
  const selectedGeometry = model?.geometry;
  const shellCount = React.useMemo(() => {
    if (!selectedGeometry) return null;
    const reportedCount = selectedGeometry.meshDefects?.nativeRepairReport?.post.component_count;
    return typeof reportedCount === 'number' && Number.isFinite(reportedCount)
      ? reportedCount
      : countConnectedMeshComponents(selectedGeometry.geometry);
  }, [selectedGeometry]);
  const [isFlipped, setIsFlipped] = React.useState(false);
  // The app forces WebKitGTK's SHM software renderer on Linux
  // (WEBKIT_DISABLE_DMABUF_RENDERER=1 in main.rs, issue #83), and that path
  // flattens preserve-3d and ignores backface-visibility — the true 3D flip
  // renders both faces superimposed. There, use a two-phase "flat flip"
  // instead: rotate the card edge-on, swap the visible face while it is
  // invisible, and rotate back. Only one face is ever shown, so no backface
  // culling is needed and it renders correctly even in software.
  const useFlatFlip = useIsLinux();
  const [flatFlipShownFace, setFlatFlipShownFace] = React.useState<'front' | 'back'>('front');
  const [flatFlipEdgeOn, setFlatFlipEdgeOn] = React.useState(false);

  React.useEffect(() => {
    if (!useFlatFlip) return;
    const target = isFlipped ? 'back' : 'front';
    if (flatFlipShownFace === target) {
      setFlatFlipEdgeOn(false);
      return;
    }
    setFlatFlipEdgeOn(true);
    const timer = window.setTimeout(() => {
      setFlatFlipShownFace(target);
      setFlatFlipEdgeOn(false);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [isFlipped, flatFlipShownFace, useFlatFlip]);
  const baseResinMlCacheRef = React.useRef<Map<string, number | null>>(new Map());
  const inFlightBaseResinMlRef = React.useRef<Map<string, Promise<number | null>>>(new Map());
  const [estimatedResinMl, setEstimatedResinMl] = React.useState<number | null>(null);
  const profileState = React.useSyncExternalStore(subscribeToProfileStore, getProfileStoreSnapshot, getProfileStoreServerSnapshot);
  const printerReachabilityByDeviceId = React.useSyncExternalStore(
    subscribeToPrinterReachability,
    getPrinterReachabilitySnapshot,
    getPrinterReachabilityServerSnapshot,
  );
  const activePrinterProfile = React.useMemo(() => getActivePrinterProfile(profileState), [profileState]);
  const networkUiAdapter = React.useMemo(
    () => getProfileNetworkUiAdapter(activePrinterProfile?.networkSupport),
    [activePrinterProfile?.networkSupport],
  );
  const activeMaterialProfile = React.useMemo(() => getActiveMaterialProfile(profileState), [profileState]);
  const selectedNetworkDeviceId = React.useMemo(() => {
    const directId = activePrinterProfile?.activeNetworkDeviceId?.trim();
    if (directId) return directId;

    const connectionIp = activePrinterProfile?.networkConnection?.ipAddress?.trim().toLowerCase() ?? '';
    if (!connectionIp) return null;

    const fleet = activePrinterProfile?.networkFleet ?? [];
    return fleet.find((device) => (device.ipAddress || '').trim().toLowerCase() === connectionIp)?.id ?? null;
  }, [
    activePrinterProfile?.activeNetworkDeviceId,
    activePrinterProfile?.networkConnection?.ipAddress,
    activePrinterProfile?.networkFleet,
  ]);
  const selectedNetworkDeviceReachability = selectedNetworkDeviceId
    ? (printerReachabilityByDeviceId[selectedNetworkDeviceId] ?? null)
    : null;
  const showRemoteOfflineMaterialPlaceholder = Boolean(networkUiAdapter)
    && networkUiAdapter?.supportsRemoteMaterialProfiles !== false
    && (
      activePrinterProfile?.networkConnection?.connected !== true
      || selectedNetworkDeviceReachability === false
    );
  const isNetworkPrinterOffline = Boolean(activePrinterProfile?.networkSupport) && (
    activePrinterProfile?.networkConnection?.connected !== true
    || selectedNetworkDeviceReachability === false
  );
  const connectedHostName = React.useMemo(() => {
    const networkConnection = activePrinterProfile?.networkConnection;
    if (!networkConnection?.connected) return null;
    return networkConnection.hostName || networkConnection.ipAddress || null;
  }, [activePrinterProfile]);

  const effectiveMaterialName = React.useMemo(() => {
    if (showRemoteOfflineMaterialPlaceholder) {
      return _(msg({ message: 'N/A', comment: 'Value placeholder shown when the material is unknown because the printer is offline. Keep it as short as "N/A".' }));
    }

    const networkConnection = activePrinterProfile?.networkConnection;
    if (activePrinterProfile?.networkSupport === 'nanodlp' && networkConnection?.connected) {
      return networkConnection.selectedMaterialName || networkConnection.selectedMaterialId || '-';
    }
    return resolveCompositeMaterialLabel(activeMaterialProfile) ?? activeMaterialProfile?.name ?? '-';
  }, [_, activeMaterialProfile, activePrinterProfile, showRemoteOfflineMaterialPlaceholder]);

  const effectiveLayerHeightMm = React.useMemo(() => {
    const networkConnection = activePrinterProfile?.networkConnection;
    if (
      activePrinterProfile?.networkSupport === 'nanodlp'
      && networkConnection?.connected
      && Number.isFinite(Number(networkConnection.selectedMaterialLayerHeightMm))
    ) {
      const value = Number(networkConnection.selectedMaterialLayerHeightMm);
      if (value > 0) return value;
    }
    return activeMaterialProfile?.layerHeightMm;
  }, [activeMaterialProfile, activePrinterProfile]);

  const effectiveNormalExposureSec = React.useMemo(() => {
    const networkConnection = activePrinterProfile?.networkConnection;
    if (
      activePrinterProfile?.networkSupport === 'nanodlp'
      && networkConnection?.connected
      && Number.isFinite(Number(networkConnection.selectedMaterialNormalExposureSec))
    ) {
      const value = Number(networkConnection.selectedMaterialNormalExposureSec);
      if (value > 0) return value;
    }
    return activeMaterialProfile?.normalExposureSec;
  }, [activeMaterialProfile, activePrinterProfile]);

  const effectiveBottomExposureSec = React.useMemo(() => {
    const networkConnection = activePrinterProfile?.networkConnection;
    if (
      activePrinterProfile?.networkSupport === 'nanodlp'
      && networkConnection?.connected
      && Number.isFinite(Number(networkConnection.selectedMaterialBottomExposureSec))
    ) {
      const value = Number(networkConnection.selectedMaterialBottomExposureSec);
      if (value > 0) return value;
    }
    return activeMaterialProfile?.bottomExposureSec;
  }, [activeMaterialProfile, activePrinterProfile]);

  const effectiveBottomLayerCount = React.useMemo(() => {
    const networkConnection = activePrinterProfile?.networkConnection;
    if (
      activePrinterProfile?.networkSupport === 'nanodlp'
      && networkConnection?.connected
      && Number.isFinite(Number(networkConnection.selectedMaterialBottomLayerCount))
    ) {
      const value = Number(networkConnection.selectedMaterialBottomLayerCount);
      if (value > 0) return value;
    }
    return activeMaterialProfile?.bottomLayerCount ?? 0;
  }, [activeMaterialProfile, activePrinterProfile]);

  // Compute per-model layer counts

  // Compact duration for the narrow "Est. print time" row. The trailing letters
  // are unit abbreviations — h(ours), min(utes), s(econds) — so "5 s" is five
  // seconds, and "min" is minutes rather than the SI symbol for metres. Each
  // form is one whole string so locales can set their own spacing and units.
  const formatDuration = (totalSeconds: number) => {
    const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.round(totalSeconds)) : 0;
    const { hours, minutes, seconds } = splitDurationSeconds(safeSeconds);

    if (hours > 0) return _(msg`${hours} h ${minutes} min`);
    if (minutes > 0) return _(msg`${minutes} min ${seconds} s`);
    return _(msg`${seconds} s`);
  };


  // Sets of model IDs used by memoized selectors; must be declared before hooks that use them
  const selectedModelSet = React.useMemo(() => new Set(selectedModelIds), [selectedModelIds]);
  const inBoundsModelSet = React.useMemo(() => new Set(inBoundsModelIds), [inBoundsModelIds]);

  const getModelLayerCount = React.useCallback((entry: LoadedModel): number | null => {
    // Use model height and effective layer height
    const bbox = entry.geometry.bbox;
    const minZ = bbox.min.z;
    const maxZ = bbox.max.z;
    const height = Math.max(0, maxZ - minZ) * Math.abs(entry.transform.scale.z || 1);
    if (!effectiveLayerHeightMm || effectiveLayerHeightMm <= 0) return null;
    return Math.ceil(height / effectiveLayerHeightMm);
  }, [effectiveLayerHeightMm]);

  // Compute per-selected or plate layer count
  const selectedLayerCounts = React.useMemo(() => {
    if (selectedModelSet.size > 0) {
      return models.filter((entry) => selectedModelSet.has(entry.id) && entry.visible)
        .map((entry) => ({ count: getModelLayerCount(entry) }));
    }
    if (inBoundsModelSet.size > 0) {
      return models.filter((entry) => inBoundsModelSet.has(entry.id) && entry.visible)
        .map((entry) => ({ count: getModelLayerCount(entry) }));
    }
    return [];
  }, [getModelLayerCount, inBoundsModelSet, models, selectedModelSet]);

  const maxLayerCount = React.useMemo(() => {
    if (selectedLayerCounts.length === 0) return null;
    return selectedLayerCounts.reduce((max, entry) => (entry.count != null && entry.count > max ? entry.count : max), 0);
  }, [selectedLayerCounts]);

  const resolvedLayerCount = React.useMemo(() => {
    if (Number.isFinite(numLayers) && numLayers > 0) {
      return Math.max(0, Math.round(numLayers));
    }
    return maxLayerCount;
  }, [maxLayerCount, numLayers]);

  const resinTargetModels = React.useMemo(() => {
    const visibleModels = models.filter((entry) => entry.visible);

    if (selectedModelSet.size > 0) {
      return visibleModels.filter((entry) => selectedModelSet.has(entry.id));
    }

    if (inBoundsModelSet.size > 0) {
      return visibleModels.filter((entry) => inBoundsModelSet.has(entry.id));
    }

    return [] as LoadedModel[];
  }, [inBoundsModelSet, models, selectedModelSet]);

  const estimatedExposureOnlySeconds = React.useMemo(() => {
    if (resinTargetModels.length === 0 || numLayers <= 0 || effectiveNormalExposureSec == null) return null;

    const bottomLayers = Math.max(0, Math.min(numLayers, Math.round(effectiveBottomLayerCount || 0)));
    const normalLayers = Math.max(0, numLayers - bottomLayers);

    const bottomTime = bottomLayers * Math.max(0, effectiveBottomExposureSec ?? effectiveNormalExposureSec);
    const normalTime = normalLayers * Math.max(0, effectiveNormalExposureSec);

    // A small fixed overhead per layer for lift/retract + settle.
    const movementOverheadSec = numLayers * 3.0;
    return bottomTime + normalTime + movementOverheadSec;
  }, [effectiveBottomExposureSec, effectiveBottomLayerCount, effectiveNormalExposureSec, numLayers, resinTargetModels.length]);

  const yieldToMainThread = React.useCallback(async () => {
    await new Promise<void>((resolve) => {
      if (typeof window !== 'undefined' && typeof (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback === 'function') {
        (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback?.(() => resolve(), { timeout: 16 });
        return;
      }
      setTimeout(resolve, 0);
    });
  }, []);

  const computeBaseResinMlChunked = React.useCallback(async (
    position: { getX: (i: number) => number; getY: (i: number) => number; getZ: (i: number) => number; count: number },
    index: { getX: (i: number) => number; count: number } | null,
  ): Promise<number | null> => {
    let signedVolume = 0;

    const vax = { x: 0, y: 0, z: 0 };
    const vbx = { x: 0, y: 0, z: 0 };
    const vcx = { x: 0, y: 0, z: 0 };

    const readVertex = (i: number, out: { x: number; y: number; z: number }) => {
      out.x = position.getX(i);
      out.y = position.getY(i);
      out.z = position.getZ(i);
    };

    const addTriangle = (ia: number, ib: number, ic: number) => {
      readVertex(ia, vax);
      readVertex(ib, vbx);
      readVertex(ic, vcx);

      signedVolume += (
        vax.x * (vbx.y * vcx.z - vbx.z * vcx.y)
        - vax.y * (vbx.x * vcx.z - vbx.z * vcx.x)
        + vax.z * (vbx.x * vcx.y - vbx.y * vcx.x)
      ) / 6;
    };

    const yieldEveryTriangles = 4096;
    let processedTriangles = 0;

    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        addTriangle(index.getX(i), index.getX(i + 1), index.getX(i + 2));
        processedTriangles += 1;
        if (processedTriangles % yieldEveryTriangles === 0) {
          await yieldToMainThread();
        }
      }
    } else {
      for (let i = 0; i < position.count; i += 3) {
        addTriangle(i, i + 1, i + 2);
        processedTriangles += 1;
        if (processedTriangles % yieldEveryTriangles === 0) {
          await yieldToMainThread();
        }
      }
    }

    const baseVolumeMm3 = Math.abs(signedVolume);
    return Number.isFinite(baseVolumeMm3) ? (baseVolumeMm3 / 1000) : null;
  }, [yieldToMainThread]);

  const getOrComputeBaseResinMl = React.useCallback(async (entry: LoadedModel): Promise<number | null> => {
    const geometry = entry.geometry.geometry;
    const positionAttr = geometry.getAttribute('position');
    if (!positionAttr) return null;

    const sourceKey = String(geometry.userData?.resinVolumeSourceKey ?? geometry.uuid);
    geometry.userData = {
      ...geometry.userData,
      resinVolumeSourceKey: sourceKey,
    };

    const position = positionAttr as {
      getX: (i: number) => number;
      getY: (i: number) => number;
      getZ: (i: number) => number;
      count: number;
      version?: number;
      data?: { version?: number };
    };
    const index = geometry.getIndex() as ({ getX: (i: number) => number; count: number; version?: number } | null);

    const positionVersion = position.version ?? position.data?.version ?? 0;
    const indexVersion = index?.version ?? 0;
    const cacheKey = `${sourceKey}:${positionVersion}:${indexVersion}`;

    const cached = baseResinMlCacheRef.current.get(cacheKey);
    if (cached !== undefined) return cached;

    const inFlight = inFlightBaseResinMlRef.current.get(cacheKey);
    if (inFlight) return inFlight;

    const promise = computeBaseResinMlChunked(position, index)
      .then((result) => {
        baseResinMlCacheRef.current.set(cacheKey, result);
        inFlightBaseResinMlRef.current.delete(cacheKey);
        return result;
      })
      .catch(() => {
        inFlightBaseResinMlRef.current.delete(cacheKey);
        return null;
      });

    inFlightBaseResinMlRef.current.set(cacheKey, promise);
    return promise;
  }, [computeBaseResinMlChunked]);

  React.useEffect(() => {
    let cancelled = false;

    if (resinTargetModels.length === 0) {
      setEstimatedResinMl(null);
      return () => {
        cancelled = true;
      };
    }

    const run = async () => {
      let totalMl = 0;
      let found = false;

      for (const entry of resinTargetModels) {
        if (cancelled) return;

        const baseMl = await getOrComputeBaseResinMl(entry);
        if (cancelled) return;
        if (baseMl == null) continue;

        const sx = Math.abs(entry.transform.scale.x || 1);
        const sy = Math.abs(entry.transform.scale.y || 1);
        const sz = Math.abs(entry.transform.scale.z || 1);
        totalMl += baseMl * sx * sy * sz;
        found = true;
      }

      if (cancelled) return;
      setEstimatedResinMl(found ? totalMl : null);
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [getOrComputeBaseResinMl, resinTargetModels]);

  const estimatedResinCost = React.useMemo(() => {
    if (estimatedResinMl == null || !activeMaterialProfile) return null;
    const bottleMl = Math.max(1, activeMaterialProfile.bottleCapacityMl || 0);
    const price = Math.max(0, activeMaterialProfile.bottlePrice || 0);
    const currency = (activeMaterialProfile.currencyCode || 'USD').toUpperCase();
    const cost = (estimatedResinMl / bottleMl) * price;
    return `${currency} ${fmt.fixed(cost, 2)}`;
  }, [activeMaterialProfile, estimatedResinMl, fmt]);

  const frontHeader = connectedHostName || activePrinterProfile?.name || _(msg`No printer connected`);
  const frontHeaderColor = isNetworkPrinterOffline
    ? '#ff4d54'
    : (connectedHostName ? '#78c63f' : '#fff9f8');

  const handleToggleFlip = React.useCallback(() => {
    setIsFlipped((prev) => !prev);
  }, []);

  const handleCardKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setIsFlipped((prev) => !prev);
    }
  }, []);

  const stopEvent = (event: React.MouseEvent) => {
    event.stopPropagation();
  };

  return (
    <div className="pointer-events-auto select-none" style={{ width: 440, maxWidth: 'min(440px, calc(100vw - 24px))' }}>
      <div
        className="w-full [perspective:1200px]"
      >
        <div
          role="button"
          tabIndex={0}
          aria-label={_(msg`Flip model stats card`)}
          onClick={handleToggleFlip}
          onKeyDown={handleCardKeyDown}
          className={useFlatFlip
            ? 'grid w-full min-w-0 focus:outline-none'
            : 'grid w-full min-w-0 transition-transform duration-500 ease-out [transform-style:preserve-3d] focus:outline-none'}
          style={useFlatFlip
            ? {
                transform: flatFlipEdgeOn ? 'rotateY(90deg)' : 'rotateY(0deg)',
                transition: 'transform 250ms',
                transitionTimingFunction: flatFlipEdgeOn ? 'ease-in' : 'ease-out',
              }
            : { transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
        >
          <div
            className="[grid-area:1/1] w-full min-w-0 ui-panel rounded-xl px-3.5 py-3.5 shadow-lg space-y-3 flex flex-col"
            style={{
              background: 'rgba(16, 18, 25, 0.7)',
              borderColor: '#2b2e38',
              ...(useFlatFlip
                ? { visibility: flatFlipShownFace === 'front' ? ('visible' as const) : ('hidden' as const) }
                // The explicit identity transform forces Blink to backface-cull
                // this face; without it Chrome renders it mirrored through the
                // back face when flipped (WebKit culls correctly either way).
                : { backfaceVisibility: 'hidden' as const, transform: 'rotateY(0deg)' }),
            }}
          >
            <div className="flex min-w-0 items-center gap-2.5 border-b pb-2.5" style={{ borderColor: 'color-mix(in srgb, #78c63f 34%, transparent)' }}>
              <Printer aria-hidden="true" size={22} strokeWidth={2.2} style={{ color: '#78c63f', flexShrink: 0 }} />
              <div className="h-7 w-1 rounded-full" style={{ background: '#78c63f' }} />
              <div className="min-w-0 truncate text-[15px] font-bold tracking-wide" style={{ color: frontHeaderColor }}>{frontHeader}</div>
            </div>

            <div className="grid grid-cols-2 gap-x-3 text-[10px] leading-tight">
              <div className="grid min-w-0 grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-center gap-x-1.5 gap-y-2">
                <span style={{ color: '#c0bdc3' }}><Trans>Printer:</Trans></span>
                <button
                  type="button"
                  onMouseDown={stopEvent}
                  onClick={(event) => {
                    event.stopPropagation();
                    openProfileSettingsModal('printer');
                  }}
                  className="min-w-0 truncate text-right underline decoration-dotted underline-offset-2 hover:opacity-85 transition-opacity"
                  style={{ color: '#fff9f8' }}
                  title={_(msg`Open printer profiles`)}
                >
                  {activePrinterProfile?.name ?? '-'}
                </button>

                <span style={{ color: '#c0bdc3' }}><Trans>Material:</Trans></span>
                <button
                  type="button"
                  onMouseDown={stopEvent}
                  onClick={(event) => {
                    event.stopPropagation();
                    openProfileSettingsModal('material');
                  }}
                  className="min-w-0 truncate text-right underline decoration-dotted underline-offset-2 hover:opacity-85 transition-opacity"
                  style={{ color: '#fff9f8' }}
                  title={_(msg`Open material profiles`)}
                >
                  {effectiveMaterialName}
                </button>

                <span style={{ color: '#c0bdc3' }}><Trans>Layer profile:</Trans></span>
                <span className="min-w-0 truncate text-right" style={{ color: '#fff9f8' }}>
                  {effectiveLayerHeightMm != null ? fmt.quantity(effectiveLayerHeightMm * 1000, 0, 'um') : '-'}
                </span>
              </div>

              <div className="grid min-w-0 grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-center gap-x-1.5 gap-y-2 border-l pl-3" style={{ borderColor: '#2b2e38' }}>
                <span style={{ color: '#c0bdc3' }}><Trans>Exposure:</Trans></span>
                <span className="min-w-0 truncate text-right" style={{ color: '#fff9f8' }}>
                  {effectiveNormalExposureSec != null
                    ? `${fmt.quantity(effectiveNormalExposureSec, 1, 's')} • ${fmt.quantity(effectiveBottomExposureSec ?? effectiveNormalExposureSec, 1, 's')}`
                    : '-'}
                </span>

                <span style={{ color: '#c0bdc3' }}><Trans>Layers:</Trans></span>
                <span className="min-w-0 truncate text-right" style={{ color: '#fff9f8' }}>
                  {estimatedLayerCountLabelOverride ?? (resolvedLayerCount != null ? resolvedLayerCount : '-')}
                </span>

                <span style={{ color: '#c0bdc3' }}><Trans comment='Row label on the printer card. "Est." is short for "estimated"; keep the abbreviation terse — the label column is narrow.'>Est. print time:</Trans></span>
                <span className="min-w-0 truncate text-right" style={{ color: '#fff9f8' }}>
                  {estimatedPrintTimeLabelOverride ?? (estimatedExposureOnlySeconds != null ? formatDuration(estimatedExposureOnlySeconds) : '-')}
                </span>
              </div>
            </div>

            {estimatedModelResinLabelOverride != null && (
              <div className="space-y-1.5 border-t pt-2" style={{ borderColor: '#2b2e38' }}>
                <div className="grid min-w-0 grid-cols-[34px_1fr_auto] items-center gap-2 rounded-lg border px-2.5 py-1.5" style={{ background: 'color-mix(in srgb, #c0bdc3 7%, #101219)', borderColor: '#2b2e38' }}>
                  <Box aria-hidden="true" size={20} strokeWidth={2} style={{ color: '#c0bdc3', justifySelf: 'center' }} />
                  <span className="border-l pl-2.5 text-[11px] font-semibold" style={{ borderColor: '#555963', color: '#fff9f8' }}><Trans>Model resin:</Trans></span>
                  <span className="min-w-0 truncate text-right text-[13px] font-bold tabular-nums" style={{ color: '#fff9f8' }}>{estimatedModelResinLabelOverride}</span>
                </div>

                <div className="grid min-w-0 grid-cols-[34px_1fr_auto] items-center gap-2 rounded-lg border px-2.5 py-1.5" style={{ background: 'color-mix(in srgb, #78c63f 10%, #101219)', borderColor: 'color-mix(in srgb, #78c63f 34%, #2b2e38)' }}>
                  <Network aria-hidden="true" size={20} strokeWidth={2} style={{ color: '#78c63f', justifySelf: 'center' }} />
                  <span className="border-l pl-2.5 text-[11px] font-semibold" style={{ borderColor: 'color-mix(in srgb, #78c63f 48%, #2b2e38)', color: '#78c63f' }}><Trans>Supports resin:</Trans></span>
                  <span className="min-w-0 truncate text-right text-[13px] font-bold tabular-nums" style={{ color: '#fff9f8' }}>{estimatedSupportsResinLabelOverride ?? '—'}</span>
                </div>

                <div className="grid min-w-0 grid-cols-[34px_1fr_auto] items-center gap-2 rounded-lg border px-2.5 py-1.5" style={{ background: 'color-mix(in srgb, #78c63f 10%, #101219)', borderColor: 'color-mix(in srgb, #78c63f 34%, #2b2e38)' }}>
                  <Layers aria-hidden="true" size={20} strokeWidth={2} style={{ color: '#78c63f', justifySelf: 'center' }} />
                  <span className="border-l pl-2.5 text-[11px] font-semibold" style={{ borderColor: 'color-mix(in srgb, #78c63f 48%, #2b2e38)', color: '#78c63f' }}><Trans>Raft resin:</Trans></span>
                  <span className="min-w-0 truncate text-right text-[13px] font-bold tabular-nums" style={{ color: '#fff9f8' }}>{estimatedRaftResinLabelOverride ?? '—'}</span>
                </div>
              </div>
            )}

            <div
              className="grid min-w-0 grid-cols-[34px_1fr_auto] items-center gap-2 rounded-lg border-l-4 px-2.5 py-2"
              style={{
                background: 'color-mix(in srgb, #ed0921 12%, #101219)',
                borderColor: '#ed0921',
                borderTop: '1px solid color-mix(in srgb, #ed0921 38%, #2b2e38)',
                borderRight: '1px solid color-mix(in srgb, #ed0921 38%, #2b2e38)',
                borderBottom: '1px solid color-mix(in srgb, #ed0921 38%, #2b2e38)',
              }}
            >
              <Droplet aria-hidden="true" size={21} strokeWidth={2.1} style={{ color: '#ed0921', justifySelf: 'center' }} />
              <span className="border-l pl-2.5 text-[12px] font-bold uppercase tracking-wide" style={{ borderColor: '#ed0921', color: '#ed0921' }}><Trans comment='Row label on the printer card: estimated resin volume including models, supports, and rafts. Keep it terse — the label column is narrow.'>Total resin:</Trans></span>
              <span className="min-w-0 truncate text-right text-[16px] font-bold tabular-nums" style={{ color: '#fff9f8' }}>
                {estimatedResinLabelOverride ?? (estimatedResinMl != null
                  ? `${fmt.quantity(estimatedResinMl, 2, 'ml')}${estimatedResinCost ? ` (${estimatedResinCost})` : ''}`
                  : '-')}
              </span>
            </div>

            {estimatedResinTotalLabel != null && estimatedResinTotalLabel.trim() !== estimatedResinLabelOverride?.trim() && (
              <div className="flex min-w-0 justify-between gap-2 px-1 text-[10px]" style={{ color: '#c0bdc3' }}>
                <span><Trans comment='Row label on the printer card: estimated resin for every plate in the scene, beside the row for the plate being worked on. Keep it terse — the label column is narrow.'>Est. resin (all):</Trans></span>
                <span className="min-w-0 truncate text-right" style={{ color: '#fff9f8' }}>{estimatedResinTotalLabel}</span>
              </div>
            )}

            <div className="pt-0.5 text-[9px] leading-tight" style={{ color: '#c0bdc3' }}>
              <Trans>Click card to view model details</Trans>
            </div>
          </div>

          <div
            className="[grid-area:1/1] w-full min-w-0 ui-panel rounded-md px-3 py-2.5 shadow-md space-y-1.5 flex flex-col"
            style={{
              background: 'color-mix(in srgb, var(--surface-0), transparent 8%)',
              ...(useFlatFlip
                ? { visibility: flatFlipShownFace === 'back' ? ('visible' as const) : ('hidden' as const) }
                : { backfaceVisibility: 'hidden' as const, transform: 'rotateY(180deg)' }),
            }}
          >
            <div className="w-full min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-[12px]" style={{ color: 'var(--text-strong)' }} title={model ? model.name : _(msg`No model selected`)}>
              {model ? model.name : _(msg`No model selected`)}
            </div>

            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              <span><Trans>STL size:</Trans></span>
              <span className="min-w-0 truncate" style={{ color: 'var(--text-strong)' }}>{model?.fileSizeBytes != null ? formatFileSize(model.fileSizeBytes, fmt) : '-'}</span>

              <span><Trans>Triangles:</Trans></span>
              <span className="min-w-0 truncate" style={{ color: 'var(--text-strong)' }}>{model ? formatPolygonCountCompact(model.geometry.sourceTriangleCount ?? model.polygonCount, fmt) : '-'}</span>

              <span><Trans comment='Row label on the model details card: number of separate connected surfaces ("shells"/bodies) in the mesh.'>Shells:</Trans></span>
              <span className="min-w-0 truncate" style={{ color: 'var(--text-strong)' }}>{shellCount != null ? fmt.fixed(shellCount, 0) : '-'}</span>

              <span><Trans>Height:</Trans></span>
              <span className="min-w-0 truncate" style={{ color: 'var(--text-strong)' }}>{model ? fmt.quantity(heightMm, 2, 'mm') : '-'}</span>
            </div>

            {model?.geometry.meshDefects?.hasDefects && (
              <div
                className="flex items-start gap-1.5 rounded px-2 py-1 text-[10px]"
                style={{
                  background: 'color-mix(in srgb, #f59e0b, var(--surface-1) 82%)',
                  color: 'color-mix(in srgb, #f59e0b, var(--text-strong) 20%)',
                  border: '1px solid color-mix(in srgb, #f59e0b, transparent 55%)',
                }}
              >
                <span>⚠</span>
                <span><Trans>Defective — {model.geometry.meshDefects.repairedFloats} errors</Trans></span>
              </div>
            )}

            <div className="pt-0.5 text-[10px] mt-auto" style={{ color: 'var(--text-muted)' }}>
              <Trans>Click card to return to print settings</Trans>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
