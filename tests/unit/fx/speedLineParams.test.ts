// A6: speed line seeds, period and length.
import { describe, expect, it } from 'vitest';
import { SPEED_FLOOR, SPEED_MAX, WORLD_PERIOD } from '../../../src/contracts/index';
import { LINE_CAPACITY, LINE_FLOATS, LINE_PERIOD, lineLength, writeLineSeeds } from '../../../src/render/fx/speedLineParams';

describe('writeLineSeeds', () => {
  it('fills every float in [0, 1), the same on repeat', () => {
    const a = new Float32Array(LINE_CAPACITY * LINE_FLOATS);
    const b = new Float32Array(LINE_CAPACITY * LINE_FLOATS);
    writeLineSeeds(a);
    writeLineSeeds(b);
    expect(Array.from(a)).toEqual(Array.from(b));
    for (const v of a) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('spreads the ranks, so the fraction shown means what it says', () => {
    const a = new Float32Array(LINE_CAPACITY * LINE_FLOATS);
    writeLineSeeds(a);
    let under = 0;
    for (let i = 0; i < LINE_CAPACITY; i++) if (a[i * LINE_FLOATS + 3]! < 0.25) under++;
    expect(under).toBeGreaterThan(LINE_CAPACITY * 0.1);
    expect(under).toBeLessThan(LINE_CAPACITY * 0.4);
  });
});

describe('constants', () => {
  it('LINE_PERIOD divides WORLD_PERIOD', () => {
    expect(WORLD_PERIOD % LINE_PERIOD).toBe(0);
  });
});

describe('lineLength', () => {
  it('is 8 at the floor and 40 at the top, clamped outside', () => {
    expect(lineLength(SPEED_FLOOR)).toBe(8);
    expect(lineLength(SPEED_MAX)).toBe(40);
    expect(lineLength(0)).toBe(8);
    expect(lineLength(SPEED_MAX * 2)).toBe(40);
  });
});
