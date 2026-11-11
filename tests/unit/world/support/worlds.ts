// World builders for tests: the real composition with a swappable scatter table, and rows sorted by biome.
import { ZONE_CHUNKS, type WorldSource } from '../../../../src/contracts/index';
import { KEEPOUT_K, PLACE, QUOTA, SAG, TERRAIN } from '../../../../src/world/biomes';
import { HeightReg, createHeight, type Height, type HeightCore, type HeightFn, type TerrainParams } from '../../../../src/world/height';
import { createItems } from '../../../../src/world/items';
import { createNoise } from '../../../../src/world/noise';
import { createScatter, type ScatterTable } from '../../../../src/world/scatter';
import { SALT_BIOME, createZones, type Zones } from '../../../../src/world/zones';

export const REAL_TABLE: ScatterTable = { quota: QUOTA, place: PLACE, sag: SAG, keepoutK: KEEPOUT_K };

export interface ComposedWorld extends WorldSource {
  readonly zones: Zones;
  readonly core: Height;
}

/** The composition of createWorld, with a test table in place of the real one. */
export function composeWorld(seed: number, periodChunks: number, table: Readonly<ScatterTable> = REAL_TABLE, terrain: readonly Readonly<TerrainParams>[] = TERRAIN): ComposedWorld {
  const noise = createNoise(seed, periodChunks);
  const zones = createZones(seed, periodChunks);
  const core = createHeight(noise, zones, periodChunks, terrain);
  return {
    seed,
    zones,
    core,
    height: core.at,
    fillProps: createScatter(seed, periodChunks, table, core, zones),
    fillItems: createItems(seed, periodChunks, zones),
    zoneAt: zones.zoneAt,
    bendAt: zones.bendAt,
  };
}

/** A HeightCore over any height function, for tests of the coarse surface on fixed params. */
export function coreOf(h: HeightFn): HeightCore {
  const regs = new Float64Array(5);
  return {
    regs,
    run() {
      regs[HeightReg.OUT] = h(regs[HeightReg.X]!, regs[HeightReg.IZ]!, regs[HeightReg.ZS]!, regs[HeightReg.Z_LOCAL]!);
    },
  };
}

/** The first count zones with this biome as their A value. */
export function zonesOfBiome(zones: Zones, biome: number, count: number, from = 0): number[] {
  const out: number[] = [];
  for (let z = from; out.length < count; z++) {
    if (zones.entry(z, SALT_BIOME, 6) === biome) out.push(z);
  }
  return out;
}

/** Enough zones of a biome to hold count pure rows, its first 75 chunks each. */
export function pureChunks(zones: Zones, biome: number, count: number, from = 0): number[] {
  const out: number[] = [];
  const list = zonesOfBiome(zones, biome, Math.ceil(count / 75) + 1, from);
  for (const z of list) {
    for (let i = 0; i < 75 && out.length < count; i++) out.push(z * ZONE_CHUNKS + i);
  }
  return out;
}

/** The first zone of biome a followed by biome b, or throws. It fades from a to b over its last 25 chunks. */
export function fadeZone(zones: Zones, a: number, b: number, from = 0): number {
  for (let z = from; z < from + 100000; z++) {
    if (zones.entry(z, SALT_BIOME, 6) === a && zones.entry(z + 1, SALT_BIOME, 6) === b) return z;
  }
  throw new Error(`no fade from biome ${a} to ${b}`);
}

/** A copy of the real table with one change to its quotas, placements or sag, for negative controls. */
export function scaledQuotas(factor: number): ScatterTable {
  return { ...REAL_TABLE, quota: QUOTA.map((row) => row.map((q, a) => (a === 6 || a === 7 ? q : q * factor))) };
}
