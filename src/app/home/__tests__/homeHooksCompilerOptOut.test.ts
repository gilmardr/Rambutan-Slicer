import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * The hooks split out of page.tsx ran inside Home, which the React Compiler
 * does not compile, so their useMemo/useCallback dependency lists were honoured
 * as written. Compiled, a memo keeps only what its body reads: useResinEstimate
 * lists a refresh tick it never reads, and the support and raft resin estimate
 * stopped updating in the Support tab. Each hook opts out to keep the behaviour
 * it had in Home; this pins that.
 */
const HOOKS: Array<[file: string, hook: string]> = [
  ['useResinEstimate.ts', 'useResinEstimate'],
  ['useSceneLifecycle.ts', 'useSceneLifecycle'],
  ['usePrintJobSender.ts', 'usePrintJobSender'],
  ['useEditorContextMenu.ts', 'useEditorContextMenuItems'],
  ['useEditorContextMenu.ts', 'useEditorMenuActions'],
  ['useEditorDebugPanels.ts', 'useEditorDebugPanels'],
  ['usePluginImportWarning.ts', 'usePluginImportWarning'],
  ['useSceneSaveChoicePrompt.ts', 'useSceneSaveChoicePrompt'],
  ['useUnsavedSceneChanges.ts', 'useUnsavedSceneChanges'],
  ['useNewDeviceToast.ts', 'useNewDeviceToast'],
  ['useSceneSaveError.ts', 'useSceneSaveError'],
  ['useManifoldWarning.ts', 'useManifoldWarning'],
  ['useToolRailLayout.ts', 'useToolRailLayout'],
  ['useExportThumbnailRenderOptions.ts', 'useExportThumbnailRenderOptions'],
  ['useOnboardingWizard.ts', 'useOnboardingWizard'],
  ['useModelStatsClearance.ts', 'useModelStatsClearance'],
  ['useDestructiveTransformGuard.ts', 'useDestructiveTransformGuard'],
  ['useEditorRightClickGesture.ts', 'useEditorRightClickGesture'],
  ['useModifierApplyOverlayElapsedLabel.ts', 'useModifierApplyOverlayElapsedLabel'],
  ['useCameraBackgroundWorkPause.ts', 'useCameraBackgroundWorkPause'],
  ['useRemoteOfflineLayerHeightSnapshot.ts', 'useRemoteOfflineLayerHeightSnapshot'],
  ['useActiveModelSupportTips.ts', 'useActiveModelSupportTips'],
  ['useHoldEmptyStateDuringSceneImport.ts', 'useHoldEmptyStateDuringSceneImport'],
  ['useSaveAsHotkey.ts', 'useSaveAsHotkey'],
  ['useOverhangViewToggle.ts', 'useOverhangViewToggle'],
  ['useStaleSliceKickFromPrinting.ts', 'useStaleSliceKickFromPrinting'],
];

for (const [file, hook] of HOOKS) {
  test(`${hook} opts out of the React Compiler`, () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/app/home', file), 'utf8');
    const start = source.indexOf(`export function ${hook}(`);
    assert.notEqual(start, -1, `${hook} no longer exists in ${file}`);
    const bodyStart = source.indexOf(') {\n', start);
    const body = source.slice(bodyStart, bodyStart + 1200);
    const firstStatement = body
      .split('\n')
      .slice(1)
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith('//'));
    assert.equal(firstStatement, "'use no memo';", `${hook} must start with the 'use no memo' directive`);
  });
}
