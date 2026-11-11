import { describe, expect, it } from 'vitest';
import { BIOME_COUNT, BIOME_NAMES, CLIP_BASE_SPACING, CLIP_COLS, CLIP_LEVELS, CLIP_RING_ROWS, type BendState, type Travel } from '../../../src/contracts/index';
import { createWorld } from '../../../src/world/index';
import { createZones } from '../../../src/world/zones';
import { bytesPerCall } from './support/alloc';
import { percentile } from './support/metrics';
import { newItemRow, newPropRow, newZoneState } from './support/rows';
import { fadeZone, pureChunks } from './support/worlds';

const SEED = 1985;
const BENCH = process.env['TERRAIN_BENCH'] === '1';
const LIMIT = 4;
/** Height samples per row in the height probe, and its ceiling per sample. 8 B is a quarter of one leaked object. */
const ROW = 129;
const HEIGHT_LIMIT = 8;
/** Rows per sub-window of the height probe: 40 rows is 5160 samples, about one sub-window of the per-call probes. */
const HEIGHT_SUB_WINDOW = 40;
const LONG = 300_000;

/**
 * Bytes per call, warmed until it settles. The JIT tiers up on background threads, so under load a first reading can
 * come from unoptimized code. A boxed double or a leak stays high however long it warms, so a retry cannot hide one.
 * Every attempt's reading is printed, one ALLOC attempts line per probe, so a pass after a retry shows in the log.
 * per divides the printed readings, so a height row prints per sample.
 */
function settled(name: string, fn: (i: number) => void, limit: number, warm = 3000, calls = 20000, subWindow?: number, per = 1): number {
  const readings: string[] = [];
  let last = Infinity;
  for (let attempt = 0; attempt < 4; attempt++) {
    last = bytesPerCall(fn, warm, calls, subWindow);
    readings.push((last / per).toFixed(2));
    if (last < limit) break;
  }
  console.log(`ALLOC attempts ${name} limit=${(limit / per).toFixed(2)} readings=${readings.join(',')} ${last < limit ? 'pass' : 'FAIL'}`);
  return last;
}

function rowChunks(biomeRows: number): number[] {
  const zones = createZones(SEED, 0);
  const out: number[] = [];
  for (let b = 0; b < BIOME_COUNT; b++) out.push(...pureChunks(zones, b, biomeRows));
  for (let i = 75; i < 100; i++) out.push(fadeZone(zones, 0, 3) * 100 + i);
  return out;
}

