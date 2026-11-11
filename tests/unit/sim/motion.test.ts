// A2 and A2w: the R1 core, steering and warp.
import { describe, expect, test } from 'vitest';
import {
  CHUNK_LIMIT, ItemKind, PLAY_HALF_X, PLAY_Y_MAX, PLAY_Y_MIN, SHIP_FORWARD, SimMode, SPEED_CRUISE, SPEED_MAX,
  type ControlFrame, type Sim,
} from '../../../src/contracts/index';
import { between } from '../../../src/core/coords';
import { createSim } from '../../../src/sim/index';
import { TUNING } from '../../../src/sim/tuning';
import { HOLD, make, BOOST, NOBODY, stepUntil, steps } from './fixtures/drive';
import { countingWorld, emptyWorld, gauntletWorld, scriptedWorld } from './fixtures/worlds';

const NO_LOCK = { BEAT_LOCK_MAX: 0 };

function frame(moveX: number, moveY: number, absolute = false): ControlFrame {
  return { moveX, moveY, absolute, boost: false, human: true };
}

describe('start state', () => {
  test('chunk 3, the plane on a beat, and already moving', () => {
    const sim = createSim(emptyWorld());
    const s = sim.state;
    expect(s.travel.chunk).toBe(3);
    expect(s.travel.local).toBe(48 - SHIP_FORWARD);
    expect(s.x).toBe(0);
    expect(s.y).toBe(6);
    expect(s.stepDist).toBeGreaterThan(0);
    expect(s.stepDist).toBe(SPEED_CRUISE / 120);
    expect(s.mode).toBe(SimMode.DEMO);
    expect(s.autopilot).toBe(true);
    expect(s.score).toBe(0);
    expect(s.tick).toBe(0);
    expect(sim.events.count).toBe(0);
  });

  test('createSim exposes only the Sim contract', () => {
    const sim = createSim(emptyWorld());
    expect(Object.keys(sim).sort()).toEqual(['command', 'events', 'forceSignalLost', 'setReducedMotion', 'state', 'step', 'warpTo']);
  });
});

