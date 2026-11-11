import { describe, expect, it } from 'vitest';
import { Objective } from '../../../src/contracts/index';
import { formatKm, formatObjective, formatScore, formatSector, formatSync, kmKey, objectiveKey, sectorCode } from '../../../src/ui/format';

describe('formatScore', () => {
  it('pads, floors and switches to exponent form at 1e10', () => {
    expect(formatScore(0)).toBe('00000000');
    expect(formatScore(99999999)).toBe('99999999');
    expect(formatScore(99999999.9)).toBe('99999999');
    expect(formatScore(9999999999)).toBe('9999999999');
    expect(formatScore(9999999999).length).toBe(10);
    expect(formatScore(1e10)).toBe('1.000E+10');
    expect(formatScore(2 ** 53)).toBe('9.007E+15');
  });

  it('never prints a non-finite or negative value', () => {
    expect(formatScore(NaN)).toBe('--------');
    expect(formatScore(Infinity)).toBe('--------');
    expect(formatScore(-Infinity)).toBe('--------');
    expect(formatScore(-5)).toBe('00000000');
  });
});

describe('formatKm', () => {
  it('floors to tenths and never rounds up', () => {
    expect(formatKm(0)).toBe('0.0');
    expect(formatKm(99)).toBe('0.0');
    expect(formatKm(100)).toBe('0.1');
    expect(formatKm(199.99)).toBe('0.1');
    expect(formatKm(12345)).toBe('12.3');
    expect(formatKm(999_999_999)).toBe('999999.9');
  });

  it('uses exponent form from 1e6 km, floored', () => {
    expect(formatKm(1e9)).toBe('1.000E+6');
    expect(formatKm(1e15)).toBe('1.000E+12');
    expect(formatKm(1.9999e15)).toBe('1.999E+12');
    expect(formatKm(9.9999e15)).toBe('9.999E+12');
  });

  it('stays at most 9 characters everywhere', () => {
    for (let e = 0; e <= 22; e += 0.137) {
      const u = Math.pow(10, e);
      expect(formatKm(u).length, `u = ${u}`).toBeLessThanOrEqual(9);
    }
    expect(formatKm(Number.MAX_VALUE).length).toBeLessThanOrEqual(9);
    expect(formatKm((2 ** 48) * 64)).toBe('1.801E+13');
  });

  it('is safe on bad input', () => {
    expect(formatKm(NaN)).toBe('-------');
    expect(formatKm(Infinity)).toBe('-------');
    expect(formatKm(-1)).toBe('0.0');
  });

  it('kmKey changes exactly when the text does', () => {
    const us = [0, 50, 99, 100, 101, 12345, 12399, 12400, 1e9 - 1, 1e9, 1e9 + 5e5, 1e9 + 1e6, 1.2345e12, 1.2346e12, 1e15, 1e15 + 1e9, 1e15 + 1e12];
    for (let i = 1; i < us.length; i++) {
      const a = us[i - 1]!;
      const b = us[i]!;
      expect(kmKey(a) === kmKey(b), `${a} ${b}`).toBe(formatKm(a) === formatKm(b));
    }
  });
});

describe('short formats', () => {
  it('formatSync', () => {
    expect(formatSync(1)).toBe('×1');
    expect(formatSync(16)).toBe('×16');
  });

  it('formatSector', () => {
    expect(formatSector(7, 2)).toBe('S07 ULTRAVIOLET');
    expect(formatSector(0, 0)).toBe('S00 SUNSET DRIVE');
    expect(formatSector(123, 5)).toBe('S123 ARCTIC LASER');
    expect(formatSector(175921860444, 5)).toBe('S175921860444 ARCTIC LASER');
    expect(formatSector(1, 8)).toBe('S01 ULTRAVIOLET');
    expect(sectorCode(8)).toBe('S08');
    expect(formatSector(7, 2, 19)).toBe('S07 ULTRAVIOLET');
    expect(formatSector(175921860444, 5, 19)).toBe('S175921860444');
  });
});

describe('formatObjective', () => {
  it('counts for GATES, CHAIN and GRAZES', () => {
    expect(formatObjective(Objective.GATES, 6, 10)).toBe('GATES 6/10');
    expect(formatObjective(Objective.CHAIN, 6, 10)).toBe('CHAIN 6/10');
    expect(formatObjective(Objective.GRAZES, 6, 10)).toBe('GRAZES 6/10');
  });

  it('km for NO_HIT and BOOST', () => {
    expect(formatObjective(Objective.NO_HIT, 1234, 3200)).toBe('CLEAN 1.2/3.2 KM');
    expect(formatObjective(Objective.BOOST, 1299, 3200)).toBe('BOOST 1.2/3.2 KM');
  });

  it('marks done on all five and clamps progress to target', () => {
    expect(formatObjective(Objective.GATES, 10, 10)).toBe('GATES 10/10 OK');
    expect(formatObjective(Objective.CHAIN, 11, 10)).toBe('CHAIN 10/10 OK');
    expect(formatObjective(Objective.GRAZES, 10, 10)).toBe('GRAZES 10/10 OK');
    expect(formatObjective(Objective.NO_HIT, 3200, 3200)).toBe('CLEAN 3.2/3.2 KM OK');
    expect(formatObjective(Objective.BOOST, 9999, 3200)).toBe('BOOST 3.2/3.2 KM OK');
  });

  it('is safe on bad input', () => {
    expect(formatObjective(Objective.GATES, NaN, 10)).toBe('GATES 0/10');
    expect(formatObjective(Objective.GATES, -3, 10)).toBe('GATES 0/10');
    expect(formatObjective(99, 1, 10)).toBe('');
  });

  it('objectiveKey changes exactly when the text does', () => {
    const cases: [number, number, number][] = [
      [0, 5, 10], [0, 5.4, 10], [0, 6, 10], [1, 6, 10], [1, 6, 12],
      [3, 1200, 3200], [3, 1299, 3200], [3, 1300, 3200], [4, 1300, 3200], [4, 3199, 3200], [4, 3200, 3200], [4, 3300, 3200],
    ];
    for (let i = 1; i < cases.length; i++) {
      const a = cases[i - 1]!;
      const b = cases[i]!;
      expect(objectiveKey(...a) === objectiveKey(...b), `${a} ${b}`).toBe(formatObjective(...a) === formatObjective(...b));
    }
  });
});
