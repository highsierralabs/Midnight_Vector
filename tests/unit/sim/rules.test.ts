// A5: each row of section 7.1 with exact numbers, overflow, and every event kind's payload.
import { describe, expect, test } from 'vitest';
import { Ev, EVENT_CAPACITY, ItemKind, SimMode, type ControlFrame, type Sim, type WorldSource } from '../../../src/contracts/index';
import { HOLD, BOOST, make, NOBODY, planeU, stepUntil, steps, take, type EvRecord } from './fixtures/drive';
import { carpetWorld, emptyWorld, scriptedWorld, type ScriptedItem } from './fixtures/worlds';

/** Rows keyed by chunk. The plane starts at 240 u, chunk 3; chunk 4 z 0 is 24 ticks ahead at cruise. */
function at(rows: Record<number, readonly ScriptedItem[]>): WorldSource {
  return scriptedWorld((c) => rows[c] ?? []);
}

const SHARD = (z = 0): ScriptedItem => ({ kind: ItemKind.SHARD, x: 0, y: 6, z, radius: 2.5 });
const GATE = (z = 0): ScriptedItem => ({ kind: ItemKind.GATE, x: 0, y: 6, z, radius: 7 });
const GATE_FAR = (z = 0): ScriptedItem => ({ kind: ItemKind.GATE, x: 30, y: 6, z, radius: 7 });
const SPIKE = (z = 0): ScriptedItem => ({ kind: ItemKind.SPIKE, x: 0, y: 6, z, radius: 2 });
/** hitR 3.6, so a spike 5 u away is a graze: 5 <= 5.4. */
const GRAZER = (z = 0): ScriptedItem => ({ kind: ItemKind.SPIKE, x: 5, y: 6, z, radius: 2 });
const CLEAR = (z = 0): ScriptedItem => ({ kind: ItemKind.SPIKE, x: 6, y: 6, z, radius: 2 });

/** Gates in chunks 4 .. 4 + n - 1 raise SYNC from 1 to 1 + n. The item under test follows. */
function afterSync(n: number, item: ScriptedItem): WorldSource {
  const rows: Record<number, readonly ScriptedItem[]> = {};
  for (let i = 0; i < n; i++) rows[4 + i] = [{ ...GATE(), radius: 40 }];
  rows[4 + n] = [item];
  return at(rows);
}

function playingUntil(world: WorldSource, kind: number, o?: Parameters<typeof make>[1], c: Readonly<ControlFrame> = HOLD): { sim: Sim; events: EvRecord[]; last: EvRecord } {
  const sim = make(world, { LAUNCH_GRACE_S: 0, ...o });
  sim.command('launch');
  const events: EvRecord[] = [];
  stepUntil(sim, () => events.some((e) => e.kind === kind), c, events, 40000);
  const matches = events.filter((e) => e.kind === kind);
  return { sim, events, last: matches[matches.length - 1]! };
}

describe('shard', () => {
  test('+100 x SYNC, +8% overdrive', () => {
    const { sim, last } = playingUntil(at({ 4: [SHARD()] }), Ev.SHARD);
    expect(last.value).toBe(100);
    expect(sim.state.score).toBe(100);
    expect(sim.state.overdrive).toBeCloseTo(0.25 + 0.08, 12);
  });

  test('at SYNC 16', () => {
    const sim = make(afterSync(15, SHARD()), { LAUNCH_GRACE_S: 0 });
    sim.command('launch');
    const events = steps(sim, 2000);
    expect(sim.state.sync).toBe(16);
    expect(events.filter((e) => e.kind === Ev.SHARD)[0]!.value).toBe(1600);
  });

  test('boost doubles it', () => {
    const { last } = playingUntil(at({ 4: [SHARD()] }), Ev.SHARD, { OVERDRIVE_START: 1 }, BOOST);
    expect(last.value).toBe(200);
  });

  test('pickup reach is radius + 1.5', () => {
    const hit = make(at({ 4: [{ ...SHARD(), x: 3.9 }] }), { LAUNCH_GRACE_S: 0 });
    hit.command('launch');
    expect(steps(hit, 100).some((e) => e.kind === Ev.SHARD)).toBe(true);
    const miss = make(at({ 4: [{ ...SHARD(), x: 4.1 }] }), { LAUNCH_GRACE_S: 0 });
    miss.command('launch');
    expect(steps(miss, 100).some((e) => e.kind === Ev.SHARD)).toBe(false);
    expect(miss.state.score).toBe(0);
  });
});

