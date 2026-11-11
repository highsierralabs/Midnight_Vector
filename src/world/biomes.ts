// src/world/biomes.ts -- every look-tunable number of the world, in Biome order. T11 may retune this file.
// Terrain per biome, scenery quotas, placement bands, the sag table of section 5.7 and the keep-out constant of 5.6.
// After a retune, `npx vitest run tests/unit/world` must stay green.
import { ARCHETYPE_COUNT, ARCHETYPE_SPEC, Archetype, BIOME_COUNT } from '../contracts/index';

export interface TerrainParams { rise: number; a0: number; a1: number; gain: number }

/** Section 5.2 parameters per biome. Boulevard is 5.2's measured function. */
export const TERRAIN: readonly Readonly<TerrainParams>[] = [
  { rise: 430, a0: 135, a1: 250, gain: 0.52 },   // Boulevard
  { rise: 430, a0: 100, a1: 185, gain: 0.52 },   // Neon City, lower
  { rise: 620, a0: 85, a1: 170, gain: 0.46 },    // Crystal Desert, lower and wider
  { rise: 180, a0: 230, a1: 300, gain: 0.55 },   // Cyber Canyon, high walls
  { rise: 430, a0: 135, a1: 250, gain: 0.52 },   // Orbital Night
  { rise: 430, a0: 135, a1: 250, gain: 0.52 },   // Olympus
];

/** Expected records per chunk, by archetype then biome, in Biome order. RING has no quota: it stands on every 48th chunk. */
const QUOTA_BY_ARCHETYPE: readonly (readonly [number, number, number, number, number, number])[] = [
  [10, 0, 0, 0, 0, 0],                  // PALM
  [5, 6, 0, 0, 0, 0],                   // ARCOLOGY (T11 r05: Boulevard 3 -> 5, D2's bare left slopes)
  [0, 0, 2, 0, 1, 2],                   // PYRAMID
  [0, 0, 0, 0, 3, 2],                   // ORB
  [0, 0, 0, 0, 0, 6],                   // COLONNADE
  [3, 3, 0, 0, 0, 0],                   // BILLBOARD
  [0, 2, 0, 2, 2, 0],                   // PYLON
  [32, 24, 16, 32, 24, 16],             // REFLECTOR
  [0, 0, 8, 3, 3, 2],                   // CRYSTAL
  [0, 0, 0, 0, 2, 0],                   // SAUCER
  [0, 1 / 6, 0, 1 / 6, 0, 0],           // SEARCHLIGHT
  [0, 2, 0, 0, 0, 6],                   // TOTEM
  [0, 0, 0, 1, 1, 0],                   // DISH
  [0, 0, 0, 0, 0, 0],                   // RING
  [3, 3, 2, 3, 1, 2],                   // OBELISK (T11 r05: Boulevard 2 -> 3)
  [0, 0, 0, 0, 1, 1],                   // DOME
  [0, 0, 0, 2, 0, 0],                   // TURBINE
  [0, 0, 0, 1, 0, 0],                   // CASSETTE
  [0, 0, 8, 0, 0, 0],                   // CACTUS
  [4, 2, 2, 4, 2, 2],                   // CHEVRON (T11 r11: Crystal Desert 1 -> 2)
];

/** QUOTA[biome][archetype]. */
export const QUOTA: readonly (readonly number[])[] = Array.from({ length: BIOME_COUNT }, (_, b) =>
  QUOTA_BY_ARCHETYPE.map((row) => row[b as 0 | 1 | 2 | 3 | 4 | 5]));

export const YawMode = { UNIFORM: 0, NARROW: 1, FACING: 2, ZERO: 3 } as const;
export type YawMode = (typeof YawMode)[keyof typeof YawMode];

/** One placement band: lateral distance from the road centre, low and high, and its share of candidates. */
export type Band = readonly [lo: number, hi: number, weight: number];

/**
 * top, root: u at scale 1, read by the keep-out and sag rules. They equal ARCHETYPE_SPEC here, and a test table may change them.
 * scale, hover: min and max. bands: tall types have a near band and a far band from 1040 (sections 5.6, 5.7 rule 4).
 */
export interface Placement {
  readonly top: number; readonly root: number;
  readonly scale: readonly [number, number];
  readonly hover: readonly [number, number];
  readonly yaw: YawMode;
  readonly bands: readonly Band[];
}

function place(a: Archetype, scale: readonly [number, number], bands: readonly Band[], yaw: YawMode, hover: readonly [number, number] = [0, 0]): Placement {
  const spec = ARCHETYPE_SPEC[a]!;
  return { top: spec.top, root: spec.root, scale, hover, yaw, bands };
}

