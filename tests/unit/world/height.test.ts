import { describe, expect, it } from 'vitest';
import { BIOME_COUNT, Biome, CHUNK_LEN, CHUNK_LIMIT } from '../../../src/contracts/index';
import { TERRAIN } from '../../../src/world/biomes';
import { createHeight, heightWith, type HeightFn, type TerrainParams } from '../../../src/world/height';
import { createNoise } from '../../../src/world/noise';
import { SALT_BIOME, createZones, smooth } from '../../../src/world/zones';
import { percentile } from './support/metrics';

const SEED = 1985;
const noise = createNoise(SEED, 0);
const zones = createZones(SEED, 0);
const real = createHeight(noise, zones, 0).at;
const BLVD = TERRAIN[Biome.BOULEVARD]!;

function fract(x: number): number {
  return x - Math.floor(x);
}

/** A sample column at abs(x) = d: alternating sides, jittered in x by under .5 u, spread over many chunks. */
function columnSamples(h: HeightFn, d: number, N: number, baseChunk = 0, sign = 1): Float64Array {
  const out = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const chunk = baseChunk + i * 37;
    const zLocal = fract(i * 0.61803398875) * 64;
    const x = sign * (i & 1 ? -1 : 1) * (d + fract(i * 0.754877666) * 0.5);
    out[i] = h(x, chunk, 64, zLocal);
  }
  return out;
}

function firstZone(biome: number, from = 0): number {
  for (let z = from; ; z++) if (zones.entry(z, SALT_BIOME, 6) === biome) return z;
}

/** A zone of biome a followed by biome b, which fades from a to b over its last 25 chunks. */
function fadeZone(a: number, b: number, from = 0): number {
  for (let z = from; ; z++) {
    if (zones.entry(z, SALT_BIOME, 6) === a && zones.entry(z + 1, SALT_BIOME, 6) === b) return z;
  }
}

/** Mean of abs(h(row + 1) - h(row)) on rows that cross a chunk edge, against other rows, across a fade. */
function chunkEdgeRatio(h: HeightFn, zone: number): { edge: number; other: number; worst: number } {
  const ROWS_PER_CHUNK = 32;
  const start = (zone * 100 + 75) * ROWS_PER_CHUNK;
  const end = (zone * 100 + 100) * ROWS_PER_CHUNK;
  let edge = 0;
  let edgeN = 0;
  let other = 0;
  let otherN = 0;
  let worst = 0;
  const COLS = 96;
  const prev = new Float64Array(COLS);
  const curr = new Float64Array(COLS);
  for (let iz = start; iz < end; iz++) {
    let sum = 0;
    for (let c = 0; c < COLS; c++) {
      const x = 96 + c * 32;
      curr[c] = h(x, iz, 2, 0);
      if (iz > start) {
        const step = Math.abs(curr[c]! - prev[c]!);
        sum += step;
        if (step > worst) worst = step;
      }
      prev[c] = curr[c]!;
    }
    if (iz === start) continue;
    if (iz % ROWS_PER_CHUNK === 0) { edge += sum; edgeN++; } else { other += sum; otherN++; }
  }
  return { edge: edge / edgeN, other: other / otherN, worst };
}

