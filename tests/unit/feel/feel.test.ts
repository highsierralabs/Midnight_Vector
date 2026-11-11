// A16 and the feel half of A20: the shapes over time, and a picture to open.
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { CAMERA_FOV, CAMERA_FOV_MAX, Ev, SimMode, SPEED_CRUISE, SPEED_MAX, type Feel, type FeelState, type SimState } from '../../../src/contracts/index';
import { createNeutralFeel } from '../../../src/core/alloc';
import { createFeel } from '../../../src/feel/index';
import { FEEL_TUNING as F } from '../../../src/feel/tuning';
import { plainEvents, plainState, pushEv, setClock } from './fixtures/frames';
import { createCanvas, type Rgb } from './fixtures/png';

const DT = 1 / 60;

/** Runs frames of DT for `seconds`, with no events, from the clock at `t`. Returns the new time. */
function quiet(feel: Feel, s: SimState, t0: number, seconds: number, each?: () => void): number {
  const e = plainEvents();
  let t = t0;
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    t += DT;
    setClock(s, t);
    feel.update(DT, s, e, false);
    each?.();
  }
  return t;
}

function fire(feel: Feel, s: SimState, ...kinds: Ev[]): void {
  const e = plainEvents();
  for (const k of kinds) pushEv(e, k);
  feel.update(0, s, e, false);
}

describe('neutral', () => {
  test('starts equal to createNeutralFeel()', () => {
    expect({ ...createFeel().out }).toEqual(createNeutralFeel());
  });

  test('quiet cruise settles to neutral, except speed lines near 0.125 and bloom within 0.03 on the beat', () => {
    const feel = createFeel();
    const s = plainState();
    const t = quiet(feel, s, 0, 5);
    const out = feel.out;
    expect(out.shakeX).toBe(0);
    expect(out.shakeY).toBe(0);
    expect(out.roll).toBeCloseTo(0, 12);
    expect(out.fovDeg).toBeCloseTo(CAMERA_FOV, 6);
    expect(out.flash).toBe(0);
    expect(out.aberration).toBe(0);
    expect(out.glitch).toBe(0);
    expect(out.duck).toBe(0);
    expect(out.shipHold).toBe(0);
    expect(out.speedLines).toBeCloseTo(0.125, 3);
    // The pulse has its own beat, and it stays small.
    let hi = 0;
    let lo = Infinity;
    quiet(feel, s, t, 3, () => {
      hi = Math.max(hi, feel.out.bloomGain);
      lo = Math.min(lo, feel.out.bloomGain);
    });
    expect(hi).toBeLessThanOrEqual(1.03 + 1e-12);
    expect(hi).toBeGreaterThan(1.02);
    expect(lo).toBeLessThan(1.005);
  });
});

