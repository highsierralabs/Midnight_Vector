import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ARCHETYPE_COUNT, BIOME_COUNT, CHUNK_LIMIT, ITEM_STRIDE, PROP_STRIDE, PropField, ItemField,
  type BendState, type CreateWorld, type Travel, type ZoneState,
} from '../../../src/contracts/index';
import { createWorld } from '../../../src/world/index';
import { bytesDiffer, bytesEqual, itemBytes, newItemRow, newPropRow, newZoneState, propBytes } from './support/rows';

const SEED = 1985;
const LONG = 240_000;

function propsOf(seed: number, period: number, chunk: number): Uint8Array {
  const row = newPropRow();
  createWorld({ seed, periodChunks: period }).fillProps(chunk, row);
  return propBytes(row);
}

function shuffled(n: number, seed: number): number[] {
  const out = Array.from({ length: n }, (_, i) => i);
  let state = seed;
  for (let i = n - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    const t = out[i]!;
    out[i] = out[j]!;
    out[j] = t;
  }
  return out;
}

function zoneFields(z: ZoneState): number[] {
  return [z.index, z.biomeA, z.biomeB, z.biomeMix, z.paletteA, z.paletteB, z.paletteMix, z.heroA, z.heroB, z.heroMix, z.objective, z.objectiveTarget, z.musicKey, z.dayPhase, ...z.palette];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('purity', () => {
  it('repeat: the same call twice gives the same bytes', () => {
    const w = createWorld({ seed: SEED, periodChunks: 0 });
    const a = newPropRow();
    const b = newPropRow();
    const ia = newItemRow();
    const ib = newItemRow();
    for (const chunk of [0, 1, 97, 4800, 2 ** 40, CHUNK_LIMIT - 1, -3]) {
      w.fillProps(chunk, a);
      w.fillProps(chunk, b);
      expect(bytesEqual(propBytes(a), propBytes(b))).toBe(true);
      w.fillItems(chunk, ia);
      w.fillItems(chunk, ib);
      expect(bytesEqual(itemBytes(ia), itemBytes(ib))).toBe(true);
    }
  });

  it('visit order: forward, reversed and shuffled, with other calls thrashing the memos', () => {
    const bases = [0, 2 ** 20, Math.floor(1e15 / 64), CHUNK_LIMIT - 300];
    const N = 300;
    const row = newPropRow();
    const items = newItemRow();
    const zone = newZoneState();
    for (const base of bases) {
      const props: Uint8Array[] = [];
      const its: Uint8Array[] = [];
      const forward = createWorld({ seed: SEED, periodChunks: 0 });
      for (let i = 0; i < N; i++) {
        forward.fillProps(base + i, row);
        props.push(propBytes(row));
        forward.fillItems(base + i, items);
        its.push(itemBytes(items));
      }
      const thrash = (w: ReturnType<typeof createWorld>, i: number): void => {
        w.height(300.5 + i, (base + i) * 2, 32, 16);
        w.zoneAt({ chunk: base + (i * 37) % 900, local: i % 64 }, zone);
        w.fillItems(base + (i * 53) % N, items);
      };
      // Height through the same row key with another zLocal, on a fresh world and after every kind of thrashing.
      const heights = new Float64Array(N);
      const clean = createWorld({ seed: SEED, periodChunks: 0 });
      for (let i = 0; i < N; i++) heights[i] = clean.height(800.5, base + i, 64, 10.5);
      const reversed = createWorld({ seed: SEED, periodChunks: 0 });
      for (let i = N - 1; i >= 0; i--) {
        reversed.height(800.5, base + i, 64, 40.5);
        expect(reversed.height(800.5, base + i, 64, 10.5), `height after a neighbour at ${base} + ${i}`).toBe(heights[i]);
        thrash(reversed, i);
        reversed.fillProps(base + i, row);
        expect(bytesEqual(propBytes(row), props[i]!), `reversed at ${base} + ${i}`).toBe(true);
      }
      const shuffle = shuffled(N, 12345);
      const mixed = createWorld({ seed: SEED, periodChunks: 0 });
      for (const i of shuffle) {
        thrash(mixed, i);
        mixed.fillProps(base + i, row);
        expect(bytesEqual(propBytes(row), props[i]!), `shuffled at ${base} + ${i}`).toBe(true);
        mixed.fillItems(base + i, items);
        expect(bytesEqual(itemBytes(items), its[i]!), `items shuffled at ${base} + ${i}`).toBe(true);
      }
    }
  }, LONG);

  it('fresh instance: a row from a used world equals one from a new world', () => {
    const used = createWorld({ seed: SEED, periodChunks: 0 });
    const row = newPropRow();
    const items = newItemRow();
    const zone = newZoneState();
    for (let i = 0; i < 1000; i++) {
      used.fillProps(i * 13, row);
      used.fillItems(i * 17, items);
      used.zoneAt({ chunk: i * 19, local: 3 }, zone);
      used.height(200 + i, i * 3, 2, 1);
    }
    for (const chunk of [12, 500, 4801, 2 ** 40 + 7]) {
      used.fillProps(chunk, row);
      expect(bytesEqual(propBytes(row), propsOf(SEED, 0, chunk))).toBe(true);
    }
  });

  it('two seeds interleaved equal each run alone, so no state is shared at module level', () => {
    const a = createWorld({ seed: SEED, periodChunks: 0 });
    const b = createWorld({ seed: 7, periodChunks: 0 });
    const ra = newPropRow();
    const rb = newPropRow();
    const za = newZoneState();
    const zb = newZoneState();
    const aloneA = createWorld({ seed: SEED, periodChunks: 0 });
    const aloneB = createWorld({ seed: 7, periodChunks: 0 });
    const ca = newPropRow();
    const cb = newPropRow();
    const zca = newZoneState();
    const zcb = newZoneState();
    const out: number[] = [];
    for (let i = 0; i < 400; i++) {
      const chunk = i * 11 + 70;
      a.fillProps(chunk, ra);
      b.fillProps(chunk, rb);
      a.zoneAt({ chunk, local: 40 }, za);
      b.zoneAt({ chunk, local: 40 }, zb);
      out.push(a.height(300, chunk, 64, 1.5), b.height(300, chunk, 64, 1.5));
      aloneA.fillProps(chunk, ca);
      aloneB.fillProps(chunk, cb);
      aloneA.zoneAt({ chunk, local: 40 }, zca);
      aloneB.zoneAt({ chunk, local: 40 }, zcb);
      expect(bytesEqual(propBytes(ra), propBytes(ca))).toBe(true);
      expect(bytesEqual(propBytes(rb), propBytes(cb))).toBe(true);
      expect(zoneFields(za)).toEqual(zoneFields(zca));
      expect(zoneFields(zb)).toEqual(zoneFields(zcb));
      expect(a.height(300, chunk, 64, 1.5)).toBe(aloneA.height(300, chunk, 64, 1.5));
    }
    expect(bytesDiffer(propBytes(ra), propBytes(rb))).toBeGreaterThan(100);
    expect(out.length).toBe(800);
  });

  it('dirty output: a row pre-filled with NaN and with 7 gives identical results', () => {
    const w = createWorld({ seed: SEED, periodChunks: 0 });
    const a = newPropRow();
    const b = newPropRow();
    a.data.fill(NaN);
    a.start.fill(65535);
    b.data.fill(7);
    b.start.fill(7);
    const ia = newItemRow();
    const ib = newItemRow();
    ia.data.fill(NaN);
    ia.count = 999;
    ib.data.fill(7);
    ib.count = 7;
    for (const chunk of [0, 13, 4800, 2 ** 40]) {
      w.fillProps(chunk, a);
      w.fillProps(chunk, b);
      expect(bytesEqual(propBytes(a), propBytes(b))).toBe(true);
      w.fillItems(chunk, ia);
      w.fillItems(chunk, ib);
      expect(bytesEqual(itemBytes(ia), itemBytes(ib))).toBe(true);
    }
  });

  it('no clock or randomness: not called, and returning other values changes nothing', () => {
    const before = propsOf(SEED, 0, 4801);
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.123);
    const now = vi.spyOn(Date, 'now').mockReturnValue(1e12);
    const perf = vi.spyOn(performance, 'now').mockReturnValue(5);
    const w = createWorld({ seed: SEED, periodChunks: 0 });
    const row = newPropRow();
    const items = newItemRow();
    const zone = newZoneState();
    const bend: BendState = { a: 0, c: 0, vMax: 1 };
    for (let i = 0; i < 200; i++) {
      w.fillProps(4801 + i, row);
      w.fillItems(4801 + i, items);
      w.zoneAt({ chunk: 4801 + i, local: 3 }, zone);
      w.bendAt({ chunk: 4801 + i, local: 3 }, bend);
      w.height(300, 4801 + i, 64, 1);
    }
    w.fillProps(4801, row);
    expect(random).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
    expect(perf).not.toHaveBeenCalled();
    expect(bytesEqual(propBytes(row), before)).toBe(true);
  });

  it('period: chunk k and k + 1024 * 2^37 give identical values, and out.chunk differs as passed', () => {
    const w = createWorld({ seed: SEED, periodChunks: 1024 });
    const shift = 1024 * 2 ** 37;
    const a = newPropRow();
    const b = newPropRow();
    const ia = newItemRow();
    const ib = newItemRow();
    const za = newZoneState();
    const zb = newZoneState();
    const ba: BendState = { a: 0, c: 0, vMax: 1 };
    const bb: BendState = { a: 0, c: 0, vMax: 1 };
    for (const k of [0, 1, 47, 48, 99, 100, 512, 1000, 1023, 1024, 2047, 3072]) {
      w.fillProps(k, a);
      w.fillProps(k + shift, b);
      expect(bytesEqual(propBytes(a), propBytes(b)), `props at ${k}`).toBe(true);
      expect(a.chunk).toBe(k);
      expect(b.chunk).toBe(k + shift);
      w.fillItems(k, ia);
      w.fillItems(k + shift, ib);
      expect(bytesEqual(itemBytes(ia), itemBytes(ib)), `items at ${k}`).toBe(true);
      expect(ib.chunk).toBe(k + shift);
      const atA: Travel = { chunk: k, local: 21.5 };
      const atB: Travel = { chunk: k + shift, local: 21.5 };
      expect(zoneFields(w.zoneAt(atA, za))).toEqual(zoneFields(w.zoneAt(atB, zb)));
      w.bendAt(atA, ba);
      w.bendAt(atB, bb);
      expect(ba.a).toBe(bb.a);
      for (const x of [86, 300.5, 1000, -2500]) {
        expect(w.height(x, k, 64, 1.5)).toBe(w.height(x, k + shift, 64, 1.5));
        expect(w.height(x, k * 32, 2, 1)).toBe(w.height(x, (k + shift) * 32, 2, 1));
      }
    }
  });

  it('aperiodic difference: with period 0 the same pair differs by over 100 bytes', () => {
    const shift = 1024 * 2 ** 37;
    const w = createWorld({ seed: SEED, periodChunks: 0 });
    const a = newPropRow();
    const b = newPropRow();
    let differ = 0;
    for (const k of [0, 1, 47, 512, 1000]) {
      w.fillProps(k, a);
      w.fillProps(k + shift, b);
      differ += bytesDiffer(propBytes(a), propBytes(b));
    }
    expect(differ).toBeGreaterThan(100);
  });

  it('limit: CHUNK_LIMIT - 1 and rows 94 ahead have no NaN, hold their ranges, and height is alive', () => {
    const w = createWorld({ seed: SEED, periodChunks: 0 });
    const row = newPropRow();
    const items = newItemRow();
    const zone = newZoneState();
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i <= 94; i++) {
      const chunk = CHUNK_LIMIT - 1 + i;
      w.fillProps(chunk, row);
      for (let r = 0; r < row.start[ARCHETYPE_COUNT]!; r++) {
        for (let f = 0; f < PROP_STRIDE; f++) expect(Number.isFinite(row.data[r * PROP_STRIDE + f]!)).toBe(true);
        expect(row.data[r * PROP_STRIDE + PropField.Z_LOCAL]!).toBeLessThan(64);
      }
      w.fillItems(chunk, items);
      for (let r = 0; r < items.count; r++) {
        for (let f = 0; f < ITEM_STRIDE; f++) expect(Number.isFinite(items.data[r * ITEM_STRIDE + f]!)).toBe(true);
        expect(items.data[r * ITEM_STRIDE + ItemField.Z_LOCAL]!).toBeLessThan(64);
      }
      w.zoneAt({ chunk, local: 63 }, zone);
      expect(zone.biomeA).toBeLessThan(BIOME_COUNT);
      expect(zone.dayPhase).toBeLessThan(1);
      const h = w.height(600, chunk, 64, 12.5);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    expect(hi - lo).toBeGreaterThan(5);
  });

  it('createWorld is the contract factory', () => {
    const factory: CreateWorld = createWorld;
    expect(factory({ seed: 3, periodChunks: 0 }).seed).toBe(3);
  });

  it('options: createWorld throws RangeError on a bad seed or period', () => {
    for (const seed of [1.5, NaN, Infinity]) {
      expect(() => createWorld({ seed, periodChunks: 0 })).toThrow(RangeError);
    }
    for (const periodChunks of [12, -8, 1.5, NaN]) {
      expect(() => createWorld({ seed: 1, periodChunks })).toThrow(RangeError);
    }
    expect(createWorld({ seed: -5, periodChunks: 8 }).seed).toBe(-5);
    expect(createWorld({ seed: 2 ** 40, periodChunks: 0 }).seed).toBe(2 ** 40);
  });
});
