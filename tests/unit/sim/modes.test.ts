// A3: each row of the modes table, and each command from each mode.
import { describe, expect, test } from 'vitest';
import { Ev, ItemKind, Objective, SimMode, type Sim, type WorldSource } from '../../../src/contracts/index';
import { TUNING } from '../../../src/sim/tuning';
import { HOLD, BOOST, make, NOBODY, stepUntil, steps, type EvRecord } from './fixtures/drive';
import { carpetWorld, emptyWorld, scriptedWorld } from './fixtures/worlds';

/** One wide shard, one wide gate and one graze-distance spike in every chunk, so every mode has something to react to. */
function busyWorld(): WorldSource {
  return scriptedWorld((c) => [
    { kind: ItemKind.SHARD, x: 0, y: 8, z: 10, radius: 80 },
    { kind: ItemKind.GATE, x: 0, y: 8, z: 20, radius: 80 },
    { kind: ItemKind.FENCE, x: 0, y: 8, z: 30, radius: 80, a: 0, b: c < 0 ? 0 : 80 },
  ]);
}

/** Every crossing grazes, so GRAZE fires and HIT cannot. Fence: gap half-width such that the edge sits inside the margin at x = 0. */
function grazeWorld(): WorldSource {
  return scriptedWorld(() => [{ kind: ItemKind.FENCE, x: 0, y: 8, z: 30, radius: 80, a: 0, b: TUNING.SHIP_HIT_RADIUS + 1 }]);
}

function kinds(events: readonly EvRecord[]): Set<number> {
  return new Set(events.map((e) => e.kind));
}

function playing(world: WorldSource = emptyWorld(), o?: Parameters<typeof make>[1]): Sim {
  const sim = make(world, o);
  sim.command('launch');
  return sim;
}

describe('DEMO', () => {
  test('the planner steers and rules are off: cosmetic events only, score and SYNC never change', () => {
    const sim = make(busyWorld());
    const events = steps(sim, 2000, NOBODY);
    expect(sim.state.mode).toBe(SimMode.DEMO);
    expect(sim.state.autopilot).toBe(true);
    expect(sim.state.score).toBe(0);
    expect(sim.state.sync).toBe(1);
    expect(sim.state.shields).toBe(3);
    expect(sim.state.overdrive).toBe(0);
    expect(sim.state.objectiveProgress).toBe(0);
    const seen = kinds(events);
    expect(seen.has(Ev.SHARD)).toBe(true);
    expect(seen.has(Ev.GATE)).toBe(true);
    expect(seen.has(Ev.HIT)).toBe(false);
    expect(seen.has(Ev.GATE_MISS)).toBe(false);
    for (const e of events) {
      if (e.kind === Ev.SHARD || e.kind === Ev.GATE || e.kind === Ev.GRAZE) expect(e.value).toBe(0);
    }
  });

  test('a player input moves nothing: the planner owns the ship', () => {
    const a = make(emptyWorld());
    const b = make(emptyWorld());
    for (let i = 0; i < 2000; i++) {
      a.step(NOBODY);
      b.step({ moveX: 1, moveY: 1, absolute: false, boost: true, human: true });
      expect(Object.is(a.state.x, b.state.x)).toBe(true);
    }
  });

  test('boost is scheduled and free: 4.8 s of every 32 s, with one BOOST_ON and one BOOST_OFF', () => {
    const sim = make(emptyWorld());
    const events = steps(sim, 3840 * 2, NOBODY);
    const on = events.filter((e) => e.kind === Ev.BOOST_ON);
    const off = events.filter((e) => e.kind === Ev.BOOST_OFF);
    expect(on.map((e) => e.tick)).toEqual([3264, 7104]);
    expect(off.map((e) => e.tick)).toEqual([3840, 7680]);
    expect(sim.state.overdrive).toBe(0);
    expect(events.every((e) => e.kind === Ev.BOOST_ON || e.kind === Ev.BOOST_OFF || e.kind === Ev.SECTOR)).toBe(true);
  });

  test('SECTOR fires, and GRADE does not', () => {
    const sim = make(emptyWorld());
    const events = steps(sim, 12000, NOBODY);
    expect(kinds(events).has(Ev.SECTOR)).toBe(true);
    expect(kinds(events).has(Ev.GRADE)).toBe(false);
  });
});

