import { registerAnatomyPreview } from '../../../anatomyPreviewRegistry';
import { panelForTab } from '../../../sidebarPanels';
import React from 'react';
import * as THREE from 'three';
import { SupportBuilder } from '@/supports/rendering/SupportBuilder';
import { ANATOMY_CONFIG } from '../../AnatomyPreviewConfig';
import { applyInitialPattern } from '@/supports/autoBracing/initialPattern';
import { applyRepeatingPattern } from '@/supports/autoBracing/repeatingPattern';
import { runZigZagChain } from '@/supports/autoBracing/zigzagChain';
import { AUTO_BRACING_HARD_RULES } from '@/supports/autoBracing/settings';
import type { AutoBracingPattern } from '@/supports/autoBracing/settings';

interface BracePreviewProps {
    settings: any;
    previewState: any;
}

const PREVIEW_HEIGHT_MM = 22.95; // 1.7× then −10%

/**
 * Build support data for a single vertical trunk at (posX, posY) using
 * realistic settings (root cones, joint spheres, contact cones, etc.)
 */
function buildTrunkData(
    posX: number,
    posY: number,
    index: number,
    shaftDiameterMm: number,
    rootsDiameterMm: number,
    rootsDiskHeightMm: number,
    rootsConeHeightMm: number,
) {
    const u = (s: string) => `brace-trunk-${index}-${s}`;

    const rootPos = { x: posX, y: posY, z: 0 };

    const root = {
        id: u('root'),
        modelId: `anatomy-preview-brace-trunk-${index}`,
        transform: { pos: rootPos, rot: { x: 0, y: 0, z: 0, w: 1 } },
        diameter: rootsDiameterMm,
        diskHeight: rootsDiskHeightMm,
        coneHeight: rootsConeHeightMm,
    };

    // Roots top-of-cone Z (where shaft starts)
    const rootsTopZ = rootsDiskHeightMm + rootsConeHeightMm;

    // Bottom joint at the top of the root cone
    const bottomJointPos = { x: posX, y: posY, z: rootsTopZ };
    const bottomJoint = {
        id: u('bottomJoint'),
        pos: bottomJointPos,
        diameter: shaftDiameterMm + 0.2,
    };

    // Top joint at the top of the trunk
    const topJointPos = { x: posX, y: posY, z: PREVIEW_HEIGHT_MM };
    const topJoint = {
        id: u('topJoint'),
        pos: topJointPos,
        diameter: shaftDiameterMm + 0.2,
    };

    // Two segments: root→bottomJoint→topJoint for a realistic look with a joint sphere
    const seg1 = {
        id: u('seg1'),
        diameter: shaftDiameterMm,
        topJoint: bottomJoint,
    };

    const seg2 = {
        id: u('seg2'),
        diameter: shaftDiameterMm,
        topJoint,
    };

    // Contact cone pointing upward at the top
    const contactCone = {
        id: u('cone'),
        pos: { x: posX, y: posY, z: PREVIEW_HEIGHT_MM + 2.0 },
        normal: { x: 0, y: 0, z: -1 },
        surfaceNormal: { x: 0, y: 0, z: -1 },
        profile: {
            type: 'disk' as const,
            contactDiameterMm: 0.35,
            bodyDiameterMm: shaftDiameterMm,
            lengthMm: 2.0,
            penetrationMm: 0.1,
            diskThicknessMm: 0.1,
            maxStandoffMm: 1.5,
            standoffAngleThreshold: Math.PI / 4,
        },
        socketJointId: u('topJoint'),
    };

    return {
        id: u('trunk'),
        roots: root,
        segments: [seg1, seg2],
        contactCone,
        angle: 0,
    };
}

/**
 * Brace anatomy preview: a four-post support bay rendered through SupportBuilder
 * with simulated braces between neighboring trunks.
 */