describe('allocation', () => {
  const world = createWorld({ seed: SEED, periodChunks: 0 });
  const row = newPropRow();
  const items = newItemRow();
  const zone = newZoneState();
  const bend: BendState = { a: 0, c: 0, vMax: 1 };
  const at: Travel = { chunk: 0, local: 0 };
  const near = rowChunks(150);
  // A chunk past Smi range is boxed once here, not per call by the probe. A plain array of doubles would box on every
  // read, so a string passes through to make its elements tagged, and only numbers remain.
  const far: number[] = near.map((c) => Math.floor(1e15 / 64) + c);
  far.push('tagged' as unknown as number);
  far.pop();

  it('allocation: fillProps, fillItems, zoneAt and bendAt stay under 4 B per call', () => {
    const props = settled('fillProps-near', (i) => { world.fillProps(near[i % near.length]!, row); }, LIMIT);
    const propsFar = settled('fillProps-far', (i) => { world.fillProps(far[i % far.length]!, row); }, LIMIT);
    const its = settled('fillItems-near', (i) => { world.fillItems(near[i % near.length]!, items); }, LIMIT);
    const itsFar = settled('fillItems-far', (i) => { world.fillItems(far[i % far.length]!, items); }, LIMIT);
    const zn = settled('zoneAt', (i) => { at.chunk = i % 50000; at.local = (i % 64) * 0.99; world.zoneAt(at, zone); }, LIMIT);
    const bd = settled('bendAt', (i) => { at.chunk = i % 50000; at.local = (i % 64) * 0.99; world.bendAt(at, bend); }, LIMIT);
    console.log(`ALLOC B/call fillProps near=${props.toFixed(2)} far=${propsFar.toFixed(2)} fillItems near=${its.toFixed(2)} far=${itsFar.toFixed(2)} zoneAt=${zn.toFixed(2)} bendAt=${bd.toFixed(2)}`);
    expect.soft(props, 'fillProps').toBeLessThan(LIMIT);
    expect.soft(propsFar, 'fillProps far').toBeLessThan(LIMIT);
    expect.soft(its, 'fillItems').toBeLessThan(LIMIT);
    expect.soft(itsFar, 'fillItems far').toBeLessThan(LIMIT);
    expect.soft(zn, 'zoneAt').toBeLessThan(LIMIT);
    expect.soft(bd, 'bendAt').toBeLessThan(LIMIT);
  }, LONG);

  // The sum goes into a typed array, so the probe does not box a double of its own on every sample.
  const acc = new Float64Array(1);
  const heightRow = (i: number): void => {
    for (let c = 0; c < ROW; c++) acc[0] = acc[0]! + world.height(90 + c * 8, 32000 + i, 2, 0);
  };

  it('a height row is printed, and gated against a leak, under 8 B per sample', () => {
    acc[0] = 0;
    const perRow = settled('height', heightRow, HEIGHT_LIMIT * ROW, 3000, 4000, HEIGHT_SUB_WINDOW, ROW);
    expect(acc[0]).toBeGreaterThan(0);
    console.log(`ALLOC B/sample height=${(perRow / ROW).toFixed(2)}`);
    expect(perRow / ROW).toBeLessThan(HEIGHT_LIMIT);
  }, LONG);

  it('negative control: the height probe reads one leaked object per sample above 16 B per sample', () => {
    // The same rows, warm-up, call count and sub-window as the gate above, with one small object kept per sample.
    let leak: unknown = null;
    const reading = bytesPerCall((i) => {
      for (let c = 0; c < ROW; c++) {
        acc[0] = acc[0]! + world.height(90 + c * 8, 32000 + i, 2, 0);
        leak = { c };
      }
    }, 3000, 4000, HEIGHT_SUB_WINDOW) / ROW;
    expect(leak).not.toBeNull();
    console.log(`ALLOC leak control height=${reading.toFixed(2)}`);
    expect(reading).toBeGreaterThan(16);
  }, LONG);

  it('negative control: a wrapper leaking one object per call reads above 16', () => {
    let leak: unknown = null;
    const reading = bytesPerCall((i) => {
      world.bendAt(at, bend);
      leak = { i };
    });
    expect(leak).not.toBeNull();
    console.log(`ALLOC leak control=${reading.toFixed(2)}`);
    expect(reading).toBeGreaterThan(16);
  }, LONG);
});