describe('speed', () => {
  test('PLAY at cruise: 80, and stepDist is exactly speed / 120 at every step', () => {
    const sim = make(emptyWorld(), NO_LOCK);
    sim.command('launch');
    for (let i = 0; i < 1000; i++) {
      sim.step(HOLD);
      expect(sim.state.speed).toBe(80);
      expect(sim.state.stepDist).toBe(80 / 120);
    }
  });

  test('the beat lock leaves an undisturbed start within 1e-6 of cruise', () => {
    const sim = make(emptyWorld());
    sim.command('launch');
    for (let i = 0; i < 5000; i++) {
      sim.step(HOLD);
      expect(Math.abs(sim.state.speed - 80)).toBeLessThan(1e-6);
    }
  });

  test('reduced motion: cruise 48, boost 90, floor 27, and the scale is exact', () => {
    expect(80 * 0.6).toBe(48);
    expect(150 * 0.6).toBe(90);
    expect(45 * 0.6).toBe(27);
    const sim = make(emptyWorld(), { OVERDRIVE_START: 1 });
    sim.setReducedMotion(true);
    sim.command('launch');
    steps(sim, 240);
    expect(sim.state.speed).toBe(48);
    steps(sim, 240, BOOST);
    expect(sim.state.speed).toBe(90);
    steps(sim, 480);
    expect(sim.state.speed).toBe(48);
  });

  test('reduced motion: a removed hit factor lands on the floor of 27, not below', () => {
    const world = scriptedWorld((c) => (c === 8 ? [{ kind: ItemKind.SPIKE, x: 0, y: 6, z: 0, radius: 3 }] : []));
    const sim = make(world, { HIT_SPEED_FACTOR: 0.01, LAUNCH_GRACE_S: 0 });
    sim.setReducedMotion(true);
    sim.command('launch');
    stepUntil(sim, () => sim.state.shields === 2);
    steps(sim, 1);
    expect(sim.state.speed).toBe(27);
  });

  test('a NaN from the beat lock lands speed on the floor of 45, every step, and travel still rises', () => {
    const sim = make(emptyWorld(), { BEAT_LOCK_GAIN: NaN });
    sim.command('launch');
    for (let i = 0; i < 600; i++) {
      const local = sim.state.travel.local;
      const chunk = sim.state.travel.chunk;
      sim.step(HOLD);
      expect(sim.state.speed).toBe(45);
      expect(sim.state.stepDist).toBe(45 / 120);
      expect(sim.state.travel.chunk > chunk || sim.state.travel.local > local).toBe(true);
    }
  });

  test('reduced motion: a NaN hit factor lands speed on the floor of 27 for the whole recovery, then 48', () => {
    const world = scriptedWorld((c) => (c === 8 ? [{ kind: ItemKind.SPIKE, x: 0, y: 6, z: 0, radius: 3 }] : []));
    const sim = make(world, { HIT_SPEED_FACTOR: NaN, LAUNCH_GRACE_S: 0 });
    sim.setReducedMotion(true);
    sim.command('launch');
    stepUntil(sim, () => sim.state.shields === 2);
    for (let i = 0; i < 180; i++) {
      sim.step(HOLD);
      expect(sim.state.speed).toBe(27);
    }
    sim.step(HOLD);
    expect(sim.state.speed).toBe(48);
  });

  test('boost eases up to 150 in about 1 s and back to cruise after', () => {
    const sim = make(emptyWorld(), { OVERDRIVE_START: 1, BEAT_LOCK_MAX: 0 });
    sim.command('launch');
    let last = 0;
    const toMax = stepUntil(sim, () => {
      expect(sim.state.speed).toBeGreaterThanOrEqual(last);
      last = sim.state.speed;
      return sim.state.speed === SPEED_MAX;
    }, BOOST);
    expect(toMax).toBeGreaterThanOrEqual(119);
    expect(toMax).toBeLessThanOrEqual(121);
    last = Infinity;
    const toCruise = stepUntil(sim, () => {
      expect(sim.state.speed).toBeLessThanOrEqual(last);
      last = sim.state.speed;
      return sim.state.speed === SPEED_CRUISE;
    });
    expect(toCruise).toBeGreaterThanOrEqual(185);
    expect(toCruise).toBeLessThanOrEqual(188);
  });

  function hitWorld(chunks: readonly number[]) {
    return scriptedWorld((c) => (chunks.includes(c) ? [{ kind: ItemKind.SPIKE, x: 0, y: 6, z: 0, radius: 3 }] : []));
  }

  test('a hit drops to 52 at once, and back to 80 in 1.5 s', () => {
    const sim = make(hitWorld([8]), { LAUNCH_GRACE_S: 0, ...NO_LOCK });
    sim.command('launch');
    stepUntil(sim, () => sim.state.shields === 2);
    steps(sim, 1);
    expect(sim.state.speed).toBe(80 * 0.65);
    const first = sim.state.tick;
    const back = stepUntil(sim, () => sim.state.speed === 80);
    expect(sim.state.tick - first).toBe(back);
    expect(back).toBe(180);
  });

  test('a second hit re-arms the slowdown and does not stack below 52', () => {
    const sim = make(hitWorld([8, 10]), { LAUNCH_GRACE_S: 0, ...NO_LOCK });
    sim.command('launch');
    stepUntil(sim, () => sim.state.shields === 2);
    let lowest = Infinity;
    stepUntil(sim, () => {
      lowest = Math.min(lowest, sim.state.speed);
      return sim.state.shields === 1;
    });
    steps(sim, 1);
    expect(sim.state.speed).toBe(52);
    for (let i = 0; i < 400; i++) {
      sim.step(HOLD);
      lowest = Math.min(lowest, sim.state.speed);
    }
    expect(lowest).toBe(52);
    expect(sim.state.speed).toBe(80);
  });
});

