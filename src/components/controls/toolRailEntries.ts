import { msg } from '@lingui/core/macro';
import {
  Boxes,
  Copy,
  Droplets,
  FlipHorizontal2,
  Hand,
  LayoutGrid,
  Move3D,
  Paintbrush,
  PencilRuler,
  Combine,
  ScanSearch,
  ScanLine,
  Stamp,
  Waypoints,
} from 'lucide-react';
import type { TransformMode } from '@/hooks/useModelTransform';
import { AutoSupportIcon, CutSeamIcon, HollowShellIcon, InteriorViewIcon, IslandPalmIcon, LineSupportIcon, PlaceOnFaceIcon, SmoothingSphereIcon, SolidSupportIcon, type ToolRailEntry } from '@/components/controls/ToolRail';

/**
 * The Support panel or canvas interaction tool currently selected in the rail.
 */
export type SupportRailMode = 'auto' | 'manual' | 'islands' | 'proximity' | 'suction';
export type SupportInteractionMode = Extract<TransformMode, 'supportPainting' | 'supportInline' | 'supportProjection'>;

/**
 * The rail's entries for each mode. They live here rather than in the rail
 * because the two modes offer different things — Prepare lists its ten model
 * tools plus the model list, Support lists its five panel tools plus the model list —
 * while the rail itself only knows how to draw and animate a list of entries.
 */

export type PrepareToolRailOptions = {
  mode: TransformMode;
  onModeChange: (mode: TransformMode) => void;
  onModeHover?: (mode: TransformMode | null) => void;
  /**
   * The model list's tile. Only the left column asks for one: the bar under the
   * app bar always shows the list, so the caller there passes no toggle — and
   * these two are given together or not at all.
   */
  modelsPanelVisible?: boolean;
  onToggleModelsPanel?: () => void;
};

/** The Prepare tools, preceded by the model list's tile when one is asked for. */
export function buildPrepareToolRailEntries({
  mode,
  onModeChange,
  onModeHover,
  modelsPanelVisible,
  onToggleModelsPanel,
}: PrepareToolRailOptions): ToolRailEntry[] {
  const tools: Array<{ mode: TransformMode; label: ToolRailEntry['label']; hint: ToolRailEntry['hint']; icon: ToolRailEntry['icon']; separated?: ToolRailEntry['separated'] }> = [
    { mode: 'select', label: msg({ message: 'Drag', comment: 'Tool rail label. The tool that drags and places models on the plate. Deliberately "Drag" rather than "Arrange": the app uses "Arrange" elsewhere for arranging the whole plate, and Spanish distinguishes the two.' }), hint: msg`Move and place models on the plate`, icon: Hand },
    { mode: 'transform', label: msg`Transform`, hint: msg({ id: 'prepGuide.transformHint', message: 'Adjust the angle before adding supports to avoid large flat layers.' }), icon: Move3D },
    {
      mode: 'placeOnFace',
      label: msg({ message: 'On-Face', comment: 'Tool rail label. Short for "lay the model flat on a selected face"; keep it terse so the rail entry stays one line.' }),
      hint: msg`Orient flat against plate`,
      icon: PlaceOnFaceIcon,
    },
    { mode: 'mirror', label: msg`Mirror`, hint: msg`Mirror across X, Y, or Z`, icon: FlipHorizontal2 },
    // Three groups: orient the model, lay out copies, then edit its surface.
    { mode: 'duplicate', label: msg`Duplicate`, hint: msg`Array copies across the plate`, icon: Copy, separated: 'above' },
    { mode: 'arrange', label: msg`Arrange`, hint: msg({ message: 'Arrange models on the plate', comment: 'Tool rail entry. The tool that auto-packs the models onto the plate.' }), icon: LayoutGrid },
    { mode: 'organicCut', label: msg({ message: 'Split', comment: 'Tool rail label in Prepare mode. Splits the model along a drawn seam.' }), hint: msg`Split the model along a drawn seam`, icon: CutSeamIcon, separated: 'above' },
    { mode: 'smoothing', label: msg({ message: 'Smooth', comment: 'Tool rail label in Prepare mode. The tool brushes and smooths local surface regions.' }), hint: msg`Sculpt and smooth surface`, icon: SmoothingSphereIcon },
    { mode: 'engraving', label: msg`Engraving`, hint: msg`Engrave text or an image on the active model`, icon: Stamp },
    { mode: 'solidOperations', label: msg`Solid Operations`, hint: msg`Combine, cut, intersect, or split solid models`, icon: Combine },
  ];

  // The list's tile is a column affordance — the bar's caller passes no toggle,
  // so no tile is built for it.
  const modelsEntry: ToolRailEntry | null = onToggleModelsPanel === undefined
    ? null
    : {
      id: 'models',
      label: msg`Models`,
      hint: msg({ message: 'Show or hide the model list', comment: 'Tool rail entry that toggles the model list panel on the left. The list is the panel titled "Models".' }),
      icon: Boxes,
      active: modelsPanelVisible === true,
      invertLit: true,
      tone: 'panel',
      separated: 'below',
      onSelect: onToggleModelsPanel,
    };

  return [
    ...(modelsEntry === null ? [] : [modelsEntry]),
    ...tools.map((tool) => ({
      id: tool.mode,
      label: tool.label,
      hint: tool.hint,
      icon: tool.icon,
      active: mode === tool.mode,
      tone: 'tool' as const,
      onSelect: () => onModeChange(tool.mode),
      onHover: (entering: boolean) => onModeHover?.(entering ? tool.mode : null),
      separated: tool.separated,
    })),
  ];
}

