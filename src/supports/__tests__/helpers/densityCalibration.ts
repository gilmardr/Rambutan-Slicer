import type { AutoSupportSettings } from '../../autoSupport/settings';

/**
 * The upstream DragonFruit density calibration these placement tests were
 * written against. Rambutan ships sparser defaults (areaPerSupportMm2 20,
 * flatDensityBoost 0.95, suctionAreaExponent 0.05, spacing floor 2.0 mm); the
 * tests below check grid, consolidation and fallback behaviour, not the shipped
 * density, so they pin the calibration their fixtures were sized for.
 */
export const DRAGONFRUIT_DENSITY_CALIBRATION: Partial<AutoSupportSettings> = {
    areaPerSupportMm2: 10,
    flatDensityBoost: 0.7,
    suctionAreaExponent: 0.15,
    gridSpacingFloorMm: 1.2,
};
