import React from 'react';
import { getSceneSnapshotRegistryBytes } from '@/features/scene/useSceneCollectionManager';
import {
  getHistoryDebugEvents,
  getHistoryStackBytes,
  getRedoCount,
  getUndoCount,
  subscribeHistory,
  subscribeHistoryDebug,
} from '@/history/historyStore';
import type { HistoryDebugEvent } from '@/history/types';

/**
 * State behind the editor's debug panels: the diagnostics, slice-metrics and
 * history modals, and the transform debug overlay with its refresh tick. Moved
 * out of Home verbatim; the history panel's readouts still refresh only while
 * it is open.
 */
export function useEditorDebugPanels() {
  'use no memo';
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = React.useState(false);
  const [isSliceMetricsDebugOpen, setIsSliceMetricsDebugOpen] = React.useState(false);

  const [isHistoryDebugOpen, setIsHistoryDebugOpen] = React.useState(false);
  const [isTransformDebugOverlayOpen, setIsTransformDebugOverlayOpen] = React.useState(false);

  const [transformDebugTick, setTransformDebugTick] = React.useState(0);
  const [historyDebugEvents, setHistoryDebugEvents] = React.useState<HistoryDebugEvent[]>([]);
  // Sizes for the history debug panel. Recomputed only while the panel is open —
  // walking every payload on each push would tax the hot path for a readout
  // nobody is looking at.
  const [historyStackBytes, setHistoryStackBytes] = React.useState<{ undo: number; redo: number; total: number }>({
    undo: 0,
    redo: 0,
    total: 0,
  });
  const [sceneSnapshotBytes, setSceneSnapshotBytes] = React.useState(0);
  const isHistoryDebugOpenRef = React.useRef(false);
  const [historyStackCounts, setHistoryStackCounts] = React.useState<{ undo: number; redo: number }>({
    undo: 0,
    redo: 0,
  });
  const [historyPreviewTargetEventId, setHistoryPreviewTargetEventId] = React.useState<number | null>(null);
  const [isHistoryPreviewActive, setIsHistoryPreviewActive] = React.useState(false);
  const historyPreviewBaselineRef = React.useRef<{ undo: number; redo: number } | null>(null);

  React.useEffect(() => {
    if (!isTransformDebugOverlayOpen) return;

    const intervalId = window.setInterval(() => {
      setTransformDebugTick((prev) => prev + 1);
    }, 120);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isTransformDebugOverlayOpen]);

  React.useEffect(() => {
    const refreshHistoryDebug = () => {
      setHistoryDebugEvents(getHistoryDebugEvents());
      setHistoryStackCounts({ undo: getUndoCount(), redo: getRedoCount() });
      // Sizes only while the panel is open: both walk every entry, and the debug
      // log updates on every push.
      if (isHistoryDebugOpenRef.current) {
        setHistoryStackBytes(getHistoryStackBytes());
        setSceneSnapshotBytes(getSceneSnapshotRegistryBytes());
      }
    };

    refreshHistoryDebug();

    const unsubHistory = subscribeHistory(refreshHistoryDebug);
    const unsubHistoryDebug = subscribeHistoryDebug(refreshHistoryDebug);

    return () => {
      unsubHistory();
      unsubHistoryDebug();
    };
  }, []);

  React.useEffect(() => {
    isHistoryDebugOpenRef.current = isHistoryDebugOpen;
    // Opening the panel must not wait for the next push to show a number.
    if (isHistoryDebugOpen) {
      setHistoryStackBytes(getHistoryStackBytes());
      setSceneSnapshotBytes(getSceneSnapshotRegistryBytes());
    }
  }, [isHistoryDebugOpen]);

  React.useEffect(() => {
    if (isHistoryDebugOpen) {
      historyPreviewBaselineRef.current = {
        undo: getUndoCount(),
        redo: getRedoCount(),
      };
      setIsHistoryPreviewActive(false);
      setHistoryPreviewTargetEventId(null);
      return;
    }

    historyPreviewBaselineRef.current = null;
    setIsHistoryPreviewActive(false);
    setHistoryPreviewTargetEventId(null);
  }, [isHistoryDebugOpen]);

  return {
    isDiagnosticsOpen,
    setIsDiagnosticsOpen,
    isSliceMetricsDebugOpen,
    setIsSliceMetricsDebugOpen,
    isHistoryDebugOpen,
    setIsHistoryDebugOpen,
    isTransformDebugOverlayOpen,
    setIsTransformDebugOverlayOpen,
    transformDebugTick,
    historyDebugEvents,
    historyStackBytes,
    sceneSnapshotBytes,
    historyStackCounts,
    historyPreviewTargetEventId,
    setHistoryPreviewTargetEventId,
    isHistoryPreviewActive,
    setIsHistoryPreviewActive,
    historyPreviewBaselineRef,
  };
}
