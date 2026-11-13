// T13 A1 and A2: the player's camera. The view origin never moves backward on a camera change, each camera rests where
// plans/T13-views.md section 4 says, DEMO draws chase, and a forced camera or renderState snaps.
import { describe, expect, it } from 'vitest';
import { CAMERA_Y, CamMode, SHIP_FORWARD, SIM_HZ, SimMode, type SimState, type Travel } from '../../../src/contracts/index';
import { createEventBuffer, createNeutralFeel } from '../../../src/core/alloc';
import { advance, between } from '../../../src/core/coords';
import { fakeProfile } from '../../../src/testing/scriptedFrame';
import {
  CAM_BACK_SHARE, COCKPIT_IN_SPAN, EYE_UP_COCKPIT, EYE_UP_NOSE, NOSE_AHEAD, createCamState, moveCam, type CamState,
} from '../../../src/app/cam';
import { FOLLOW_Y } from '../../../src/app/follow';
import { createAppView, writeCamAt, writeCamStep, type AppView } from '../../../src/app/view';

const GAIN = 0.793;

function sim(): SimState {
  return {
    tick: 100, travel: { chunk: 9, local: 0.3 }, stepDist: 1, speed: SIM_HZ,
    x: 10, y: 8, prevX: 10, prevY: 8, mode: SimMode.PLAY,
    score: 0, sync: 1, shields: 3, overdrive: 0, ghost: 0, beat: 0, sectorIndex: 0, objectiveProgress: 0,
    autopilot: false, warpSerial: 0,
  };
}

function rig(): { s: SimState; v: AppView; c: CamState } {
  const s = sim();
  return { s, v: createAppView(s, createEventBuffer(), createNeutralFeel(), fakeProfile(3)), c: createCamState() };
}

/** One sim step of `dist` u and one frame of dt seconds at alpha 1, as the loop does it. */
function frame(r: { s: SimState; v: AppView; c: CamState }, dist: number, dt: number, forced: CamMode | null = null): void {
  advance(r.s.travel, dist);
  r.s.stepDist = dist;
  r.s.tick += 1;
  writeCamStep(r.v, r.s, { acc: 1 / SIM_HZ }, { gainX: GAIN });
  moveCam(r.c, r.v, r.s, forced, { dt }, false);
}

/** A small deterministic generator, so the fuzz needs no Math.random. */
function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

/**
 * The fuzz of A1 with the backward share given: every frame is one sim step of speed * dt, the camera changes at random,
 * and the view origin is compared with the one before. Returns how many frames moved it backward.
 */
function backwardFrames(share: number, frames: number): number {
  const r = rig();
  const rnd = lcg(1985);
  const prev: Travel = { chunk: 0, local: 0 };
  let bad = 0;
  frame(r, 1, 1 / 60);
  prev.chunk = r.v.cam.chunk;
  prev.local = r.v.cam.local;
  for (let i = 0; i < frames; i++) {
    if (rnd() < 0.02) r.c.want = Math.floor(rnd() * 3) as CamMode;
    const speed = 27 + rnd() * 123;
    const dt = 0.002 + rnd() * rnd() * 0.248;
    const dist = speed * dt;
    if (share === CAM_BACK_SHARE) {
      frame(r, dist, dt);
    } else {
      // The control cannot change the module's constant, so it lets moveCam run and then replays the backward rule with
      // the other share, on the two values that rule writes: camAhead and the view origin.
      const before = r.c.ahead;
      frame(r, dist, dt);
      const goal = r.c.mode === CamMode.CHASE ? 0 : r.c.mode === CamMode.COCKPIT ? SHIP_FORWARD : NOSE_AHEAD;
      if (before > goal) {
        const wrong = Math.max(goal, before - share * dist);
        advance(r.v.cam, wrong - r.c.ahead);
        r.c.ahead = wrong;
      }
    }
    if (between(r.v.cam, prev) < 0) bad += 1;
    prev.chunk = r.v.cam.chunk;
    prev.local = r.v.cam.local;
  }
  return bad;
}

