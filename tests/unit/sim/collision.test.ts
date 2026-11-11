// A4: every item fires at most once, at the ship plane, with no tunnelling.
import { describe, expect, test } from 'vitest';
import {
  CHUNK_LEN, Ev, ItemKind, ITEM_STRIDE, Objective, SimMode, SHIP_FORWARD, TRAFFIC_TRAVEL_MAX,
  type ItemRow, type Sim, type WorldSource,
} from '../../../src/contracts/index';
import { createItemRow } from '../../../src/core/alloc';
import { advance, between } from '../../../src/core/coords';
import { droneOffset, phaseOf } from '../../../src/core/motion';
import { Crossing } from '../../../src/sim/collision';
import type { SimProbe } from '../../../src/sim/sim';
import { TUNING } from '../../../src/sim/tuning';
import { HOLD, make, mulberry32, NOBODY, planeU, steps, stepUntil } from './fixtures/drive';
import { gauntletWorld, scriptedWorld, type ScriptedItem } from './fixtures/worlds';

const PLAIN = { AP_ENABLED: false, BEAT_LOCK_MAX: 0, AP_DEMO_BOOST_TICKS: 0 };
const ALWAYS_BOOST = { AP_ENABLED: false, BEAT_LOCK_MAX: 0, AP_DEMO_BOOST_PERIOD_TICKS: 1, AP_DEMO_BOOST_TICKS: 1 };

interface Firing { chunk: number; index: number; kind: number; outcome: number; tick: number; plane: number; camChunk: number }

function recording(world: WorldSource, o?: Parameters<typeof make>[1]): { sim: Sim; firings: Firing[] } {
  const firings: Firing[] = [];
  const probe: SimProbe = {
    onCrossing(outcome, kind, row, index): void {
      firings.push({ chunk: row.chunk, index, kind, outcome, tick: sim.state.tick, plane: planeU(sim), camChunk: sim.state.travel.chunk });
    },
  };
  const sim = make(world, o, probe);
  return { sim, firings };
}

/** The checker the double-count control is run through. Returns the first repeated (chunk, index), or null. */
function firstRepeat(firings: readonly { chunk: number; index: number }[]): string | null {
  const seen = new Set<string>();
  for (const f of firings) {
    const key = `${f.chunk}:${f.index}`;
    if (seen.has(key)) return key;
    seen.add(key);
  }
  return null;
}

