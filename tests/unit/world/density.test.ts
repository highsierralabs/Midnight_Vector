import { beforeAll, describe, expect, it } from 'vitest';
import {
  ARCHETYPE_COUNT, Archetype, BIOME_COUNT, BIOME_NAMES, Biome, PROP_STRIDE, PropField,
} from '../../../src/contracts/index';
import { QUOTA } from '../../../src/world/biomes';
import type { ScatterTable } from '../../../src/world/scatter';
import { COLUMNS, columnCounts, cosine, liveCount } from './support/metrics';
import { newPropRow } from './support/rows';
import { REAL_TABLE, composeWorld, fadeZone, pureChunks, scaledQuotas, zonesOfBiome, type ComposedWorld } from './support/worlds';

const SEED = 1985;
const LONG = 240_000;
const POSITIONS = 200;

const SIGNATURE: readonly (readonly number[])[] = [
  [Archetype.PALM, Archetype.BILLBOARD, Archetype.REFLECTOR, Archetype.CHEVRON],
  [Archetype.ARCOLOGY, Archetype.BILLBOARD, Archetype.PYLON, Archetype.OBELISK],
  [Archetype.PYRAMID, Archetype.CRYSTAL, Archetype.OBELISK, Archetype.CACTUS],
  [Archetype.PYLON, Archetype.DISH, Archetype.TURBINE, Archetype.CASSETTE],
  [Archetype.ORB, Archetype.SAUCER, Archetype.DISH, Archetype.DOME],
  [Archetype.ORB, Archetype.COLONNADE, Archetype.TOTEM],
];

/** Row means and fills of a biome, over its pure rows. */
interface BiomeReport {
  rowMin: number; near: number; rise: number; far: number;
  fillWorst: number; fillSearch: number;
  histogram: Float64Array;
}

function isSpeedLayer(a: number): boolean {
  return a === Archetype.REFLECTOR || a === Archetype.CHEVRON;
}

function measureBiome(world: ComposedWorld, biome: number, table: Readonly<ScatterTable>): BiomeReport {
  const row = newPropRow();
  const chunks = pureChunks(world.zones, biome, 1500);
  const placed = new Float64Array(ARCHETYPE_COUNT);
  const histogram = new Float64Array(ARCHETYPE_COUNT);
  let rowMin = Infinity;
  let near = 0;
  let rise = 0;
  let far = 0;
  for (const chunk of chunks) {
    world.fillProps(chunk, row);
    rowMin = Math.min(rowMin, row.start[ARCHETYPE_COUNT]!);
    for (let a = 0; a < ARCHETYPE_COUNT; a++) {
      const end = row.start[a + 1]!;
      placed[a] = placed[a]! + end - row.start[a]!;
      if (isSpeedLayer(a)) continue;
      histogram[a] = histogram[a]! + end - row.start[a]!;
      if (a === Archetype.RING) continue;
      for (let i = row.start[a]!; i < end; i++) {
        const ax = Math.abs(row.data[i * PROP_STRIDE + PropField.X]!);
        if (ax <= 85) near++;
        else if (ax <= 520) rise++;
        else far++;
      }
    }
  }
  let fillWorst = 1;
  let fillSearch = 1;
  for (let a = 0; a < ARCHETYPE_COUNT; a++) {
    const q = table.quota[biome]![a]!;
    if (q === 0 || a === Archetype.RING) continue;
    const fill = placed[a]! / (q * chunks.length);
    if (a === Archetype.SEARCHLIGHT) fillSearch = Math.min(fillSearch, fill);
    else fillWorst = Math.min(fillWorst, fill);
  }
  const n = chunks.length;
  return { rowMin, near: near / n, rise: rise / n, far: far / n, fillWorst, fillSearch, histogram };
}

interface ScreenReport { liveMin: number; columnMin: number; columnMean: number; centreMean: number; emptyAt: string }

function measureScreen(world: ComposedWorld, biome: number, positions: number): ScreenReport {
  const row = newPropRow();
  const zones = zonesOfBiome(world.zones, biome, Math.ceil(positions / 5));
  const sum = new Float64Array(COLUMNS);
  const cols = new Int32Array(COLUMNS);
  let liveMin = Infinity;
  let columnMin = Infinity;
  const empties = new Int32Array(COLUMNS);
  for (let i = 0; i < positions; i++) {
    const chunk = zones[i % zones.length]! * 100 + (i * 17) % 75;
    const local = (i * 13) % 64;
    liveMin = Math.min(liveMin, liveCount(world.fillProps, row, chunk, local));
    columnCounts(world.fillProps, row, chunk, local, cols);
    for (let c = 0; c < COLUMNS; c++) {
      sum[c] = sum[c]! + cols[c]!;
      columnMin = Math.min(columnMin, cols[c]!);
      if (cols[c] === 0) empties[c] = empties[c]! + 1;
    }
  }
  let columnMean = Infinity;
  let centreMean = Infinity;
  for (let c = 0; c < COLUMNS; c++) {
    const m = sum[c]! / positions;
    columnMean = Math.min(columnMean, m);
    if (c >= COLUMNS / 2 - 2 && c < COLUMNS / 2 + 2) centreMean = Math.min(centreMean, m);
  }
  return { liveMin, columnMin, columnMean, centreMean, emptyAt: empties.join(',') };
}