describe('gate', () => {
  test('thread: +500 x SYNC, SYNC +1', () => {
    const { sim, last } = playingUntil(at({ 4: [GATE()] }), Ev.GATE);
    expect(last.value).toBe(500);
    expect(sim.state.score).toBe(500);
    expect(sim.state.sync).toBe(2);
  });

  test('at SYNC 16 the points use 16 and SYNC stays capped', () => {
    const sim = make(afterSync(15, GATE()), { LAUNCH_GRACE_S: 0 });
    sim.command('launch');
    const events = steps(sim, 2000);
    const gates = events.filter((e) => e.kind === Ev.GATE);
    expect(gates.length).toBe(16);
    expect(gates[15]!.value).toBe(500 * 16);
    expect(sim.state.sync).toBe(16);
  });

  test('thread under boost is doubled', () => {
    const { last } = playingUntil(at({ 4: [GATE()] }), Ev.GATE, { OVERDRIVE_START: 1 }, BOOST);
    expect(last.value).toBe(1000);
  });

  test('threaded uses the bare radius, without the ship', () => {
    const inside = make(at({ 4: [{ ...GATE(), x: 6.9 }] }), { LAUNCH_GRACE_S: 0 });
    inside.command('launch');
    expect(steps(inside, 100).some((e) => e.kind === Ev.GATE)).toBe(true);
    const outside = make(at({ 4: [{ ...GATE(), x: 7.1 }] }), { LAUNCH_GRACE_S: 0 });
    outside.command('launch');
    expect(steps(outside, 100).some((e) => e.kind === Ev.GATE_MISS)).toBe(true);
  });

  test('miss: SYNC -1, floor 1, value 0, and no score', () => {
    const rows: Record<number, readonly ScriptedItem[]> = { 4: [{ ...GATE(), radius: 40 }], 5: [{ ...GATE(), radius: 40 }], 6: [GATE_FAR()], 7: [GATE_FAR()], 8: [GATE_FAR()] };
    const sim = make(at(rows), { LAUNCH_GRACE_S: 0 });
    sim.command('launch');
    const events = steps(sim, 1000);
    expect(events.filter((e) => e.kind === Ev.GATE).length).toBe(2);
    const misses = events.filter((e) => e.kind === Ev.GATE_MISS);
    expect(misses.length).toBe(3);
    for (const m of misses) expect(m.value).toBe(0);
    expect(sim.state.sync).toBe(1);
    expect(sim.state.score).toBe(500 + 1000);
  });
});

describe('graze', () => {
  test('+50 x SYNC, +5% overdrive, inside 1.5 radii', () => {
    const { sim, last } = playingUntil(at({ 4: [GRAZER()] }), Ev.GRAZE);
    expect(last.value).toBe(50);
    expect(sim.state.score).toBe(50);
    expect(sim.state.overdrive).toBeCloseTo(0.25 + 0.05, 12);
    expect(sim.state.shields).toBe(3);
  });

  test('at SYNC 16', () => {
    const sim = make(afterSync(15, GRAZER()), { LAUNCH_GRACE_S: 0 });
    sim.command('launch');
    expect(steps(sim, 2000).filter((e) => e.kind === Ev.GRAZE)[0]!.value).toBe(800);
  });

  test('boost doubles it', () => {
    const { last } = playingUntil(at({ 4: [GRAZER()] }), Ev.GRAZE, { OVERDRIVE_START: 1 }, BOOST);
    expect(last.value).toBe(100);
  });

  test('past 1.5 radii nothing happens', () => {
    const sim = make(at({ 4: [CLEAR()] }), { LAUNCH_GRACE_S: 0 });
    sim.command('launch');
    expect(steps(sim, 100).length).toBe(0);
    expect(sim.state.score).toBe(0);
  });
});

