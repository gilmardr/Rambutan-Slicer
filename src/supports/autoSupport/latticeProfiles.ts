import type { RaftSettings } from '../Rafts/Crenelated/RaftTypes';

type LatticeProfile = {
    name: string;
    anchorSpacingMm: number;
    overhangAngleDeg: number;
    tip: { contactDiameterMm: number; sphereDiameterMm?: number; bodyDiameterMm: number; penetrationMm: number };
    brace: { widthMm: number; spanMm: number; angleDeg: number };
    raft: Pick<RaftSettings, 'thickness' | 'baseReliefPattern' | 'baseReliefHoleDiameterMm' | 'baseReliefPitchMm'>;
};

export const latticeProfiles: Readonly<Record<string, LatticeProfile>> = {
    'sculpture-lattice': {
        name: 'Sculpture Lattice',
        anchorSpacingMm: 2.5,
        overhangAngleDeg: 45,
        tip: { contactDiameterMm: 0.4, bodyDiameterMm: 0.8, penetrationMm: 0.3 },
        brace: { widthMm: 0.9, spanMm: 9, angleDeg: 45 },
        raft: { thickness: 0.4, baseReliefPattern: 'staggered-round', baseReliefHoleDiameterMm: 2, baseReliefPitchMm: 3 },
    },
    'fine-lattice': {
        name: 'Fine Lattice',
        anchorSpacingMm: 2,
        overhangAngleDeg: 50,
        tip: { contactDiameterMm: 0.32, sphereDiameterMm: 0.35, bodyDiameterMm: 0.6, penetrationMm: 0.1 },
        brace: { widthMm: 0.8, spanMm: 7, angleDeg: 60 },
        raft: { thickness: 0.5, baseReliefPattern: 'staggered-round', baseReliefHoleDiameterMm: 2, baseReliefPitchMm: 3 },
    },
};

export function getLatticeProfile(id: string | null | undefined): LatticeProfile | undefined {
    return id && Object.hasOwn(latticeProfiles, id) ? latticeProfiles[id] : undefined;
}