// DI-75 (T10's D-001): reduced motion set before the sim's first step applies from that step, at
// SPEED_CRUISE * REDUCED_MOTION_SCALE with no ease. A toggle after the first step keeps the ease, so a mid-run toggle
// does not jolt. Before this ruling every sim started at 80 and eased down: 79.625, 68.75, 57.5, 48 at steps 1, 30, 60, 120
// [O: test-results/T10-defects/D-001/node-repro.txt].
describe('reduced motion before and after the first step (DI-75, D-001)', () => {
  const REDUCED = SPEED_CRUISE * TUNING.REDUCED_MOTION_SCALE;
  const DOWN = TUNING.SPEED_DECEL * (1 / 120);
  const UP = TUNING.SPEED_ACCEL * (1 / 120);

  /** The at-load check: every speed in the trace is exactly the reduced cruise, so nothing eased. */
  function noEase(trace: readonly number[]): boolean {
    return trace.length > 0 && trace.every((v) => v === REDUCED);
  }

  function trace(sim: Sim, n: number, c: Readonly<ControlFrame>): number[] {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      sim.step(c);
      sim.events.count = 0;
      out.push(sim.state.speed);
    }
    return out;
  }

  test.each([
    ['DEMO, as the app boots', false],
    ['launched before the first step', true],
  ] as const)('set before the first step, %s: 48 exactly from the start state and step 1 on, with no ease', (_name, launch) => {
    expect(REDUCED).toBe(48);
    // Rules are off in DEMO, so the gauntlet cannot slow it; launched, an empty world keeps hits out of the trace.
    const sim = createSim(launch ? emptyWorld() : gauntletWorld({ seed: 1985, density: 0.6 }));
    sim.setReducedMotion(true);
    if (launch) sim.command('launch');
    // The start state already reads the scaled cruise, so no reader sees 80 first, and stepDist is still speed / 120.
    expect(sim.state.speed).toBe(48);
    expect(sim.state.stepDist).toBe(48 / 120);
    const start = { chunk: sim.state.travel.chunk, local: sim.state.travel.local };
    const speeds = trace(sim, 240, launch ? HOLD : NOBODY);
    expect(speeds[0]).toBe(48);
    expect(Math.max(...speeds)).toBe(48);
    expect(noEase(speeds)).toBe(true);
    expect(sim.state.stepDist).toBe(48 / 120);
    // 240 steps at 0.4 u: the ship has flown 96 u, where the eased start flew about 11 u more.
    expect(Math.abs(between(sim.state.travel, start) - 96)).toBeLessThan(1e-9);
  });

  test('on then off before the first step leaves the sim exactly as if it was never set', () => {
    const a = createSim(emptyWorld());
    const b = createSim(emptyWorld());
    a.setReducedMotion(true);
    a.setReducedMotion(false);
    expect(Object.is(a.state.speed, b.state.speed)).toBe(true);
    expect(Object.is(a.state.stepDist, b.state.stepDist)).toBe(true);
    for (let i = 0; i < 600; i++) {
      a.step(NOBODY);
      b.step(NOBODY);
      a.events.count = 0;
      b.events.count = 0;
      expect(Object.is(a.state.speed, b.state.speed)).toBe(true);
      expect(Object.is(a.state.travel.local, b.state.travel.local)).toBe(true);
      expect(a.state.travel.chunk).toBe(b.state.travel.chunk);
    }
  });

  test('a toggle after the first step keeps the ease: 0.375 u/s less per step to 48 in 86 steps, and 0.583 more per step back', () => {
    const sim = make(emptyWorld());
    sim.command('launch');
    trace(sim, 600, HOLD);
    expect(Math.abs(sim.state.speed - 80)).toBeLessThan(1e-6);
    sim.setReducedMotion(true);
    // A mid-run toggle moves nothing until the next step.
    expect(Math.abs(sim.state.speed - 80)).toBeLessThan(1e-6);
    const down = trace(sim, 200, HOLD);
    expect(down[0]).toBe(80 - DOWN);
    for (let i = 1; i < down.length; i++) {
      expect(down[i]!).toBeLessThanOrEqual(down[i - 1]!);
      expect(down[i - 1]! - down[i]!).toBeLessThanOrEqual(DOWN);
    }
    expect(down.indexOf(48) + 1).toBe(86);
    expect(noEase(down)).toBe(false);
    sim.setReducedMotion(false);
    const up = trace(sim, 10, HOLD);
    // The sim adds UP once per step, so the expected value is the same repeated sum, not 48 + 10 * UP.
    let want = 48;
    for (let i = 0; i < 10; i++) {
      want += UP;
      expect(up[i]).toBe(want);
    }
  });

  test('a toggle after exactly one step is already after the first step, so it eases', () => {
    const sim = createSim(emptyWorld());
    sim.step(NOBODY);
    sim.events.count = 0;
    sim.setReducedMotion(true);
    const speeds = trace(sim, 120, NOBODY);
    expect(speeds[0]).toBe(80 - DOWN);
  });

  test('control: the old behaviour, an ease from 80, fails the at-load check', () => {
    // A toggle after one step replays the old at-load ease from the toggle on: the same numbers D-001 recorded.
    const sim = createSim(emptyWorld());
    sim.step(NOBODY);
    sim.events.count = 0;
    sim.setReducedMotion(true);
    const old = trace(sim, 120, NOBODY);
    expect([old[0], old[29], old[59], old[119]]).toEqual([79.625, 68.75, 57.5, 48]);
    expect(noEase(old)).toBe(false);
    expect(old[0]).not.toBe(48);
  });
});