describe('PLAY, human', () => {
  test('input steers, boost costs overdrive, rules are live', () => {
    const sim = playing(busyWorld(), { OVERDRIVE_START: 1 });
    expect(sim.state.autopilot).toBe(false);
    steps(sim, 100, BOOST);
    expect(sim.state.overdrive).toBeLessThan(1);
    expect(sim.state.score).toBeGreaterThan(0);
    const events = steps(sim, 200);
    expect(kinds(events).has(Ev.BOOST_OFF)).toBe(true);
  });
});

describe('PLAY, idle over 10 s', () => {
  test('10 s without human sets autopilot, cruise only, and freezes rules; one human frame returns control', () => {
    const sim = playing(busyWorld(), { LAUNCH_GRACE_S: 0, OVERDRIVE_START: 1 });
    const live = steps(sim, 1199, NOBODY);
    expect(sim.state.autopilot).toBe(false);
    expect(kinds(live).has(Ev.GATE)).toBe(true);
    const score = sim.state.score;
    const sync = sim.state.sync;
    const shields = sim.state.shields;
    const overdrive = sim.state.overdrive;
    const progress = sim.state.objectiveProgress;
    expect(score).toBeGreaterThan(0);

    steps(sim, 1, NOBODY);
    expect(sim.state.autopilot).toBe(true);
    expect(sim.state.mode).toBe(SimMode.PLAY);
    const idle = steps(sim, 2000, NOBODY);
    expect(sim.state.score).toBe(score);
    expect(sim.state.sync).toBe(sync);
    expect(sim.state.shields).toBe(shields);
    expect(sim.state.overdrive).toBe(overdrive);
    expect(sim.state.objectiveProgress).toBe(progress);
    for (const e of idle) {
      if (e.kind === Ev.GATE || e.kind === Ev.SHARD || e.kind === Ev.GRAZE) expect(e.value).toBe(0);
    }
    expect(kinds(idle).has(Ev.GATE)).toBe(true);
    expect(kinds(idle).has(Ev.HIT)).toBe(false);
    expect(kinds(idle).has(Ev.GATE_MISS)).toBe(false);

    steps(sim, 1, HOLD);
    expect(sim.state.autopilot).toBe(false);
    steps(sim, 300, HOLD);
    expect(sim.state.score).toBeGreaterThan(score);
  });

  test('going idle mid-boost ends the boost in that same step, and an idle frame with the button down cannot start one', () => {
    const sim = playing(emptyWorld(), { OVERDRIVE_START: 1, BOOST_DRAIN_PER_S: 0 });
    steps(sim, 10, BOOST);
    const held = { ...NOBODY, boost: true };
    const events: EvRecord[] = [];
    let idleTick = -1;
    let boostingBeforeIdle = false;
    for (let i = 0; i < 1300; i++) {
      steps(sim, 1, held, events);
      if (idleTick < 0 && sim.state.autopilot) idleTick = sim.state.tick;
      if (sim.state.tick === 1209) boostingBeforeIdle = sim.state.speed > 85;
    }
    expect(sim.state.autopilot).toBe(true);
    expect(boostingBeforeIdle).toBe(true);
    // The last human frame was tick 10, so idle starts at tick 10 + 1200, and BOOST_OFF must carry that same tick.
    expect(idleTick).toBe(1210);
    const off = events.filter((e) => e.kind === Ev.BOOST_OFF);
    expect(off.length).toBe(1);
    expect(off[0]!.tick).toBe(idleTick);
    steps(sim, 400, held);
    expect(sim.state.speed).toBeLessThanOrEqual(85);
  });

  test('a graze in idle PLAY is cosmetic', () => {
    const sim = playing(grazeWorld(), { LAUNCH_GRACE_S: 0 });
    const live = steps(sim, 1000);
    expect(live.some((e) => e.kind === Ev.GRAZE && e.value > 0)).toBe(true);
    steps(sim, 1300, NOBODY);
    const score = sim.state.score;
    const events = steps(sim, 2000, NOBODY);
    expect(sim.state.score).toBe(score);
    for (const e of events) if (e.kind === Ev.GRAZE) expect(e.value).toBe(0);
  });
});

