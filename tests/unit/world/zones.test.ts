import { describe, expect, it } from 'vitest';
import { BIOME_COUNT, Objective, PALETTE_COUNT, PALETTE_FLOATS, type BendState } from '../../../src/contracts/index';
import { hash01 } from '../../../src/core/hash';
import { SALT_BIOME, SALT_HERO, SALT_OBJECTIVE, SALT_PALETTE, createZones, findZoneChunk } from '../../../src/world/zones';
import { newZoneState } from './support/rows';

const SEED = 1985;
const zones = createZones(SEED, 0);
const CASES: readonly (readonly [number, number])[] = [
  [SALT_BIOME, 6], [SALT_PALETTE, 6], [SALT_HERO, 4], [SALT_OBJECTIVE, 5],
];

function adjacentRepeats(entry: (z: number, salt: number, n: number) => number, from: number, count: number): number {
  let repeats = 0;
  for (const [salt, n] of CASES) {
    let prev = entry(from, salt, n);
    for (let z = from + 1; z < from + count; z++) {
      const v = entry(z, salt, n);
      if (v === prev) repeats++;
      prev = v;
    }
  }
  return repeats;
}

/** A copy of entry with the block-edge repair bypassed, so the detector has something to find. */
function unrepaired(z: number, salt: number, n: number): number {
  const scratch = new Uint8Array(6);
  const block = Math.floor(z / n);
  for (let i = 0; i < n; i++) scratch[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(hash01(SEED, block, salt, i) * (i + 1));
    const t = scratch[i]!;
    scratch[i] = scratch[j]!;
    scratch[j] = t;
  }
  return scratch[z - block * n]!;
}