describe('steering', () => {
  function flying(): Sim {
    const sim = make(emptyWorld());
    sim.command('launch');
    return sim;
  }

  test('rate: +moveX is +x and +moveY is +y, at the bounded rate', () => {
    const sim = flying();
    steps(sim, 30, frame(1, 1));
    expect(sim.state.x).toBeGreaterThan(0);
    expect(sim.state.y).toBeGreaterThan(6);
    const speedX = (sim.state.x - sim.state.prevX) * 120;
    expect(speedX).toBeGreaterThan(45);
    expect(speedX).toBeLessThanOrEqual(60);
    const sim2 = flying();
    steps(sim2, 30, frame(-1, -1));
    expect(sim2.state.x).toBeLessThan(0);
    expect(sim2.state.y).toBeLessThan(6);
  });

  test('rate: clamps at every wall, and the velocity dies there', () => {
    const sim = flying();
    steps(sim, 600, frame(1, 1));
    expect(sim.state.x).toBe(PLAY_HALF_X);
    expect(sim.state.y).toBe(PLAY_Y_MAX);
    steps(sim, 2, frame(-1, -1));
    // Velocity restarts from 0, so the first step off the wall is small.
    expect(sim.state.x).toBeGreaterThan(PLAY_HALF_X - 1);
    steps(sim, 600, frame(-1, -1));
    expect(sim.state.x).toBe(-PLAY_HALF_X);
    expect(sim.state.y).toBe(PLAY_Y_MIN);
  });

  test('absolute: moveX, moveY map across the play box, and approach at a bounded rate', () => {
    const sim = flying();
    const target = frame(0.5, 1, true);
    let fastest = 0;
    for (let i = 0; i < 480; i++) {
      sim.step(target);
      fastest = Math.max(fastest, Math.abs(sim.state.x - sim.state.prevX) * 120);
    }
    expect(fastest).toBeLessThanOrEqual(60);
    expect(sim.state.x).toBeCloseTo(0.5 * PLAY_HALF_X, 3);
    expect(sim.state.y).toBe(PLAY_Y_MAX);
    steps(sim, 480, frame(-1, -1, true));
    expect(sim.state.x).toBe(-PLAY_HALF_X);
    expect(sim.state.y).toBe(PLAY_Y_MIN);
    steps(sim, 480, frame(0, 0, true));
    expect(sim.state.x).toBeCloseTo(0, 3);
    expect(sim.state.y).toBeCloseTo((PLAY_Y_MIN + PLAY_Y_MAX) / 2, 3);
  });

  test.each([false, true])('NaN acts as 0 and out-of-range clamps, with absolute %s', (absolute) => {
    const pairs: readonly (readonly [number, number])[] = [
      [NaN, 0], [Infinity, 1], [-Infinity, -1], [1e308, 1], [-1e308, -1], [5, 1], [-5, -1],
    ];
    for (const [poison, clean] of pairs) {
      const a = flying();
      const b = flying();
      steps(a, 60, frame(0.3, 0.3));
      steps(b, 60, frame(0.3, 0.3));
      for (let i = 0; i < 120; i++) {
        a.step(frame(poison, poison, absolute));
        b.step(frame(clean, clean, absolute));
        expect(Object.is(a.state.x, b.state.x)).toBe(true);
        expect(Object.is(a.state.y, b.state.y)).toBe(true);
        expect(a.state.speed).toBe(b.state.speed);
      }
    }
  });
});

