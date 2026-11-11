// A7: gates land on the beat at normal cruise, re-lock after a disturbance, and the lock is off under reduced motion.
import { describe, expect, test } from 'vitest';
import { Ev, ItemKind, type Sim } from '../../../src/contracts/index';
import { BOOST, HOLD, make, steps, stepUntil, type EvRecord } from './fixtures/drive';
import { scriptedWorld, type ScriptedItem } from './fixtures/worlds';

const GATE: ScriptedItem = { kind: ItemKind.GATE, x: 0, y: 6, z: 0, radius: 9 };

function gatesOnly() {
  return scriptedWorld((c) => (c % 3 === 0 ? [GATE] : []));
}

/** How many ticks a gate's tick is from the nearest integer beat. */
function offBeat(tick: number): number {
  const m = tick % 72;
  return Math.min(m, 72 - m);
}

function gateTicks(events: readonly EvRecord[]): number[] {
  return events.filter((e) => e.kind === Ev.GATE).map((e) => e.tick);
}

describe('undisturbed', () => {
  test('launched at tick 0: the first 20 gates cross within 1 tick of an integer beat, the first after exactly 3 beats', () => {
    const sim = make(gatesOnly(), { LAUNCH_GRACE_S: 0 });
    sim.command('launch');
    const events: EvRecord[] = [];
    stepUntil(sim, () => gateTicks(events).length >= 20, HOLD, events);
    const ticks = gateTicks(events);
    expect(Math.abs(ticks[0]! - 216)).toBeLessThanOrEqual(1);
    for (const t of ticks) expect(offBeat(t)).toBeLessThanOrEqual(1);
    for (let i = 1; i < ticks.length; i++) expect(Math.abs(ticks[i]! - ticks[i - 1]! - 288)).toBeLessThanOrEqual(1);
  });
});

function relockedAfter(sim: Sim, label: string): { firstLockedS: number; held: number } {
  const start = sim.state.tick;
  const events: EvRecord[] = [];
  steps(sim, 120 * 30, HOLD, events);
  const ticks = gateTicks(events);
  const firstLocked = ticks.findIndex((t, i) => ticks.slice(i).every((u) => offBeat(u) <= 1));
  expect(firstLocked, label).toBeGreaterThanOrEqual(0);
  return { firstLockedS: (ticks[firstLocked]! - start) / 120, held: ticks.length - firstLocked };
}

describe('after a disturbance', () => {
  test('after a 5 s boost, a gate crossing within 1 tick of a beat occurs within 10 s and holds', () => {
    const sim = make(gatesOnly(), { LAUNCH_GRACE_S: 0, OVERDRIVE_START: 1 });
    sim.command('launch');
    steps(sim, 600, BOOST);
    steps(sim, 240);   // Decelerating: the lock waits for speed to settle, about 1.6 s.
    const r = relockedAfter(sim, 'boost');
    expect(r.firstLockedS).toBeLessThanOrEqual(10);
    expect(r.held).toBeGreaterThanOrEqual(5);
  });

  test('after a hit, the same', () => {
    const world = scriptedWorld((c) => (c % 3 === 0 ? [GATE] : c === 8 ? [{ kind: ItemKind.SPIKE, x: 0, y: 6, z: 10, radius: 2 }] : []));
    const sim = make(world, { LAUNCH_GRACE_S: 0 });
    sim.command('launch');
    stepUntil(sim, () => sim.state.shields === 2);
    const r = relockedAfter(sim, 'hit');
    expect(r.firstLockedS).toBeLessThanOrEqual(10);
    expect(r.held).toBeGreaterThanOrEqual(5);
  });

  test('speed stays inside 80 +/- 4.8 when locked', () => {
    const sim = make(gatesOnly(), { LAUNCH_GRACE_S: 0, OVERDRIVE_START: 1 });
    sim.command('launch');
    steps(sim, 300, BOOST);
    steps(sim, 300);
    let trimmed = 0;
    for (let i = 0; i < 2400; i++) {
      sim.step(HOLD);
      sim.events.count = 0;
      expect(sim.state.speed).toBeGreaterThanOrEqual(80 - 4.8);
      expect(sim.state.speed).toBeLessThanOrEqual(80 + 4.8);
      if (Math.abs(sim.state.speed - 80) > 0.5) trimmed++;
    }
    expect(trimmed).toBeGreaterThan(0);
  });

  test('the worst phase error closes in about 6 s', () => {
    // Half a beat out: warp the plane 24 u off. Speed saturates at +/- 4.8 u/s, then the error decays with a 1 s time constant.
    const sim = make(gatesOnly(), { LAUNCH_GRACE_S: 0 });
    sim.command('launch');
    sim.warpTo(sim.state.travel.chunk, 34 + 24);
    const events: EvRecord[] = [];
    steps(sim, 120 * 12, HOLD, events);
    const late = gateTicks(events).filter((t) => t > 120 * 9);
    expect(late.length).toBeGreaterThan(0);
    for (const t of late) expect(offBeat(t)).toBeLessThanOrEqual(1);
  });
});

describe('controls', () => {
  test('negative control: with BEAT_LOCK_MAX 0, a boost leaves the gates off the beat for good', () => {
    const sim = make(gatesOnly(), { LAUNCH_GRACE_S: 0, OVERDRIVE_START: 1, BEAT_LOCK_MAX: 0 });
    sim.command('launch');
    steps(sim, 600, BOOST);
    steps(sim, 240);
    const events: EvRecord[] = [];
    steps(sim, 120 * 30, HOLD, events);
    const ticks = gateTicks(events);
    expect(ticks.length).toBeGreaterThanOrEqual(5);
    const inBand = ticks.filter((t) => offBeat(t) <= 1).length;
    expect(inBand).toBe(0);
  });

  test('off under reduced motion, where speed is 48 exactly and a bar is not 192 u', () => {
    const sim = make(gatesOnly(), { LAUNCH_GRACE_S: 0 });
    sim.setReducedMotion(true);
    sim.command('launch');
    steps(sim, 240);
    for (let i = 0; i < 2400; i++) {
      sim.step(HOLD);
      sim.events.count = 0;
      expect(sim.state.speed).toBe(48);
    }
  });

  test('not during a boost', () => {
    const sim = make(gatesOnly(), { LAUNCH_GRACE_S: 0, OVERDRIVE_START: 1, BOOST_DRAIN_PER_S: 0 });
    sim.command('launch');
    steps(sim, 200, BOOST);
    for (let i = 0; i < 1000; i++) {
      sim.step(BOOST);
      sim.events.count = 0;
      expect(sim.state.speed).toBe(150);
    }
  });
});
