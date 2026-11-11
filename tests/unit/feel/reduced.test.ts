// A18: section 10.3. Under reduced motion the seven listed fields are exactly neutral on every frame, while duck and shipHold still work.
import { expect, test } from 'vitest';
import { CAMERA_FOV, Ev, SimMode, SPEED_MAX, type Feel } from '../../../src/contracts/index';
import { createNeutralFeel } from '../../../src/core/alloc';
import { createFeel } from '../../../src/feel/index';
import { plainEvents, plainState, pushEv, setClock } from './fixtures/frames';

const SEVEN = ['shakeX', 'shakeY', 'roll', 'flash', 'speedLines', 'aberration', 'glitch'] as const;

/** Boost, hits, gates and a turn, with a loss in the middle. Calls `each` after every frame. */
function flood(reduced: boolean, each: (f: Feel) => void): void {
  const feel = createFeel();
  const s = plainState();
  const e = plainEvents();
  let t = 0;
  for (let i = 0; i < 2000; i++) {
    const dt = 1 / 60;
    t += dt;
    setClock(s, t);
    s.speed = SPEED_MAX;
    s.prevX = s.x;
    s.x = 30 * Math.sin(i / 7);
    s.mode = i % 500 > 450 ? SimMode.SIGNAL_LOST : SimMode.PLAY;
    e.count = 0;
    if (i % 20 === 0) {
      pushEv(e, Ev.HIT, 2);
      pushEv(e, Ev.SIGNAL_LOST);
    }
    if (i % 7 === 0) pushEv(e, Ev.GATE, 500);
    if (i % 3 === 0) pushEv(e, Ev.SHARD, 100);
    feel.update(dt, s, e, reduced);
    each(feel);
  }
}

test('A18: the seven fields, fovDeg and bloomGain are exactly neutral on every frame', () => {
  const neutral = createNeutralFeel();
  let frames = 0;
  flood(true, (f) => {
    frames++;
    for (const k of SEVEN) {
      if (!Object.is(f.out[k], 0)) throw new Error(`${k} = ${f.out[k]} on frame ${frames}`);
    }
    expect(f.out.fovDeg).toBe(CAMERA_FOV);
    expect(f.out.bloomGain).toBe(neutral.bloomGain);
  });
  expect(frames).toBe(2000);
});

test('A18: duck and shipHold still respond, since neither moves the picture', () => {
  let duck = 0;
  let hold = 0;
  flood(true, (f) => {
    duck = Math.max(duck, f.out.duck);
    hold = Math.max(hold, f.out.shipHold);
  });
  expect(duck).toBe(1);
  expect(hold).toBe(0.07);
});

test('A18 negative control: the same flood with it off makes each of the seven differ, and fov and bloom too', () => {
  const peak: Record<string, number> = {};
  let fov = 0;
  let bloom = 0;
  flood(false, (f) => {
    for (const k of SEVEN) peak[k] = Math.max(peak[k] ?? 0, Math.abs(f.out[k]));
    fov = Math.max(fov, f.out.fovDeg);
    bloom = Math.max(bloom, f.out.bloomGain);
  });
  for (const k of SEVEN) expect(peak[k], k).toBeGreaterThan(0);
  expect(fov).toBeGreaterThan(CAMERA_FOV);
  expect(bloom).toBeGreaterThan(1);
});

test('switching the toggle does not pop: hidden state kept moving', () => {
  const s = plainState({ speed: SPEED_MAX });
  const e = plainEvents();
  const a = createFeel();
  const b = createFeel();
  for (let i = 0; i < 300; i++) {
    setClock(s, i / 60);
    a.update(1 / 60, s, e, true);
    b.update(1 / 60, s, e, false);
  }
  a.update(1 / 60, s, e, false);
  b.update(1 / 60, s, e, false);
  // The first frame back already reads what a never-reduced instance reads.
  expect({ ...a.out }).toEqual({ ...b.out });
  expect(a.out.fovDeg).toBeGreaterThan(CAMERA_FOV);
});