describe('density floors on the real table', () => {
  const world = composeWorld(SEED, 0);
  const reports: BiomeReport[] = [];
  const screens: ScreenReport[] = [];

  beforeAll(() => {
    for (let b = 0; b < BIOME_COUNT; b++) {
      reports.push(measureBiome(world, b, REAL_TABLE));
      screens.push(measureScreen(world, b, POSITIONS));
    }
  }, LONG);

  it('every biome is full, near to far', () => {
    for (let b = 0; b < BIOME_COUNT; b++) {
      const r = reports[b]!;
      const s = screens[b]!;
      console.log(`DENSITY biome=${BIOME_NAMES[b]} rowMin=${r.rowMin} near=${r.near.toFixed(2)} rise=${r.rise.toFixed(2)} far=${r.far.toFixed(2)} fill=${r.fillWorst.toFixed(3)} searchlight=${r.fillSearch.toFixed(3)} live=${s.liveMin} columnMin=${s.columnMin} columnMean=${s.columnMean.toFixed(1)} centreMean=${s.centreMean.toFixed(1)} emptyAt=${s.emptyAt}`);
      const name = BIOME_NAMES[b];
      expect.soft(r.rowMin, `${name} row total`).toBeGreaterThanOrEqual(32);
      expect.soft(s.liveMin, `${name} live`).toBeGreaterThanOrEqual(700);
      expect.soft(r.rise, `${name} rise`).toBeGreaterThanOrEqual(5);
      expect.soft(r.far, `${name} far`).toBeGreaterThanOrEqual(1.5);
      expect.soft(r.fillWorst, `${name} fill`).toBeGreaterThanOrEqual(0.9);
      expect.soft(r.fillSearch, `${name} searchlight fill`).toBeGreaterThanOrEqual(0.7);
      expect.soft(s.columnMin, `${name} worst column`).toBeGreaterThanOrEqual(1);
      expect.soft(s.columnMean, `${name} mean column`).toBeGreaterThanOrEqual(5);
      expect.soft(s.centreMean, `${name} centre columns`).toBeGreaterThanOrEqual(30);
    }
    expect(reports[Biome.BOULEVARD]!.near).toBeGreaterThanOrEqual(7);
    expect(reports[Biome.OLYMPUS]!.near).toBeGreaterThanOrEqual(7);
    expect(reports[Biome.CRYSTAL_DESERT]!.near).toBeGreaterThanOrEqual(4);
  }, LONG);

  it('biome identity: cosine similarity of row histograms at most .65, any pair', () => {
    let worst = 0;
    let pair = '';
    for (let a = 0; a < BIOME_COUNT; a++) {
      for (let b = a + 1; b < BIOME_COUNT; b++) {
        const c = cosine(reports[a]!.histogram, reports[b]!.histogram);
        if (c > worst) {
          worst = c;
          pair = `${BIOME_NAMES[a]} and ${BIOME_NAMES[b]}`;
        }
      }
    }
    console.log(`DENSITY identity worst=${worst.toFixed(3)} ${pair}`);
    expect(worst).toBeLessThanOrEqual(0.65);
  });

  it('variety: 6 distinct archetypes in any rolling 10 chunks, and every signature archetype present', () => {
    const row = newPropRow();
    for (let b = 0; b < BIOME_COUNT; b++) {
      const zones = zonesOfBiome(world.zones, b, 41);
      let rolled = 0;
      for (const z of zones) {
        const counts: Uint8Array[] = [];
        for (let i = 0; i < 75; i++) {
          world.fillProps(z * 100 + i, row);
          const present = new Uint8Array(ARCHETYPE_COUNT);
          for (let a = 0; a < ARCHETYPE_COUNT; a++) present[a] = row.start[a + 1]! > row.start[a]! ? 1 : 0;
          counts.push(present);
          if (counts.length < 10) continue;
          const window = counts.slice(-10);
          let distinct = 0;
          for (let a = 0; a < ARCHETYPE_COUNT; a++) if (window.some((p) => p[a] === 1)) distinct++;
          expect(distinct, `biome ${b} at ${z * 100 + i}`).toBeGreaterThanOrEqual(6);
          for (const sig of SIGNATURE[b]!) {
            expect(window.some((p) => p[sig] === 1), `biome ${b} signature ${sig} at ${z * 100 + i}`).toBe(true);
          }
          rolled++;
        }
      }
      expect(rolled).toBeGreaterThan(2600);
    }
  }, LONG);

  it('a run of 600 zones shows every archetype', () => {
    const row = newPropRow();
    const seen = new Uint8Array(ARCHETYPE_COUNT);
    for (let c = 0; c < 60000; c++) {
      world.fillProps(c, row);
      for (let a = 0; a < ARCHETYPE_COUNT; a++) if (row.start[a + 1]! > row.start[a]!) seen[a] = 1;
    }
    expect(seen.reduce((n, v) => n + v, 0)).toBe(20);
  }, LONG);

  it('searchlights: at most 8 in any 47-chunk window', () => {
    const row = newPropRow();
    const zones = zonesOfBiome(world.zones, Biome.NEON_CITY, 40);
    let most = 0;
    for (const z of zones) {
      const has: number[] = [];
      for (let i = 0; i < 100; i++) {
        world.fillProps(z * 100 + i, row);
        has.push(row.start[Archetype.SEARCHLIGHT + 1]! - row.start[Archetype.SEARCHLIGHT]!);
        if (has.length >= 47) most = Math.max(most, has.slice(-47).reduce((n, v) => n + v, 0));
      }
    }
    expect(most).toBeGreaterThan(0);
    expect(most).toBeLessThanOrEqual(8);
  }, LONG);

  it('thinning is even inside a row', () => {
    const row = newPropRow();
    for (const d of [0.7, 0.4]) {
      let beyond2 = 0;
      let rows = 0;
      let kept = 0;
      let total = 0;
      for (let b = 0; b < BIOME_COUNT; b++) {
        for (const chunk of pureChunks(world.zones, b, 700)) {
          world.fillProps(chunk, row);
          for (let a = 0; a < ARCHETYPE_COUNT; a++) {
            if (a === Archetype.RING || a === Archetype.PYLON) continue;
            const n = row.start[a + 1]! - row.start[a]!;
            if (n < 4) continue;
            let k = 0;
            for (let i = row.start[a]!; i < row.start[a + 1]!; i++) {
              if (row.data[i * PROP_STRIDE + PropField.KEEP]! < d) k++;
            }
            if (Math.abs(k - n * d) > 2) beyond2++;
            kept += k;
            total += n;
            rows++;
          }
        }
      }
      expect(rows).toBeGreaterThan(5000);
      expect(beyond2, `rows beyond 2 at density ${d}`).toBe(0);
      expect(Math.abs(kept / total - d), `mean kept share at density ${d}`).toBeLessThanOrEqual(0.01);
    }
  }, LONG);

  it('fades meet the same floors, between every ordered biome pair', () => {
    const row = newPropRow();
    let fades = 0;
    let rowFloor = Infinity;
    let liveFloor = Infinity;
    for (let a = 0; a < BIOME_COUNT; a++) {
      for (let b = 0; b < BIOME_COUNT; b++) {
        if (a === b) continue;
        const z = fadeZone(world.zones, a, b);
        fades++;
        for (let i = 75; i < 100; i++) {
          const chunk = z * 100 + i;
          world.fillProps(chunk, row);
          const total = row.start[ARCHETYPE_COUNT]!;
          rowFloor = Math.min(rowFloor, total);
          expect(total, `row total in fade ${a} to ${b} at ${chunk}`).toBeGreaterThanOrEqual(32);
          if (i % 5 === 0) {
            const live = liveCount(world.fillProps, row, chunk, 32);
            liveFloor = Math.min(liveFloor, live);
            expect(live, `live in fade ${a} to ${b} at ${chunk}`).toBeGreaterThanOrEqual(700);
          }
        }
      }
    }
    console.log(`DENSITY fades=${fades} rowMin=${rowFloor} liveMin=${liveFloor}`);
    expect(fades).toBe(30);
  }, LONG);
});