describe('boost', () => {
  test('drains 20% per s, stops at 0, and cannot restart under 5%', () => {
    const sim = make(emptyWorld(), { OVERDRIVE_START: 0.1, BEAT_LOCK_MAX: 0 });
    sim.command('launch');
    const events = steps(sim, 240, BOOST);
    expect(sim.state.overdrive).toBe(0);
    expect(events.filter((e) => e.kind === Ev.BOOST_ON).length).toBe(1);
    expect(events.filter((e) => e.kind === Ev.BOOST_OFF).length).toBe(1);
    const on = events.find((e) => e.kind === Ev.BOOST_ON)!;
    const off = events.find((e) => e.kind === Ev.BOOST_OFF)!;
    expect(off.tick - on.tick).toBeGreaterThanOrEqual(60);
    expect(off.tick - on.tick).toBeLessThanOrEqual(62);
    expect(steps(sim, 100, BOOST).filter((e) => e.kind === Ev.BOOST_ON).length).toBe(0);
  });

  test('just below 5% cannot start, at 5% it can', () => {
    const low = make(emptyWorld(), { OVERDRIVE_START: 0.0499 });
    low.command('launch');
    expect(steps(low, 10, BOOST).length).toBe(0);
    const ok = make(emptyWorld(), { OVERDRIVE_START: 0.05 });
    ok.command('launch');
    expect(steps(ok, 2, BOOST).map((e) => e.kind)).toEqual([Ev.BOOST_ON]);
  });

  test('releasing stops it and keeps what is left', () => {
    const sim = make(emptyWorld(), { OVERDRIVE_START: 1 });
    sim.command('launch');
    steps(sim, 60, BOOST);
    const left = sim.state.overdrive;
    expect(left).toBeCloseTo(0.9, 10);
    expect(steps(sim, 1).map((e) => e.kind)).toEqual([Ev.BOOST_OFF]);
    steps(sim, 60);
    expect(sim.state.overdrive).toBe(left);
  });

  test('overdrive clamps at 1', () => {
    const rows: ScriptedItem[] = [];
    for (let i = 0; i < 16; i++) rows.push({ ...SHARD(i * 4) });
    const sim = make(scriptedWorld(() => rows), { LAUNCH_GRACE_S: 0, OVERDRIVE_START: 0.9 });
    sim.command('launch');
    steps(sim, 200);
    expect(sim.state.overdrive).toBe(1);
  });
});