describe('CRUISE', () => {
  test('entry says BOOST_OFF, the planner steers at cruise, and only SECTOR fires', () => {
    const sim = playing(busyWorld(), { OVERDRIVE_START: 1 });
    steps(sim, 100, BOOST);
    sim.command('pause');
    expect(sim.state.mode).toBe(SimMode.CRUISE);
    expect(sim.state.autopilot).toBe(true);
    expect(sim.events.count).toBe(1);
    expect(sim.events.kind[0]).toBe(Ev.BOOST_OFF);
    sim.events.count = 0;
    const score = sim.state.score;
    const overdrive = sim.state.overdrive;
    const events = steps(sim, 16000, BOOST);
    expect(new Set(events.map((e) => e.kind))).toEqual(new Set([Ev.SECTOR]));
    expect(sim.state.score).toBe(score);
    expect(sim.state.overdrive).toBe(overdrive);
    expect(sim.state.speed).toBeLessThanOrEqual(85);
  });

  test('pausing without a boost emits nothing', () => {
    const sim = playing();
    steps(sim, 10);
    sim.command('pause');
    expect(sim.events.count).toBe(0);
  });

  test('resume returns to PLAY with at least 1 s of ghost', () => {
    const sim = playing(emptyWorld(), { LAUNCH_GRACE_S: 0 });
    steps(sim, 10);
    sim.command('pause');
    steps(sim, 400);
    sim.command('resume');
    expect(sim.state.mode).toBe(SimMode.PLAY);
    expect(sim.state.autopilot).toBe(false);
    expect(sim.state.ghost).toBe(1);
  });

  test('resume keeps a longer ghost that is still running', () => {
    const sim = playing(emptyWorld(), { LAUNCH_GRACE_S: 10 });
    steps(sim, 10);
    sim.command('pause');
    steps(sim, 10);
    sim.command('resume');
    expect(sim.state.ghost).toBeGreaterThan(9);
  });
});

