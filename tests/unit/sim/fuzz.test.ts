// A10 and A11: R1 cannot be broken from inside the sim, in any mode, at chunk 0 and at chunk 2^40, and the same gate fails
// when a floor is removed. FUZZ_STEPS is 1e6, or T02_FUZZ_STEPS for quick local runs.
import { describe, expect, test } from 'vitest';
import { CHUNK_LIMIT, SimMode, type WorldSource } from '../../../src/contracts/index';
import { checkStep, createSnap, type Snap } from './fixtures/invariants';
import { runFuzz, runIdleFuzz, type FuzzTarget } from './fixtures/drive';
import { carpetWorld, gauntletWorld, poisonWorld } from './fixtures/worlds';

const FUZZ_STEPS = Number(process.env['T02_FUZZ_STEPS'] ?? 1e6);
const REDUCED_STEPS = Math.min(FUZZ_STEPS, 1e5);
const TIMEOUT = 600_000;
const TARGETS = ['DEMO', 'PLAY', 'CRUISE', 'SIGNAL_LOST'] as const;
const BASES = [0, 2 ** 40] as const;

function worldFor(target: FuzzTarget): WorldSource {
  if (target === 'SIGNAL_LOST') return carpetWorld();
  if (target === 'CHAOS') return poisonWorld();
  return gauntletWorld({ seed: 1985, density: target === 'DEMO' ? 0.6 : 1 });
}

function seedFor(target: FuzzTarget, base: number, extra = 0): number {
  return TARGETS.indexOf(target as (typeof TARGETS)[number]) * 7919 + (base === 0 ? 0 : 104729) + extra + 1985;
}

describe('A10: invariants hold', () => {
  for (const target of TARGETS) {
    for (const base of BASES) {
      test(`${target} at chunk ${base}`, () => {
        const r = runFuzz({ world: worldFor(target), base, target, stepsInMode: FUZZ_STEPS, seed: seedFor(target, base) });
        console.log(`FUZZ ${target} base=${base} steps=${r.inMode} ok (of ${r.steps}, ${r.hits} hits)`);
        expect(r.inMode).toBeGreaterThanOrEqual(FUZZ_STEPS);
        if (target === 'SIGNAL_LOST') expect(r.hits).toBeGreaterThan(0);
      }, TIMEOUT);
    }
  }

  for (const base of BASES) {
    test(`CHAOS at chunk ${base}`, () => {
      const r = runFuzz({ world: worldFor('CHAOS'), base, target: 'CHAOS', stepsInMode: FUZZ_STEPS, seed: seedFor('CHAOS', base, 31) });
      console.log(`FUZZ CHAOS base=${base} steps=${r.steps} ok (${r.warps} warps, ${r.hits} hits, modes ${r.modeSteps.join('/')}, idle ${r.idleSteps}, reduced ${r.reducedSteps})`);
      expect(r.steps).toBeGreaterThanOrEqual(FUZZ_STEPS);
      expect(r.warps).toBeGreaterThan(0);
      if (FUZZ_STEPS >= 1e5) {
        // Chaos reached every state it claims to cover.
        expect(r.modeSteps[SimMode.PLAY]).toBeGreaterThan(1000);
        expect(r.modeSteps[SimMode.CRUISE]).toBeGreaterThan(1000);
        expect(r.modeSteps[SimMode.SIGNAL_LOST]).toBeGreaterThan(1000);
        expect(r.idleSteps).toBeGreaterThan(100);
        expect(r.reducedSteps).toBeGreaterThan(1000);
      }
    }, TIMEOUT);
  }

  for (const target of TARGETS) {
    test(`${target} under reduced motion`, () => {
      const r = runFuzz({ world: worldFor(target), base: 0, target, stepsInMode: REDUCED_STEPS, seed: seedFor(target, 0, 77), reducedMotion: true });
      console.log(`FUZZ ${target} reduced steps=${r.inMode} ok (of ${r.steps})`);
      expect(r.inMode).toBeGreaterThanOrEqual(REDUCED_STEPS);
    }, TIMEOUT);
  }

  // DI-94: leaving SIGNAL_LOST is not player input. With human false on every frame, the score never rises after the first
  // idle, through any number of forced losses. Poison changes sector every chunk, so a loss spans several boundaries.
  test.each<[string, number, () => WorldSource]>([
    ['gauntlet', 0, () => gauntletWorld({ seed: 1985, density: 1 })],
    ['gauntlet', 2 ** 40, () => gauntletWorld({ seed: 1985, density: 1 })],
    ['poison', 0, () => poisonWorld()],
  ])('nobody at the controls on %s at chunk %d: score frozen after the first idle', (name, base, world) => {
    const r = runIdleFuzz({ world: world(), base, steps: FUZZ_STEPS, seed: 9400 + base % 997 + name.length });
    console.log(`FUZZ IDLE ${name} base=${base} steps=${r.steps} ok (first idle tick ${r.firstIdleTick}, ${r.forcedFromIdle} forced from idle, ` +
      `lost ${r.lostSteps}, idle ${r.idleSteps}, live after idle ${r.liveAfterIdle}, hits after idle ${r.hitsAfterIdle}, ` +
      `sectors in lost ${r.sectorsInLost}, score ${r.scoreAtIdle} -> ${r.finalScore})`);
    expect(r.steps).toBeGreaterThanOrEqual(FUZZ_STEPS);
    expect(r.firstIdleTick).toBeGreaterThan(0);
    expect(r.finalScore).toBe(r.scoreAtIdle);
    expect(r.liveAfterIdle).toBe(0);
    expect(r.forcedFromIdle).toBeGreaterThan(FUZZ_STEPS >= 1e5 ? 100 : 0);
    if (name === 'poison' && FUZZ_STEPS >= 1e5) expect(r.sectorsInLost).toBeGreaterThan(100);
  }, TIMEOUT);

  test('past the limit: 1e4 steps from CHUNK_LIMIT - 1', () => {
    const r = runFuzz({ world: gauntletWorld({ seed: 7, density: 1 }), base: CHUNK_LIMIT - 1, target: 'PLAY', stepsInMode: 1e4, seed: 7 });
    console.log(`FUZZ PLAY base=CHUNK_LIMIT-1 steps=${r.inMode} ok`);
    expect(r.inMode).toBeGreaterThanOrEqual(1e4);
  }, TIMEOUT);
});

