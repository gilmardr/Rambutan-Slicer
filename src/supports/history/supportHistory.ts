import { createTypedHistory } from '@/history/typedHistory';
import type { SupportHistoryPayloadMap } from './actionTypes';
import { SUPPORT_HISTORY_LABELS } from './supportHistoryLabels';

const supportHistory = createTypedHistory<SupportHistoryPayloadMap>(SUPPORT_HISTORY_LABELS);

let supportHistoryBatchDepth = 0;

/**
 * Push a support history entry with the payload its type requires. The compiler
 * rejects a payload that doesn't match the action type, so a push site can't
 * drift from the handler that inverts it.
 */
export const pushSupportHistory: typeof supportHistory.push = (...args) => {
  if (supportHistoryBatchDepth > 0) return;
  return supportHistory.push(...args);
};

/** Suppress per-entity entries while one user gesture records its final snapshot. */
export function beginSupportHistoryBatch(): () => void {
  supportHistoryBatchDepth += 1;
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    supportHistoryBatchDepth = Math.max(0, supportHistoryBatchDepth - 1);
  };
}

/**
 * Register a handler that receives its action's payload already narrowed, so no
 * handler body has to cast `action.payload`.
 */
export const registerSupportHistoryHandler = supportHistory.register;
