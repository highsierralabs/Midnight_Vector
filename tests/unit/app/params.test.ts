// A5: every row and bad value of the URL table.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED } from '../../../src/contracts/index';
import { parseParams } from '../../../src/app/params';

function parse(search: string): { p: ReturnType<typeof parseParams>; warns: string[] } {
  const warns: string[] = [];
  const p = parseParams(search, (m) => { warns.push(m); });
  return { p, warns };
}

describe('parseParams', () => {
  it('defaults: seed DEFAULT_SEED, aperiodic, no harness, no tier, no warning', () => {
    const { p, warns } = parse('');
    expect(p).toEqual({ seed: DEFAULT_SEED, harness: false, period: 0, tier: null });
    expect(warns).toEqual([]);
  });

  it('?harness gives period 1024; ?harness&period=0 is aperiodic; ?period=n is honoured under harness', () => {
    expect(parse('?harness').p).toEqual({ seed: DEFAULT_SEED, harness: true, period: 1024, tier: null });
    expect(parse('?harness&period=0').p.period).toBe(0);
    expect(parse('?harness&period=2048').p.period).toBe(2048);
    expect(parse('?harness&period=8').p.period).toBe(8);
  });

  it('?period without ?harness is ignored, with one warning', () => {
    const { p, warns } = parse('?period=0');
    expect(p.period).toBe(0);
    expect(p.harness).toBe(false);
    expect(warns.length).toBe(1);
    expect(parse('?period=2048').p.period).toBe(0);
  });

  it('?seed takes any safe integer, negative included', () => {
    expect(parse('?seed=42').p.seed).toBe(42);
    expect(parse('?seed=-7').p.seed).toBe(-7);
    expect(parse('?seed=9007199254740991').p.seed).toBe(9007199254740991);
  });

  for (const bad of ['1e400', '1.5', '', 'abc', '9007199254740993', '0x10', ' 5', '1e3']) {
    it(`?seed=${JSON.stringify(bad)} warns once and uses the default`, () => {
      const { p, warns } = parse(`?seed=${encodeURIComponent(bad)}`);
      expect(p.seed).toBe(DEFAULT_SEED);
      expect(warns.length).toBe(1);
    });
  }

  for (const bad of ['1e400', '1.5', '-8', '7', '', 'x', '12']) {
    it(`?harness&period=${JSON.stringify(bad)} warns once and uses 1024`, () => {
      const { p, warns } = parse(`?harness&period=${encodeURIComponent(bad)}`);
      expect(p.period).toBe(1024);
      expect(warns.length).toBe(1);
    });
  }

  it('?tier=0..4 forces that tier, in any mode', () => {
    for (const t of [0, 1, 2, 3, 4] as const) {
      expect(parse(`?tier=${t}`).p.tier).toBe(t);
      expect(parse(`?harness&tier=${t}`).p.tier).toBe(t);
    }
  });

  for (const bad of ['5', '-1', '1.5', '', 'x', '03', '1e400']) {
    it(`?tier=${JSON.stringify(bad)} warns once and is ignored`, () => {
      const { p, warns } = parse(`?tier=${encodeURIComponent(bad)}`);
      expect(p.tier).toBeNull();
      expect(warns.length).toBe(1);
    });
  }

  it('combines every switch', () => {
    const { p, warns } = parse('?harness&period=0&seed=11&tier=2');
    expect(p).toEqual({ seed: 11, harness: true, period: 0, tier: 2 });
    expect(warns).toEqual([]);
  });
});
