// A17: under event floods, every field stays in its range, and the caps are really reached, so a cap that does nothing fails.
import { expect, test } from 'vitest';
import { CAMERA_FOV, CAMERA_FOV_MAX, Ev, EVENT_CAPACITY, SimMode, SPEED_MAX, type FeelState } from '../../../src/contracts/index';
import { createFeel } from '../../../src/feel/index';
import { FEEL_TUNING as F } from '../../../src/feel/tuning';
import { plainEvents, plainState, pushEv, setClock } from './fixtures/frames';

const RANGES: Record<keyof FeelState, readonly [number, number]> = {
  shakeX: [-F.SHAKE_YAW_MAX, F.SHAKE_YAW_MAX],
  shakeY: [-F.SHAKE_PITCH_MAX, F.SHAKE_PITCH_MAX],
  roll: [-(F.BANK_ROLL_MAX + F.SHAKE_ROLL_MAX), F.BANK_ROLL_MAX + F.SHAKE_ROLL_MAX],
  fovDeg: [CAMERA_FOV, CAMERA_FOV_MAX],
  aberration: [0, 1],
  flash: [0, 0.6],
  speedLines: [0, 1],
  bloomGain: [1, 1.25],
  glitch: [0, 1],
  duck: [0, 1],
  shipHold: [0, 0.07],
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('A17: 1e5 frames of random dt, floods of 64 events and random speed stay in range, and reach every cap', () => {
  const rand = mulberry32(1985);
  const feel = createFeel();
  const s = plainState();
  const e = plainEvents();
  const keys = Object.keys(RANGES) as (keyof FeelState)[];
  const max: Record<string, number> = {};
  const min: Record<string, number> = {};
  for (const k of keys) {
    max[k] = -Infinity;
    min[k] = Infinity;
  }
  const kinds = [Ev.SHARD, Ev.GATE, Ev.GATE_MISS, Ev.GRAZE, Ev.HIT, Ev.SIGNAL_LOST, Ev.SECTOR, Ev.GRADE, Ev.BOOST_ON, Ev.BOOST_OFF] as const;
  let t = 0;
  let boostFrames = 0;
  for (let i = 0; i < 1e5; i++) {
    const r = rand();
    // A run of boosted frames in places, so the eased values have time to reach their caps.
    const inBurst = (i >> 8) % 3 === 0;
    const dt = r < 0.05 ? 0 : inBurst ? rand() * 0.25 : rand() * 0.02;
    t += dt;
    setClock(s, t);
    s.prevX = s.x;
    s.x = 40 * (2 * rand() - 1);
    s.speed = inBurst ? SPEED_MAX : 45 + rand() * (SPEED_MAX - 45);
    if (inBurst) boostFrames++;
    s.mode = rand() < 0.2 ? SimMode.SIGNAL_LOST : SimMode.PLAY;
    e.count = 0;
    const flood = rand() < 0.3 ? EVENT_CAPACITY : Math.floor(rand() * 4);
    const hitsAllowed = rand() < 0.5;
    for (let n = 0; n < flood; n++) {
      const kind = kinds[Math.floor(rand() * kinds.length)]!;
      if (!hitsAllowed && (kind === Ev.HIT || kind === Ev.SIGNAL_LOST)) continue;
      pushEv(e, kind, rand() * 1000);
    }
    feel.update(dt, s, e, false);
    const out = feel.out;
    for (const k of keys) {
      const v = out[k];
      const [lo, hi] = RANGES[k];
      if (!Number.isFinite(v) || v < lo - 1e-9 || v > hi + 1e-9) throw new Error(`frame ${i}: ${k} = ${v}, range ${lo}..${hi}`);
      if (v > max[k]!) max[k] = v;
      if (v < min[k]!) min[k] = v;
    }
  }
  expect(boostFrames).toBeGreaterThan(1000);
  // Non-vacuous: the run's maximum equals the cap, so without the cap these would pass it.
  expect(max['fovDeg']).toBe(CAMERA_FOV_MAX);
  expect(max['flash']).toBe(0.6);
  expect(max['bloomGain']).toBe(1.25);
  expect(max['aberration']).toBe(1);
  expect(max['glitch']).toBe(1);
  expect(max['duck']).toBe(1);
  expect(max['shipHold']).toBe(0.07);
  // The other direction moved too, so the range checks saw both ends of the signed fields.
  expect(min['shakeY']).toBeLessThan(0);
  expect(max['shakeY']).toBeGreaterThan(0);
  expect(min['roll']).toBeLessThan(0);
  expect(max['roll']).toBeGreaterThan(0);
});

test('the flood above is big enough to need the caps: uncapped it would pass each of them', () => {
  expect(64 * F.FLASH_HIT).toBeGreaterThan(F.FLASH_CAP);
  expect(64 * F.BLOOM_GATE).toBeGreaterThan(F.BLOOM_GAIN_CAP - 1);
  expect(64 * F.ABERR_HIT).toBeGreaterThan(F.ABERR_CAP);
});

test('NaN and a negative dt are treated as 0, and a NaN state field does not poison the output', () => {
  const feel = createFeel();
  const s = plainState();
  const e = plainEvents();
  feel.update(0.016, s, e, false);
  const before = { ...feel.out };
  feel.update(NaN, s, e, false);
  feel.update(-5, s, e, false);
  expect({ ...feel.out }).toEqual(before);
  feel.update(0.016, plainState({ speed: NaN, x: NaN, beat: NaN }), e, false);
  for (const v of Object.values(feel.out)) expect(Number.isFinite(v)).toBe(true);
});