describe('a hit', () => {
  test('raises shake, flash, glitch, duck and shipHold 0.07 at once', () => {
    const feel = createFeel();
    const s = plainState();
    setClock(s, 1 + 7 / 120);   // Not a tick where the sines all pass 0.
    fire(feel, s, Ev.HIT);
    const out = feel.out;
    expect(out.flash).toBe(F.FLASH_HIT);
    expect(out.glitch).toBe(1);
    expect(out.duck).toBe(1);
    expect(out.shipHold).toBe(F.HITSTOP_S);
    expect(out.aberration).toBe(F.ABERR_HIT);
    expect(Math.abs(out.shakeX) + Math.abs(out.shakeY)).toBeGreaterThan(0);
  });

  test('each returns to neutral in its stated time', () => {
    const at = (seconds: number): FeelState => {
      const feel = createFeel();
      const s = plainState();
      setClock(s, 1);
      fire(feel, s, Ev.HIT);
      quiet(feel, s, 1, seconds);
      return { ...feel.out };
    };
    // Linear, so exact to within a frame.
    expect(at(0.05).shipHold).toBeGreaterThan(0);
    expect(at(0.0834).shipHold).toBe(0);
    expect(at(0.15).glitch).toBeGreaterThan(0);
    expect(at(0.2167).glitch).toBe(0);
    expect(at(0.38).duck).toBeGreaterThan(0);
    expect(at(0.4167).duck).toBe(0);
    // Exponential, so read as a time constant: one tau leaves e^-1.
    expect(at(6 * DT).flash).toBeCloseTo(F.FLASH_HIT * Math.exp((-6 * DT) / F.FLASH_TAU), 9);
    expect(at(12 * DT).aberration).toBeCloseTo(F.ABERR_HIT * Math.exp((-12 * DT) / F.ABERR_TAU), 9);
    expect(at(1.5).flash).toBe(0);
    expect(at(2.5).aberration).toBe(0);
    // Trauma 0.7 decays at 1.6 per s, so the shake ends at 0.4375 s.
    const shake = at(0.43);
    const done = at(0.45);
    expect(Math.abs(shake.shakeX) + Math.abs(shake.shakeY)).toBeLessThan(1e-3);
    expect(done.shakeX).toBe(0);
    expect(done.shakeY).toBe(0);
  });

  test('SIGNAL_LOST holds the glitch at 0.35 while it lasts, then lets go', () => {
    const feel = createFeel();
    const s = plainState({ mode: SimMode.SIGNAL_LOST });
    setClock(s, 1);
    fire(feel, s, Ev.HIT, Ev.SIGNAL_LOST);
    expect(feel.out.glitch).toBe(1);
    const t = quiet(feel, s, 1, 1);
    expect(feel.out.glitch).toBe(F.GLITCH_SIGNAL_LOST_HOLD);
    s.mode = SimMode.PLAY;
    quiet(feel, s, t, 0.4);
    expect(feel.out.glitch).toBe(0);
  });

  test('trauma from a loss is full, and two hits saturate without passing 1', () => {
    const peak = (...kinds: Ev[]): number => {
      const feel = createFeel();
      const s = plainState();
      setClock(s, 1 + 3 / 120);
      fire(feel, s, ...kinds);
      return Math.abs(feel.out.shakeY);
    };
    const single = peak(Ev.HIT);
    const loss = peak(Ev.SIGNAL_LOST);
    const flood = peak(Ev.HIT, Ev.HIT, Ev.HIT, Ev.SIGNAL_LOST);
    expect(loss).toBeCloseTo(single / (0.7 * 0.7), 9);
    expect(flood).toBeCloseTo(loss, 12);
  });
});

describe('bank', () => {
  test('moving right gives negative roll, and left positive', () => {
    const feel = createFeel();
    const s = plainState();
    s.x = 0.5;
    s.prevX = 0;
    quiet(feel, s, 0, 2);
    expect(feel.out.roll).toBeLessThan(0);
    expect(feel.out.roll).toBeCloseTo(-F.BANK_ROLL_MAX, 3);
    s.x = -0.5;
    quiet(feel, s, 2, 2);
    expect(feel.out.roll).toBeGreaterThan(0);
  });
});

describe('field of view', () => {
  test('boost takes it to 66, boost plus gate to 68', () => {
    const feel = createFeel();
    const s = plainState({ speed: SPEED_MAX });
    const t = quiet(feel, s, 0, 6);
    expect(feel.out.fovDeg).toBeCloseTo(66, 3);
    fire(feel, s, Ev.GATE);
    expect(feel.out.fovDeg).toBeCloseTo(68, 3);
    fire(feel, s, Ev.GATE, Ev.GATE, Ev.GATE);
    expect(feel.out.fovDeg).toBeCloseTo(68, 3);
    expect(feel.out.fovDeg).toBeLessThanOrEqual(CAMERA_FOV_MAX);
    quiet(feel, s, t, 2);
    expect(feel.out.fovDeg).toBeCloseTo(66, 2);
  });

  test('at cruise a gate pulses it by 2, once, and it comes back', () => {
    const feel = createFeel();
    const s = plainState({ speed: SPEED_CRUISE });
    quiet(feel, s, 0, 2);
    fire(feel, s, Ev.GATE);
    expect(feel.out.fovDeg).toBeCloseTo(60, 6);
    fire(feel, s, Ev.GATE, Ev.GATE);
    expect(feel.out.fovDeg).toBeCloseTo(60, 6);
  });
});