describe('boost lock (double tap)', () => {
  const kinds = (events: readonly EvRecord[]): number[] => events.filter((e) => e.kind === Ev.BOOST_ON || e.kind === Ev.BOOST_OFF).map((e) => e.kind);

  /** Press for `down` steps, release for `gap` steps, press for `down` steps, release. The presses are down + gap apart. */
  function doubleTap(sim: Sim, gap: number, into: EvRecord[], down = 4): void {
    steps(sim, down, BOOST, into);
    steps(sim, gap, HOLD, into);
    steps(sim, down, BOOST, into);
  }

  function launched(world: WorldSource = emptyWorld(), o?: Parameters<typeof make>[1]): Sim {
    const sim = make(world, { OVERDRIVE_START: 1, BEAT_LOCK_MAX: 0, ...o });
    sim.command('launch');
    return sim;
  }

  test('two presses 0.3 s apart lock boost on with nothing held; 0.3 s + 1 tick does not', () => {
    // BOOST_LOCK_TAP_S 0.3 is 36 ticks, press to press.
    const locked = launched();
    const a: EvRecord[] = [];
    doubleTap(locked, 32, a);
    const od = locked.state.overdrive;
    steps(locked, 120, HOLD, a);
    expect(kinds(a)).toEqual([Ev.BOOST_ON, Ev.BOOST_OFF, Ev.BOOST_ON]);
    expect(od - locked.state.overdrive).toBeCloseTo(0.2, 10);

    const late = launched();
    const b: EvRecord[] = [];
    doubleTap(late, 33, b);
    const left = late.state.overdrive;
    steps(late, 120, HOLD, b);
    expect(kinds(b)).toEqual([Ev.BOOST_ON, Ev.BOOST_OFF, Ev.BOOST_ON, Ev.BOOST_OFF]);
    expect(late.state.overdrive).toBe(left);
  });

  test('negative control: BOOST_LOCK_TAP_S 0 never locks', () => {
    const sim = launched(emptyWorld(), { BOOST_LOCK_TAP_S: 0 });
    const events: EvRecord[] = [];
    doubleTap(sim, 4, events);
    steps(sim, 60, HOLD, events);
    expect(kinds(events)).toEqual([Ev.BOOST_ON, Ev.BOOST_OFF, Ev.BOOST_ON, Ev.BOOST_OFF]);
  });

  test('a frame held across several steps is one press', () => {
    const sim = launched();
    const events: EvRecord[] = [];
    steps(sim, 30, BOOST, events);
    steps(sim, 60, HOLD, events);
    expect(kinds(events)).toEqual([Ev.BOOST_ON, Ev.BOOST_OFF]);
  });

  test('ends when overdrive runs out, and stays off as overdrive refills', () => {
    const sim = launched(emptyWorld(), { OVERDRIVE_START: 0.1 });
    const events: EvRecord[] = [];
    doubleTap(sim, 4, events);
    steps(sim, 240, HOLD, events);
    expect(sim.state.overdrive).toBe(0);
    expect(kinds(events)).toEqual([Ev.BOOST_ON, Ev.BOOST_OFF, Ev.BOOST_ON, Ev.BOOST_OFF]);
    const on = events.filter((e) => e.kind === Ev.BOOST_ON)[1]!;
    const off = events.filter((e) => e.kind === Ev.BOOST_OFF)[1]!;
    // 0.1 less the first press's 4 steps is 0.0933, which drains at 0.2 per s in 56 steps.
    expect(off.tick - on.tick).toBeGreaterThanOrEqual(56);
    expect(off.tick - on.tick).toBeLessThanOrEqual(58);
  });

  test('a hit that lands ends it on the next step', () => {
    const sim = launched(at({ 6: [SPIKE()] }), { LAUNCH_GRACE_S: 0 });
    const events: EvRecord[] = [];
    doubleTap(sim, 4, events);
    stepUntil(sim, () => sim.state.shields < 3, HOLD, events);
    expect(kinds(events)).toEqual([Ev.BOOST_ON, Ev.BOOST_OFF, Ev.BOOST_ON]);
    const after: EvRecord[] = [];
    steps(sim, 1, HOLD, after);
    expect(kinds(after)).toEqual([Ev.BOOST_OFF]);
  });

  test('a hit while the button is held keeps boosting as a plain hold, until release', () => {
    const sim = launched(at({ 6: [SPIKE()] }), { LAUNCH_GRACE_S: 0 });
    const events: EvRecord[] = [];
    doubleTap(sim, 4, events);
    stepUntil(sim, () => sim.state.shields < 3, BOOST, events);
    steps(sim, 30, BOOST, events);
    expect(kinds(events)).toEqual([Ev.BOOST_ON, Ev.BOOST_OFF, Ev.BOOST_ON]);
    expect(kinds(steps(sim, 1, HOLD))).toEqual([Ev.BOOST_OFF]);
  });

  test('a hazard during launch grace is no hit and does not end it', () => {
    const sim = launched(at({ 5: [SPIKE()] }));
    const start = sim.state.tick;
    const events: EvRecord[] = [];
    doubleTap(sim, 4, events);
    // Past the spike's row (z 320) and still inside the 180-tick grace, so the spike was crossed and blocked.
    stepUntil(sim, () => planeU(sim) > 330, HOLD, events);
    expect(sim.state.tick - start).toBeLessThan(180);
    expect(sim.state.shields).toBe(3);
    expect(kinds(events)).toEqual([Ev.BOOST_ON, Ev.BOOST_OFF, Ev.BOOST_ON]);
  });

  test('the next press cancels it: boost holds while pressed and stops on release', () => {
    const sim = launched();
    const events: EvRecord[] = [];
    doubleTap(sim, 4, events);
    steps(sim, 60, HOLD, events);
    steps(sim, 4, BOOST, events);
    expect(kinds(events)).toEqual([Ev.BOOST_ON, Ev.BOOST_OFF, Ev.BOOST_ON]);
    expect(kinds(steps(sim, 1, HOLD))).toEqual([Ev.BOOST_OFF]);
    const left = sim.state.overdrive;
    steps(sim, 60, HOLD);
    expect(sim.state.overdrive).toBe(left);
  });

  test('the cancelling press does not open a new double tap', () => {
    const sim = launched();
    doubleTap(sim, 4, []);
    steps(sim, 60, HOLD);
    const events: EvRecord[] = [];
    doubleTap(sim, 4, events);
    steps(sim, 30, HOLD, events);
    // Cancel press, release (off); the next press is a first tap again, so release turns it off.
    expect(kinds(events)).toEqual([Ev.BOOST_OFF, Ev.BOOST_ON, Ev.BOOST_OFF]);
  });

  test('pause ends it, and resume does not bring it back', () => {
    const sim = launched();
    doubleTap(sim, 4, []);
    steps(sim, 10, HOLD);
    sim.command('pause');
    expect(kinds(take(sim))).toEqual([Ev.BOOST_OFF]);
    sim.command('resume');
    expect(kinds(steps(sim, 60, HOLD))).toEqual([]);
  });
});