describe('SIGNAL_LOST', () => {
  test('reached by the hit rule, lasts exactly 360 ticks, keeps score, sets SYNC 1, refills shields at its end', () => {
    const world = scriptedWorld((c) => [
      { kind: ItemKind.GATE, x: 0, y: 6, z: 0, radius: 80 },
      ...(c >= 8 ? [{ kind: ItemKind.SPIKE, x: 0, y: 6, z: 32, radius: 80 }] : []),
    ]);
    const sim = playing(world, { LAUNCH_GRACE_S: 0, GATE_POINTS: 500 });
    const events: EvRecord[] = [];
    stepUntil(sim, () => sim.state.mode === SimMode.SIGNAL_LOST, HOLD, events);
    expect(sim.state.shields).toBe(0);
    expect(sim.state.sync).toBe(1);
    expect(sim.state.autopilot).toBe(true);
    const score = sim.state.score;
    expect(score).toBeGreaterThan(0);
    const hit = events.filter((e) => e.kind === Ev.HIT);
    expect(hit.map((e) => e.value)).toEqual([2, 1, 0]);
    expect(events[events.length - 1]!.kind).toBe(Ev.SIGNAL_LOST);
    expect(events[events.length - 2]!.kind).toBe(Ev.HIT);
    const start = sim.state.tick;

    let lost = 1;
    const during: EvRecord[] = [];
    while (sim.state.mode === SimMode.SIGNAL_LOST) {
      expect(sim.state.shields).toBe(0);
      steps(sim, 1, HOLD, during);
      if (sim.state.mode === SimMode.SIGNAL_LOST) lost++;
    }
    expect(lost).toBe(360);
    expect(sim.state.tick - start).toBe(360);
    expect(sim.state.mode).toBe(SimMode.PLAY);
    expect(sim.state.autopilot).toBe(false);
    expect(sim.state.shields).toBe(3);
    expect(sim.state.ghost).toBeCloseTo(1.2, 10);
    expect(sim.state.score).toBeGreaterThanOrEqual(score);
    expect(during.some((e) => e.kind === Ev.GATE && e.value === 0)).toBe(true);
    expect(during.some((e) => e.kind === Ev.HIT)).toBe(false);
    expect(during.some((e) => e.kind === Ev.GATE_MISS)).toBe(false);
  });

  test('pause and resume during it are no-ops, and a human frame changes nothing', () => {
    const sim = playing();
    steps(sim, 10);
    sim.forceSignalLost();
    const until = sim.state.tick + 360;
    for (const c of ['pause', 'resume', 'launch'] as const) {
      sim.command(c);
      expect(sim.state.mode).toBe(SimMode.SIGNAL_LOST);
    }
    steps(sim, 100, HOLD);
    sim.command('pause');
    expect(sim.state.mode).toBe(SimMode.SIGNAL_LOST);
    expect(sim.state.autopilot).toBe(true);
    stepUntil(sim, () => sim.state.mode === SimMode.PLAY);
    expect(sim.state.tick).toBe(until);
  });

  test('a boost held through a loss ends with BOOST_OFF before SIGNAL_LOST', () => {
    const sim = playing(emptyWorld(), { OVERDRIVE_START: 1 });
    steps(sim, 10, BOOST);
    sim.forceSignalLost();
    expect(sim.events.count).toBe(2);
    expect(sim.events.kind[0]).toBe(Ev.BOOST_OFF);
    expect(sim.events.kind[1]).toBe(Ev.SIGNAL_LOST);
    expect(sim.events.value[1]).toBe(0);
    sim.events.count = 0;
    const events = steps(sim, 100, BOOST);
    expect(events.length).toBe(0);
  });

  // DI-94: leaving SIGNAL_LOST is not player input. The exit keeps the last real input's tick, so a loss with nobody at
  // the controls cannot re-arm 10 s of rules-on PLAY.
  test('DI-94: a loss forced from idle PLAY ends in idle PLAY, with rules still frozen', () => {
    const sim = playing(busyWorld(), { LAUNCH_GRACE_S: 0 });
    steps(sim, 1300, NOBODY);
    expect(sim.state.autopilot).toBe(true);
    const score = sim.state.score;
    expect(score).toBeGreaterThan(0);
    sim.forceSignalLost();
    sim.events.count = 0;
    steps(sim, 360, NOBODY);
    expect(sim.state.mode).toBe(SimMode.PLAY);
    expect(sim.state.autopilot).toBe(true);
    expect(sim.state.shields).toBe(3);
    const after = steps(sim, 2400, NOBODY);
    expect(sim.state.autopilot).toBe(true);
    expect(sim.state.score).toBe(score);
    expect(kinds(after).has(Ev.GATE)).toBe(true);
    expect(kinds(after).has(Ev.HIT)).toBe(false);
    expect(kinds(after).has(Ev.GATE_MISS)).toBe(false);
    for (const e of after) {
      if (e.kind === Ev.GATE || e.kind === Ev.SHARD || e.kind === Ev.GRAZE) expect(e.value).toBe(0);
    }
    steps(sim, 1, HOLD);
    expect(sim.state.autopilot).toBe(false);
  });

  test('DI-94: a loss inside the idle window returns to live PLAY, and idle comes 1200 ticks after the last input, not after the exit', () => {
    const sim = playing();
    steps(sim, 10, HOLD);
    steps(sim, 390, NOBODY);
    expect(sim.state.autopilot).toBe(false);
    sim.forceSignalLost();
    stepUntil(sim, () => sim.state.mode === SimMode.PLAY, NOBODY);
    expect(sim.state.tick).toBe(760);
    expect(sim.state.autopilot).toBe(false);
    // The last human frame was tick 10. Counting the exit as input would put idle at 760 + 1200 = 1960.
    stepUntil(sim, () => sim.state.autopilot, NOBODY);
    expect(sim.state.tick).toBe(1210);
  });

  test('DI-94: a human frame during SIGNAL_LOST is a real input, though it steers nothing', () => {
    const sim = playing();
    steps(sim, 10, HOLD);
    steps(sim, 990, NOBODY);
    sim.forceSignalLost();
    steps(sim, 300, NOBODY);
    steps(sim, 1, HOLD);
    expect(sim.state.tick).toBe(1301);
    expect(sim.state.mode).toBe(SimMode.SIGNAL_LOST);
    stepUntil(sim, () => sim.state.mode === SimMode.PLAY, NOBODY);
    expect(sim.state.tick).toBe(1360);
    // 1360 - 10 is past the timeout, so without the frame at 1301 this exit would be idle at once.
    expect(sim.state.autopilot).toBe(false);
    stepUntil(sim, () => sim.state.autopilot, NOBODY);
    expect(sim.state.tick).toBe(2501);
  });

  test('a real carpet takes the shields and SIGNAL_LOST returns them, over and over', () => {
    const sim = playing(carpetWorld());
    let losses = 0;
    let last = sim.state.mode;
    for (let i = 0; i < 12000; i++) {
      sim.step(HOLD);
      sim.events.count = 0;
      if (sim.state.mode === SimMode.SIGNAL_LOST && last !== SimMode.SIGNAL_LOST) losses++;
      last = sim.state.mode;
    }
    expect(losses).toBeGreaterThan(5);
  });
});