describe('cosmetic events pulse too', () => {
  test('value 0 on GATE and SHARD still flashes, so the title screen breathes', () => {
    const feel = createFeel();
    const s = plainState({ mode: SimMode.DEMO, autopilot: true });
    fire(feel, s, Ev.GATE, Ev.SHARD);
    expect(feel.out.flash).toBeCloseTo(F.FLASH_GATE + F.FLASH_SHARD, 12);
    expect(feel.out.bloomGain).toBeGreaterThan(1.1);
  });
});

describe('frame-rate independence', () => {
  /** The same event stream, with events on times both rates sample. Returns values at each multiple of 1/30 s. */
  function sampled(dt: number): FeelState[] {
    const feel = createFeel();
    const s = plainState();
    const e = plainEvents();
    const out: FeelState[] = [];
    const framesPerSample = Math.round(1 / 30 / dt);
    for (let i = 1; i <= Math.round(10 / dt); i++) {
      const t = i * dt;
      setClock(s, t);
      s.speed = t > 2 && t < 5 ? Math.min(SPEED_MAX, SPEED_CRUISE + (t - 2) * 70) : t >= 5 ? Math.max(SPEED_CRUISE, SPEED_MAX - (t - 5) * 45) : SPEED_CRUISE;
      s.prevX = 0;
      s.x = (Math.sin(t) * 30) / 120;
      e.count = 0;
      const sampleIndex = i / framesPerSample;
      if (Number.isInteger(sampleIndex)) {
        if (sampleIndex === 30 || sampleIndex === 180) pushEv(e, Ev.GATE);
        if (sampleIndex === 90) pushEv(e, Ev.HIT);
      }
      feel.update(dt, s, e, false);
      if (Number.isInteger(sampleIndex)) out.push({ ...feel.out });
    }
    return out;
  }

  test('at dt 1/30 and 1/240 the values agree within 5% at matching times', () => {
    const coarse = sampled(1 / 30);
    const fine = sampled(1 / 240);
    expect(coarse.length).toBe(fine.length);
    const RANGE = {
      fovDeg: CAMERA_FOV_MAX, flash: 0.6, aberration: 1, bloomGain: 1.25, speedLines: 1, glitch: 1, duck: 1, shipHold: 0.07,
      shakeX: 2 * F.SHAKE_YAW_MAX, shakeY: 2 * F.SHAKE_PITCH_MAX, roll: 2 * (F.BANK_ROLL_MAX + F.SHAKE_ROLL_MAX),
    } as const;
    const fields = Object.keys(RANGE) as (keyof typeof RANGE)[];
    let compared = 0;
    let worst = 0;
    for (let i = 0; i < coarse.length; i++) {
      for (const f of fields) {
        const a = coarse[i]![f];
        const b = fine[i]![f];
        // A ratio means nothing as a signal passes through 0, so it is taken against at least 2% of the field's range.
        const scale = Math.max(Math.abs(a), Math.abs(b), 0.02 * RANGE[f]);
        const relative = Math.abs(a - b) / scale;
        worst = Math.max(worst, relative);
        compared++;
        if (relative > 0.05) throw new Error(`sample ${i} ${f}: ${a} at 1/30, ${b} at 1/240`);
      }
    }
    console.log(`FEEL_RATE compared ${compared} values, worst relative difference ${(100 * worst).toFixed(2)}%`);
    expect(compared).toBeGreaterThan(1000);
  });
});