describe('heightWith, on Boulevard params', () => {
  const goldens: readonly (readonly [number, number, number, number, number])[] = [
    [150, 1000, 2, 0.5, 3.125618514997149],
    [515.5, 1000, 2, 0.5, 130.76588773885882],
    [-1000.25, 15625000, 64, 3.25, 211.02120995099142],
    [2000, 500000000000, 2, 0.75, 347.9489411765333],
    [4000, 500000000000000, 2, 0.75, 253.83894945696144],
    [85, 1000, 2, 0.5, 0],
    [85.5, 1000, 2, 0.5, 0.00020830239364939826],
  ];
  for (const [x, iz, zs, zLocal, v] of goldens) {
    it(`golden height(${x}, ${iz}, ${zs}, ${zLocal})`, () => {
      expect(heightWith(noise, BLVD, x, iz, zs, zLocal)).toBe(v);
    });
  }

  it('section 5.2 statistics: p50 within 15% at all six columns', () => {
    const table: readonly (readonly [number, number])[] = [[150, 4.3], [300, 34], [515, 102], [1000, 208], [2000, 251], [4000, 227]];
    for (const [d, p50] of table) {
      const s = columnSamples((x, iz, zs, zl) => heightWith(noise, BLVD, x, iz, zs, zl), d, 20000).sort();
      const got = percentile(s, 0.5);
      expect(Math.abs(got - p50) / p50, `p50 at ${d} was ${got}`).toBeLessThanOrEqual(0.15);
    }
  });
});