describe('moveCam: the view origin', () => {
  it('A1: never moves backward over 10,000 fuzzed frames of speeds, frame times and camera changes', () => {
    expect(backwardFrames(CAM_BACK_SHARE, 10_000)).toBe(0);
  });

  it('A1 control: with a backward share of 1.5 the same fuzz moves it backward', () => {
    expect(backwardFrames(1.5, 10_000)).toBeGreaterThan(0);
  });

  it('reaches each camera and rests there', () => {
    const r = rig();
    for (const [mode, ahead] of [[CamMode.COCKPIT, SHIP_FORWARD], [CamMode.NOSE, NOSE_AHEAD], [CamMode.COCKPIT, SHIP_FORWARD], [CamMode.CHASE, 0]] as const) {
      r.c.want = mode;
      for (let i = 0; i < 240; i++) frame(r, 80 / 60, 1 / 60);
      expect(r.v.camMode).toBe(mode);
      expect(r.v.camAhead).toBe(ahead);
      expect(between(r.v.cam, r.s.travel)).toBeCloseTo(ahead, 9);
      expect(r.v.cockpitIn).toBe(mode === CamMode.COCKPIT ? 1 : 0);
    }
  });

  it('regains chase in 14 / (share * speed) s: 12 frames at cruise, 35 at the reduced-motion floor', () => {
    for (const [speed, frames] of [[80, 12], [27, 35]] as const) {
      const r = rig();
      frame(r, 1, 1 / 60, CamMode.COCKPIT);
      expect(r.v.camAhead).toBe(SHIP_FORWARD);
      let n = 0;
      while (r.v.camAhead > 0 && n < 1000) {
        frame(r, speed / 60, 1 / 60);
        n += 1;
      }
      expect(n).toBe(frames);
    }
  });
});

describe('moveCam: where each camera rests (A2)', () => {
  it('chase leaves the frame exactly as writeCamStep wrote it', () => {
    const r = rig();
    r.s.x = 12; r.s.prevX = 11; r.s.y = 9; r.s.prevY = 7;
    writeCamStep(r.v, r.s, { acc: 0.5 / SIM_HZ }, { gainX: GAIN });
    const want = { chunk: r.v.cam.chunk, local: r.v.cam.local, camX: r.v.camX, camY: r.v.camY };
    moveCam(r.c, r.v, r.s, null, { dt: 1 / 60 }, false);
    expect({ chunk: r.v.cam.chunk, local: r.v.cam.local, camX: r.v.camX, camY: r.v.camY }).toEqual(want);
    expect([r.v.camMode, r.v.camAhead, r.v.cockpitIn]).toEqual([CamMode.CHASE, 0, 0]);
  });

  it('cockpit: the ship plane, the eye EYE_UP_COCKPIT over the interpolated ship', () => {
    const r = rig();
    r.s.x = 12; r.s.prevX = 11; r.s.y = 9; r.s.prevY = 7;
    writeCamStep(r.v, r.s, { acc: 0.5 / SIM_HZ }, { gainX: GAIN });
    moveCam(r.c, r.v, r.s, CamMode.COCKPIT, { dt: 1 / 60 }, false);
    expect(r.v.camAhead).toBe(SHIP_FORWARD);
    expect(r.v.camX).toBeCloseTo(11.5, 12);
    expect(r.v.camY).toBeCloseTo(8 + EYE_UP_COCKPIT, 12);
    expect(r.v.cockpitIn).toBe(1);
    expect(between(r.v.cam, r.s.travel)).toBeCloseTo(SHIP_FORWARD - 0.5, 12);
  });

  it('nose: the nose tip, the eye EYE_UP_NOSE over the ship, and no cockpit', () => {
    const r = rig();
    writeCamAt(r.v, r.s, { gainX: GAIN });
    moveCam(r.c, r.v, r.s, CamMode.NOSE, { dt: 0 }, true);
    expect(r.v.camAhead).toBe(NOSE_AHEAD);
    expect(r.v.camX).toBeCloseTo(10, 12);
    expect(r.v.camY).toBeCloseTo(8 + EYE_UP_NOSE, 12);
    expect(r.v.cockpitIn).toBe(0);
  });

  it('A2 control: the two eye heights differ, so a swap would fail the rows above', () => {
    expect(EYE_UP_COCKPIT).not.toBe(EYE_UP_NOSE);
    expect(EYE_UP_COCKPIT).toBeGreaterThan(EYE_UP_NOSE);
  });

  it('DEMO draws chase whatever the player chose, and the choice returns with PLAY', () => {
    const r = rig();
    r.c.want = CamMode.NOSE;
    r.s.mode = SimMode.DEMO;
    for (let i = 0; i < 60; i++) frame(r, 80 / 60, 1 / 60);
    expect([r.v.camMode, r.v.camAhead]).toEqual([CamMode.CHASE, 0]);
    expect(r.v.camY).toBeCloseTo(CAMERA_Y + FOLLOW_Y * (8 - 6), 12);
    r.s.mode = SimMode.PLAY;
    for (let i = 0; i < 60; i++) frame(r, 80 / 60, 1 / 60);
    expect([r.v.camMode, r.v.camAhead]).toEqual([CamMode.NOSE, NOSE_AHEAD]);
  });

  it('a forced camera snaps, and so does renderState; null gives the choice back', () => {
    const r = rig();
    frame(r, 1, 1 / 60);
    frame(r, 1, 1 / 60, CamMode.COCKPIT);
    expect([r.v.camMode, r.v.camAhead, r.v.cockpitIn]).toEqual([CamMode.COCKPIT, SHIP_FORWARD, 1]);
    frame(r, 1, 1 / 60, CamMode.CHASE);
    expect([r.v.camMode, r.v.camAhead, r.v.cockpitIn]).toEqual([CamMode.CHASE, 0, 0]);
    r.c.want = CamMode.NOSE;
    writeCamAt(r.v, r.s, { gainX: GAIN });
    moveCam(r.c, r.v, r.s, null, { dt: 0 }, true);
    expect([r.v.camMode, r.v.camAhead]).toEqual([CamMode.NOSE, NOSE_AHEAD]);
  });

  it('a warp and a travel that went backward both snap', () => {
    const r = rig();
    r.c.want = CamMode.COCKPIT;
    frame(r, 1, 1 / 60);
    expect(r.v.camAhead).toBe(SHIP_FORWARD);          // the first call snaps
    r.c.want = CamMode.CHASE;
    frame(r, 1, 1 / 60);
    expect(r.v.camAhead).toBeCloseTo(SHIP_FORWARD - CAM_BACK_SHARE, 12);
    r.s.warpSerial += 1;
    frame(r, 1, 1 / 60);
    expect(r.v.camAhead).toBe(0);
    r.c.want = CamMode.COCKPIT;
    frame(r, 1, 1 / 60);
    expect(r.v.camAhead).toBeGreaterThan(0);
    expect(r.v.camAhead).toBeLessThan(SHIP_FORWARD);
    advance(r.s.travel, -200);
    frame(r, 1, 1 / 60);
    expect(r.v.camAhead).toBe(SHIP_FORWARD);
  });
});