describe('no tunnelling', () => {
  const STATIC_ROW: readonly ScriptedItem[] = [
    { kind: ItemKind.SHARD, x: 0, y: 8, z: 0, radius: 2 },
    { kind: ItemKind.SPIKE, x: 30, y: 8, z: 63.99, radius: 2 },
  ];
  const world = scriptedWorld(() => STATIC_ROW);
  // z = 63.99 as stored: a record carries a Float32.
  const Z_HIGH = new Float32Array([63.99])[0]!;

  test.each([
    ['48 u/s, reduced', PLAIN, true, 48],
    ['80 u/s', PLAIN, false, 80],
    ['150 u/s', ALWAYS_BOOST, false, 150],
  ] as const)('%s: over 10,000 start offsets each item at zLocal 0 and 63.99 crosses exactly once', (_name, tuning, reduced, speed) => {
    const counts = new Map<number, number>();
    const sim = make(world, tuning, {
      onCrossing(_outcome, _kind, row, index): void {
        const key = row.chunk * 2 + index;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      },
    });
    sim.setReducedMotion(reduced);
    for (let i = 0; i < 400; i++) sim.step(NOBODY);
    expect(sim.state.speed).toBe(speed);
    sim.events.count = 0;

    const rand = mulberry32(1985);
    const stepU = speed / 120;
    const nSteps = Math.ceil(70 / stepU);
    let checked = 0;
    for (let trial = 0; trial < 10000; trial++) {
      // A third of the offsets land the plane on a record at zLocal 0 after a whole number of steps, which is where rounding bites.
      const pick = trial % 3;
      const offset = pick === 0 ? rand() * 64 : pick === 1 ? (64 * trial) / 10000 : CHUNK_LEN - SHIP_FORWARD - (trial % 40) * stepU;
      const chunk = 100 + (trial % 7);
      expect(sim.warpTo(chunk, offset)).toBe(true);
      const startCam = { chunk: sim.state.travel.chunk, local: sim.state.travel.local };
      counts.clear();
      for (let s = 0; s < nSteps; s++) sim.step(NOBODY);
      sim.events.count = 0;
      const endCam = sim.state.travel;
      for (let rc = chunk - 2; rc <= chunk + 3; rc++) {
        for (let index = 0; index < 2; index++) {
          const at = { chunk: rc, local: index === 0 ? 0 : Z_HIGH };
          // Distance past the plane at the start and at the end, by the same arithmetic the sim uses.
          const relStart = between({ chunk: rc, local: 0 }, startCam) - SHIP_FORWARD + at.local;
          const relEnd = between({ chunk: rc, local: 0 }, endCam) - SHIP_FORWARD + at.local;
          const expected = relStart > 0 && relEnd <= 0 ? 1 : 0;
          const got = counts.get(rc * 2 + index) ?? 0;
          if (got !== expected) throw new Error(`trial ${trial} row ${rc} index ${index}: fired ${got}, expected ${expected}`);
          checked += expected;
        }
      }
    }
    // Over 70 u at least two records must have crossed per trial, so this cannot pass by finding nothing.
    expect(checked).toBeGreaterThanOrEqual(20000);
  }, 120000);

  test('negative control: the first form in the plan, rel + stepDist, double-counts on such offsets, so this can see the fault', () => {
    const stepDist = 80 / 120;
    let doubled = 0;
    let once = 0;
    let cases = 0;
    for (let k = 1; k < 3000; k++) {
      if (k % 40 === 0) continue;   // Already on the plane at the start, so it has already crossed.
      cases++;
      const start = (CHUNK_LEN - SHIP_FORWARD - (k % 40) * stepDist) + (k % 50) * 1e-3;
      const cam = { chunk: 100, local: start };
      const landing = { chunk: 100, local: start };
      for (let i = 0; i < k % 40; i++) advance(landing, stepDist);
      const item = { chunk: 100, local: 0 };
      const z = landing.local + SHIP_FORWARD - 0;
      let naive = 0;
      let exact = 0;
      const before = { chunk: 0, local: 0 };
      for (let i = 0; i < 60; i++) {
        before.chunk = cam.chunk;
        before.local = cam.local;
        advance(cam, stepDist);
        const rel = between(item, cam) - SHIP_FORWARD + z;
        if (rel + stepDist > 0 && rel <= 0) naive++;
        if (between(item, before) - SHIP_FORWARD + z > 0 && rel <= 0) exact++;
      }
      if (naive > 1) doubled++;
      if (exact === 1) once++;
    }
    expect(doubled).toBeGreaterThan(100);
    expect(once).toBe(cases);
  });

  // A gate on a step boundary meets the plane within rounding of exactly 0, and the side of 0 the rounding falls on decides
  // whether the plan's first form, rel + stepDist, double-counts it. From the start position every gate lands just above 0
  // on the step before it crosses, beat lock on or off, at 80 or 48 u/s [O: repair probe], and that form still counts those
  // once. So the first test checks the steady case it names, and the second warps to offsets that also reach the side
  // where that form fires twice (V1-T02 verifier, mutation M1; section 10).
  const gateEvery3 = (): WorldSource => scriptedWorld((c) => (c % 3 === 0 ? [{ kind: ItemKind.GATE, x: 0, y: 6, z: 0, radius: 9 }] : []));

  // Exact gate counts over the 400 s (48,000 steps) [arithmetic]. From the start the plane is at 3 * 64 + 48 = 240 u, so the
  // first gate, chunk 6 at 384 u, is 144 u ahead, and one follows every 192 u. At 80 u/s (2/3 u a step) the first crosses on
  // step 217 and one every 288 steps after: 1 + floor((48000 - 217) / 288) = 166. At 48 u/s (0.4 u a step), step 361 and
  // every 480: 1 + floor((48000 - 361) / 480) = 100. An exact count also catches a run that loses its tail.
  test.each([
    ['80 u/s, beat lock on', { AP_ENABLED: false, AP_DEMO_BOOST_TICKS: 0 }, false, 80, 166],
    ['80 u/s, no lock', PLAIN, false, 80, 166],
    ['48 u/s, reduced', PLAIN, true, 48, 100],
  ] as const)('%s: a gate on the beat grid, within rounding of the plane one step before it crosses, fires once per crossing', (_name, tuning, reduced, speed, gates) => {
    const firings: { chunk: number; before: number }[] = [];
    const origin = { chunk: 0, local: 0 };
    const sim = make(gateEvery3(), tuning, {
      onCrossing(_o, _k, row): void {
        origin.chunk = row.chunk;
        firings.push({ chunk: row.chunk, before: between(origin, sim.state.travel) - SHIP_FORWARD + sim.state.stepDist });
      },
    });
    sim.setReducedMotion(reduced);
    // Settle, then warp back to the start, at a tick on the beat. Before DI-75 reduced motion set here eased down off the
    // step grid; it now starts at 48, and the settle is kept so the row's start is unchanged.
    steps(sim, 216, NOBODY);
    expect(sim.warpTo(3, 48 - SHIP_FORWARD)).toBe(true);
    firings.length = 0;
    steps(sim, 120 * 400, NOBODY);
    expect(Math.abs(sim.state.speed - speed)).toBeLessThan(1e-6);
    const chunks = firings.map((f) => f.chunk);
    expect(chunks.length).toBe(gates);
    expect(new Set(chunks).size).toBe(chunks.length);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i]! - chunks[i - 1]!).toBe(3);
    // The case the name claims, checked rather than assumed.
    const worst = Math.max(...firings.map((f) => Math.abs(f.before)));
    expect(worst).toBeLessThan(1e-9);
  });

  test.each([
    ['80 u/s', false, 80],
    ['48 u/s, reduced', true, 48],
  ] as const)('%s: gates reached from offsets that round to either side of the plane each fire exactly once', (_name, reduced, speed) => {
    let fired = 0;
    const origin = { chunk: 0, local: 0 };
    let atCrossing = 0;
    let stepBefore = 0;
    const sim = make(gateEvery3(), PLAIN, {
      onCrossing(_o, _k, row): void {
        fired++;
        origin.chunk = row.chunk;
        const rel = between(origin, sim.state.travel) - SHIP_FORWARD;
        if (Math.abs(rel) < 1e-9) atCrossing++;
        else if (Math.abs(rel + sim.state.stepDist) < 1e-9) stepBefore++;
        else throw new Error(`a gate crossed ${rel} u from the plane, not within rounding`);
      },
    });
    sim.setReducedMotion(reduced);
    steps(sim, 300, NOBODY);
    expect(sim.state.speed).toBe(speed);
    atCrossing = 0;
    stepBefore = 0;
    const stepU = speed / 120;
    const most = Math.floor((CHUNK_LEN - SHIP_FORWARD) / stepU);
    for (let j = 1; j < most; j++) {
      // The plane reaches the gate of chunk 3m + 3 after exactly j steps.
      const m = 10 + (j % 7);
      expect(sim.warpTo(3 * m + 2, CHUNK_LEN - SHIP_FORWARD - j * stepU)).toBe(true);
      fired = 0;
      steps(sim, j + 3, NOBODY);
      if (fired !== 1) throw new Error(`offset ${j}: fired ${fired}, expected 1`);
    }
    // Both sides of 0 were reached, so the side where rel + stepDist fires twice was exercised.
    expect(atCrossing).toBeGreaterThan(0);
    expect(stepBefore).toBeGreaterThan(0);
    expect(atCrossing + stepBefore).toBe(most - 1);
  });

  test('the same holds at chunk 2^40', () => {
    const counts = new Map<string, number>();
    const sim = make(world, PLAIN, {
      onCrossing(_outcome, _kind, row, index): void {
        const key = `${row.chunk}:${index}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      },
    });
    const base = 2 ** 40;
    expect(sim.warpTo(base, 3.25)).toBe(true);
    for (let i = 0; i < 20000; i++) {
      sim.step(NOBODY);
      sim.events.count = 0;
    }
    const passed = sim.state.travel.chunk - base;
    expect(passed).toBeGreaterThan(100);
    expect(counts.size).toBeGreaterThanOrEqual(2 * (passed - 1));
    for (const [key, v] of counts) {
      if (v !== 1) throw new Error(`${key} fired ${v} times`);
    }
  });
});

describe('the double-count checker', () => {
  test('negative control: it fails on a hand-made double count, and passes the same list without it', () => {
    const clean = [{ chunk: 5, index: 0 }, { chunk: 5, index: 1 }, { chunk: 6, index: 0 }];
    expect(firstRepeat(clean)).toBeNull();
    expect(firstRepeat([...clean, { chunk: 5, index: 1 }])).toBe('5:1');
  });
});

describe('the ship plane', () => {
  test('an item fires when between puts it at SHIP_FORWARD from the camera, not at 0', () => {
    const world = scriptedWorld((c) => (c === 8 ? [{ kind: ItemKind.SHARD, x: 0, y: 6, z: 10, radius: 80 }] : []));
    const { sim, firings } = recording(world, PLAIN);
    stepUntil(sim, () => firings.length > 0, NOBODY);
    const item = { chunk: 8, local: 10 };
    const distance = between(item, sim.state.travel);
    expect(distance).toBeLessThanOrEqual(SHIP_FORWARD);
    expect(distance).toBeGreaterThan(SHIP_FORWARD - sim.state.stepDist);
    expect(firings.length).toBe(1);
    // Nothing more when the camera itself reaches the item.
    stepUntil(sim, () => between(item, sim.state.travel) < 0, NOBODY);
    expect(firings.length).toBe(1);
  });
});

describe('traffic', () => {
  const carItem = (seed: number, z: number, b = 80): ScriptedItem => ({ kind: ItemKind.TRAFFIC, x: 0, y: 6, z, radius: 3, a: TRAFFIC_TRAVEL_MAX, b, seed });

  test('a car from row c - 2 at TRAFFIC_TRAVEL_MAX and 40 u/s crosses once at normal speeds', () => {
    expect((TRAFFIC_TRAVEL_MAX * 80) / 256).toBe(40);
    let once = 0;
    let fromTwoBack = 0;
    for (let i = 0; i < 400; i++) {
      const seed = i / 400;
      const { sim, firings } = recording(scriptedWorld((c) => (c === 20 ? [carItem(seed, 63.99)] : [])), PLAIN);
      steps(sim, 2600, NOBODY);
      expect(firings.length).toBeLessThanOrEqual(1);
      if (firings.length === 1) {
        once++;
        expect(firings[0]!.kind).toBe(ItemKind.TRAFFIC);
        if (firings[0]!.chunk === firings[0]!.camChunk - 2) fromTwoBack++;
      }
    }
    // The plane takes 1.28 s to pass the band's 102.4 u, while the car climbs 51.2 u. It overtakes the car inside the band
    // only if the car starts that pass within 51.2 u above the band's bottom, so 51.2 / 128 = 40% of phases cross [arithmetic].
    // The rest wrap out of reach in the fade band.
    expect(once).toBeGreaterThanOrEqual(150);
    expect(once).toBeLessThanOrEqual(170);
    expect(fromTwoBack).toBeGreaterThan(0);
  });

  test('at boost the same car also crosses at most once', () => {
    for (let i = 0; i < 200; i++) {
      const { sim, firings } = recording(scriptedWorld((c) => (c === 20 ? [carItem(i / 200, 63.99)] : [])), ALWAYS_BOOST);
      steps(sim, 2000, NOBODY);
      expect(firings.length).toBeLessThanOrEqual(1);
    }
  });

  test('a wrap that jumps a car from ahead of the plane to behind it does not cross', () => {
    // seed 0.5, b 80: f = fract(tick / 384 + 0.5) wraps at tick 192, when the plane is at 240 + 128 = 368.
    // The car's home is 320, so it jumps from 448, ahead of the plane, to 320, behind it, with no real crossing.
    const { sim, firings } = recording(scriptedWorld((c) => (c === 5 ? [carItem(0.5, 0)] : [])), PLAIN);
    const homePos = 5 * 64;
    let wasAhead = false;
    let wentBehind = false;
    for (let t = 0; t < 800; t++) {
      sim.step(NOBODY);
      const q = 80 * phaseOf(sim.state.tick, 0, 7) + 0.5;
      const f = q - Math.floor(q);
      const rel = homePos + TRAFFIC_TRAVEL_MAX * f - planeU(sim);
      if (sim.state.tick === 191) wasAhead = rel > 0;
      if (sim.state.tick === 193) wentBehind = rel < 0;
    }
    expect(wasAhead).toBe(true);
    expect(wentBehind).toBe(true);
    expect(firings.length).toBe(0);
  });

  test('a car that meets the plane inside the fade band cannot hit', () => {
    // After the wrap at tick 192 the car is at 374 + (tick - 192) / 3, and the plane meets it at tick 210, with f = 0.047.
    const { sim, firings } = recording(scriptedWorld((c) => (c === 5 ? [carItem(0.5, 54)] : [])), PLAIN);
    const homePos = 5 * 64 + 54;
    let bandMeeting = false;
    let last = Infinity;
    for (let t = 0; t < 800; t++) {
      sim.step(NOBODY);
      const q = 80 * phaseOf(sim.state.tick, 0, 7) + 0.5;
      const f = q - Math.floor(q);
      const rel = homePos + TRAFFIC_TRAVEL_MAX * f - planeU(sim);
      if (last > 0 && rel <= 0 && f < 0.1 && f > 0) bandMeeting = true;
      last = rel;
    }
    expect(bandMeeting).toBe(true);
    expect(firings.length).toBe(0);
  });

  test('negative control: the same car outside the fade band does hit', () => {
    let hits = 0;
    for (let i = 0; i < 100; i++) {
      const { sim, firings } = recording(scriptedWorld((c) => (c === 20 ? [carItem(i / 100, 0)] : [])), PLAIN);
      steps(sim, 2600, NOBODY);
      for (const f of firings) if (f.outcome === Crossing.HAZARD_HIT) hits++;
    }
    expect(hits).toBeGreaterThan(30);
  });
});

describe('drone', () => {
  test('the same ship position hits or misses according to phase, matching droneOffset', () => {
    let hit = 0;
    let clear = 0;
    for (let i = 0; i < 300; i++) {
      const seed = i / 300;
      const item = { kind: ItemKind.DRONE, x: 0, y: 6, z: 5, radius: 2.5, a: 8, b: 1, seed };
      const { sim, firings } = recording(scriptedWorld((c) => (c === 6 ? [item] : [])), PLAIN);
      const trace: number[] = [];
      for (let t = 0; t < 500 && firings.length === 0; t++) {
        sim.step(NOBODY);
        trace.push(sim.state.x);
      }
      expect(firings.length).toBe(1);
      const f = firings[0]!;
      const stored = new Float32Array([seed])[0]!;
      const x = droneOffset(8, 1, stored, phaseOf(f.tick, 0, 3));
      const dy = sim.state.y - 6;
      const d = Math.hypot(sim.state.x - x, dy);
      const hitR = 2.5 + TUNING.SHIP_HIT_RADIUS;
      const want = d <= hitR ? Crossing.HAZARD_HIT : d <= 1.5 * hitR ? Crossing.HAZARD_GRAZE : Crossing.HAZARD_CLEAR;
      expect(f.outcome).toBe(want);
      if (want === Crossing.HAZARD_HIT) hit++;
      if (want === Crossing.HAZARD_CLEAR) clear++;
    }
    expect(hit).toBeGreaterThan(30);
    expect(clear).toBeGreaterThan(30);
  });
});

describe('fence', () => {
  /** A ship parked at x, then one fence with the given gap. */
  function outcomeAt(x: number, y: number, fence: { spanX: number; spanHalf: number; gap: number; gapHalf: number }): number {
    const item = { kind: ItemKind.FENCE, x: fence.spanX, y: 8, z: 0, radius: fence.spanHalf, a: fence.gap, b: fence.gapHalf };
    const { sim, firings } = recording(scriptedWorld((c) => (c === 12 ? [item] : [])), PLAIN);
    sim.command('launch');
    const hold = { moveX: x / 40, moveY: ((y - 2) / 12) * 2 - 1, absolute: true, boost: false, human: true };
    stepUntil(sim, () => firings.length > 0, hold);
    expect(firings.length).toBe(1);
    return firings[0]!.outcome;
  }
  const FENCE = { spanX: 0, spanHalf: 40, gap: 10, gapHalf: 8 };
  const inner = FENCE.gapHalf - TUNING.SHIP_HIT_RADIUS;

  test('in the gap: clear; the gap narrows by the ship radius', () => {
    expect(outcomeAt(10, 8, FENCE)).toBe(Crossing.HAZARD_CLEAR);
    expect(outcomeAt(10 + inner - TUNING.FENCE_GRAZE_MARGIN - 0.2, 8, FENCE)).toBe(Crossing.HAZARD_CLEAR);
  });
  test('near the edge inside the gap: graze', () => {
    expect(outcomeAt(10 + inner - 0.5, 8, FENCE)).toBe(Crossing.HAZARD_GRAZE);
    expect(outcomeAt(10 - inner + 0.5, 8, FENCE)).toBe(Crossing.HAZARD_GRAZE);
  });
  test('past the narrowed edge, though still in the drawn gap: hit', () => {
    expect(outcomeAt(10 + inner + 0.5, 8, FENCE)).toBe(Crossing.HAZARD_HIT);
    expect(outcomeAt(-30, 8, FENCE)).toBe(Crossing.HAZARD_HIT);
  });
  test('outside the span: clear', () => {
    expect(outcomeAt(30, 8, { spanX: -10, spanHalf: 20, gap: -10, gapHalf: 3 })).toBe(Crossing.HAZARD_CLEAR);
  });
  test('at any y', () => {
    for (const y of [2.5, 8, 13.5]) {
      expect(outcomeAt(-30, y, FENCE)).toBe(Crossing.HAZARD_HIT);
      expect(outcomeAt(10, y, FENCE)).toBe(Crossing.HAZARD_CLEAR);
    }
  });
});

describe('checkpoint', () => {
  const world = scriptedWorld((c) => (c === 10 ? [{ kind: ItemKind.GATE, x: 39, y: 13, z: 0, radius: 1, a: 1 }] : []), () => ({ objective: Objective.GATES, objectiveTarget: 5 }));

  test('never a miss, no points, no SYNC, not counted by GATES, even far outside its radius', () => {
    const sim = make(world, { LAUNCH_GRACE_S: 0 });
    sim.command('launch');
    const events = steps(sim, 1500);
    expect(events.filter((e) => e.kind === Ev.GATE_MISS).length).toBe(0);
    const gate = events.filter((e) => e.kind === Ev.GATE);
    expect(gate.length).toBe(1);
    expect(gate[0]!.value).toBe(0);
    expect(sim.state.score).toBe(0);
    expect(sim.state.sync).toBe(1);
    expect(sim.state.objectiveProgress).toBe(0);
  });

  test('flashes in DEMO, idle PLAY and SIGNAL_LOST, not in CRUISE', () => {
    const near = scriptedWorld((c) => (c === 5 ? [{ kind: ItemKind.GATE, x: 39, y: 13, z: 0, radius: 1, a: 1 }] : []));
    const far = scriptedWorld((c) => (c === 40 ? [{ kind: ItemKind.GATE, x: 39, y: 13, z: 0, radius: 1, a: 1 }] : []));
    const gateFlashes = (events: readonly { kind: number; value: number }[]): number => {
      const gates = events.filter((e) => e.kind === Ev.GATE);
      for (const g of gates) expect(g.value).toBe(0);
      return gates.length;
    };

    const demo = make(near);
    expect(gateFlashes(steps(demo, 400, NOBODY))).toBe(1);

    const lost = make(near);
    lost.command('launch');
    steps(lost, 10);
    lost.forceSignalLost();
    lost.events.count = 0;
    const during = steps(lost, 300);
    expect(lost.state.mode).toBe(SimMode.SIGNAL_LOST);
    expect(gateFlashes(during)).toBe(1);

    const idle = make(far);
    idle.command('launch');
    const flown = steps(idle, 5000, NOBODY);
    expect(idle.state.mode).toBe(SimMode.PLAY);
    expect(idle.state.autopilot).toBe(true);
    expect(gateFlashes(flown)).toBe(1);

    const cruise = make(near);
    cruise.command('launch');
    cruise.command('pause');
    expect(gateFlashes(steps(cruise, 400, NOBODY))).toBe(0);
  });
});

describe('row identity', () => {
  test('each item event names a record of the matching kind, at (chunk, index), and each item fires once', () => {
    const world = gauntletWorld({ seed: 1985, density: 1 });
    const sim = make(world);
    const rand = mulberry32(99);
    const row: ItemRow = createItemRow();
    const seen = new Set<string>();
    const control = { moveX: 0, moveY: 0, absolute: true, boost: false, human: true };
    sim.command('launch');
    let checked = 0;
    for (let i = 0; i < 60000; i++) {
      if (i % 60 === 0) {
        control.moveX = 2 * rand() - 1;
        control.moveY = 2 * rand() - 1;
      }
      sim.step(control);
      const e = sim.events;
      for (let n = 0; n < e.count; n++) {
        const kind = e.kind[n]!;
        const expected = kind === Ev.SHARD ? [ItemKind.SHARD]
          : kind === Ev.GATE || kind === Ev.GATE_MISS ? [ItemKind.GATE]
            : kind === Ev.GRAZE || kind === Ev.HIT ? [ItemKind.SPIKE, ItemKind.FENCE, ItemKind.DRONE, ItemKind.TRAFFIC] : null;
        if (expected === null) continue;
        world.fillItems(e.chunk[n]!, row);
        expect(e.index[n]!).toBeLessThan(row.count);
        expect(expected).toContain(row.data[e.index[n]! * ITEM_STRIDE]);
        const key = `${e.chunk[n]}:${e.index[n]}`;
        expect(seen.has(key), key).toBe(false);
        seen.add(key);
        checked++;
      }
      e.count = 0;
    }
    expect(checked).toBeGreaterThan(300);
  });
});

describe('poison records', () => {
  test('NaN and Infinity in a record cross nothing they should not, and throw nothing', () => {
    const items: ScriptedItem[] = [
      { kind: 99, x: 0, y: 6, z: 2, radius: 5 },
      { kind: ItemKind.SHARD, x: NaN, y: 6, z: 3, radius: 5 },
      { kind: ItemKind.SPIKE, x: 0, y: 6, z: NaN, radius: 5 },
      { kind: ItemKind.GATE, x: 0, y: 6, z: 4, radius: -3 },
    ];
    const { sim, firings } = recording(scriptedWorld((c) => (c >= 5 ? items : [])), PLAIN);
    steps(sim, 400, HOLD);
    expect(firings.length).toBeGreaterThan(0);
    for (const f of firings) {
      expect(f.kind).not.toBe(99);
      expect(f.index).not.toBe(2);   // A NaN zLocal never crosses.
      if (f.index === 1) expect(f.outcome).toBe(Crossing.SHARD_MISSED);
      if (f.index === 3) expect(f.outcome).toBe(Crossing.GATE_MISSED);
    }
  });
});
