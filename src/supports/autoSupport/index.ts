export type {
  CandidatePoint,
  AutoPlaceModelResult,
  AutoPlaceResult,
  AutoPlaceAnalytics,
  SizingDebugInfo,
  RejectReason,
  ForestReport,
  ForestTree,
  ForestLedgerEntry,
} from "./types";

export {
  MAGIC_PREPARE_WORKFLOWS_STORAGE_KEY,
  subscribeToMagicPrepareWorkflows,
  getMagicPrepareWorkflowsSnapshot,
  getMagicPrepareWorkflowsServerSnapshot,
  saveMagicPrepareWorkflow,
  deleteMagicPrepareWorkflow,
} from "./magicPrepareWorkflows";
export type {
  MagicPrepareWorkflow,
  MagicPrepareWorkflowConfig,
} from "./magicPrepareWorkflows";

export {
  AUTO_SUPPORT_CONSTRAINTS,
  SIZING_BANDS,
  DIAGNOSTIC_AUTO_SUPPORT_KEYS,
  createDefaultAutoSupportSettings,
  normalizeAutoSupportSettings,
  applyAutoSupportSettingsPatch,
  migrateLegacySizingPreset,
} from "./settings";
export type {
  AutoSupportSettings,
  AutoSupportScope,
  AutoSupportDiagnosticKey,
  NumericConstraint,
  NumericAutoSupportSettingKey,
  SizingBand,
  SizingPreset,
} from "./settings";

export {
  generateCandidates,
  deduplicateCandidates,
  candidateFromIsland,
  candidatesFromIsland,
} from "./candidateGeneration";

export { sizeParameters } from "./parameterSizing";
export type { SizeOverrides } from "./parameterSizing";

export { runAutoPlace, commitAutoPlacePlan, forestReportToText, runAutoSupportOptimization } from "./autoPlace";
export {
  runAutoPlaceInWorker,
  runAutoPlaceSequenceInWorker,
  runAutoPlaceBatchSequenceInWorker,
  runAutoSupportOptimizationInWorker,
} from "./autoPlaceWorkerClient";
export type {
  AutoPlaceBatchEntry,
  AutoPlaceSequenceConsolidation,
  AutoPlaceSequenceOptions,
} from "./autoPlaceWorkerClient";
export { setModelMesh, getModelMesh } from "./meshStore";