describe('A11: the checker can fail', () => {
  const NORMAL = { reducedMotion: false };

  function goodPair(): { prev: Snap; cur: Snap } {
    const prev = createSnap();
    prev.tick = 100; prev.beat = 100 / 72; prev.speed = 80; prev.stepDist = 80 / 120;
    prev.chunk = 5; prev.local = 10; prev.x = 3; prev.y = 7; prev.prevX = 3; prev.prevY = 7;
    prev.mode = 1; prev.autopilot = false; prev.shields = 3;
    const cur: Snap = { ...prev };
    cur.tick = 101; cur.beat = 101 / 72; cur.local = 10 + 80 / 120; cur.prevX = prev.x; cur.prevY = prev.y;
    return { prev, cur };
  }

  test('an unbroken transition passes', () => {
    const { prev, cur } = goodPair();
    expect(checkStep(prev, cur, NORMAL)).toBeNull();
  });

  test.each<[string, (c: Snap) => void, RegExp]>([
    ['speed 44', (c) => { c.speed = 44; }, /speed floor/],
    ['equal travel', (c) => { c.local = 10; }, /travel/],
    ['stepDist halved', (c) => { c.stepDist /= 2; }, /stepDist/],
    ['NaN x', (c) => { c.x = NaN; }, /\bx NaN/],
    ['sync 17', (c) => { c.sync = 17; }, /sync 17/],
    ['tick + 2', (c) => { c.tick += 1; }, /tick/],
    ['local 64', (c) => { c.local = 64; }, /local 64/],
    ['beat off by a tick', (c) => { c.beat = (c.tick + 1) / 72; }, /beat/],
  ])('a hand-broken transition is named: %s', (_name, breakIt, want) => {
    const { prev, cur } = goodPair();
    breakIt(cur);
    expect(checkStep(prev, cur, NORMAL)).toMatch(want);
  });

  test('the reduced floor is 27, and 44 passes it', () => {
    const { prev, cur } = goodPair();
    cur.speed = 44;
    cur.stepDist = 44 / 120;
    cur.local = 10 + 44 / 120;
    expect(checkStep(prev, cur, { reducedMotion: true })).toBeNull();
    cur.speed = 26;
    cur.stepDist = 26 / 120;
    cur.local = 10 + 26 / 120;
    expect(checkStep(prev, cur, { reducedMotion: true })).toMatch(/speed floor/);
  });
});

describe('A11: the fuzz catches a broken sim through the real pipeline', () => {
  const world = gauntletWorld({ seed: 1985, density: 1 });

  test('no floor, hit factor 0.01: throws "speed floor"', () => {
    expect(() => runFuzz({ world, base: 0, target: 'PLAY', stepsInMode: 2e6, seed: 3, tuning: { speedFloor: 0, HIT_SPEED_FACTOR: 0.01 } })).toThrow(/speed floor/);
  }, TIMEOUT);

  test('no floor, hit factor 0: a sim that stops is caught as "travel" or "stepDist"', () => {
    expect(() => runFuzz({ world, base: 0, target: 'PLAY', stepsInMode: 2e6, seed: 3, tuning: { speedFloor: 0, HIT_SPEED_FACTOR: 0 } })).toThrow(/travel|stepDist/);
  }, TIMEOUT);

  test('the same run with the floor in place passes, so the controls above fail for their stated reason', () => {
    const r = runFuzz({ world, base: 0, target: 'PLAY', stepsInMode: 5e4, seed: 3, tuning: { HIT_SPEED_FACTOR: 0 } });
    expect(r.inMode).toBeGreaterThanOrEqual(5e4);
    expect(r.hits).toBeGreaterThan(0);
  }, TIMEOUT);
});