describe('timing', () => {
  const world = createWorld({ seed: SEED, periodChunks: 0 });

  it('sanity: fillProps p50 under 1 ms across 7 buckets', () => {
    const row = newPropRow();
    const zones = createZones(SEED, 0);
    const buckets: number[][] = [];
    for (let b = 0; b < BIOME_COUNT; b++) buckets.push(pureChunks(zones, b, 300));
    buckets.push(Array.from({ length: 25 }, (_, i) => fadeZone(zones, 0, 3) * 100 + 75 + i));
    const times = new Float64Array(2000);
    for (const chunks of buckets) {
      for (let i = 0; i < 2000; i++) world.fillProps(chunks[i % chunks.length]!, row);
      for (let i = 0; i < 2000; i++) {
        const t0 = performance.now();
        world.fillProps(chunks[i % chunks.length]!, row);
        times[i] = performance.now() - t0;
      }
      times.sort();
      expect(percentile(times, 0.5)).toBeLessThan(1);
    }
  }, LONG);

  it.runIf(BENCH)('BENCH, within budget', () => {
    const row = newPropRow();
    const items = newItemRow();
    const zone = newZoneState();
    const zones = createZones(SEED, 0);
    const N = 20000;
    const times = new Float64Array(N);
    const us = (p: number): string => (percentile(times, p) * 1000).toFixed(1);
    const fails: string[] = [];
    const budget = (name: string, p: number, limitUs: number): void => {
      const v = percentile(times, p) * 1000;
      if (v > limitUs) fails.push(`${name} ${v.toFixed(1)} us over ${limitUs}`);
    };
    const buckets: [string, number[]][] = [];
    for (let b = 0; b < BIOME_COUNT; b++) buckets.push([BIOME_NAMES[b]!.replace(' ', '-'), pureChunks(zones, b, 1500)]);
    const fadeRows: number[] = [];
    for (let a = 0; a < BIOME_COUNT; a++) {
      for (let b = 0; b < BIOME_COUNT; b++) {
        if (a === b) continue;
        const z = fadeZone(zones, a, b);
        for (let i = 75; i < 100; i++) fadeRows.push(z * 100 + i);
      }
    }
    buckets.push(['fade', fadeRows]);
    for (const [name, chunks] of buckets) {
      for (let i = 0; i < 4000; i++) world.fillProps(chunks[i % chunks.length]!, row);
      let records = 0;
      for (let i = 0; i < N; i++) {
        const chunk = chunks[i % chunks.length]!;
        const t0 = performance.now();
        world.fillProps(chunk, row);
        times[i] = performance.now() - t0;
        records += row.start[20]!;
      }
      const max = Math.max(...times) * 1000;
      times.sort();
      console.log(`BENCH fillProps bucket=${name} rows=${N} records=${(records / N).toFixed(1)} p50us=${us(0.5)} p99us=${us(0.99)} maxus=${max.toFixed(0)}`);
      budget(`fillProps ${name} p50`, 0.5, 60);
      budget(`fillProps ${name} p99`, 0.99, 150);
    }
    const all = buckets.flatMap(([, c]) => c);
    for (let i = 0; i < 4000; i++) world.fillItems(all[i % all.length]!, items);
    let itemRecords = 0;
    for (let i = 0; i < N; i++) {
      const chunk = all[i % all.length]!;
      const t0 = performance.now();
      world.fillItems(chunk, items);
      times[i] = performance.now() - t0;
      itemRecords += items.count;
    }
    {
      const max = Math.max(...times) * 1000;
      times.sort();
      console.log(`BENCH fillItems rows=${N} records=${(itemRecords / N).toFixed(1)} p50us=${us(0.5)} p99us=${us(0.99)} maxus=${max.toFixed(0)}`);
      budget('fillItems p50', 0.5, 20);
      budget('fillItems p99', 0.99, 60);
    }
    const at: Travel = { chunk: 0, local: 0 };
    for (let i = 0; i < N; i++) {
      at.chunk = (i * 37) % 60000;
      at.local = i % 64;
      const t0 = performance.now();
      world.zoneAt(at, zone);
      times[i] = performance.now() - t0;
    }
    {
      const max = Math.max(...times) * 1000;
      times.sort();
      console.log(`BENCH zoneAt rows=${N} p50us=${us(0.5)} p99us=${us(0.99)} maxus=${max.toFixed(0)}`);
      budget('zoneAt p50', 0.5, 5);
    }
    let sink = 0;
    for (const level of [0, 5]) {
      const s = CLIP_BASE_SPACING * 2 ** level;
      const start = 64000 / s;
      for (let i = 0; i < N; i++) {
        const iz = start + i;
        const t0 = performance.now();
        for (let c = 0; c <= CLIP_COLS; c++) sink += world.height((c - CLIP_COLS / 2) * s, iz, s, 0);
        times[i] = performance.now() - t0;
      }
      const max = Math.max(...times) * 1000;
      times.sort();
      console.log(`BENCH heightRow level=${level} rows=${N} p50us=${us(0.5)} p99us=${us(0.99)} maxus=${max.toFixed(0)}`);
      budget(`heightRow ${level} p50`, 0.5, level === 0 ? 40 : 60);
    }
    expect(sink).toBeGreaterThan(0);
    // A warp or restore: 96 prop rows, and every level's 128 ring rows.
    const REFILLS = 60;
    const refill = new Float64Array(REFILLS);
    for (let r = 0; r < REFILLS; r++) {
      const cam = 20000 + r * 411;
      const t0 = performance.now();
      for (let i = 0; i < 96; i++) world.fillProps(cam + i, row);
      for (let L = 0; L < CLIP_LEVELS; L++) {
        const s = CLIP_BASE_SPACING * 2 ** L;
        const base = Math.floor(cam * 64 / s);
        for (let i = 0; i < CLIP_RING_ROWS; i++) {
          for (let c = 0; c <= CLIP_COLS; c++) sink += world.height((c - CLIP_COLS / 2) * s, base + i, s, 0);
        }
      }
      refill[r] = performance.now() - t0;
    }
    refill.sort();
    const p95 = percentile(refill, 0.95);
    console.log(`BENCH refill ms=${percentile(refill, 0.5).toFixed(2)} ${p95.toFixed(2)}`);
    if (p95 > 25) fails.push(`refill p95 ${p95.toFixed(2)} ms over 25`);
    expect(fails).toEqual([]);
  }, LONG);
});
