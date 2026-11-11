// The 36 palette and biome pairs, their samples, the 30 ordered palette transitions and the day-phase samples, all
// computed in Node from the real world (plan M1, "Samples"). Fixed by rule in advance, so nobody picks flattering frames.
import { ARCHETYPE_COUNT, Archetype, BIOME_COUNT, CHUNK_LEN, DAY_CHUNKS, MAX_PROPS_PER_CHUNK, PALETTE_COUNT, PALETTE_FLOATS, PROP_STRIDE, PropField, ZONE_CHUNKS, type PropRow, type ZoneState } from '../../../src/contracts/index';
import { createWorld } from '../../../src/world/index';
import { findZoneChunk } from '../../../src/world/zones';

/** One state in a real zone (plan section 4). into is the chunk's position in its zone, 0 to 99. */
export interface Sample { chunk: number; local: number; tick: number; palette: number; biome: number; into: number }
export interface NamedSample extends Sample { id: string; kind: 'pair' | 'day' | 'mid'; dayPhase: number }

export interface Pair { palette: number; biome: number; z0: number; samples: NamedSample[]; tile: NamedSample }
export interface Transition { a: number; b: number; zone: number; biomeA: number; biomeB: number; heroA: number; heroB: number; mid: NamedSample }
export interface Combos { seed: number; pairs: Pair[]; samples: NamedSample[]; day: NamedSample[]; transitions: Transition[]; allPairsByZone: number }

export const INTO = [8, 23, 38, 53, 68] as const;
export const TILE_INTO = 38;
export const SAMPLE_LOCAL = 20;
export const MID_INTO = 87;
export const MID_LOCAL = 32;

/** Cruise timing: 1.5 ticks per u, and 320 chunks is the slowest phase period, 30720 ticks (plan section 4). */
export function tickFor(chunk: number, local: number): number {
  return Math.round(((chunk % 320) * 64 + local) * 1.5);
}

export function newZone(): ZoneState {
  return {
    index: 0, biomeA: 0, biomeB: 0, biomeMix: 0, paletteA: 0, paletteB: 0, paletteMix: 0,
    palette: new Float32Array(PALETTE_FLOATS), heroA: 0, heroB: 0, heroMix: 0,
    objective: 0, objectiveTarget: 0, musicKey: 0, dayPhase: 0,
  };
}

export function newPropRow(): PropRow {
  return { chunk: 0, data: new Float32Array(PROP_STRIDE * MAX_PROPS_PER_CHUNK), start: new Uint16Array(ARCHETYPE_COUNT + 1) };
}

/** A RING lies 0 to 8 chunks ahead when chunk % 48 is 0 or at least 40. */
export function ringAhead(chunk: number): boolean {
  const r = chunk % 48;
  return r === 0 || r >= 40;
}

/** The plan's rule: add 9 chunks, or subtract 9 if adding would pass into 74. */
export function avoidRing(z0: number, into: number): number {
  let i = into;
  if (ringAhead(z0 + i)) i = i + 9 > 74 ? i - 9 : i + 9;
  return i;
}

function dayPhaseOf(chunk: number, local: number): number {
  return (((chunk % DAY_CHUNKS) + DAY_CHUNKS) % DAY_CHUNKS + local / CHUNK_LEN) / DAY_CHUNKS;
}

