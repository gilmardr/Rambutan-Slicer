/** The model and plate types the scene collection holds. */
import { type GeometryWithBounds } from '@/hooks/useStlGeometry';
import { type PlateFrame } from '@/features/scene/plates/plateLayout';
import { type VoxlMeshRef } from '@/features/scene/voxl';
import type { ModelTransform } from '@/hooks/useModelTransform';
import type { ModelMeshModifiers } from '@/features/mesh-modifiers/types';

/**
 * One build plate in the scene. `name` is '' when the user has not named it, so
 * the widget falls back to its own wording rather than showing an empty label.
 */
export type ScenePlate = {
  id: string;
  name: string;
};

/** Where a plate is in the world, and the build volume it holds there. */
export type { PlateFrame };

export interface LoadedModel {
  id: string;
  name: string;
  groupId?: string;
  groupName?: string;
  fileUrl: string;
  /**
   * The plate this model stands on. Absent means the scene's first plate, which
   * is what a scene written before plates meant by it; new models are stamped
   * with the plate they were imported onto.
   */
  plateId?: string;
  /** Original on-disk mesh retained when `geometry` is a reduced native preview. */
  sourcePath?: string | null;
  /** Original mesh sidecar reference when not embedded in ORIG chunk. */
  originalRef?: VoxlMeshRef;
  fileSizeBytes?: number;
  geometry: GeometryWithBounds;
  transform: ModelTransform;
  visible: boolean;
  color: string;
  polygonCount: number;
  /** Pre-processed individual body geometries for multi-body 3MF imports.
   *  When set, "Split to Bodies" replaces this single model with separate
   *  models for each entry — instant, no reprocessing needed. */
  splitBodies?: GeometryWithBounds[];
  meshModifiers?: ModelMeshModifiers;
  ignoreAutoLift?: boolean;
  manualZMoveOverride?: boolean;
  isSupportGeometry?: boolean;
  linkGroupId?: string;
}
