import { describe, expect, it } from 'vitest';
import { hash01 } from '../../../src/core/hash';
import { withRefHeight } from '../../../src/render/terrain/dev/devTools';
import { createFakeWorld } from '../../../src/testing/fakeWorld';

const COLUMNS = [150, 300, 515, 1000, 2000, 4000];
const P50 = [4.3, 34, 102, 208, 251, 227];
const P95 = [6.4, 52, 135, 279, 336, 308];
const SAMPLES = 20_000;

function percentile(sorted: Float64Array, p: number): number {
  return sorted[Math.floor(sorted.length * p)]!;
}

describe('ref height', () => {
  for (const seed of [1985, 7, 12345]) {
    it(`reproduces the section 5.2 table within 10% on seed ${seed}`, () => {
      const world = withRefHeight(createFakeWorld({ seed }));
      COLUMNS.forEach((x, col) => {
        const heights = new Float64Array(SAMPLES);
        for (let i = 0; i < SAMPLES; i++) {
          // Hashed rows and both sides of the valley, so a sample is not correlated with the last one.
          const iz = Math.floor(hash01(seed, col, i, 1) * 2 ** 30);
          const side = hash01(seed, col, i, 2) < 0.5 ? -1 : 1;
          heights[i] = world.height(side * x, iz, 2, 0);
        }
        heights.sort();
        const p50 = percentile(heights, 0.5), p95 = percentile(heights, 0.95);
        console.log(`REF seed ${seed} x ${x}: p50 ${p50.toFixed(1)} vs ${P50[col]}, p95 ${p95.toFixed(1)} vs ${P95[col]}`);
        expect(Math.abs(p50 / P50[col]! - 1)).toBeLessThan(0.1);
        expect(Math.abs(p95 / P95[col]! - 1)).toBeLessThan(0.1);
      });
    });
  }

  it('is non-flat at 1e9, 1e12 and 1e15 u, across columns and along the road', () => {
    const world = withRefHeight(createFakeWorld());
    for (const distance of [1e9, 1e12, 1e15]) {
      const row = Math.floor(distance / 64);
      const across: number[] = [];
      const along: number[] = [];
      for (let i = 0; i < 400; i++) {
        across.push(world.height(500 + i * 8, row, 64, 0));
        along.push(world.height(1000, row + i, 64, 0));
      }
      const std = (v: number[]): number => {
        const m = v.reduce((a, b) => a + b, 0) / v.length;
        return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
      };
      expect(std(across)).toBeGreaterThan(5);
      expect(std(along)).toBeGreaterThan(5);
    }
  });

  it('is exactly 0 in the valley and never negative', () => {
    const world = withRefHeight(createFakeWorld());
    for (let i = 0; i < 2000; i++) {
      const iz = Math.floor(hash01(1, 0, i, 3) * 2 ** 40) - 18;
      const x = -85 + 170 * (i / 1999);
      expect(world.height(x, iz, 2, 0)).toBe(0);
      expect(world.height(90 + 4000 * hash01(1, 0, i, 4), iz, 2, 0)).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns finite values for negative rows near chunk 0, and at the row limit', () => {
    const world = withRefHeight(createFakeWorld());
    for (let c = 0; c <= 128; c++) {
      expect(Number.isFinite(world.height((c - 64) * 2, -18, 2, 0))).toBe(true);
      expect(Number.isFinite(world.height((c - 64) * 64, -4, 64, 0))).toBe(true);
      expect(Number.isFinite(world.height((c - 64) * 2, 2 ** 53 - 33000, 2, 0))).toBe(true);
    }
  });

  it('levels agree: height(x, 2q, s, 0) equals height(x, q, 2s, 0)', () => {
    const world = withRefHeight(createFakeWorld());
    for (let i = 0; i < 500; i++) {
      const q = 1000 + i * 37;
      for (const s of [2, 4, 8, 16, 32]) {
        const x = (i % 128) * 2 * s;
        expect(world.height(x, 2 * q, s, 0)).toBeCloseTo(world.height(x, q, 2 * s, 0), 3);
      }
    }
  });

  it('period 1024 repeats exactly at k = 2^37, and the aperiodic world does not', () => {
    const periodic = withRefHeight(createFakeWorld({ periodChunks: 1024 }), { period: 1024 });
    const aperiodic = withRefHeight(createFakeWorld());
    let differs = 0;
    for (const s of [2, 4, 8, 16, 32, 64]) {
      const rowsPerPeriod = (1024 * 64) / s;
      const far = rowsPerPeriod * 2 ** 37;
      for (let i = 0; i < 300; i++) {
        const q = i * 3;
        const x = 100 + i * 7 * s;
        expect(periodic.height(x, q + far, s, 0)).toBe(periodic.height(x, q, s, 0));
        if (aperiodic.height(x, q + far, s, 0) !== aperiodic.height(x, q, s, 0)) differs++;
      }
    }
    expect(differs).toBeGreaterThan(1000);
  });
});