export function BracePreview({
    settings,
    previewState,
}: BracePreviewProps) {
    const autoBracing = settings.autoBracing ?? {};
    const braceDiameter = autoBracing.braceDiameterMm ?? 1.0;
    const initialPattern: string = autoBracing.initialPattern ?? 'crossDiagonal';
    const initialDistance = autoBracing.initialDistanceMm ?? 2.0;
    const repeatingPattern: string = autoBracing.repeatingPattern ?? 'crossDiagonal';
    const patternInterval = autoBracing.patternIntervalMm ?? 8.0;
    const lateralTrellisEnabled = autoBracing.lateralTrellisEnabled ?? true;
    const maxBraceLengthMm = autoBracing.maxBraceLengthMm ?? 10.0;
    const shaftDiameterMm = Math.max(0.5, settings.shaft?.diameterMm ?? 1.0);
    const rootsDiameterMm = settings.roots?.diameterMm ?? 2.0;
    const rootsDiskHeightMm = settings.roots?.diskHeightMm ?? 0.2;
    const rootsConeHeightMm = settings.roots?.coneHeightMm ?? 0.3;
    const braceRadius = braceDiameter / 2;

    const HIGHLIGHT_COLOR = ANATOMY_CONFIG.colors.highlight;
    const DIM_COLOR = ANATOMY_CONFIG.colors.dim;
    const NORMAL_COLOR = ANATOMY_CONFIG.colors.normal;
    const focusKey = previewState.activeSettingKey;
    const isBraceFocused = focusKey?.startsWith('brace') ?? false;
    const isPatternFocused = focusKey === 'initialPattern' || focusKey === 'repeatingPattern';
    const isDiameterFocused = focusKey === 'braceDiameterMm';

    // Four trunks around a 10 mm bay so the preview can show every side link.
    const rootsTopZ = rootsDiskHeightMm + rootsConeHeightMm;

    const trunkPositions: { x: number; y: number; index: number }[] = [
        { x: -5, y: -5, index: 0 },
        { x: 5, y: -5, index: 1 },
        { x: -5, y: 5, index: 2 },
        { x: 5, y: 5, index: 3 },
    ];

    // Build trunk support data (memoised)
    const trunkSupports = React.useMemo(
        () => trunkPositions.map(({ x, y, index }) =>
            buildTrunkData(x, y, index, shaftDiameterMm, rootsDiameterMm, rootsDiskHeightMm, rootsConeHeightMm),
        ),
        [shaftDiameterMm, rootsDiameterMm, rootsDiskHeightMm, rootsConeHeightMm],
    );

    // Anatomy colour overrides for the trunks
    const trunkOverrides = React.useMemo(() => {
        if (isDiameterFocused || isBraceFocused) {
            return {
                roots: DIM_COLOR,
                rootsDisk: DIM_COLOR,
                rootsCone: DIM_COLOR,
                shaft: DIM_COLOR,
                joint: DIM_COLOR,
                tipBody: DIM_COLOR,
                tipDisk: DIM_COLOR,
            };
        }
        return undefined; // default orange
    }, [isDiameterFocused, isBraceFocused, DIM_COLOR]);

    // With the trellis on, brace all four sides of the bay; otherwise show a
    // spanning set. The actual run applies its plan-direction and clearance
    // checks after choosing these nearby pairs.
    type GridPair = { aX: number; aY: number; bX: number; bY: number; dist: number };
    const candidatePairs: GridPair[] = lateralTrellisEnabled
        ? [
            { aX: -5, aY: -5, bX: 5, bY: -5, dist: 10 },
            { aX: -5, aY: 5, bX: 5, bY: 5, dist: 10 },
            { aX: -5, aY: -5, bX: -5, bY: 5, dist: 10 },
            { aX: 5, aY: -5, bX: 5, bY: 5, dist: 10 },
        ]
        : [
            { aX: -5, aY: -5, bX: 5, bY: -5, dist: 10 },
            { aX: -5, aY: -5, bX: -5, bY: 5, dist: 10 },
            { aX: 5, aY: -5, bX: 5, bY: 5, dist: 10 },
        ];
    const bracePairs = candidatePairs.filter((pair) => pair.dist <= maxBraceLengthMm + 0.001);

    // Build brace geometry using the real auto-bracing ladder logic
    const braces: { start: THREE.Vector3; end: THREE.Vector3; section: 'initial' | 'repeating' }[] = [];

    const ladder: number[] = [rootsTopZ + initialDistance];
    let curr = rootsTopZ + initialDistance + patternInterval;
    const maxZ = PREVIEW_HEIGHT_MM - 1.0;
    while (curr <= maxZ) { ladder.push(curr); curr += patternInterval; }

    const edges = bracePairs.map((pair) => ({
        a: { x: pair.aX, y: pair.aY },
        b: { x: pair.bX, y: pair.bY },
        hDist: pair.dist,
    }));
    // Match production: the chain never climbs tighter than the hard minimum.
    const zigZagMinRise = AUTO_BRACING_HARD_RULES.minZigZagRiseMm;
    const placeAt = (
        low: { x: number; y: number },
        high: { x: number; y: number },
        section: 'initial' | 'repeating',
        atZ: number,
        minRiseMm = 0,
    ) => {
        const dist = Math.sqrt((high.x - low.x) ** 2 + (high.y - low.y) ** 2);
        // Same rise the chain actually spends, so preview links stay joined.
        const rise = Math.max(dist, minRiseMm);
        // Real auto-bracing rule: skip if the high end would go past the top joint.
        if (atZ + rise >= PREVIEW_HEIGHT_MM - 0.1) return;
        braces.push({
            start: new THREE.Vector3(low.x, low.y, atZ),
            end: new THREE.Vector3(high.x, high.y, atZ + rise),
            section,
        });
    };
    // Zigzag runs as continuous per-edge chains like production; other
    // patterns follow the fixed-interval ladder.
    if (initialPattern === 'zigZag') {
        runZigZagChain(edges, rootsTopZ + initialDistance, maxZ, 'initial', placeAt, zigZagMinRise);
    } else if (repeatingPattern === 'zigZag') {
        runZigZagChain(
            edges,
            rootsTopZ + initialDistance + patternInterval,
            maxZ,
            'repeating',
            placeAt,
            zigZagMinRise,
        );
    }
    ladder.forEach((anchorZ, tierIndex) => {
        const isInitial = tierIndex === 0;
        const pattern = isInitial ? initialPattern : repeatingPattern;
        const section: 'initial' | 'repeating' = isInitial ? 'initial' : 'repeating';
        // Zigzag tiers are covered by the chains above.
        if (pattern === 'zigZag') return;
        const placeAtTier = (
            low: { x: number; y: number },
            high: { x: number; y: number },
        ) => placeAt(low, high, section, anchorZ);
        if (isInitial) {
            applyInitialPattern(edges, pattern as AutoBracingPattern, placeAtTier);
        } else {
            applyRepeatingPattern(edges, pattern as AutoBracingPattern, placeAtTier);
        }
    });

    // Colour per section
    const getSectionColor = (s: 'initial' | 'repeating'): string => {
        if (isPatternFocused) return HIGHLIGHT_COLOR;
        if (isDiameterFocused || isBraceFocused) return s === 'initial' ? DIM_COLOR : '#666666';
        return s === 'initial' ? '#00cc66' : '#33aaff';
    };

    return (
        <group>
            <directionalLight position={[0, 0, -20]} intensity={0.6} color="#ffffff" />

            {/* Trunks rendered through SupportBuilder (same pattern as Grid) */}
            {trunkSupports.map((data) => (
                <SupportBuilder
                    key={data.id}
                    data={data}
                    isPreview={ANATOMY_CONFIG.rendering.showAsGhostPreview}
                    raftOverride={{ bottomMode: 'off', thickness: 0 }}
                    anatomyOverrides={trunkOverrides}
                />
            ))}

            {/* Braces simulated between the trunks */}
            {braces.map((brace, i) => {
                const dir = brace.end.clone().sub(brace.start);
                const length = dir.length();
                if (length < 0.001) return null;
                const mid = brace.start.clone().add(dir.clone().multiplyScalar(0.5));
                const quat = new THREE.Quaternion().setFromUnitVectors(
                    new THREE.Vector3(0, 1, 0),
                    dir.clone().normalize(),
                );
                const color = getSectionColor(brace.section);

                return (
                    <group key={`brace-${i}`}>
                        <group position={[mid.x, mid.y, mid.z]} quaternion={quat}>
                            <mesh>
                                <cylinderGeometry args={[braceRadius, braceRadius, length, 8]} />
                                <meshStandardMaterial color={color} roughness={0.5} metalness={0.1} transparent opacity={0.75} />
                            </mesh>
                        </group>
                        <mesh position={[brace.start.x, brace.start.y, brace.start.z]}>
                            <sphereGeometry args={[braceRadius * 1.8, 8, 8]} />
                            <meshStandardMaterial color={color} roughness={0.5} metalness={0.1} transparent opacity={0.75} />
                        </mesh>
                        <mesh position={[brace.end.x, brace.end.y, brace.end.z]}>
                            <sphereGeometry args={[braceRadius * 1.8, 8, 8]} />
                            <meshStandardMaterial color={color} roughness={0.5} metalness={0.1} transparent opacity={0.75} />
                        </mesh>
                    </group>
                );
            })}
        </group>
    );
}

// Registered under the panel it draws: the one the bracing tab opens.
registerAnatomyPreview(panelForTab('bracing'), BracePreview);
