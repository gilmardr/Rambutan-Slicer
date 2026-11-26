import React from 'react';
import * as THREE from 'three';
import type { useSceneCollectionManager } from '@/features/scene/useSceneCollectionManager';
import { contactEndpointsFor, SUPPORT_TYPES, type SupportCollectionKey } from '@/supports/supportTypeRegistry';
import { subscribe as subscribeSupportState, getSnapshot as getSupportSnapshot } from '@/supports/state';

type HomeScene = ReturnType<typeof useSceneCollectionManager>;

/**
 * Every support contact point on the active model, kept in step with the
 * support store and only replaced when a point actually moves. The islands
 * check reads it. Moved out of Home verbatim.
 */
export function useActiveModelSupportTips({ scene }: { scene: HomeScene }) {
  'use no memo';
  const [supportTips, setSupportTips] = React.useState<THREE.Vector3[]>([]);

  React.useEffect(() => {
    const updateSupportTips = () => {
      const snap = getSupportSnapshot();
      const tips: THREE.Vector3[] = [];
      const activeModelId = scene.activeModel?.id;
      if (!activeModelId) {
        setSupportTips([]);
        return;
      }

      const addPos = (pos?: { x: number; y: number; z: number }, modelId?: string) => {
        if (pos && modelId === activeModelId) {
          tips.push(new THREE.Vector3(pos.x, pos.y, pos.z));
        }
      };

      // Every declared contact, in registry order.
      for (const descriptor of SUPPORT_TYPES) {
        const contacts = contactEndpointsFor(descriptor.id);
        if (contacts.length === 0) continue;

        const collection = snap[descriptor.location.key as SupportCollectionKey] as unknown as
          Record<string, { modelId?: string }>;
        for (const entity of Object.values(collection ?? {})) {
          for (const { field } of contacts) {
            const contact = (entity as unknown as Record<string, { pos?: { x: number; y: number; z: number } }>)[field];
            if (contact?.pos) addPos(contact.pos, entity.modelId);
          }
        }
      }

      setSupportTips(prevTips => {
        if (prevTips.length !== tips.length) return tips;
        for (let i = 0; i < tips.length; i++) {
          if (!prevTips[i].equals(tips[i])) return tips;
        }
        return prevTips;
      });
    };

    updateSupportTips();
    return subscribeSupportState(updateSupportTips);
  }, [scene.activeModel?.id]);

  return supportTips;
}