describe('commands', () => {
  const ALL = ['launch', 'pause', 'resume'] as const;

  test('launch from DEMO resets as listed', () => {
    const sim = make(emptyWorld());
    steps(sim, 50, NOBODY);
    const travel = { ...sim.state.travel };
    sim.command('launch');
    const s = sim.state;
    expect(s.mode).toBe(SimMode.PLAY);
    expect(s.autopilot).toBe(false);
    expect(s.score).toBe(0);
    expect(s.sync).toBe(1);
    expect(s.shields).toBe(3);
    expect(s.overdrive).toBe(TUNING.OVERDRIVE_START);
    expect(s.objectiveProgress).toBe(0);
    expect(s.ghost).toBe(TUNING.LAUNCH_GRACE_S);
    expect(s.travel).toEqual(travel);
  });

  test('launch mid demo boost ends the demo boost with BOOST_OFF', () => {
    const sim = make(emptyWorld());
    steps(sim, 3300, NOBODY);
    sim.command('launch');
    expect(sim.events.count).toBe(1);
    expect(sim.events.kind[0]).toBe(Ev.BOOST_OFF);
    sim.events.count = 0;
    const events = steps(sim, 10);
    expect(events.length).toBe(0);
  });

  test.each([
    ['DEMO', () => make(emptyWorld()), ['pause', 'resume']],
    ['PLAY', () => playing(), ['launch', 'resume']],
    ['CRUISE', () => { const s = playing(); s.command('pause'); return s; }, ['launch', 'pause']],
    ['SIGNAL_LOST', () => { const s = playing(); s.forceSignalLost(); s.events.count = 0; return s; }, ALL],
  ] as const)('from %s, these commands are silent no-ops', (_name, build, commands) => {
    for (const c of commands) {
      const sim = build();
      steps(sim, 20);
      const before = { ...sim.state, travel: { ...sim.state.travel } };
      sim.command(c);
      expect({ ...sim.state, travel: { ...sim.state.travel } }).toEqual(before);
      expect(sim.events.count).toBe(0);
    }
  });

  test('forceSignalLost works in PLAY, and is a no-op in DEMO, CRUISE and SIGNAL_LOST', () => {
    const demo = make(emptyWorld());
    demo.forceSignalLost();
    expect(demo.state.mode).toBe(SimMode.DEMO);
    expect(demo.events.count).toBe(0);

    const cruise = playing();
    cruise.command('pause');
    cruise.forceSignalLost();
    expect(cruise.state.mode).toBe(SimMode.CRUISE);

    const play = playing();
    steps(play, 5);
    play.forceSignalLost();
    expect(play.state.mode).toBe(SimMode.SIGNAL_LOST);
    expect(play.state.shields).toBe(0);
    expect(play.state.sync).toBe(1);
    expect(play.events.kind[0]).toBe(Ev.SIGNAL_LOST);
    const tick = play.state.tick;
    play.events.count = 0;
    play.forceSignalLost();
    expect(play.events.count).toBe(0);
    stepUntil(play, () => play.state.mode === SimMode.PLAY);
    expect(play.state.tick).toBe(tick + 360);
  });

  test('pause from idle PLAY then resume gives a player control back', () => {
    const sim = playing();
    steps(sim, 1300, NOBODY);
    expect(sim.state.autopilot).toBe(true);
    sim.command('pause');
    expect(sim.state.mode).toBe(SimMode.CRUISE);
    sim.command('resume');
    expect(sim.state.autopilot).toBe(false);
    steps(sim, 1199, NOBODY);
    expect(sim.state.autopilot).toBe(false);
  });

  test('a cosmetic gate in idle PLAY leaves score and SYNC unchanged, and objectives too', () => {
    const world = scriptedWorld(() => [{ kind: ItemKind.GATE, x: 0, y: 8, z: 0, radius: 80 }], () => ({ objective: Objective.GATES, objectiveTarget: 100 }));
    const sim = playing(world, { LAUNCH_GRACE_S: 0 });
    steps(sim, 1300, NOBODY);
    expect(sim.state.autopilot).toBe(true);
    const { score, sync, objectiveProgress } = sim.state;
    const events = steps(sim, 1000, NOBODY);
    expect(events.filter((e) => e.kind === Ev.GATE).length).toBeGreaterThan(5);
    expect(sim.state.score).toBe(score);
    expect(sim.state.sync).toBe(sync);
    expect(sim.state.objectiveProgress).toBe(objectiveProgress);
  });
});