describe('negative controls for the floors', () => {
  it('quotas times .1 fail the row total and the column floors', () => {
    const thin = composeWorld(SEED, 0, scaledQuotas(0.1));
    const r = measureBiome(thin, Biome.BOULEVARD, scaledQuotas(0.1));
    const s = measureScreen(thin, Biome.CRYSTAL_DESERT, 40);
    expect(s.columnMin).toBeLessThan(1);
    expect(s.centreMean).toBeLessThan(30);
    // REFLECTOR is the speed layer, so scaledQuotas keeps it and the fixed lines; the scenery metrics must drop.
    expect(r.rise).toBeLessThan(5);
    expect(r.far).toBeLessThan(1.5);
    const realRow = newPropRow();
    const thinTotal = composeWorld(SEED, 0, { ...REAL_TABLE, quota: QUOTA.map((q) => q.map((v) => v * 0.1)) });
    const chunks = pureChunks(thinTotal.zones, Biome.OLYMPUS, 200);
    let low = Infinity;
    for (const chunk of chunks) {
      thinTotal.fillProps(chunk, realRow);
      low = Math.min(low, realRow.start[ARCHETYPE_COUNT]!);
    }
    expect(low).toBeLessThan(32);
  }, LONG);

  it('Olympus copied from Boulevard fails biome identity', () => {
    const quota = QUOTA.map((q, b) => (b === Biome.OLYMPUS ? QUOTA[Biome.BOULEVARD]! : q));
    const table = { ...REAL_TABLE, quota };
    const w = composeWorld(SEED, 0, table);
    const a = measureBiome(w, Biome.OLYMPUS, table);
    const b = measureBiome(w, Biome.BOULEVARD, table);
    expect(cosine(a.histogram, b.histogram)).toBeGreaterThan(0.65);
  }, LONG);

});
