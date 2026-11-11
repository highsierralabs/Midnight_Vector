import { describe, expect, it } from 'vitest';
import { PHASE_COUNT, PHASE_PERIOD_TICKS } from '../../../src/contracts/index';
import { hash01 } from '../../../src/core/hash';
import { droneOffset, phaseOf, trafficOffset, writePhases } from '../../../src/core/motion';

describe('trafficOffset', () => {
  it('stays in [0, travel)', () => {
    for (let i = 0; i < 20000; i++) {
      const phase = hash01(1, i, 0, 0);
      const seed = hash01(2, i, 0, 0);
      const k = 1 + (i % 160);
      const v = trafficOffset(128, k, seed, phase);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(128);
    }
  });

  it('is equal at phase 0 and 1 for an integer k, so the wrap cannot pop', () => {
    expect(trafficOffset(64, 80, 0.25, 0)).toBe(trafficOffset(64, 80, 0.25, 1));
    expect(trafficOffset(96, 64, 0.625, 0)).toBe(trafficOffset(96, 64, 0.625, 1));
    for (let i = 0; i < 1000; i++) {
      const seed = hash01(3, i, 0, 0);
      expect(Math.abs(trafficOffset(128, 48, seed, 0) - trafficOffset(128, 48, seed, 1))).toBeLessThan(1e-9);
    }
  });

  it('a non-integer k pops, which is why the rule exists', () => {
    expect(Math.abs(trafficOffset(64, 80.5, 0.25, 0) - trafficOffset(64, 80.5, 0.25, 1))).toBeGreaterThan(1);
  });
});

describe('droneOffset', () => {
  it('is within 1e-9 at phase 0 and 1 for an integer k', () => {
    for (let i = 0; i < 1000; i++) {
      const seed = hash01(4, i, 0, 0);
      expect(Math.abs(droneOffset(8, 1, seed, 0) - droneOffset(8, 1, seed, 1))).toBeLessThan(1e-9);
      expect(Math.abs(droneOffset(8, 7, seed, 0) - droneOffset(8, 7, seed, 1))).toBeLessThan(1e-9);
    }
  });

  it('stays within its amplitude', () => {
    for (let i = 0; i < 1000; i++) {
      expect(Math.abs(droneOffset(5, 1, hash01(5, i, 0, 0), hash01(6, i, 0, 0)))).toBeLessThanOrEqual(5);
    }
  });
});

describe('phases, section 4.5', () => {
  it('phaseOf equals the formula', () => {
    for (let i = 0; i < PHASE_COUNT; i++) {
      const p = PHASE_PERIOD_TICKS[i]!;
      expect(phaseOf(0, 0, i)).toBe(0);
      expect(phaseOf(p, 0, i)).toBe(0);
      expect(phaseOf(p + 1, 0.5, i)).toBe(1.5 / p);
      expect(phaseOf(2 ** 50 + 7, 0.25, i)).toBe((((2 ** 50 + 7) % p) + 0.25) / p);
    }
  });

  it('writePhases equals phaseOf after Float32 storage, in place', () => {
    const out = new Float32Array(PHASE_COUNT);
    const ref = out;
    writePhases(12345, 0.75, out);
    expect(out).toBe(ref);
    for (let i = 0; i < PHASE_COUNT; i++) {
      expect(out[i]).toBe(Math.fround(phaseOf(12345, 0.75, i)));
    }
  });

  it('every phase stays in [0, 1)', () => {
    const out = new Float32Array(PHASE_COUNT);
    for (let tick = 0; tick < 40000; tick += 37) {
      writePhases(tick, 0.999, out);
      for (const v of out) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });
});