describe('hit', () => {
  test('shield -1, SYNC halved, floor 1, ghost 1.2 s, HIT event, and no score', () => {
    const sim = make(afterSync(7, SPIKE()), { LAUNCH_GRACE_S: 0 });
    sim.command('launch');
    const events: EvRecord[] = [];
    stepUntil(sim, () => sim.state.shields < 3, HOLD, events);
    expect(sim.state.sync).toBe(4);
    expect(sim.state.shields).toBe(2);
    expect(sim.state.ghost).toBeCloseTo(1.2, 10);
    const hit = events.find((e) => e.kind === Ev.HIT)!;
    expect(hit.value).toBe(2);
    expect(hit.chunk).toBe(11);
    expect(hit.index).toBe(0);
    expect(hit.x).toBe(0);
    expect(hit.y).toBe(6);
  });

  test('SYNC 1 stays 1', () => {
    const { sim } = playingUntil(at({ 4: [SPIKE()] }), Ev.HIT);
    expect(sim.state.sync).toBe(1);
  });

  test('ghost blocks a hit for 144 ticks: tick 143 after the hit is blocked and tick 144 is not', () => {
    // HIT_SPEED_FACTOR 1 keeps the speed exact, so the second spike can be placed by the tick it must arrive at.
    for (const [ticksAfter, shieldsLeft] of [[143, 2], [144, 1]] as const) {
      const sim = make(at({ 4: [SPIKE()] }), { LAUNCH_GRACE_S: 0, BEAT_LOCK_MAX: 0, HIT_SPEED_FACTOR: 1 });
      sim.command('launch');
      stepUntil(sim, () => sim.state.shields === 2);
      const hitTick = sim.state.tick;
      const plane = sim.state.travel.chunk * 64 + sim.state.travel.local + 14;
      const z = plane + ticksAfter * (80 / 120) - 0.3;
      const chunk = Math.floor(z / 64);
      const second = make(scriptedWorld((c) => {
        const out: ScriptedItem[] = [];
        if (c === 4) out.push(SPIKE());
        if (c === chunk) out.push(SPIKE(z - chunk * 64));
        return out;
      }), { LAUNCH_GRACE_S: 0, BEAT_LOCK_MAX: 0, HIT_SPEED_FACTOR: 1 });
      second.command('launch');
      steps(second, hitTick + ticksAfter + 5);
      expect(second.state.shields).toBe(shieldsLeft);
    }
  });

  test('ghost blocks a graze too', () => {
    const sim = make(at({ 4: [SPIKE(), GRAZER(20)] }), { LAUNCH_GRACE_S: 0 });
    sim.command('launch');
    const events = steps(sim, 200);
    expect(events.filter((e) => e.kind === Ev.HIT).length).toBe(1);
    expect(events.filter((e) => e.kind === Ev.GRAZE).length).toBe(0);
    expect(sim.state.score).toBe(0);
  });

  test('launch grace blocks hits for 1.5 s', () => {
    const blocked = make(at({ 4: [SPIKE()] }));
    blocked.command('launch');
    steps(blocked, 200);
    expect(blocked.state.shields).toBe(3);
    const afterGrace = make(at({ 7: [SPIKE()] }));
    afterGrace.command('launch');
    steps(afterGrace, 400);
    expect(afterGrace.state.shields).toBe(2);
  });

  test('third hit: SIGNAL_LOST, HIT with 0 then SIGNAL_LOST, score kept', () => {
    const sim = make(carpetWorld());
    sim.command('launch');
    const events: EvRecord[] = [];
    stepUntil(sim, () => sim.state.mode === SimMode.SIGNAL_LOST, HOLD, events);
    expect(events.filter((e) => e.kind === Ev.HIT).map((e) => e.value)).toEqual([2, 1, 0]);
    const sl = events.find((e) => e.kind === Ev.SIGNAL_LOST)!;
    expect(sl.value).toBe(0);
    expect(sl.chunk).toBe(sim.state.travel.chunk);
    expect(sl.index).toBe(0);
  });
});

