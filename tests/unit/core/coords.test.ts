import { describe, expect, it } from 'vitest';
import { CHUNK_LEN, CHUNK_LIMIT, type Travel } from '../../../src/contracts/index';
import { advance, between, canWarp, rowMod, totalDistance, travelMod } from '../../../src/core/coords';

describe('advance', () => {
  it('moves forward across a chunk boundary', () => {
    const t: Travel = { chunk: 3, local: 63 };
    advance(t, 2);
    expect(t).toEqual({ chunk: 4, local: 1 });
  });

  it('moves backward across a chunk boundary', () => {
    const t: Travel = { chunk: 3, local: 1 };
    advance(t, -2);
    expect(t).toEqual({ chunk: 2, local: 63 });
  });

  it('moves by many chunks in one step with either sign', () => {
    const t: Travel = { chunk: 10, local: 5 };
    advance(t, 64 * 7 + 3);
    expect(t).toEqual({ chunk: 17, local: 8 });
    advance(t, -(64 * 7 + 3));
    expect(t).toEqual({ chunk: 10, local: 5 });
  });

  it('keeps local in range on the tiny-negative case, in the same chunk', () => {
    const t: Travel = { chunk: 5, local: 0 };
    advance(t, -1e-17);
    expect(t.local).toBe(0);
    expect(t.chunk).toBe(5);
  });

  it('keeps exact arithmetic at 2^48 - 1025', () => {
    const base = 2 ** 48 - 1025;
    const t: Travel = { chunk: base, local: 63.5 };
    advance(t, 1);
    expect(t.chunk).toBe(base + 1);
    expect(t.local).toBe(0.5);
    advance(t, -1);
    expect(t.chunk).toBe(base);
    expect(t.local).toBe(63.5);
    expect(t.local).toBeLessThan(CHUNK_LEN);
  });
});

describe('between', () => {
  it('is exact across a chunk gap', () => {
    expect(between({ chunk: 7, local: 1.25 }, { chunk: 5, local: 63.75 })).toBe(2 * 64 + (1.25 - 63.75));
  });

  it('is exact at huge chunks, where a totalDistance subtraction loses precision', () => {
    const a = { chunk: 2 ** 47 + 2, local: 0.125 };
    const b = { chunk: 2 ** 47, local: 0.0625 };
    expect(between(a, b)).toBe(128.0625);
    expect(totalDistance(a) - totalDistance(b)).not.toBe(128.0625);
  });

  it('is antisymmetric', () => {
    const a = { chunk: 9, local: 3 };
    const b = { chunk: 2, local: 60 };
    expect(between(a, b)).toBe(-between(b, a));
  });
});

describe('rowMod', () => {
  it('wraps into [0, 65536)', () => {
    expect(rowMod(0)).toBe(0);
    expect(rowMod(65535)).toBe(65535);
    expect(rowMod(65536)).toBe(0);
    expect(rowMod(65537)).toBe(1);
    expect(rowMod(-1)).toBe(65535);
    expect(rowMod(2 ** 40 + 63)).toBe(63);
  });
});

describe('travelMod', () => {
  it('gives 4044.5 at chunk 2^40 + 63, local 12.5', () => {
    expect(travelMod({ chunk: 2 ** 40 + 63, local: 12.5 }, 4096)).toBe(4044.5);
  });

  it('handles the 64 period and a negative chunk', () => {
    expect(travelMod({ chunk: 5, local: 12.5 }, 64)).toBe(12.5);
    expect(travelMod({ chunk: -1, local: 12.5 }, 4096)).toBe(63 * 64 + 12.5);
  });
});

describe('canWarp', () => {
  it.each([
    [CHUNK_LIMIT, 0],
    [2 ** 48, 0],
    [1.5, 0],
    [-1, 0],
    [Number.NaN, 0],
    [0, 64],
    [0, -1],
    [0, Number.NaN],
  ])('refuses chunk %d local %d', (chunk, local) => {
    expect(canWarp(chunk, local)).toBe(false);
  });

  it('accepts the last legal chunk and chunk 0', () => {
    expect(canWarp(CHUNK_LIMIT - 1, 0)).toBe(true);
    expect(canWarp(0, 0)).toBe(true);
    expect(canWarp(0, 63.999)).toBe(true);
  });
});