/** PLACE[archetype], in Archetype order. PYLON, REFLECTOR and RING are fixed lines: scatter writes their exact values. */
export const PLACE: readonly Placement[] = [
  place(Archetype.PALM, [0.7, 1.25], [[50, 84, 0.7], [86, 240, 0.3]], YawMode.UNIFORM),
  place(Archetype.ARCOLOGY, [0.5, 3.2], [[120, 520, 0.35], [1040, 1800, 0.65]], YawMode.NARROW),
  place(Archetype.PYRAMID, [0.5, 3.5], [[150, 500, 0.3], [1040, 1800, 0.7]], YawMode.UNIFORM),
  place(Archetype.ORB, [0.8, 2.2], [[50, 180, 1]], YawMode.UNIFORM, [3, 10]),
  place(Archetype.COLONNADE, [0.7, 1.3], [[50, 84, 0.65], [86, 320, 0.35]], YawMode.UNIFORM),
  place(Archetype.BILLBOARD, [0.7, 1.3], [[50, 84, 0.6], [86, 220, 0.4]], YawMode.FACING),
  place(Archetype.PYLON, [1, 1], [[100, 100, 1]], YawMode.ZERO),
  place(Archetype.REFLECTOR, [1, 1], [[44.5, 44.5, 1]], YawMode.ZERO),
  place(Archetype.CRYSTAL, [0.8, 4], [[50, 450, 1]], YawMode.UNIFORM, [3, 28]),
  place(Archetype.SAUCER, [1, 2.5], [[100, 1400, 1]], YawMode.UNIFORM, [40, 150]),
  place(Archetype.SEARCHLIGHT, [1, 1.5], [[90, 500, 1]], YawMode.UNIFORM),
  place(Archetype.TOTEM, [0.7, 1.3], [[50, 84, 0.65], [86, 320, 0.35]], YawMode.UNIFORM),
  place(Archetype.DISH, [0.6, 1.5], [[110, 500, 1]], YawMode.FACING),
  place(Archetype.RING, [1, 1], [[0, 0, 1]], YawMode.ZERO),
  place(Archetype.OBELISK, [0.5, 3], [[100, 520, 0.5], [1040, 1800, 0.5]], YawMode.UNIFORM),
  place(Archetype.DOME, [0.5, 1.4], [[105, 450, 1]], YawMode.UNIFORM),
  place(Archetype.TURBINE, [0.5, 2.2], [[110, 520, 0.5], [1040, 1500, 0.5]], YawMode.FACING),
  place(Archetype.CASSETTE, [0.6, 1.3], [[90, 420, 1]], YawMode.FACING),
  // T11 r11: scale .7 to 1.4 -> .9 to 1.8, and CHEVRON 1 -> 2 in Crystal Desert, so its floor beside the road is not bare (M9 review, J3).
  place(Archetype.CACTUS, [0.9, 1.8], [[50, 84, 0.5], [86, 320, 0.5]], YawMode.UNIFORM),
  place(Archetype.CHEVRON, [1, 1], [[46, 49, 1]], YawMode.FACING),
];

if (PLACE.length !== ARCHETYPE_COUNT || QUOTA_BY_ARCHETYPE.length !== ARCHETYPE_COUNT) {
  throw new Error('biomes.ts: one row per archetype');
}

/** Terrain class of a biome for the sag table: Boulevard, Orbital and Olympus share a height function. */
export const SAG_CLASS: readonly number[] = [0, 1, 2, 3, 0, 0];

/** SAG[class][log2(s) - 2][band]: absolute p95 of true height minus the coarse surface. Bands: 85-200, 200-500, 500-1400, above. */
export type SagTable = readonly (readonly (readonly number[])[])[];
export const SAG: SagTable = [
  [ // Boulevard, Orbital Night, Olympus
    [0.04, 0.39, 1.2, 1.6], [0.12, 1.1, 3.1, 3.8], [0.31, 2.6, 7.7, 9.2],
    [0.74, 5.7, 16, 19.5], [1.7, 11.3, 31, 37.5], [5.2, 20, 53, 65],
  ],
  [ // Neon City
    [0.03, 0.29, 0.87, 1.15], [0.09, 0.79, 2.3, 2.8], [0.23, 1.95, 5.7, 6.8],
    [0.55, 4.2, 11.7, 14.4], [1.25, 8.4, 22.5, 27.8], [3.9, 14.7, 39, 48],
  ],
  [ // Crystal Desert
    [0.01, 0.12, 0.57, 0.77], [0.03, 0.33, 1.56, 1.92], [0.08, 0.86, 3.94, 4.77],
    [0.21, 2.05, 8.6, 10.6], [0.53, 4.42, 18.3, 22.7], [1.9, 8.7, 33.8, 42.2],
  ],
  [ // Cyber Canyon
    [0.34, 1.09, 1.93, 2.45], [1, 2.72, 5.03, 6], [2.47, 6.39, 12.1, 14.2],
    [5.29, 13, 24.5, 29.4], [10.8, 25.1, 45, 54.1], [21.2, 41.5, 75.7, 90.9],
  ],
];

/** Section 5.6. K is the gnomonic height the keep-out allows at the cone's edge C. T11 may raise K toward the terrain's .067. */
export const KEEPOUT_K = 0.05;
export const KEEPOUT_C = 0.24;
