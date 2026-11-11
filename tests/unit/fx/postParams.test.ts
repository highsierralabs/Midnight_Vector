// A5: what a FrameView means for the effects, on the same scriptedFrame the dev shell uses.
import { describe, expect, it } from 'vitest';
import type { FeelState, PostVariant } from '../../../src/contracts/index';
import { scriptedFrame, type ScriptedFrameOptions } from '../../../src/testing/scriptedFrame';
import { computePostParams, createPostParams, type PostParams } from '../../../src/render/fx/postParams';

function params(variant: PostVariant, o: ScriptedFrameOptions = {}, ratio = 1, gainMax = 1.5): PostParams {
  const out = createPostParams();
  computePostParams(scriptedFrame(0, { at: { chunk: 1, local: 12.5 }, tick: 0, ...o }), variant, ratio, gainMax, out);
  return out;
}

const feel = (f: Partial<FeelState>): ScriptedFrameOptions => ({ feel: f });

describe('chromatic aberration', () => {
  it('neutral at full is the low end, aberration 1 the high end', () => {
    const a = params('full');
    expect(a.caX).toBeCloseTo(0.0006, 12);
    expect(a.caY).toBeCloseTo(0.0003, 12);
    const b = params('full', feel({ aberration: 1 }));
    expect(b.caX).toBeCloseTo(0.0014, 12);
    expect(b.caY).toBeCloseTo(0.0007, 12);
  });

  it('is exactly 0 under noCa and under reduced motion', () => {
    for (const p of [params('noCa', feel({ aberration: 1 })), params('full', { reducedMotion: true, feel: { aberration: 1 } })]) {
      expect(p.caX).toBe(0);
      expect(p.caY).toBe(0);
    }
  });
});

describe('bloom', () => {
  it('scales .8 by the clamped gain', () => {
    expect(params('full', feel({ bloomGain: 1 })).bloomIntensity).toBeCloseTo(0.8, 12);
    expect(params('full', feel({ bloomGain: 1.25 })).bloomIntensity).toBeCloseTo(1.0, 12);
    expect(params('full', feel({ bloomGain: 9 })).bloomIntensity).toBeCloseTo(1.2, 12);
    expect(params('full', feel({ bloomGain: 0 })).bloomIntensity).toBe(0);
  });

  it('honours the dev-only gain limit', () => {
    expect(params('full', feel({ bloomGain: 3.75 }), 1, 9).bloomIntensity).toBeCloseTo(3, 12);
  });
});

describe('scan and grain', () => {
  it('min and bare have neither, with the period still set', () => {
    for (const v of ['min', 'bare'] as const) {
      const p = params(v);
      expect(p.scan).toBe(0);
      expect(p.grain).toBe(0);
      expect(p.scanPeriod).toBe(3);
    }
  });

  it('full and noCa have both, at the design values', () => {
    for (const v of ['full', 'noCa'] as const) {
      const p = params(v);
      expect(p.scan).toBeCloseTo(0.1, 9);
      expect(p.grain).toBeCloseTo(0.07, 12);
    }
  });

  it('reduced motion removes grain and keeps scan', () => {
    const p = params('noCa', { reducedMotion: true });
    expect(p.grain).toBe(0);
    expect(p.scan).toBeCloseTo(0.1, 9);
  });

  it('the period follows the pixel ratio', () => {
    expect(params('full', {}, 2).scanPeriod).toBe(6);
    expect(params('full', {}, 1.5).scanPeriod).toBe(5);
  });

  it('grainFrame steps every 5 ticks and wraps at 7680, at any tick', () => {
    const at = (tick: number): number => params('full', { tick }).grainFrame;
    expect(at(0)).toBe(0);
    for (let t = 0; t < 5; t++) expect(at(t)).toBe(0);
    expect(at(5)).toBe(1);
    expect(at(7679)).toBe(1535);
    expect(at(7680)).toBe(0);
    expect(at(7680 * 2 ** 39)).toBe(0);
    for (const t of [3, 99, 7000, 1e12 + 3, 2 ** 52 + 1]) {
      const g = at(t);
      expect(Number.isInteger(g)).toBe(true);
      expect(g).toBeLessThan(1536);
    }
  });
});

describe('exposure', () => {
  const at = (dayPhase: number): number => params('full', { zone: { dayPhase } }).exposure;

  it('is .88 at deepest night and 1 at midday', () => {
    expect(at(0)).toBeCloseTo(0.88, 12);
    expect(at(0.5)).toBeCloseTo(1, 12);
  });

  it('does not pop across the sawtooth wrap', () => {
    expect(Math.abs(at(0.001) - at(0.999))).toBeLessThan(1e-3);
  });
});

describe('flash', () => {
  it('passes the feel value, and scales the grid colour to luma .2 keeping its hue (T11 r09, DI-105)', () => {
    for (let palette = 0; palette < 6; palette++) {
      const v = scriptedFrame(0, { at: { chunk: 1, local: 12.5 }, tick: 0, palette, feel: { flash: 0.6 } });
      const grid = [v.zone.palette[15]!, v.zone.palette[16]!, v.zone.palette[17]!] as const;
      const p = createPostParams();
      computePostParams(v, 'full', 1, 1.5, p);
      expect(p.flash).toBeCloseTo(0.6, 12);
      expect(0.2126 * p.flashR + 0.7152 * p.flashG + 0.0722 * p.flashB, `palette ${palette}`).toBeCloseTo(0.2, 9);
      // One scale factor for all three channels, compared channel by channel, so a channel at exactly 0 never divides.
      const luma = 0.2126 * grid[0] + 0.7152 * grid[1] + 0.0722 * grid[2];
      expect(p.flashR).toBeCloseTo((grid[0] * 0.2) / luma, 6);
      expect(p.flashG).toBeCloseTo((grid[1] * 0.2) / luma, 6);
      expect(p.flashB).toBeCloseTo((grid[2] * 0.2) / luma, 6);
    }
  });
});

it('passes glitch through', () => {
  expect(params('full', feel({ glitch: 0.35 })).glitch).toBeCloseTo(0.35, 12);
});