export type SupportToolRailOptions = {
  /** The Support panel tool that is showing its panel. */
  mode: SupportRailMode;
  onModeChange: (mode: SupportRailMode) => void;
  /** The active support interaction tool, if one is selected. */
  activeInteractionMode: SupportInteractionMode | null;
  onInteractionModeSelect: (mode: SupportInteractionMode) => void;
  /** The model list's tile. See `PrepareToolRailOptions`. */
  modelsPanelVisible?: boolean;
  onToggleModelsPanel?: () => void;
  /**
   * The Hollowing tool is a transform mode, not a Support panel mode: selecting
   * it sets `transformMgr.transformMode` and shows the hollowing workflow. While
   * it is active the panel tools are deselected but their mode is kept, so
   * coming back lands on the panel the user left.
   */
  hollowingActive: boolean;
  onSelectHollowing: () => void;
  /**
   * The support display mode. `lines` is the line view the eye button in the
   * Support Studio header used to toggle: contact discs solid, every member a
   * line. `full` renders everything.
   */
  viewMode: SupportViewMode;
  onViewModeChange: (mode: SupportViewMode) => void;
  /**
   * Interior view looks through the shell of a hollowed model. It is only
   * meaningful once a cavity exists, which is what `interiorViewAvailable`
   * answers — the tile greys out rather than hiding while there is nothing to
   * look inside.
   */
  interiorView: boolean;
  interiorViewAvailable: boolean;
  onToggleInteriorView: () => void;
};

/** How the support forest is drawn. */
export type SupportViewMode = 'full' | 'lines';

/**
 * Support mode's entries include the model list; support panels; canvas interaction
 * tools; hollowing and interior view; and the support display toggle. A panel tool
 * selects which panel is shown. Canvas tools also open the Manual panel for their
 * settings, and the model list tile only appears when the caller offers its toggle.
 *
 * The labels are only ever read in a tile's tooltip, so they name the tool rather
 * than fitting a box, and the comments give each one the context its translation
 * needs.
 */
