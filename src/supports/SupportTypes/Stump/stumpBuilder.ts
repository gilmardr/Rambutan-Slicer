import type { Stump, Joint, Vec3 } from '../../types';
import type { ContactCone, SupportTipProfile } from '../../SupportPrimitives/ContactCone/types';
import type { SupportData } from '../../rendering/SupportBuilder';
import type * as THREE from 'three';
// Direct, not through the barrel: the barrel re-exports renderers and their
// React hooks, which a server route cannot import.
import { recomputeContactConeForMovedDisk } from '../../SupportPrimitives/ContactDisk/ContactDiskInteraction';
import { getSettings } from '../../Settings/state';
import { inlineRootId } from '../../supportTypeRegistry';
import { resolveConeAxisPolicy } from '../../PlacementLogic/ConeAxisPolicy';
import { encodeSupportSettingsHex } from '../../Settings/supportSettingsCodec';
import { v4 as uuidv4 } from 'uuid';
import { getRaftSettings } from '../../Rafts/Crenelated/RaftState';

const STUMP_ROOT_BASE_DIAMETER_MM = 2.0;
const STUMP_ROOT_TOP_DIAMETER_MM = 1.5;
const STUMP_ROOT_HEIGHT_MM = 1.0;
const STUMP_JOINT_DIAMETER_MM = 1.5;
/** Shortest cone (contact disk to joint) a full-size stump keeps, in mm. */
const STUMP_MIN_CONE_MM = 0.45;
/** Smallest fraction a compact stump shrinks to; below it the gap is the plate. */
const STUMP_MIN_FIT = 0.2;

/**
 * How much of the full stump stack fits under a contact this low.
 *
 * A full stump stands its contact cone on a 1 mm root and a 1.5 mm joint ball,
 * about 2.2 mm in all. A tip hanging lower than that (the point of a horn or a
 * claw just above the plate) used to get a full stump whose joint ball reached
 * into the model, so the point was refused and left with no support at all.
 * Root, joint and diameters scale by this factor instead; stumps with room keep
 * the full size (factor 1).
 */
export function compactStumpFit(tipZ: number, diskHeightMm: number): number {
    const fullStackMm = STUMP_ROOT_HEIGHT_MM + STUMP_JOINT_DIAMETER_MM / 2 + STUMP_MIN_CONE_MM;
    const available = tipZ - diskHeightMm;
    return Math.min(1, Math.max(STUMP_MIN_FIT, available / fullStackMm));
}

export interface StumpBuildInput {
    tipPos: Vec3;
    tipNormal: Vec3;
    modelId: string;
    mesh?: THREE.Mesh;
}

export interface StumpBuildResult {
    stump: Stump;
    supportData: SupportData;
}