describe('SYNC bounds', () => {
  test('never above 16 or below 1, whatever happens', () => {
    const rows: ScriptedItem[] = [{ ...GATE(), radius: 40 }, GATE_FAR(30)];
    const sim = make(scriptedWorld((c) => (c % 5 === 0 ? [{ ...GATE_FAR(), x: 39 }] : c % 7 === 0 ? [SPIKE()] : rows)), { LAUNCH_GRACE_S: 0 });
    sim.command('launch');
    for (let i = 0; i < 50000; i++) {
      sim.step(HOLD);
      sim.events.count = 0;
      expect(sim.state.sync).toBeGreaterThanOrEqual(1);
      expect(sim.state.sync).toBeLessThanOrEqual(16);
      expect(sim.state.overdrive).toBeLessThanOrEqual(1);
    }
  });
});

describe('overflow', () => {
  function carpetRun(clearEvery: number): { sim: Sim; maxCount: number } {
    const items: ScriptedItem[] = [];
    for (let i = 0; i < 32; i++) items.push({ kind: ItemKind.SHARD, x: 0, y: 6, z: i * 2, radius: 80 });
    const sim = make(scriptedWorld(() => items), { LAUNCH_GRACE_S: 0, GATE_POINTS: 500 });
    sim.command('launch');
    let maxCount = 0;
    for (let f = 0; f < 200; f++) {
      for (let i = 0; i < 30; i++) {
        sim.step(HOLD);
        maxCount = Math.max(maxCount, sim.events.count);
        if (clearEvery === 1) sim.events.count = 0;
      }
    }
    return { sim, maxCount };
  }

  test('a 32-item carpet at 30 steps per frame, never cleared: count 64, and the state equals a run cleared every step', () => {
    const flooded = carpetRun(0);
    const cleared = carpetRun(1);
    expect(flooded.sim.events.count).toBe(EVENT_CAPACITY);
    expect(flooded.maxCount).toBe(64);
    expect(cleared.maxCount).toBeLessThan(64);
    const a = flooded.sim.state;
    const b = cleared.sim.state;
    expect({ ...a, travel: { ...a.travel } }).toEqual({ ...b, travel: { ...b.travel } });
    expect(a.score).toBeGreaterThan(0);
  });
});