export function buildSupportToolRailEntries({
  mode,
  onModeChange,
  activeInteractionMode,
  onInteractionModeSelect,
  modelsPanelVisible,
  onToggleModelsPanel,
  hollowingActive,
  onSelectHollowing,
  viewMode,
  onViewModeChange,
  interiorView,
  interiorViewAvailable,
  onToggleInteriorView,
}: SupportToolRailOptions): ToolRailEntry[] {
  /**
   * The five panel tools by the mode each selects. Keyed rather than listed, so
   * that the rail's order is only ever the array at the bottom of this function.
   */
  const panelTools: Record<SupportRailMode, { label: ToolRailEntry['label']; hint: ToolRailEntry['hint']; icon: ToolRailEntry['icon'] }> = {
    islands: {
      label: msg({ message: 'Islands', comment: 'Tool rail label in Support mode. Short for the Islands panel, which scans the model for unsupported islands.' }),
      hint: msg({ id: 'prepGuide.islandsHint', message: 'Before slicing, check for regions with nothing supporting them from below.' }),
      icon: IslandPalmIcon,
    },
    auto: {
      label: msg({ message: 'Automatic', comment: 'Tool rail label in Support mode. Short for the Auto Supports panel, which generates supports automatically.' }),
      hint: msg({ id: 'prepGuide.supportsHint', message: 'Generate supports after orienting the model, then review their contacts.' }),
      icon: AutoSupportIcon,
    },
    manual: {
      label: msg({ message: 'Manual', comment: 'Tool rail label in Support mode. Short for the manual support settings panel (tip, shaft, roots, bracing).' }),
      hint: msg({ message: 'Support settings and presets', comment: 'Tool rail entry in Support mode. Selecting it shows the support parameter sidebar (tip, shaft, roots, bracing).' }),
      icon: PencilRuler,
    },
    proximity: {
      label: msg({ message: 'Proximity', comment: 'Tool rail label in Support mode. Opens the support clearance check.' }),
      hint: msg({ message: 'Check clearance around support shafts', comment: 'Tool rail entry in Support mode. Selecting it shows the support proximity analysis panel.' }),
      icon: ScanSearch,
    },
    suction: {
      label: msg({ message: 'Suction Cups', comment: 'Tool rail label in Support mode. Opens the resin suction cup detector.' }),
      hint: msg({ message: 'Find resin-trapping concave regions on the active model', comment: 'Tool rail entry in Support mode. Selecting it shows the suction cup detector.' }),
      icon: Droplets,
    },
  };

  /** One panel tool as a tile. `separated` is the group gap on its own side. */
  const panelTool = (railMode: SupportRailMode, separated?: ToolRailEntry['separated']): ToolRailEntry => ({
    id: railMode,
    label: panelTools[railMode].label,
    hint: panelTools[railMode].hint,
    icon: panelTools[railMode].icon,
    active: !hollowingActive && mode === railMode,
    tone: 'tool',
    separated,
    onSelect: () => onModeChange(railMode),
  });

  const interactionTool = (
    toolMode: SupportInteractionMode,
    label: ToolRailEntry['label'],
    hint: ToolRailEntry['hint'],
    icon: ToolRailEntry['icon'],
    separated?: ToolRailEntry['separated'],
  ): ToolRailEntry => ({
    id: toolMode,
    label,
    hint,
    icon,
    active: !hollowingActive && activeInteractionMode === toolMode,
    tone: 'tool',
    separated,
    onSelect: () => onInteractionModeSelect(toolMode),
  });

  // Same column-only tile as Prepare's.
  const modelsEntry: ToolRailEntry | null = onToggleModelsPanel === undefined
    ? null
    : {
      id: 'models',
      label: msg`Models`,
      hint: msg({ message: 'Show or hide the model list', comment: 'Tool rail entry that toggles the model list panel on the left. The list is the panel titled "Models".' }),
      icon: Boxes,
      active: modelsPanelVisible === true,
      invertLit: true,
      tone: 'panel',
      separated: 'below',
      onSelect: onToggleModelsPanel,
    };

  return [
    ...(modelsEntry === null ? [] : [modelsEntry]),
    panelTool('islands'),
    panelTool('manual', 'above'),
    panelTool('auto'),
    panelTool('proximity'),
    panelTool('suction'),
    interactionTool(
      'supportPainting',
      msg({ message: 'Paint', comment: 'Tool rail label in Support mode. Paints support contact points on the model surface.' }),
      msg({ message: 'Paint support contact points on the model', comment: 'Tool rail entry in Support mode.' }),
      Paintbrush,
      'above',
    ),
    interactionTool(
      'supportInline',
      msg({ message: 'Inline', comment: 'Tool rail label in Support mode. Places evenly spaced supports between two points on the model.' }),
      msg({ message: 'Place a row of supports between two surface points', comment: 'Tool rail entry in Support mode.' }),
      Waypoints,
    ),
    interactionTool(
      'supportProjection',
      msg({ message: 'Projection', comment: 'Tool rail label in Support mode. Projects support contacts from painted surface regions.' }),
      msg({ message: 'Project support contacts from a painted surface', comment: 'Tool rail entry in Support mode.' }),
      ScanLine,
    ),
    {
      id: 'hollowing',
      label: msg({ message: 'Hollow', comment: 'Tool rail label in Support mode. One word, like the other tool names: opens the hollowing tool (shell the model, add drainage holes).' }),
      hint: msg({ id: 'prepGuide.hollowHint', message: 'Hollow bulky parts and check that drainage holes reach the cavity.' }),
      icon: HollowShellIcon,
      active: hollowingActive,
      tone: 'tool',
      separated: 'above',
      onSelect: onSelectHollowing,
    },
    {
      id: 'interiorView',
      label: msg({ message: 'Interior View', comment: 'Tool rail label in Support mode. Toggles looking inside a hollowed model instead of at its outside.' }),
      hint: interiorViewAvailable
        ? msg({ message: 'Look inside the hollow, at the cavity and its drain holes', comment: 'Tool rail entry in Support mode, enabled once the model has been hollowed.' })
        : msg({ message: 'Hollow the model first to look inside it', comment: 'Tool rail entry in Support mode, shown greyed when the model has no cavity yet.' }),
      icon: InteriorViewIcon,
      active: interiorView,
      tone: 'tool',
      disabled: !interiorViewAvailable,
      onSelect: onToggleInteriorView,
    },
    {
      id: 'viewMode',
      label: msg({ message: 'View Mode', comment: 'Tool rail label in Support mode. Toggles the support display between everything drawn solid and contact discs with line members.' }),
      hint: msg({ message: 'How the support forest is drawn', comment: 'Tool rail entry in Support mode. A toggle: lit means the line view, unlit the solid one.' }),
      // The tile wears the icon of the mode in use as well as the lit state, so the
      // rail answers "how am I looking at this?" at a glance.
      icon: viewMode === 'lines' ? LineSupportIcon : SolidSupportIcon,
      active: viewMode === 'lines',
      tone: 'tool',
      separated: 'above',
      onSelect: () => onViewModeChange(viewMode === 'lines' ? 'full' : 'lines'),
    },
  ];
}