export function buildStumpData(input: StumpBuildInput): StumpBuildResult {
    const { tipPos, tipNormal, modelId, mesh } = input;

    const settings = getSettings();
    const settingsCodeHex = encodeSupportSettingsHex(settings);
    const coneAngleMode = settings.tip.coneAngleMode ?? 'normal';
    const adaptiveConeAngleOffsetDeg = settings.tip.adaptiveConeAngleOffsetDeg ?? 30;

    const { coneAxis } = resolveConeAxisPolicy({
        surfaceNormal: tipNormal,
        coneAngleMode,
        adaptiveConeAngleOffsetDeg,
    });

    const effectiveConeAxis = coneAxis ?? tipNormal;
    const tipProfile: SupportTipProfile = {
        type: 'disk',
        contactDiameterMm: settings.tip.contactDiameterMm,
        bodyDiameterMm: settings.tip.bodyDiameterMm,
        lengthMm: settings.tip.lengthMm,
        penetrationMm: settings.tip.penetrationMm,
        diskThicknessMm: 0.1,
        maxStandoffMm: 1.5,
        standoffAngleThreshold: Math.PI / 4,
    };

    // Compute raft vertical offset (must match RootsRenderer logic)
    const raft = getRaftSettings();
    const hasSolidBottom = raft.bottomMode === 'solid';
    const raftThickness = raft.thickness ?? 0;
    const ANCHOR_DISK_HEIGHT_MM = 0.1;
    const effectiveDiskHeight = ANCHOR_DISK_HEIGHT_MM;
    const verticalOffset = 0;

    // A tip lower than the full stack gets a proportionally smaller stump.
    const fit = compactStumpFit(tipPos.z - verticalOffset, effectiveDiskHeight);
    const rootHeightMm = STUMP_ROOT_HEIGHT_MM * fit;
    const jointDiameterMm = STUMP_JOINT_DIAMETER_MM * fit;
    const rootBaseDiameterMm = STUMP_ROOT_BASE_DIAMETER_MM * fit;
    const rootTopDiameterMm = STUMP_ROOT_TOP_DIAMETER_MM * fit;

    // Sphere center Z = verticalOffset + effectiveDiskHeight + coneHeight
    // (sphere center is at top of cone, not offset by radius)
    const targetSocketZ = verticalOffset + effectiveDiskHeight + rootHeightMm;
    const dzPerUnit = effectiveConeAxis.z;
    const coneLength = Math.abs(dzPerUnit) > 1e-6
        ? (targetSocketZ - tipPos.z) / dzPerUnit
        : tipProfile.lengthMm; // fallback if cone axis is nearly horizontal

    // Use the stretched length (but never shorter than the default) — and never
    // so long that the socket overshoots BELOW the root joint: on a downward
    // cone axis extra length sinks the socket, leaving the joint ball stranded
    // above the cone (or the shaft plunging below the root).
    let effectiveConeLength = Math.max(coneLength, tipProfile.lengthMm);
    if (dzPerUnit < -1e-6) {
        const maxConeLength = (tipPos.z - targetSocketZ) / -dzPerUnit;
        if (maxConeLength > 0) {
            effectiveConeLength = Math.min(effectiveConeLength, maxConeLength);
        }
    }

    const guessedSocketPos: Vec3 = {
        x: tipPos.x + effectiveConeAxis.x * effectiveConeLength,
        y: tipPos.y + effectiveConeAxis.y * effectiveConeLength,
        z: tipPos.z + effectiveConeAxis.z * effectiveConeLength,
    };
    const authoredCone = recomputeContactConeForMovedDisk(
        {
            id: 'preview-stump-cone',
            pos: tipPos,
            normal: effectiveConeAxis,
            surfaceNormal: tipNormal,
            profile: {
                ...tipProfile,
                lengthMm: effectiveConeLength,
                bodyDiameterMm: Math.max(0.2, jointDiameterMm - 0.1),
            },
        },
        tipPos,
        tipNormal,
        guessedSocketPos,
        mesh,
    );
    const socketPos: Vec3 = {
        x: authoredCone.pos.x + (authoredCone.surfaceNormal?.x ?? tipNormal.x) * (authoredCone.diskLengthOverride ?? 0) + authoredCone.normal.x * authoredCone.profile.lengthMm,
        y: authoredCone.pos.y + (authoredCone.surfaceNormal?.y ?? tipNormal.y) * (authoredCone.diskLengthOverride ?? 0) + authoredCone.normal.y * authoredCone.profile.lengthMm,
        z: authoredCone.pos.z + (authoredCone.surfaceNormal?.z ?? tipNormal.z) * (authoredCone.diskLengthOverride ?? 0) + authoredCone.normal.z * authoredCone.profile.lengthMm,
    };

    // Root and joint are positioned at the socket XY, vertical stack
    const rootPos: Vec3 = { x: socketPos.x, y: socketPos.y, z: 0 };
    const jointPos: Vec3 = { x: socketPos.x, y: socketPos.y, z: targetSocketZ };
    const joint: Joint = {
        id: uuidv4(),
        pos: jointPos,
        diameter: jointDiameterMm,
    };

    const socketJoint: Joint = {
        id: uuidv4(),
        pos: socketPos,
        diameter: jointDiameterMm,
    };

    // Override profile: stretched length + body diameter matches joint
    const stumpTipProfile: SupportTipProfile = {
        ...tipProfile,
        lengthMm: effectiveConeLength,
        bodyDiameterMm: Math.max(0.2, jointDiameterMm - 0.1),
    };

    const contactCone: ContactCone = {
        ...authoredCone,
        id: uuidv4(),
        socketJointId: socketJoint.id,
    };

    const stumpId = uuidv4();
    const stump: Stump = {
        id: stumpId,
        modelId,
        settingsCodeHex,
        rootPos,
        rootBaseDiameter: rootBaseDiameterMm,
        rootTopDiameter: rootTopDiameterMm,
        rootHeight: rootHeightMm,
        joint,
        segments: [],
        contactCone,
    };

    const supportData: SupportData = {
        id: stumpId,
        // Synthetic Roots entity so the generic SupportBuilder preview renders
        // the root cone exactly like StumpRenderer does for placed stumps.
        roots: {
            id: inlineRootId(stumpId),
            modelId,
            transform: { pos: rootPos, rot: { x: 0, y: 0, z: 0, w: 1 } },
            diameter: rootBaseDiameterMm,
            diskHeight: ANCHOR_DISK_HEIGHT_MM,
            coneHeight: rootHeightMm,
        },
        segments: [],
        contactCone,
    };

    return { stump, supportData };
}