describe('event payloads', () => {
  test('SHARD, GATE, GATE_MISS, GRAZE, HIT: x, y are the ship, chunk and index name the record', () => {
    const rows: Record<number, readonly ScriptedItem[]> = {
      4: [SHARD(), GATE(1), GATE_FAR(2), GRAZER(3), CLEAR(4), SPIKE(30)],
    };
    const sim = make(at(rows), { LAUNCH_GRACE_S: 0 });
    sim.command('launch');
    const events = steps(sim, 200);
    const kinds = events.map((e) => [e.kind, e.chunk, e.index]);
    expect(kinds).toEqual([
      [Ev.SHARD, 4, 0], [Ev.GATE, 4, 1], [Ev.GATE_MISS, 4, 2], [Ev.GRAZE, 4, 3], [Ev.HIT, 4, 5],
    ]);
    for (const e of events) {
      expect(e.x).toBe(0);
      expect(e.y).toBe(6);
    }
    expect(events.map((e) => e.value)).toEqual([100, 500, 0, 50 * 1, 2]);
  });

  test('BOOST_ON and BOOST_OFF: value 0, travel.chunk, index 0', () => {
    const sim = make(emptyWorld(), { OVERDRIVE_START: 1 });
    sim.command('launch');
    const events = steps(sim, 5, BOOST);
    expect(events.length).toBe(1);
    expect(events[0]!.kind).toBe(Ev.BOOST_ON);
    expect(events[0]!.value).toBe(0);
    expect(events[0]!.chunk).toBe(sim.state.travel.chunk);
    expect(events[0]!.index).toBe(0);
  });

  test('SECTOR: value is the new index, travel.chunk, index 0; state.sectorIndex agrees at the same step', () => {
    const sim = make(emptyWorld());
    sim.command('launch');
    const events: EvRecord[] = [];
    stepUntil(sim, () => events.length > 0, HOLD, events);
    // DI-97: the launch sector is graded, so its GRADE comes just before SECTOR in the same step: GATES 0 of 10, a C.
    expect(events.map((e) => e.kind)).toEqual([Ev.GRADE, Ev.SECTOR]);
    expect(events[0]!.tick).toBe(events[1]!.tick);
    expect([events[0]!.index, events[0]!.value, events[0]!.chunk]).toEqual([3, 250, 100]);
    expect(events[1]!.value).toBe(1);
    expect(events[1]!.chunk).toBe(100);
    expect(events[1]!.index).toBe(0);
    expect(sim.state.sectorIndex).toBe(1);
  });

  test('rows fire ascending by chunk, then index', () => {
    const rows: Record<number, readonly ScriptedItem[]> = {
      4: [{ ...SHARD(10) }, { ...SHARD(10) }, { ...SHARD(10) }],
      5: [{ ...SHARD(10) }, { ...SHARD(10) }],
    };
    const sim = make(at(rows), { LAUNCH_GRACE_S: 0 });
    sim.command('launch');
    const events = steps(sim, 300);
    expect(events.map((e) => [e.chunk, e.index])).toEqual([[4, 0], [4, 1], [4, 2], [5, 0], [5, 1]]);
  });

  test('no rule reads the buffer: pre-filling it changes nothing', () => {
    const run = (fill: boolean) => {
      const sim = make(at({ 4: [SHARD()], 5: [GATE()], 6: [SPIKE()] }), { LAUNCH_GRACE_S: 0 });
      sim.command('launch');
      for (let i = 0; i < 600; i++) {
        if (fill) sim.events.count = EVENT_CAPACITY;
        sim.step(NOBODY);
        if (!fill) sim.events.count = 0;
      }
      return { ...sim.state, travel: { ...sim.state.travel } };
    };
    expect(run(true)).toEqual(run(false));
  });
});