describe('zones', () => {
  it('zones never repeat', () => {
    expect(adjacentRepeats(zones.entry, 0, 100_000)).toBe(0);
    expect(adjacentRepeats(zones.entry, 2 ** 40, 100_000)).toBe(0);
    expect(adjacentRepeats(zones.entry, -1000, 2000)).toBe(0);
  });

  it('negative control: without the repair the detector finds repeats', () => {
    expect(adjacentRepeats(unrepaired, 0, 100_000)).toBeGreaterThan(1000);
  });

  it('every entry is in range, and biome counts stay uniform within 1 per block of six', () => {
    const counts = new Int32Array(BIOME_COUNT);
    for (let z = 0; z < 6000; z++) {
      const b = zones.entry(z, SALT_BIOME, 6);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(6);
      counts[b] = counts[b]! + 1;
    }
    for (const c of counts) expect(c).toBe(1000);
  });

  it('all 36 palette and biome pairs appear within 600 zones', () => {
    const seen = new Set<number>();
    for (let z = 0; z < 600; z++) {
      seen.add(zones.entry(z, SALT_BIOME, 6) * 10 + zones.entry(z, SALT_PALETTE, 6));
    }
    expect(seen.size).toBe(36);
  });

  it('crossfade timing: mix 0 at into 75, between 0 and 1 at 87.5, and the next zone starts on B', () => {
    const z = newZoneState();
    for (let index = 0; index < 60; index++) {
      const base = index * 100;
      zones.zoneAt({ chunk: base, local: 0 }, z);
      expect(z.index).toBe(index);
      expect(z.biomeMix).toBe(0);
      zones.zoneAt({ chunk: base + 75, local: 0 }, z);
      expect(z.biomeMix).toBe(0);
      expect(z.paletteMix).toBe(0);
      expect(z.heroMix).toBe(0);
      zones.zoneAt({ chunk: base + 87, local: 32 }, z);
      expect(z.biomeMix).toBeGreaterThan(0);
      expect(z.biomeMix).toBeLessThan(1);
      const { biomeB, paletteB, heroB } = z;
      const objectiveNext = zones.entry(index + 1, SALT_OBJECTIVE, 5);
      zones.zoneAt({ chunk: base + 99, local: 63.999 }, z);
      expect(z.biomeMix).toBeGreaterThan(0.999);
      expect(z.biomeMix).toBeLessThan(1);
      zones.zoneAt({ chunk: base + 100, local: 0 }, z);
      expect(z.biomeA).toBe(biomeB);
      expect(z.paletteA).toBe(paletteB);
      expect(z.heroA).toBe(heroB);
      expect(z.objective).toBe(objectiveNext);
      expect(z.biomeMix).toBe(0);
    }
  });

  it('palette is continuous across a zone edge, within 1e-3', () => {
    const a = newZoneState();
    const b = newZoneState();
    for (let index = 0; index < 200; index++) {
      zones.zoneAt({ chunk: index * 100 + 99, local: 64 - 1e-6 }, a);
      zones.zoneAt({ chunk: index * 100 + 100, local: 0 }, b);
      for (let i = 0; i < PALETTE_FLOATS; i++) {
        expect(Math.abs(a.palette[i]! - b.palette[i]!)).toBeLessThan(1e-3);
      }
    }
  });

  it('palette is continuous through the fade: no step over .02 in a linear channel per 1/64 of a chunk', () => {
    const a = newZoneState();
    const b = newZoneState();
    let worst = 0;
    for (let index = 0; index < 30; index++) {
      for (let k = 0; k < 25 * 8; k++) {
        const into = 75 + k / 8;
        const chunk = index * 100 + Math.floor(into);
        const local = (into - Math.floor(into)) * 64;
        zones.zoneAt({ chunk, local }, a);
        zones.zoneAt({ chunk, local: local + 1 }, b);
        for (let i = 0; i < PALETTE_FLOATS; i++) worst = Math.max(worst, Math.abs(a.palette[i]! - b.palette[i]!));
      }
    }
    expect(worst).toBeLessThan(0.02);
  });

  it('dayPhase is a sawtooth in [0, 1) over 750 chunks', () => {
    const z = newZoneState();
    zones.zoneAt({ chunk: 0, local: 0 }, z);
    expect(z.dayPhase).toBe(0);
    zones.zoneAt({ chunk: 749, local: 63.99999 }, z);
    expect(z.dayPhase).toBeLessThan(1);
    expect(z.dayPhase).toBeGreaterThan(0.9999);
    zones.zoneAt({ chunk: 750, local: 0 }, z);
    expect(z.dayPhase).toBe(0);
    zones.zoneAt({ chunk: 375, local: 0 }, z);
    expect(z.dayPhase).toBe(0.5);
    zones.zoneAt({ chunk: 2 ** 47 + 375, local: 32 }, z);
    expect(z.dayPhase).toBeGreaterThanOrEqual(0);
    expect(z.dayPhase).toBeLessThan(1);
  });

  it('objectiveTarget follows the table, and each is feasible in one zone', () => {
    const z = newZoneState();
    for (let index = 0; index < 400; index++) {
      zones.zoneAt({ chunk: index * 100, local: 0 }, z);
      const d = Math.min(index, 12);
      const want = z.objective === Objective.GATES ? 12 + d
        : z.objective === Objective.CHAIN ? 24 + 3 * d
          : z.objective === Objective.GRAZES ? 6 + d
            : z.objective === Objective.NO_HIT ? 1600 + 200 * d
              : 800 + 100 * d;
      expect(z.objectiveTarget).toBe(want);
      expect(Number.isInteger(z.objectiveTarget)).toBe(true);
      if (z.objective === Objective.GATES) expect(z.objectiveTarget).toBeLessThanOrEqual(33);
      if (z.objective === Objective.NO_HIT) expect(z.objectiveTarget).toBeLessThanOrEqual(6400);
    }
  });

  it('musicKey is a circle-of-fifths walk in [0, 12)', () => {
    const z = newZoneState();
    for (let index = 0; index < 48; index++) {
      zones.zoneAt({ chunk: index * 100, local: 0 }, z);
      expect(z.musicKey).toBe((index * 7) % 12);
    }
  });

  it('negative chunks are valid and in range', () => {
    const z = newZoneState();
    for (const chunk of [-1, -48, -100, -101, -750, -751]) {
      zones.zoneAt({ chunk, local: 3 }, z);
      expect(z.dayPhase).toBeGreaterThanOrEqual(0);
      expect(z.dayPhase).toBeLessThan(1);
      expect(z.musicKey).toBeGreaterThanOrEqual(0);
      expect(z.musicKey).toBeLessThan(12);
      expect(z.objectiveTarget).toBeGreaterThan(0);
    }
  });

  it('bend stays inside its bound, and uses the constants of section 5.3', () => {
    const b: BendState = { a: 0, c: 0, vMax: 1 };
    let hi = 0;
    for (let k = 0; k < 20000; k++) {
      const chunk = k * 7;
      zones.bendAt({ chunk, local: (k % 64) }, b);
      expect(Math.abs(b.a)).toBeLessThanOrEqual(8e-5);
      expect(b.c).toBe(-1.2e-5);
      expect(b.vMax).toBe(1500);
      hi = Math.max(hi, Math.abs(b.a));
    }
    expect(hi).toBeGreaterThan(4e-5);
    zones.bendAt({ chunk: 2 ** 47, local: 7.5 }, b);
    expect(Number.isFinite(b.a)).toBe(true);
    expect(Math.abs(b.a)).toBeLessThanOrEqual(8e-5);
  });

  it('findZoneChunk returns a chunk whose zone has those A values, and -1 for an impossible pair', () => {
    const z = newZoneState();
    for (let palette = 0; palette < PALETTE_COUNT; palette++) {
      for (let biome = 0; biome < BIOME_COUNT; biome++) {
        const chunk = findZoneChunk(SEED, palette, biome);
        expect(chunk).toBeGreaterThanOrEqual(0);
        expect(chunk % 100).toBe(0);
        zones.zoneAt({ chunk, local: 0 }, z);
        expect(z.paletteA).toBe(palette);
        expect(z.biomeA).toBe(biome);
      }
    }
    expect(findZoneChunk(SEED, 99, 0)).toBe(-1);
  });
});
