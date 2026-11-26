import React from 'react';
import {
  getToolLayout,
  isModelsPanelVisibleEnabled,
  TOOL_LAYOUT_EVENT,
  type ToolLayout,
} from '@/components/layout/floatingLayoutPreferences';

/**
 * The tool rail's stored preferences as Home reads them: whether the Models
 * panel is shown, and whether the rail is a column or a bar, kept in step with
 * the event Settings and the rail's menu send. Moved out of Home verbatim.
 */
export function useToolRailLayout() {
  'use no memo';
  // Tool rail's `Models` entry. Defaults to shown, which is how the list behaved
  // before the rail existed; the stored value is applied on mount, not at render,
  // because localStorage does not exist during the server render.
  const [modelsPanelVisible, setModelsPanelVisible] = React.useState<boolean>(true);
  React.useEffect(() => {
    setModelsPanelVisible(isModelsPanelVisibleEnabled());
  }, []);
  // Column on the left edge or bar under the app bar; Settings and the rail's own
  // context menu both write the preference and announce it. The fold animation
  // itself lives in `ToolRail`, which measures the entries as the layout lands.
  const [toolLayout, setToolLayoutState] = React.useState<ToolLayout>('horizontal');
  React.useEffect(() => {
    setToolLayoutState(getToolLayout());

    const handleToolLayoutChanged = (event: Event) => {
      setToolLayoutState((event as CustomEvent<{ layout?: ToolLayout }>).detail?.layout ?? getToolLayout());
    };

    window.addEventListener(TOOL_LAYOUT_EVENT, handleToolLayoutChanged as EventListener);
    return () => {
      window.removeEventListener(TOOL_LAYOUT_EVENT, handleToolLayoutChanged as EventListener);
    };
  }, []);

  return {
    modelsPanelVisible,
    setModelsPanelVisible,
    toolLayout,
  };
}
