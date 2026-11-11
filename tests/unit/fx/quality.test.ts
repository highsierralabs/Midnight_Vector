// A1: the tier table, the pixel-ratio formula and the scan arithmetic.
import { describe, expect, it } from 'vitest';
import type { QualityProfile, Tier } from '../../../src/contracts/index';
import { fakeProfile } from '../../../src/testing/scriptedFrame';
import { TIERS, pixelRatioFor, scanAmpFor, scanDarkRows, scanPeriodFor } from '../../../src/render/fx/quality';

/** Section 5's table of the plan, written out again by hand so the test cannot follow a typo in the source. */
const TABLE: readonly QualityProfile[] = [
  { tier: 0, dprCap: 1, maxPixels: 230400, msaa: 0, mirror: false, post: 'bare', bloomLevels: 0, nebulaWidth: 0, propDensity: 0.08, terrainStride: 2, speedLines: 0 },
  { tier: 1, dprCap: 0.75, maxPixels: 921600, msaa: 0, mirror: false, post: 'min', bloomLevels: 3, nebulaWidth: 0, propDensity: 0.4, terrainStride: 2, speedLines: 0 },
  { tier: 2, dprCap: 1, maxPixels: 1440000, msaa: 0, mirror: false, post: 'noCa', bloomLevels: 5, nebulaWidth: 192, propDensity: 0.7, terrainStride: 1, speedLines: 32 },
  { tier: 3, dprCap: 1.5, maxPixels: 2073600, msaa: 2, mirror: true, post: 'full', bloomLevels: 6, nebulaWidth: 384, propDensity: 1, terrainStride: 1, speedLines: 64 },
  { tier: 4, dprCap: 2, maxPixels: 3686400, msaa: 4, mirror: true, post: 'full', bloomLevels: 7, nebulaWidth: 384, propDensity: 1, terrainStride: 1, speedLines: 96 },
];

describe('TIERS', () => {
  it('equals the table literally, index being tier', () => {
    expect(TIERS.length).toBe(5);
    TABLE.forEach((row, t) => expect(TIERS[t]).toEqual(row));
  });

  it('is frozen, row by row', () => {
    expect(Object.isFrozen(TIERS)).toBe(true);
    for (const row of TIERS) expect(Object.isFrozen(row)).toBe(true);
  });

  it('never rises going down a tier on the cost fields', () => {
    for (const key of ['maxPixels', 'msaa', 'bloomLevels', 'propDensity', 'speedLines'] as const) {
      for (let t = 1; t < TIERS.length; t++) {
        expect(TIERS[t - 1]![key], `${key} tier ${t - 1}`).toBeLessThanOrEqual(TIERS[t]![key]);
      }
    }
  });

  it('equals fakeProfile field by field, which is what the dev shell calls post.setQuality with', () => {
    for (let t = 0; t < 5; t++) expect(TIERS[t]).toEqual(fakeProfile(t as Tier));
  });
});

describe('pixelRatioFor', () => {
  const at = (t: number, w: number, h: number, dpr: number): number => pixelRatioFor(TIERS[t]!, w, h, dpr);

  it('matches the measured buffers at 1920x1080', () => {
    expect(at(4, 1920, 1080, 1)).toBe(1);
    expect(at(3, 1920, 1080, 1)).toBe(1);
    const r2 = at(2, 1920, 1080, 1);
    expect(r2).toBeCloseTo(0.8333, 4);
    expect(Math.floor(1920 * r2)).toBe(1600);
    expect(Math.floor(1080 * r2)).toBe(900);
    expect(at(1, 1920, 1080, 1)).toBeCloseTo(0.6667, 4);
    expect(at(0, 1920, 1080, 1)).toBeCloseTo(0.3333, 4);
    expect(at(4, 1920, 1080, 2)).toBeCloseTo(1.3333, 4);
  });

  it('never supersamples a DPR 1 monitor, at any size', () => {
    for (let t = 0; t < 5; t++) {
      for (const [w, h] of [[320, 200], [800, 600], [1280, 720], [2560, 1440], [3840, 2160], [100, 5000]] as const) {
        expect(at(t, w, h, 1)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps 200 random sizes within maxPixels', () => {
    let s = 1;
    const rnd = (): number => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 200; i++) {
      const w = 1 + Math.floor(rnd() * 5119);
      const h = 1 + Math.floor(rnd() * 2879);
      const dpr = 0.5 + rnd() * 3.5;
      const t = i % 5;
      const r = at(t, w, h, dpr);
      expect(Math.floor(w * r) * Math.floor(h * r), `${w}x${h} dpr ${dpr} tier ${t}`).toBeLessThanOrEqual(TIERS[t]!.maxPixels);
    }
  });
});

describe('scan arithmetic', () => {
  it('scanPeriodFor is the rounded 3 CSS px, an integer of at least 2', () => {
    expect(scanPeriodFor(1)).toBe(3);
    expect(scanPeriodFor(1.5)).toBe(5);
    expect(scanPeriodFor(2)).toBe(6);
    expect(scanPeriodFor(1.3333)).toBe(4);
    expect(scanPeriodFor(0.5)).toBe(2);
    for (let r = 0.1; r < 4; r += 0.013) {
      const p = scanPeriodFor(r);
      expect(Number.isInteger(p)).toBe(true);
      expect(p).toBeGreaterThanOrEqual(2);
    }
  });

  it('scanAmpFor keeps the mean darkening at .10 / 3 for periods 2 to 8', () => {
    for (let p = 2; p <= 8; p++) {
      expect(Math.abs((scanAmpFor(p) * scanDarkRows(p)) / p - 0.1 / 3)).toBeLessThan(1e-9);
    }
  });

  it('gives the amplitude .10 at the design period 3', () => {
    expect(scanAmpFor(3)).toBeCloseTo(0.1, 9);
  });
});