describe('the picture', () => {
  test('writes test-results/T02/feel-trace.png: 20 s with boost, gates, two hits and a SIGNAL_LOST', () => {
    const path = fileURLToPath(new URL('../../../test-results/T02/feel-trace.png', import.meta.url));
    const feel = createFeel();
    const s = plainState();
    const e = plainEvents();
    const SERIES: readonly { name: keyof FeelState; lo: number; hi: number; colour: Rgb }[] = [
      { name: 'fovDeg', lo: 58, hi: 68, colour: [90, 200, 255] },
      { name: 'flash', lo: 0, hi: 0.6, colour: [255, 255, 255] },
      { name: 'aberration', lo: 0, hi: 1, colour: [255, 90, 200] },
      { name: 'bloomGain', lo: 1, hi: 1.25, colour: [255, 200, 90] },
      { name: 'speedLines', lo: 0, hi: 1, colour: [120, 255, 140] },
      { name: 'shakeY', lo: -0.012, hi: 0.012, colour: [255, 120, 90] },
      { name: 'roll', lo: -0.07, hi: 0.07, colour: [170, 140, 255] },
    ];
    const WIDTH = 1600;
    const ROW = 120;
    const canvas = createCanvas(WIDTH, ROW * SERIES.length, [12, 12, 20]);
    for (let i = 0; i < SERIES.length; i++) {
      const top = i * ROW;
      canvas.hline(top, 0, WIDTH - 1, [50, 50, 70]);
      canvas.hline(top + ROW - 6, 0, WIDTH - 1, [50, 50, 70]);
      canvas.hline(top + 4, 0, WIDTH - 1, [50, 50, 70]);
      for (let sec = 0; sec <= 20; sec++) canvas.vline((sec / 20) * (WIDTH - 1), top + 4, top + ROW - 6, [30, 30, 44]);
    }
    const FPS = 60;
    const SECONDS = 20;
    const eventAt = (t: number, k: number): boolean => Math.abs(t - k) < 0.5 / FPS;
    const peaks: Record<string, number> = {};
    let x = 0;
    for (let i = 1; i <= SECONDS * FPS; i++) {
      const t = i / FPS;
      setClock(s, t);
      const boosting = (t > 3 && t < 7);
      const target = boosting ? SPEED_MAX : SPEED_CRUISE;
      const step = (boosting ? 70 : 45) / FPS;
      s.speed += Math.max(-step, Math.min(step, target - s.speed));
      s.prevX = x;
      x = 15 * Math.sin((2 * Math.PI * t) / 6);
      s.x = x;
      // The sim's own x difference per step, one 120 Hz step's worth.
      s.prevX = x - ((15 * 2 * Math.PI) / 6) * Math.cos((2 * Math.PI * t) / 6) / 120;
      const losing = t >= 14 && t < 17;
      s.mode = losing ? SimMode.SIGNAL_LOST : SimMode.PLAY;
      e.count = 0;
      for (const g of [1, 4, 5, 8, 9.5, 11, 13, 18, 19]) if (eventAt(t, g)) pushEv(e, Ev.GATE);
      for (let k = 0; k < 40; k++) if (eventAt(t, 0.5 + k * 0.5) && !boosting) pushEv(e, Ev.SHARD);
      for (const h of [6, 10.5]) if (eventAt(t, h)) pushEv(e, Ev.HIT);
      if (eventAt(t, 14)) { pushEv(e, Ev.HIT); pushEv(e, Ev.SIGNAL_LOST); }
      feel.update(1 / FPS, s, e, false);
      for (let r = 0; r < SERIES.length; r++) {
        const series = SERIES[r]!;
        const v = feel.out[series.name];
        peaks[series.name] = Math.max(peaks[series.name] ?? -Infinity, Math.abs(v));
        const px = (t / SECONDS) * (WIDTH - 1);
        const u = (v - series.lo) / (series.hi - series.lo);
        const py = r * ROW + 4 + (1 - u) * (ROW - 10);
        canvas.dot(px, py, series.colour, 1);
      }
    }
    canvas.save(path);
    console.log(`TRACE ${path}: peaks ${JSON.stringify(peaks)}`);
    // The run is not vacuous, and nothing is stuck high at the end: a shard's flash at most, 1 s after the last gate.
    expect(peaks['flash']).toBe(0.6);
    expect(feel.out.flash).toBeLessThan(0.04);
    expect(feel.out.glitch).toBe(0);
    expect(feel.out.duck).toBe(0);
  });
});
