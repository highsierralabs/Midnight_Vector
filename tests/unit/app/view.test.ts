// A5: a mutable AppView type-checks as FrameView with no cast; the step 5 helpers.
import { describe, expect, it } from 'vitest';
import { CAMERA_Y, SIM_HZ, SimMode, type FrameView, type SimState } from '../../../src/contracts/index';
import { createEventBuffer, createNeutralFeel } from '../../../src/core/alloc';
import { between } from '../../../src/core/coords';
import { fakeProfile } from '../../../src/testing/scriptedFrame';
import { applyFeelOverride, copyFeel, createAppView, writeCamAt, writeCamStep } from '../../../src/app/view';

function sim(): SimState {
  return {
    tick: 100, travel: { chunk: 9, local: 0.3 }, stepDist: 1, speed: SIM_HZ,
    x: 10, y: 8, prevX: 6, prevY: 4, mode: SimMode.PLAY,
    score: 0, sync: 1, shields: 3, overdrive: 0, ghost: 0, beat: 0, sectorIndex: 0, objectiveProgress: 0,
    autopilot: false, warpSerial: 0,
  };
}

describe('AppView', () => {
  it('assigns to FrameView with no cast, and feel is writable', () => {
    const neutral = createNeutralFeel();
    const v = createAppView(sim(), createEventBuffer(), neutral, fakeProfile(3));
    const f: FrameView = v;
    const other = createNeutralFeel();
    v.feel = other;
    expect(f.feel).toBe(other);
    expect(f.phases.length).toBe(8);
    expect(f.zone.palette.length).toBe(21);
  });

  it('writeCamStep interpolates the camera between ticks T-1 and T, across a chunk boundary', () => {
    const s = sim();
    const v = createAppView(s, createEventBuffer(), createNeutralFeel(), fakeProfile(3));
    writeCamStep(v, s, { acc: 0.25 / SIM_HZ }, { gainX: 0.72 });
    expect(v.alpha).toBeCloseTo(0.25, 12);
    expect(between(s.travel, v.cam)).toBeCloseTo(0.75, 12);
    expect(v.cam.chunk).toBe(8);
    expect(v.camX).toBeCloseTo(0.72 * (6 + 4 * 0.25), 12);
    expect(v.camY).toBeCloseTo(CAMERA_Y + 0.15 * (4 + 4 * 0.25 - 6), 12);
    expect(v.tick).toBe(100);
  });

  it('writeCamStep caps alpha at 1', () => {
    const s = sim();
    const v = createAppView(s, createEventBuffer(), createNeutralFeel(), fakeProfile(3));
    writeCamStep(v, s, { acc: 2 / SIM_HZ }, { gainX: 1 });
    expect(v.alpha).toBe(1);
    expect(between(s.travel, v.cam)).toBe(0);
  });

  it('writeCamAt: alpha 0, dt 0, camX and camY from prevX and prevY', () => {
    const s = sim();
    const v = createAppView(s, createEventBuffer(), createNeutralFeel(), fakeProfile(3));
    v.dt = 1 / 60;
    v.alpha = 0.5;
    writeCamAt(v, s, { gainX: 0.9 });
    expect(v.alpha).toBe(0);
    expect(v.dt).toBe(0);
    expect(v.camX).toBe(0.9 * 6);
    expect(v.camY).toBe(CAMERA_Y + 0.15 * (4 - 6));
  });

  it('copyFeel copies every field, and applyFeelOverride writes only the ones given', () => {
    const src = createNeutralFeel();
    let k = 1;
    for (const key of Object.keys(src) as (keyof typeof src)[]) src[key] = k++;
    const dst = createNeutralFeel();
    copyFeel(src, dst);
    expect(dst).toEqual(src);
    applyFeelOverride({ shakeY: -0.05, bloomGain: 0 }, dst);
    expect(dst).toEqual({ ...src, shakeY: -0.05, bloomGain: 0 });
    const all = createNeutralFeel();
    applyFeelOverride(src, all);
    expect(all).toEqual(src);
  });
});