export function buildCombos(seed: number): Combos {
  const world = createWorld({ seed, periodChunks: 0 });
  const z = newZone();
  const pairs: Pair[] = [];
  const samples: NamedSample[] = [];
  let allPairsByZone = 0;
  for (let p = 0; p < PALETTE_COUNT; p++) {
    for (let b = 0; b < BIOME_COUNT; b++) {
      const z0 = findZoneChunk(seed, p, b);
      if (z0 < 0) throw new Error(`no zone for palette ${p} biome ${b} at seed ${seed}`);
      allPairsByZone = Math.max(allPairsByZone, z0 / ZONE_CHUNKS);
      const list: NamedSample[] = [];
      for (const base of INTO) {
        const into = avoidRing(z0, base);
        const chunk = z0 + into;
        world.zoneAt({ chunk, local: SAMPLE_LOCAL }, z);
        if (z.paletteA !== p || z.biomeA !== b || z.paletteMix !== 0) {
          throw new Error(`Node zoneAt at ${chunk} gives palette ${z.paletteA} biome ${z.biomeA} mix ${z.paletteMix}, wanted ${p} ${b} 0`);
        }
        list.push({ id: `p${p}b${b}i${into}`, kind: 'pair', chunk, local: SAMPLE_LOCAL, tick: tickFor(chunk, SAMPLE_LOCAL), palette: p, biome: b, into, dayPhase: z.dayPhase });
      }
      const tile = list[INTO.indexOf(TILE_INTO)]!;
      pairs.push({ palette: p, biome: b, z0, samples: list, tile });
      samples.push(...list);
    }
  }

  // Day phase: per palette, the sample nearest dayPhase 0 and nearest .5, from that palette's zones, mix 0.
  const day: NamedSample[] = [];
  for (let p = 0; p < PALETTE_COUNT; p++) {
    for (const target of [0, 0.5]) {
      let best: NamedSample | null = null;
      let bestD = Infinity;
      for (let zone = 0; zone < 1500; zone++) {
        const c0 = zone * ZONE_CHUNKS;
        world.zoneAt({ chunk: c0 + 40, local: 0 }, z);
        if (z.paletteA !== p) continue;
        for (let into = 8; into <= 74; into++) {
          const chunk = c0 + into;
          if (ringAhead(chunk)) continue;
          const ph = dayPhaseOf(chunk, SAMPLE_LOCAL);
          const d = Math.min(Math.abs(ph - target), 1 - Math.abs(ph - target));
          if (d < bestD) {
            world.zoneAt({ chunk, local: SAMPLE_LOCAL }, z);
            bestD = d;
            best = { id: `day${target === 0 ? 'Night' : 'Noon'}p${p}`, kind: 'day', chunk, local: SAMPLE_LOCAL, tick: tickFor(chunk, SAMPLE_LOCAL), palette: p, biome: z.biomeA, into, dayPhase: z.dayPhase };
          }
        }
        if (bestD < 0.002) break;
      }
      if (!best) throw new Error(`no day sample for palette ${p}`);
      day.push(best);
    }
  }

  // Transitions: first zone with palette a followed by palette b. The m = .5 frame is into 87, local 32.
  const transitions: Transition[] = [];
  for (let a = 0; a < PALETTE_COUNT; a++) {
    for (let b = 0; b < PALETTE_COUNT; b++) {
      if (a === b) continue;
      let found: Transition | null = null;
      for (let zone = 0; zone < 4096 && !found; zone++) {
        const chunk = zone * ZONE_CHUNKS + MID_INTO;
        world.zoneAt({ chunk, local: MID_LOCAL }, z);
        if (z.paletteA !== a || z.paletteB !== b) continue;
        found = {
          a, b, zone, biomeA: z.biomeA, biomeB: z.biomeB, heroA: z.heroA, heroB: z.heroB,
          mid: { id: `mid${a}to${b}`, kind: 'mid', chunk, local: MID_LOCAL, tick: tickFor(chunk, MID_LOCAL), palette: a, biome: z.biomeA, into: MID_INTO, dayPhase: z.dayPhase },
        };
      }
      if (!found) throw new Error(`no transition ${a} to ${b} at seed ${seed}`);
      transitions.push(found);
    }
  }
  return { seed, pairs, samples, day, transitions, allPairsByZone };
}

/** Zone facts at one state, from Node's world. */
export function zoneAtNode(seed: number, chunk: number, local: number): ZoneState {
  return createWorld({ seed, periodChunks: 0 }).zoneAt({ chunk, local }, newZone());
}

/** The first RING record at or after chunk `from` in rows that stay inside zone (chunk / 100), as row chunk and zLocal. */
export function findRing(seed: number, from: number, untilInto = 74): { chunk: number; zLocal: number } | null {
  const world = createWorld({ seed, periodChunks: 0 });
  const row = newPropRow();
  const zone = Math.floor(from / ZONE_CHUNKS);
  for (let c = from; c <= zone * ZONE_CHUNKS + untilInto; c++) {
    if (c % 48 !== 0) continue;
    world.fillProps(c, row);
    const s = row.start[Archetype.RING]!, e = row.start[Archetype.RING + 1]!;
    if (e > s) return { chunk: c, zLocal: row.data[s * PROP_STRIDE + PropField.Z_LOCAL]! };
  }
  return null;
}

/** The opening: zones 0 to n - 1 at this seed, as Node's world sees them. */
export function opening(seed: number, n: number): { zone: number; palette: number; biome: number; hero: number; dayPhase: number }[] {
  const world = createWorld({ seed, periodChunks: 0 });
  const z = newZone();
  const out: { zone: number; palette: number; biome: number; hero: number; dayPhase: number }[] = [];
  for (let k = 0; k < n; k++) {
    world.zoneAt({ chunk: k * ZONE_CHUNKS + 10, local: 0 }, z);
    out.push({ zone: k, palette: z.paletteA, biome: z.biomeA, hero: z.heroA, dayPhase: z.dayPhase });
  }
  return out;
}
