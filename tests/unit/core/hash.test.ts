import { describe, expect, it } from 'vitest';
import { hash01 } from '../../../src/core/hash';

const GOLDENS: readonly (readonly [number, number, number, number, number])[] = [
  [1985, 0, 0, 0, 0.5741655419114977],
  [1985, 1, 0, 0, 0.23195873759686947],
  [1985, 0, 1, 0, 0.35482506174594164],
  [1985, 0, 0, 1, 0.06773243471980095],
  [1986, 0, 0, 0, 0.033974359510466456],
  [1985, 2 ** 32, 0, 0, 0.19808156415820122],
  [1985, 2 ** 40 + 3, 19, 127, 0.3153043582569808],
  [1985, 2 ** 48 - 1025, 5, 9, 0.3606241049710661],
  [2 ** 40, 7, 2, 3, 0.012779665645211935],
];

/** Chi-squared over 256 bins, with 1e6 draws. df 255, mean 255, sd about 23. Not a calibrated test. */
function chi2(draw: (i: number) => number): number {
  const N = 1_000_000;
  const bins = new Uint32Array(256);
  for (let i = 0; i < N; i++) {
    const v = draw(i);
    if (!(v >= 0 && v < 1)) throw new Error(`out of range: ${v}`);
    bins[Math.floor(v * 256)]!++;
  }
  const expected = N / 256;
  let sum = 0;
  for (const c of bins) sum += ((c - expected) * (c - expected)) / expected;
  return sum;
}

describe('hash01', () => {
  it.each(GOLDENS)('golden (%d, %d, %d, %d)', (seed, chunk, a, b, value) => {
    expect(hash01(seed, chunk, a, b)).toBe(value);
  });

  it('is uniform under 340 on the chunk, a, b and seed sweeps', () => {
    expect(chi2((i) => hash01(1985, i, 0, 0))).toBeLessThan(340);
    expect(chi2((i) => hash01(1985, 0, i, 0))).toBeLessThan(340);
    expect(chi2((i) => hash01(1985, 0, 0, i))).toBeLessThan(340);
    expect(chi2((i) => hash01(i, 0, 0, 0))).toBeLessThan(340);
    expect(chi2((i) => hash01(1985, 2 ** 48 - 2_000_000 + i, 3, 4))).toBeLessThan(340);
    expect(chi2((i) => hash01(1985, 2 ** 40 + i * 2 ** 7, 3, 4))).toBeLessThan(340);
  }, 60_000);

  it('the uniformity check itself can fail: a collapsed draw reads far above 340', () => {
    expect(chi2((i) => (i % 16) / 16)).toBeGreaterThan(340);
  });

  it('at chunk k differs from k + 2^32, so the high word is not dropped', () => {
    for (let k = 0; k < 1000; k++) {
      expect(hash01(1985, k, 1, 2)).not.toBe(hash01(1985, k + 2 ** 32, 1, 2));
    }
  });

  it('accepts a negative chunk and stays in range', () => {
    for (let k = -1000; k < 0; k++) {
      const v = hash01(1985, k, 0, 0);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
