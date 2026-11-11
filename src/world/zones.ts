// src/world/zones.ts -- section 5.3 bend and 5.4 zones. Hashed permutations per block, with a repair at block edges
// that reads only raw permutations, so it stays a pure function of the zone number.
import {
  BIOME_COUNT, CHUNK_LEN, DAY_CHUNKS, Objective, PALETTE_COUNT, ZONE_CHUNKS, ZONE_FADE_CHUNKS,
  type BendState, type HeroMode, type Travel, type ZoneState,
} from '../contracts/index';
import { travelMod } from '../core/coords';
import { drawInto } from './draws';
import { mixPaletteAt } from './palettes';

export const SALT_BIOME = 0x5A01;
export const SALT_PALETTE = 0x5A02;
export const SALT_HERO = 0x5A03;
export const SALT_OBJECTIVE = 0x5A04;
const HERO_MODES: readonly HeroMode[] = [0, 1, 2, 3];
const OBJECTIVES: readonly Objective[] = [Objective.GATES, Objective.CHAIN, Objective.GRAZES, Objective.NO_HIT, Objective.BOOST];
const HERO_COUNT = HERO_MODES.length;
const OBJECTIVE_COUNT = OBJECTIVES.length;

const TAU = 2 * Math.PI;
const BEND_A = 8e-5;
const BEND_C = -1.2e-5;
const BEND_VMAX = 1500;
const BEND_PERIOD_SHORT = 16384;
const BEND_PERIOD_LONG = 65536;
/** Zone number from which difficulty stops rising (section 5.4). */
export const DIFFICULTY_CAP_ZONE = 12;