describe('height', () => {
  it('the real height equals heightWith on the zone biome by toBe, away from a fade', () => {
    for (const base of [0, 2 ** 20, 2 ** 36]) {
      let z = Math.floor(base / 100);
      const end = z + 12;
      for (; z < end; z++) {
        const p = TERRAIN[zones.entry(z, SALT_BIOME, 6)]!;
        for (let i = 0; i < 30; i++) {
          const chunk = z * 100 + (i * 7) % 75;
          const x = (i & 1 ? -1 : 1) * (86 + i * 113.5);
          const zLocal = (i * 5.5) % 64;
          expect(real(x, chunk, 64, zLocal)).toBe(heightWith(noise, p, x, chunk, 64, zLocal));
        }
      }
    }
  });

  it('is exactly 0 at abs(x) <= 85, for all biomes and at all distances', () => {
    for (const iz of [0, 15625000, 1.5e13, 2 ** 47, -5]) {
      for (const x of [0, 40, -40, 84.999, 85, -85]) {
        expect(real(x, iz, 64, 3.5)).toBe(0);
        for (let b = 0; b < BIOME_COUNT; b++) expect(heightWith(noise, TERRAIN[b]!, x, iz, 64, 3.5)).toBe(0);
      }
    }
  });

  it('is positive just outside the valley and never negative', () => {
    for (let i = 0; i < 4000; i++) {
      const v = real(85 + (i % 2000), i * 13, 64, fract(i * 0.618) * 64);
      expect(v).toBeGreaterThanOrEqual(0);
    }
    expect(real(90, 1000, 64, 3.5)).toBeGreaterThan(0);
  });

  it('split independence', () => {
    const SPACINGS = [2, 4, 8, 16, 32, 64, 128] as const;
    const edge = firstZone(Biome.CYBER_CANYON) * 100 + 96;
    const bases = [0, edge, 2 ** 20, Math.floor(1e15 / 64), 2 ** 47, 2 ** 48 - 1025];
    let mismatches = 0;
    let compared = 0;
    // Every s divides 128, so sample at z = base * 64 + 128 * r, with a shared even chunk base.
    for (const b of bases) {
      const base = Math.floor(b / 2) * 2;
      for (let r = 0; r < 40; r++) {
        for (const x of [120.5, 300.25, 1000, 2500.5, 4000]) {
          const z = base * 64 + 128 * r;
          const reference = real(x, z / 128, 128, 0);
          for (const s of SPACINGS) {
            const v = real(x, z / s, s, 0);
            compared++;
            if (v !== reference) mismatches++;
          }
          // The same point through a chunk and a local offset.
          compared++;
          if (real(x, base + 2 * r, 64, 0) !== reference) mismatches++;
          // A local inside a coarse row.
          compared++;
          if (real(x, (base + 2 * r) / 2, 128, 0) !== reference) mismatches++;
        }
      }
    }
    expect(compared).toBeGreaterThan(10_000);
    expect(mismatches).toBe(0);
    // Inside a fade, the same row key with another zLocal: each sample must read its own mix, whichever came before.
    const fade = firstZone(Biome.CYBER_CANYON) * 100 + 85;
    for (let i = 0; i < 400; i++) {
      const chunk = fade + (i % 10);
      const zl = (i % 32) * 2;
      const other = zl + 2 < 64 ? zl + 2 : 0;
      real(800.5, chunk, 64, other);
      const viaChunk = real(800.5, chunk, 64, zl);
      expect(viaChunk).toBe(real(800.5, chunk * 32 + zl / 2, 2, 0));
    }
    // Also a point that is not on any coarse lattice line, for spacing 2 and 64.
    for (let i = 0; i < 2000; i++) {
      const chunk = 2 ** 30 + i;
      const zLocal = (i % 32) * 2 + 0.5;
      const a = real(555.5, chunk, 64, zLocal);
      const iz2 = chunk * 32 + Math.floor(zLocal / 2);
      const b = real(555.5, iz2, 2, zLocal - Math.floor(zLocal / 2) * 2);
      expect(a).toBe(b);
    }
  });

  it('height non-flat at 1e9, 1e12, 1e15', () => {
    const blvd: HeightFn = (x, iz, zs, zl) => heightWith(noise, BLVD, x, iz, zs, zl);
    for (const D of [1e9, 1e12, 1e15]) {
      const base = Math.floor(D / 64);
      for (const d of [150, 515, 1000, 2000]) {
        const a = columnSamples(blvd, d, 2000, base).sort();
        const r = columnSamples(real, d, 2000, base).sort();
        const blvdRange = a[a.length - 1]! - a[0]!;
        const realRange = r[r.length - 1]! - r[0]!;
        expect(blvdRange, `Boulevard range ${D} at ${d}`).toBeGreaterThanOrEqual(d === 150 ? 5 : 40);
        expect(realRange, `real range ${D} at ${d}`).toBeGreaterThanOrEqual(d === 150 ? 0.001 : 20);
      }
    }
  });

  it('V rule: p95 / abs(x) at most .30 outside Canyon, and Canyon at least .40 at 300', () => {
    const columns = [150, 300, 515, 1000, 2000, 4000];
    for (let b = 0; b < BIOME_COUNT; b++) {
      const h: HeightFn = (x, iz, zs, zl) => heightWith(noise, TERRAIN[b]!, x, iz, zs, zl);
      for (const d of columns) {
        const s = columnSamples(h, d, 5000).sort();
        const ratio = percentile(s, 0.95) / d;
        if (b !== Biome.CYBER_CANYON) expect(ratio, `biome ${b} at ${d}`).toBeLessThanOrEqual(0.30);
        if (b === Biome.CYBER_CANYON && d === 300) expect(ratio).toBeGreaterThanOrEqual(0.40);
      }
    }
  });

  it('biomes keep their terrain order: Neon under Boulevard, Desert under Neon, at 1000', () => {
    const p50 = (p: Readonly<TerrainParams>): number => percentile(
      columnSamples((x, iz, zs, zl) => heightWith(noise, p, x, iz, zs, zl), 1000, 5000).sort(), 0.5);
    const b = p50(TERRAIN[Biome.BOULEVARD]!);
    const n = p50(TERRAIN[Biome.NEON_CITY]!);
    const d = p50(TERRAIN[Biome.CRYSTAL_DESERT]!);
    expect(n).toBeLessThan(b);
    expect(d).toBeLessThan(n);
  });

  it('adjacent rows: a .0002 u step at every zone edge moves height at most .01 u', () => {
    let worst = 0;
    for (let z = 0; z < 60; z++) {
      const c = z * 100;
      for (let i = 0; i < 40; i++) {
        const x = 100 + i * 75;
        // chunk edge, inside the same row and across it
        const below = real(x, c - 1, 64, 64 - 0.0001);
        const above = real(x, c, 64, 0.0001);
        worst = Math.max(worst, Math.abs(above - below));
      }
    }
    expect(worst).toBeLessThanOrEqual(0.01);
  });

  it('a 2 u row step is at most 20 u anywhere', () => {
    let worst = 0;
    for (let z = 0; z < 24; z++) {
      for (let r = 0; r < 200; r++) {
        const iz = (z * 100 + 60) * 32 + r * 11;
        for (let c = 0; c < 40; c++) {
          const x = 90 + c * 50;
          worst = Math.max(worst, Math.abs(real(x, iz + 1, 2, 0) - real(x, iz, 2, 0)));
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(20);
    expect(worst).toBeGreaterThan(0);
  });

  it('chunk edge: the mean row step on chunk-edge rows stays near other rows through a Boulevard to Canyon fade', () => {
    const zone = fadeZone(Biome.BOULEVARD, Biome.CYBER_CANYON);
    const r = chunkEdgeRatio(real, zone);
    expect(r.edge / r.other, `edge ${r.edge} other ${r.other}`).toBeLessThanOrEqual(1.2);
  });

  it('negative control: a mix stepped per chunk reads at least 1.5 there, while the worst step cannot tell', () => {
    // The same height with the biome mix evaluated at the row's chunk, not its exact z.
    const stepped: HeightFn = (x, iz, zs, zLocal) => {
      const c = Math.floor((iz * zs + zLocal) / CHUNK_LEN);
      const z = Math.floor(c / 100);
      const m = smooth((c - z * 100 - 75) / 25);
      const a = TERRAIN[zones.entry(z, SALT_BIOME, 6)]!;
      const b = TERRAIN[zones.entry(z + 1, SALT_BIOME, 6)]!;
      const p: TerrainParams = {
        rise: a.rise + (b.rise - a.rise) * m,
        a0: a.a0 + (b.a0 - a.a0) * m,
        a1: a.a1 + (b.a1 - a.a1) * m,
        gain: a.gain + (b.gain - a.gain) * m,
      };
      return heightWith(noise, p, x, iz, zs, zLocal);
    };
    const zone = fadeZone(Biome.BOULEVARD, Biome.CYBER_CANYON);
    const bad = chunkEdgeRatio(stepped, zone);
    const good = chunkEdgeRatio(real, zone);
    expect(bad.edge / bad.other).toBeGreaterThanOrEqual(1.5);
    // The worst-step metric moves far less than the mean ratio does, which is why the ratio is the gate.
    expect(Math.abs(bad.worst - good.worst) / good.worst).toBeLessThan(0.2);
  });

  it('the memo cannot change a result: thrashed and fresh calls agree', () => {
    const fresh = (): HeightFn => createHeight(createNoise(SEED, 0), createZones(SEED, 0), 0).at;
    const iz = 2 ** 20;
    const a = fresh();
    const expected = a(300, iz, 2, 1.5);
    const b = fresh();
    b(300, iz, 2, 0.5);        // same row key except zLocal
    b(300, iz + 1, 2, 1.5);    // same zLocal, other row
    b(300, iz, 4, 1.5);        // same iz and zLocal, other spacing
    expect(b(300, iz, 2, 1.5)).toBe(expected);
    const edgeBase = firstZone(Biome.CYBER_CANYON) * 100 + 90;
    const c = fresh();
    const fadeValue = c(300, edgeBase, 64, 10.5);
    const d = fresh();
    d(300, edgeBase, 64, 11.5);
    expect(d(300, edgeBase, 64, 10.5)).toBe(fadeValue);
  });

  it('holds to the end of the world: no NaN at CHUNK_LIMIT, or at negative rows', () => {
    for (const chunk of [CHUNK_LIMIT - 1, CHUNK_LIMIT + 94, -1, -96]) {
      for (const x of [86, 500, -2000, 4096]) {
        for (const zs of [2, 64, 128]) {
          const iz = zs === 128 ? Math.floor(chunk / 2) : chunk * (64 / zs);
          const v = real(x, iz, zs, 0);
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