describe('moveCam: the cockpit arrives and leaves', () => {
  it('rises over the last COCKPIT_IN_SPAN u from chase, and never shows on the way from chase to nose', () => {
    const r = rig();
    frame(r, 1, 1 / 60);
    r.c.want = CamMode.COCKPIT;
    let last = 0;
    for (let i = 0; i < 60; i++) {
      frame(r, 80 / 60, 1 / 60);
      expect(r.v.cockpitIn).toBeGreaterThanOrEqual(last);
      if (r.v.camAhead <= SHIP_FORWARD - COCKPIT_IN_SPAN) expect(r.v.cockpitIn).toBe(0);
      last = r.v.cockpitIn;
    }
    expect(last).toBe(1);

    const n = rig();
    frame(n, 1, 1 / 60);
    n.c.want = CamMode.NOSE;
    for (let i = 0; i < 60; i++) {
      frame(n, 80 / 60, 1 / 60);
      expect(n.v.cockpitIn).toBe(0);
    }
    n.c.want = CamMode.CHASE;
    for (let i = 0; i < 60; i++) {
      frame(n, 80 / 60, 1 / 60);
      expect(n.v.cockpitIn).toBe(0);
    }
  });

  it('falls on the way to chase and on the way to the nose', () => {
    for (const to of [CamMode.CHASE, CamMode.NOSE]) {
      const r = rig();
      frame(r, 1, 1 / 60, CamMode.COCKPIT);
      r.c.want = to;
      let last = 1;
      for (let i = 0; i < 60; i++) {
        frame(r, 80 / 60, 1 / 60);
        expect(r.v.cockpitIn).toBeLessThanOrEqual(last);
        last = r.v.cockpitIn;
      }
      expect(last).toBe(0);
    }
  });
});