export function smooth(x: number): number {
  const t = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

export function floorMod(a: number, m: number): number {
  return ((a % m) + m) % m;
}

/** Scratch for one entry: the zone, the block being permuted, and n - 1 draws. Addressed by entryAt. */
const ENTRY_REGS = 8;
const ER_Z = 0;
const ER_BLOCK = 1;
const ER_DRAWS = 2;

const draw = drawInto;

function permInto(scratch: Uint8Array, regs: Float64Array, seed: number, salt: number, n: number): void {
  draw(seed, regs, ER_BLOCK, salt, 1, regs, ER_DRAWS, n - 1);
  for (let i = 0; i < n; i++) scratch[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(regs[ER_DRAWS + i - 1]! * (i + 1));
    const t = scratch[i]!;
    scratch[i] = scratch[j]!;
    scratch[j] = t;
  }
}

/** The value of the zone in regs[ER_Z], in the permutation sequence of salt, n entries. Pure. */
function entryAt(scratch: Uint8Array, regs: Float64Array, seed: number, salt: number, n: number): number {
  const z = regs[ER_Z]!;
  const block = Math.floor(z / n);
  const i = z - block * n;
  regs[ER_BLOCK] = block - 1;
  permInto(scratch, regs, seed, salt, n);
  const prevLast = scratch[n - 1]!;
  regs[ER_BLOCK] = block;
  permInto(scratch, regs, seed, salt, n);
  if (scratch[0] === prevLast) {
    const t = scratch[0]!;
    scratch[0] = scratch[1]!;
    scratch[1] = t;
  }
  return scratch[i]!;
}

export interface Zones {
  /** Value of zone z in the permutation sequence of salt, n entries. z may be negative. Pure. */
  entry(z: number, salt: number, n: number): number;
  /** Writes the two biomes of the zone in io[0] to io[1] and io[2], so a far z crosses no call as a double. */
  biomePair(io: Float64Array): void;
  zoneAt(at: Readonly<Travel>, out: ZoneState): ZoneState;
  bendAt(at: Readonly<Travel>, out: BendState): BendState;
}

export function createZones(seed: number, periodChunks: number): Zones {
  const scratch = new Uint8Array(BIOME_COUNT);
  const regs = new Float64Array(ENTRY_REGS);
  const reduced: Travel = { chunk: 0, local: 0 };
  const mix = new Float64Array(1);

  function entry(z: number, salt: number, n: number): number {
    regs[ER_Z] = z;
    return entryAt(scratch, regs, seed, salt, n);
  }

  function biomePair(io: Float64Array): void {
    const z = io[0]!;
    regs[ER_Z] = z;
    io[1] = entryAt(scratch, regs, seed, SALT_BIOME, BIOME_COUNT);
    regs[ER_Z] = z + 1;
    io[2] = entryAt(scratch, regs, seed, SALT_BIOME, BIOME_COUNT);
  }

  function zoneAt(at: Readonly<Travel>, out: ZoneState): ZoneState {
    const c = periodChunks > 0 ? floorMod(at.chunk, periodChunks) : at.chunk;
    const z = Math.floor(c / ZONE_CHUNKS);
    const into = c - z * ZONE_CHUNKS + at.local / CHUNK_LEN;
    const m = smooth((into - (ZONE_CHUNKS - ZONE_FADE_CHUNKS)) / ZONE_FADE_CHUNKS);
    regs[ER_Z] = z;
    const paletteA = entryAt(scratch, regs, seed, SALT_PALETTE, PALETTE_COUNT);
    const biomeA = entryAt(scratch, regs, seed, SALT_BIOME, BIOME_COUNT);
    const heroA = HERO_MODES[entryAt(scratch, regs, seed, SALT_HERO, HERO_COUNT)]!;
    const objective = OBJECTIVES[entryAt(scratch, regs, seed, SALT_OBJECTIVE, OBJECTIVE_COUNT)]!;
    regs[ER_Z] = z + 1;
    const paletteB = entryAt(scratch, regs, seed, SALT_PALETTE, PALETTE_COUNT);
    const biomeB = entryAt(scratch, regs, seed, SALT_BIOME, BIOME_COUNT);
    const heroB = HERO_MODES[entryAt(scratch, regs, seed, SALT_HERO, HERO_COUNT)]!;
    mix[0] = m;
    mixPaletteAt(paletteA, paletteB, mix, out.palette);
    out.index = z;
    out.biomeA = biomeA;
    out.biomeB = biomeB;
    out.biomeMix = m;
    out.paletteA = paletteA;
    out.paletteB = paletteB;
    out.paletteMix = m;
    out.heroA = heroA;
    out.heroB = heroB;
    out.heroMix = m;
    const d = z <= 0 ? 0 : z >= DIFFICULTY_CAP_ZONE ? DIFFICULTY_CAP_ZONE : z;
    out.objective = objective;
    out.objectiveTarget = objective === Objective.GATES ? 12 + d
      : objective === Objective.CHAIN ? 24 + 3 * d
        : objective === Objective.GRAZES ? 6 + d
          : objective === Objective.NO_HIT ? 1600 + 200 * d
            : 800 + 100 * d;
    out.musicKey = floorMod(z * 7, 12);
    out.dayPhase = (floorMod(c, DAY_CHUNKS) + at.local / CHUNK_LEN) / DAY_CHUNKS;
    return out;
  }

  function bendAt(at: Readonly<Travel>, out: BendState): BendState {
    reduced.chunk = periodChunks > 0 ? floorMod(at.chunk, periodChunks) : at.chunk;
    reduced.local = at.local;
    const s0 = Math.sin(TAU * travelMod(reduced, BEND_PERIOD_SHORT) / BEND_PERIOD_SHORT);
    const s1 = Math.sin(TAU * travelMod(reduced, BEND_PERIOD_LONG) / BEND_PERIOD_LONG);
    out.a = BEND_A * (0.7 * s0 + 0.3 * s1);
    out.c = BEND_C;
    out.vMax = BEND_VMAX;
    return out;
  }

  return { entry, biomePair, zoneAt, bendAt };
}

const findScratch = new Uint8Array(BIOME_COUNT);
const findRegs = new Float64Array(ENTRY_REGS);

/** First chunk of the lowest zone with this palette and biome as its A values, or -1 if none in 4096 zones. Pure, allocates nothing, not for per-frame use. */
export function findZoneChunk(seed: number, palette: number, biome: number): number {
  for (let z = 0; z < 4096; z++) {
    findRegs[ER_Z] = z;
    if (entryAt(findScratch, findRegs, seed, SALT_BIOME, BIOME_COUNT) === biome
      && entryAt(findScratch, findRegs, seed, SALT_PALETTE, PALETTE_COUNT) === palette) {
      return z * ZONE_CHUNKS;
    }
  }
  return -1;
}