describe('identity', () => {
  test('state, events and travel stay the same objects through steps, commands and warp', () => {
    const sim = createSim(gauntletWorld({ seed: 7, density: 0.6 }));
    const { state, events } = sim;
    const travel = state.travel;
    steps(sim, 200);
    sim.command('launch');
    steps(sim, 200);
    expect(sim.warpTo(1000, 5)).toBe(true);
    steps(sim, 200);
    expect(sim.state).toBe(state);
    expect(sim.events).toBe(events);
    expect(sim.state.travel).toBe(travel);
  });
});

describe('warp', () => {
  test.each([
    [CHUNK_LIMIT, 0], [2 ** 48, 0], [1.5, 0], [5, 64], [5, -1], [NaN, 0], [5, NaN], [-1, 0], [Infinity, 0],
  ])('warpTo(%s, %s) is refused and changes nothing', (chunk, local) => {
    const sim = createSim(gauntletWorld({ seed: 7, density: 0.6 }));
    sim.command('launch');
    steps(sim, 300);
    const before = { ...sim.state, travel: { ...sim.state.travel } };
    expect(sim.warpTo(chunk, local)).toBe(false);
    const after = { ...sim.state, travel: { ...sim.state.travel } };
    for (const key of Object.keys(before) as (keyof typeof before)[]) {
      if (key === 'travel') continue;
      expect(Object.is(before[key], after[key]), key).toBe(true);
    }
    expect(Object.is(before.travel.chunk, after.travel.chunk)).toBe(true);
    expect(Object.is(before.travel.local, after.travel.local)).toBe(true);
    expect(sim.events.count).toBe(0);
  });

  test('warpTo(CHUNK_LIMIT - 1, 0): true, serial + 1, no event, at most 8 world rows, and steps keep rising past the limit', () => {
    const world = countingWorld(gauntletWorld({ seed: 7, density: 0.6 }));
    const sim = createSim(world);
    world.fillItemsCalls = 0;
    world.zoneAtCalls = 0;
    const tick = sim.state.tick;
    expect(sim.warpTo(CHUNK_LIMIT - 1, 0)).toBe(true);
    expect(sim.state.warpSerial).toBe(1);
    expect(sim.state.tick).toBe(tick);
    expect(sim.events.count).toBe(0);
    expect(world.fillItemsCalls).toBeLessThanOrEqual(8);
    expect(world.zoneAtCalls).toBe(1);
    expect(sim.state.travel.chunk).toBe(CHUNK_LIMIT - 1);
    let chunk = sim.state.travel.chunk;
    for (let i = 0; i < 2000; i++) {
      sim.step(HOLD);
      sim.events.count = 0;
      expect(sim.state.travel.chunk).toBeGreaterThanOrEqual(chunk);
      chunk = sim.state.travel.chunk;
    }
    expect(chunk).toBeGreaterThan(CHUNK_LIMIT);
  });

  test('a crossing costs one row and one zoneAt', () => {
    const world = countingWorld(emptyWorld());
    const sim = createSim(world);
    expect(world.fillItemsCalls).toBe(8);
    expect(world.zoneAtCalls).toBe(1);
    world.fillItemsCalls = 0;
    world.zoneAtCalls = 0;
    stepUntil(sim, () => sim.state.travel.chunk === 13);
    expect(world.fillItemsCalls).toBe(10);
    expect(world.zoneAtCalls).toBe(10);
  });

  test('a warp to chunk 0 asks the world for no negative row', () => {
    const asked: number[] = [];
    const inner = emptyWorld();
    const sim = createSim({ ...inner, fillItems(c, out): void { asked.push(c); inner.fillItems(c, out); } });
    asked.length = 0;
    expect(sim.warpTo(0, 0)).toBe(true);
    expect(asked.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test('warp keeps mode and score, and clears sector progress', () => {
    const world = scriptedWorld((c) => (c === 5 ? [{ kind: ItemKind.GATE, x: 0, y: 6, z: 0, radius: 9 }] : []));
    const sim = make(world, { LAUNCH_GRACE_S: 0 });
    sim.command('launch');
    stepUntil(sim, () => sim.state.score > 0);
    expect(sim.state.objectiveProgress).toBe(1);
    const { score, mode, sync } = sim.state;
    sim.warpTo(500, 0);
    expect(sim.state.score).toBe(score);
    expect(sim.state.mode).toBe(mode);
    expect(sim.state.sync).toBe(sync);
    expect(sim.state.objectiveProgress).toBe(0);
    expect(sim.state.sectorIndex).toBe(5);
  });
});
