// A6: objectives progress in T01's units, and grades.
import { describe, expect, test } from 'vitest';
import { Ev, ItemKind, Objective, SimMode, ZONE_CHUNKS, type Sim, type WorldSource } from '../../../src/contracts/index';
import { TUNING } from '../../../src/sim/tuning';
import { BOOST, HOLD, make, mulberry32, NOBODY, stepUntil, steps, take, type EvRecord } from './fixtures/drive';
import { gauntletWorld, scriptedWorld, type ScriptedItem, type ScriptedZone } from './fixtures/worlds';

const ALL_GATES: ScriptedItem = { kind: ItemKind.GATE, x: 0, y: 6, z: 0, radius: 40 };
const SHARD_HIT: ScriptedItem = { kind: ItemKind.SHARD, x: 0, y: 6, z: 0, radius: 40 };
const SHARD_MISS: ScriptedItem = { kind: ItemKind.SHARD, x: 39, y: 6, z: 0, radius: 1 };
const GRAZER: ScriptedItem = { kind: ItemKind.SPIKE, x: 5, y: 6, z: 0, radius: 2 };
const SPIKE: ScriptedItem = { kind: ItemKind.SPIKE, x: 0, y: 6, z: 0, radius: 2 };

/** Sector 0 covers chunks below `boundary`, by default ZONE_CHUNKS. */
function zones(objective: Objective, objectiveTarget: number, boundary = ZONE_CHUNKS): (c: number) => ScriptedZone {
  return (c) => ({ index: Math.floor(c / boundary), objective, objectiveTarget });
}

function playing(world: WorldSource, o?: Parameters<typeof make>[1]): Sim {
  const sim = make(world, { LAUNCH_GRACE_S: 0, ...o });
  sim.command('launch');
  return sim;
}

function untilChunk(sim: Sim, chunk: number, c = HOLD, into?: EvRecord[]): void {
  stepUntil(sim, () => sim.state.travel.chunk >= chunk, c, into);
}

describe('progress', () => {
  test('GATES counts normal gates threaded, and a miss neither counts nor takes back', () => {
    const world = scriptedWorld((c) => (c % 3 === 0 ? [{ ...ALL_GATES }] : c === 5 ? [{ ...ALL_GATES, x: 39, radius: 1 }] : []), zones(Objective.GATES, 100));
    const sim = playing(world);
    let last = 0;
    for (let i = 0; i < 4000; i++) {
      sim.step(HOLD);
      sim.events.count = 0;
      expect(sim.state.objectiveProgress).toBeGreaterThanOrEqual(last);
      last = sim.state.objectiveProgress;
    }
    expect(last).toBe(Math.floor((sim.state.travel.chunk + 0.2) / 3) - 1);
  });

  test('GRAZES counts grazes, and a hit is not one', () => {
    const world = scriptedWorld((c) => (c === 4 || c === 6 || c === 8 ? [GRAZER] : c === 10 ? [SPIKE] : []), zones(Objective.GRAZES, 100));
    const sim = playing(world);
    steps(sim, 1200);
    expect(sim.state.objectiveProgress).toBe(3);
    expect(sim.state.shields).toBe(2);
  });

  test('BOOST accumulates u while boosting and live, in stepDist', () => {
    const world = scriptedWorld(() => [], zones(Objective.BOOST, 1000));
    const sim = playing(world, { OVERDRIVE_START: 1 });
    let sum = 0;
    for (let i = 0; i < 240; i++) {
      sim.step(BOOST);
      sim.events.count = 0;
      sum += sim.state.stepDist;
    }
    expect(sim.state.objectiveProgress).toBeCloseTo(sum, 6);
    expect(sim.state.objectiveProgress).toBeGreaterThan(240);
    const held = sim.state.objectiveProgress;
    steps(sim, 300);
    expect(sim.state.objectiveProgress).toBe(held);
  });

  test('NO_HIT accumulates u, restarts its run on a hit and keeps its best', () => {
    const world = scriptedWorld((c) => (c === 20 ? [SPIKE] : []), zones(Objective.NO_HIT, 1e6));
    const sim = playing(world);
    stepUntil(sim, () => sim.state.shields === 2);
    const best = sim.state.objectiveProgress;
    expect(best).toBeGreaterThan(900);
    // The run restarted: progress holds until a new run beats it.
    const atHit = sim.state.tick;
    steps(sim, 240);
    expect(sim.state.objectiveProgress).toBe(best);
    stepUntil(sim, () => sim.state.objectiveProgress > best);
    const flown = (sim.state.tick - atHit) * (80 / 120);
    expect(flown).toBeGreaterThan(best - 50);
    expect(flown).toBeLessThan(best + 50);
  });

  test('CHAIN counts consecutive shards', () => {
    const world = scriptedWorld((c) => (c >= 4 && c < 10 ? [SHARD_HIT] : []), zones(Objective.CHAIN, 100));
    const sim = playing(world, { CHAIN_BREAK_U: 70 });
    untilChunk(sim, 12);
    expect(sim.state.objectiveProgress).toBe(6);
  });

  test('CHAIN survives a missed shard on a double rail with its twin collected, and a hit', () => {
    const rail = [SHARD_MISS, SHARD_HIT];
    const world = scriptedWorld((c) => (c >= 4 && c < 10 ? rail : c === 7 ? [SPIKE] : []), zones(Objective.CHAIN, 100));
    const sim = playing(world, { CHAIN_BREAK_U: 70 });
    untilChunk(sim, 12);
    expect(sim.state.objectiveProgress).toBe(6);
    const withHit = scriptedWorld((c) => (c >= 4 && c < 10 ? (c === 7 ? [...rail, { ...SPIKE, z: 10 }] : rail) : []), zones(Objective.CHAIN, 100));
    const hit = playing(withHit, { CHAIN_BREAK_U: 70 });
    untilChunk(hit, 12);
    expect(hit.state.shields).toBe(2);
    expect(hit.state.objectiveProgress).toBe(6);
  });

  test('CHAIN breaks past CHAIN_BREAK_U: a miss more than 36 u after the last taken shard, and the best stays', () => {
    const near = (z: number): ScriptedItem => ({ ...SHARD_HIT, z });
    const far = (z: number): ScriptedItem => ({ ...SHARD_MISS, z });
    const inRow = (zs: readonly ScriptedItem[]) => scriptedWorld((c) => (c === 4 ? zs : []), zones(Objective.CHAIN, 100));
    // Taken, taken, then a miss 34 u on: no break, so the next taken shard makes 3.
    const within = playing(inRow([near(0), near(4), far(38), near(44)]));
    untilChunk(within, 6);
    expect(within.state.objectiveProgress).toBe(3);
    // The same with the miss 40 u on: the run breaks at 2, and the taken shard after it starts a run of 1.
    const beyond = playing(inRow([near(0), near(4), far(44), near(48)]));
    untilChunk(beyond, 6);
    expect(beyond.state.objectiveProgress).toBe(2);
  });

  test('CHAIN breaks at SIGNAL_LOST', () => {
    const world = scriptedWorld((c) => (c >= 4 && c < 40 ? [{ ...SHARD_HIT }] : []), zones(Objective.CHAIN, 100));
    const sim = playing(world, { CHAIN_BREAK_U: 70 });
    untilChunk(sim, 8);
    const chain = sim.state.objectiveProgress;
    expect(chain).toBe(5);   // Chunks 4 to 8: the plane is 14 u ahead of the camera, so chunk 8's z 0 has crossed.
    sim.forceSignalLost();
    stepUntil(sim, () => sim.state.mode === SimMode.PLAY);
    expect(sim.state.objectiveProgress).toBe(chain);
    const shardsDuringLoss = sim.state.travel.chunk;
    untilChunk(sim, shardsDuringLoss + 3);
    // A fresh run of 3, below the best of 5. A chain that had survived would read 5 + 3.
    expect(sim.state.objectiveProgress).toBe(chain);
  });

  test('progress is 0 at a sector start, and frozen while rules are off', () => {
    const world = scriptedWorld((c) => (c % 3 === 0 ? [{ ...ALL_GATES }] : []), zones(Objective.GATES, 1000, 12));
    const sim = playing(world);
    let sectors = 0;
    for (let i = 0; i < 3000; i++) {
      const was = sim.state.sectorIndex;
      sim.step(HOLD);
      sim.events.count = 0;
      if (sim.state.sectorIndex !== was) {
        sectors++;
        expect(sim.state.objectiveProgress).toBe(0);
      }
    }
    expect(sectors).toBeGreaterThan(1);
    // Fly to just after a sector start, take a gate, then pause: nothing moves it until the next sector zeroes it.
    stepUntil(sim, () => sim.state.objectiveProgress > 0);
    sim.command('pause');
    const held = sim.state.objectiveProgress;
    const sector = sim.state.sectorIndex;
    for (let i = 0; i < 2000 && sim.state.sectorIndex === sector; i++) {
      expect(sim.state.objectiveProgress).toBe(held);
      steps(sim, 1);
    }
    expect(sim.state.sectorIndex).toBe(sector + 1);
    expect(sim.state.objectiveProgress).toBe(0);
  });
});

describe('every objective', () => {
  test.each([
    ['GATES', Objective.GATES],
    ['CHAIN', Objective.CHAIN],
    ['GRAZES', Objective.GRAZES],
    ['NO_HIT', Objective.NO_HIT],
    ['BOOST', Objective.BOOST],
  ] as const)('%s rises, and never falls within a sector, under wild input on the gauntlet', (_name, objective) => {
    const inner = gauntletWorld({ seed: 1985, density: 1 });
    const world: WorldSource = {
      ...inner,
      zoneAt(at, out) {
        inner.zoneAt(at, out);
        out.index = Math.floor(at.chunk / 40);
        out.objective = objective;
        out.objectiveTarget = 1000;
        return out;
      },
    };
    const sim = playing(world, { OVERDRIVE_START: 1 });
    const rand = mulberry32(11);
    const frame = { moveX: 0, moveY: 0, absolute: true, boost: false, human: true };
    let sector = sim.state.sectorIndex;
    let last = sim.state.objectiveProgress;
    let peak = 0;
    for (let i = 0; i < 30000; i++) {
      if (i % 90 === 0) {
        frame.moveX = 2 * rand() - 1;
        frame.moveY = 2 * rand() - 1;
        frame.boost = rand() < 0.5;
      }
      sim.step(frame);
      sim.events.count = 0;
      const s = sim.state;
      if (s.sectorIndex === sector) expect(s.objectiveProgress).toBeGreaterThanOrEqual(last);
      else expect(s.objectiveProgress).toBeLessThanOrEqual(2);
      sector = s.sectorIndex;
      last = s.objectiveProgress;
      peak = Math.max(peak, last);
    }
    expect(peak).toBeGreaterThan(0);
  });
});

describe('grades', () => {
  /** Plays one graded sector: launches in sector 0, crosses into sector 1, then threads `threaded` gates of a GATES objective. */
  function gradedRun(threaded: number, target: number, o?: Parameters<typeof make>[1]): { events: EvRecord[]; sim: Sim } {
    const world = scriptedWorld((c) => (c >= 12 && c < 12 + threaded ? [{ ...ALL_GATES, z: 20 }] : []), (c) => ({
      index: Math.floor(c / 12), objective: Objective.GATES, objectiveTarget: target,
    }));
    const sim = playing(world, o);
    const events: EvRecord[] = [];
    untilChunk(sim, 12, HOLD, events);
    events.length = 0;
    untilChunk(sim, 24, HOLD, events);
    return { events, sim };
  }

  test.each([
    // threaded, target, rank, bonus
    [100, 100, 0, 5000],
    [101, 100, 0, 5000],
    [99, 100, 1, 2500],
    [75, 100, 1, 2500],
    [74, 100, 2, 1000],
    [50, 100, 2, 1000],
    [49, 100, 3, 250],
    [0, 100, 3, 250],
  ])('%d of %d grades rank %d with bonus %d', (threaded, target, rank, bonus) => {
    // Reach exactly this progress through the real rule: rows of gates past the plane's start in sector 1, which runs from
    // chunk 12 to chunk 40. The camera enters a sector 14 u after the plane, so z starts at 16.
    const rows: ScriptedItem[][] = [];
    for (let i = 0; i < threaded; i++) (rows[Math.floor(i / 24)] ??= []).push({ ...ALL_GATES, z: 16 + (i % 24) * 2 });
    const real = scriptedWorld((c) => (c >= 12 && c - 12 < rows.length ? rows[c - 12]! : []), (c) => ({
      index: c < 12 ? 0 : c < 40 ? 1 : 2, objective: Objective.GATES, objectiveTarget: target,
    }));
    const live = playing(real);
    const events: EvRecord[] = [];
    untilChunk(live, 12, HOLD, events);
    // DI-97: the launch sector is graded too, against its full target. It holds no gates, so it is a C.
    expect(events.filter((e) => e.kind === Ev.GRADE).map((e) => [e.index, e.value])).toEqual([[3, 250]]);
    events.length = 0;
    stepUntil(live, () => events.some((e) => e.kind === Ev.SECTOR), HOLD, events);
    expect(live.state.travel.chunk).toBe(40);
    const grade = events.find((e) => e.kind === Ev.GRADE)!;
    expect(grade.index).toBe(rank);
    expect(grade.value).toBe(bonus);
    expect(grade.chunk).toBe(live.state.travel.chunk);
  });

  test('the ratio thresholds are read from the tuning table', () => {
    expect(TUNING.GRADE_RATIO_S).toBe(1);
    expect(TUNING.GRADE_RATIO_A).toBe(0.75);
    expect(TUNING.GRADE_RATIO_B).toBe(0.5);
    expect(TUNING.GRADE_BONUS).toEqual([5000, 2500, 1000, 250]);
  });

  test('GRADE comes just before SECTOR in the same step, and the bonus is not multiplied by SYNC or boost', () => {
    const { events, sim } = gradedRun(5, 5, { OVERDRIVE_START: 1 });
    const gi = events.findIndex((e) => e.kind === Ev.GRADE);
    expect(gi).toBeGreaterThanOrEqual(0);
    const si = events.findIndex((e) => e.kind === Ev.SECTOR);
    expect(si).toBe(gi + 1);
    expect(events[si]!.tick).toBe(events[gi]!.tick);
    expect(events[gi]!.value).toBe(5000);
    expect(sim.state.sync).toBe(6);
    const scoreBefore = 500 + 1000 + 1500 + 2000 + 2500;
    // DI-97: the launch sector, chunks 3 to 11 with no gates, graded C against its target of 5 first.
    const launchSector = 250;
    expect(sim.state.score).toBe(launchSector + scoreBefore + 5000);
  });

  test('the launch sector is graded; a CRUISE-started sector and a warp are not', () => {
    const world = scriptedWorld(() => [], (c) => ({ index: Math.floor(c / 12), objective: Objective.GATES, objectiveTarget: 0 }));
    // Launch sector (DI-97). target 0 grades S.
    const launch = playing(world);
    const events: EvRecord[] = [];
    untilChunk(launch, 12, HOLD, events);
    expect(events.some((e) => e.kind === Ev.SECTOR)).toBe(true);
    expect(events.filter((e) => e.kind === Ev.GRADE).map((e) => e.index)).toEqual([0]);
    // The next one is too, since it started in human PLAY.
    events.length = 0;
    untilChunk(launch, 24, HOLD, events);
    expect(events.find((e) => e.kind === Ev.GRADE)!.index).toBe(0);

    // CRUISE across a boundary: no grade for the sector ended in CRUISE, and none for the sector that began there.
    const cruise = playing(world);
    untilChunk(cruise, 12);
    cruise.command('pause');
    const during: EvRecord[] = [];
    untilChunk(cruise, 24, HOLD, during);
    expect(during.some((e) => e.kind === Ev.GRADE)).toBe(false);
    expect(during.some((e) => e.kind === Ev.SECTOR)).toBe(true);
    cruise.command('resume');
    const after: EvRecord[] = [];
    untilChunk(cruise, 36, HOLD, after);
    expect(after.some((e) => e.kind === Ev.GRADE)).toBe(false);

    // Warp.
    const warped = playing(world);
    untilChunk(warped, 12);
    warped.warpTo(14, 0);
    const afterWarp: EvRecord[] = [];
    untilChunk(warped, 24, HOLD, afterWarp);
    expect(afterWarp.some((e) => e.kind === Ev.GRADE)).toBe(false);
  });

  test('a pause inside a sector keeps it eligible when it ends in human PLAY', () => {
    const world = scriptedWorld(() => [], (c) => ({ index: Math.floor(c / 12), objective: Objective.GATES, objectiveTarget: 0 }));
    const sim = playing(world);
    untilChunk(sim, 12);
    sim.command('pause');
    steps(sim, 60);
    sim.command('resume');
    const events: EvRecord[] = [];
    untilChunk(sim, 24, HOLD, events);
    expect(events.some((e) => e.kind === Ev.GRADE)).toBe(true);
  });

  test('a sector ending during SIGNAL_LOST is graded, and the next one is eligible', () => {
    const world = scriptedWorld(() => [], (c) => ({ index: Math.floor(c / 12), objective: Objective.GATES, objectiveTarget: 0 }));
    const sim = playing(world);
    untilChunk(sim, 12);
    stepUntil(sim, () => sim.state.travel.chunk === 23 && sim.state.travel.local > 40);
    sim.forceSignalLost();
    const events: EvRecord[] = [];
    untilChunk(sim, 24, HOLD, events);
    expect(sim.state.mode).toBe(SimMode.SIGNAL_LOST);
    expect(events.some((e) => e.kind === Ev.GRADE)).toBe(true);
    events.length = 0;
    untilChunk(sim, 36, HOLD, events);
    expect(events.some((e) => e.kind === Ev.GRADE)).toBe(true);
  });

  test('DI-94: a loss forced from idle PLAY grades nothing, and the sectors it starts are not eligible', () => {
    // A sector every chunk, so one 3 s loss at 80 u/s spans three or four boundaries. target 0 would grade S.
    const world = scriptedWorld(() => [], (c) => ({ index: c, objective: Objective.GATES, objectiveTarget: 0 }));
    const sim = playing(world);
    const nobody = { ...HOLD, human: false };
    steps(sim, 1300, nobody);
    expect(sim.state.autopilot).toBe(true);
    const score = sim.state.score;
    sim.forceSignalLost();
    const events: EvRecord[] = [];
    steps(sim, 360, nobody, events);
    expect(sim.state.mode).toBe(SimMode.PLAY);
    expect(events.filter((e) => e.kind === Ev.SECTOR).length).toBeGreaterThanOrEqual(3);
    steps(sim, 1200, nobody, events);
    expect(events.some((e) => e.kind === Ev.GRADE)).toBe(false);
    expect(sim.state.score).toBe(score);
  });

  test('an idle sector boundary is not graded', () => {
    const world = scriptedWorld(() => [], (c) => ({ index: Math.floor(c / 12), objective: Objective.GATES, objectiveTarget: 0 }));
    const sim = playing(world);
    untilChunk(sim, 12);
    const nobody = { ...HOLD, human: false };
    untilChunk(sim, 24, nobody);
    const events: EvRecord[] = [];
    untilChunk(sim, 36, nobody, events);
    expect(sim.state.autopilot).toBe(true);
    expect(events.some((e) => e.kind === Ev.GRADE)).toBe(false);
    expect(events.some((e) => e.kind === Ev.SECTOR)).toBe(true);
  });

  test('target 0 grades S, and a NaN target grades C', () => {
    const run = (target: number): number => {
      const world = scriptedWorld(() => [], (c) => ({ index: Math.floor(c / 12), objective: Objective.GATES, objectiveTarget: target }));
      const sim = playing(world);
      untilChunk(sim, 12);
      const events: EvRecord[] = [];
      untilChunk(sim, 24, HOLD, events);
      return events.find((e) => e.kind === Ev.GRADE)!.index;
    };
    expect(run(0)).toBe(0);
    expect(run(-5)).toBe(0);
    expect(run(NaN)).toBe(3);
  });

  test('a world with no checkpoint gate grades the same as one with an arch at the boundary', () => {
    const arch = { kind: ItemKind.GATE, x: 0, y: 8, z: 0, radius: 40, a: 1 };
    const zone = (c: number): ScriptedZone => ({ index: Math.floor(c / 12), objective: Objective.GATES, objectiveTarget: 0 });
    const a = playing(scriptedWorld((c) => (c % 12 === 0 ? [arch] : []), zone));
    const b = playing(scriptedWorld(() => [], zone));
    untilChunk(a, 30);
    untilChunk(b, 30);
    expect(a.state.score).toBe(b.state.score);
    expect(a.state.score).toBeGreaterThan(0);
  });
});

describe("DI-97: the launch sector is graded against the zone's full target, the one the HUD shows", () => {
  // Sector 1 runs from chunk 3, where the sim starts, to chunk 15: twelve chunks with one gate each at z 56, target 12. The
  // plane starts at chunk 3 local 48, so chunk 3's gate is still ahead of it at tick 0. Radius 41 covers the whole play
  // window, so wherever DEMO left the ship, every gate after launch is threaded and every one before it was cosmetic.
  const TARGET = 12;
  const sectorOneWorld = (): WorldSource => scriptedWorld(
    (c) => (c >= 3 && c < 15 ? [{ ...ALL_GATES, z: 56, radius: 41 }] : []),
    (c) => ({ index: c < 3 ? 0 : c < 15 ? 1 : 2, objective: Objective.GATES, objectiveTarget: TARGET }),
  );

  /** Flies DEMO until the camera enters `launchChunk`, launches, and flies to the end of sector 1. */
  function launchedAt(launchChunk: number): { progress: number; grades: number[][]; sim: Sim } {
    const sim = make(sectorOneWorld(), { LAUNCH_GRACE_S: 0 });
    expect(sim.state.sectorIndex).toBe(1);
    if (launchChunk > sim.state.travel.chunk) untilChunk(sim, launchChunk, NOBODY);
    expect(sim.state.mode).toBe(SimMode.DEMO);
    expect(sim.state.sectorIndex).toBe(1);
    sim.command('launch');
    const events: EvRecord[] = [];
    let progress = -1;
    for (let i = 0; i < 20000 && sim.state.sectorIndex === 1; i++) {
      progress = sim.state.objectiveProgress;   // what the HUD reads as "GATES <progress>/12" up to the boundary
      sim.step(HOLD);
      take(sim, events);
    }
    expect(sim.state.sectorIndex).toBe(2);
    return { progress, grades: events.filter((e) => e.kind === Ev.GRADE).map((e) => [e.index, e.value]), sim };
  }

  test('launched at the start of a sector, completing its objective gives that sector\'s grade', () => {
    const { progress, grades, sim } = launchedAt(3);
    expect(progress).toBe(TARGET);   // "GATES 12/12 OK" on the HUD
    expect(grades).toEqual([[0, 5000]]);
    // Twelve gates at SYNC 1 to 12, then the bonus, unmultiplied.
    expect(sim.state.score).toBe(500 * (12 * 13) / 2 + 5000);
  });

  test.each([
    // launch chunk, gates still ahead, rank, bonus. DI-92's scaled target would have graded every row S.
    [6, 9, 1, 2500],
    [9, 6, 2, 1000],
    [12, 3, 3, 250],
    [14, 1, 3, 250],
  ])('launched late, at chunk %d, threads %d of 12 and grades rank %d, still with a bonus of %d', (chunk, threaded, rank, bonus) => {
    const { progress, grades } = launchedAt(chunk);
    expect(progress).toBe(threaded);
    expect(grades).toEqual([[rank, bonus]]);
    expect(rank).toBeGreaterThan(0);   // a lower grade than the start's S
    expect(bonus).toBeGreaterThan(0);
  });

  test('warpTo keeps the sector it lands in ungraded, the launch sector included', () => {
    const sim = make(sectorOneWorld(), { LAUNCH_GRACE_S: 0 });
    sim.command('launch');
    steps(sim, 60);
    expect(sim.warpTo(5, 0)).toBe(true);
    const events = steps(sim, 0);
    untilChunk(sim, 15, HOLD, events);
    expect(events.some((e) => e.kind === Ev.SECTOR)).toBe(true);
    expect(events.some((e) => e.kind === Ev.GRADE)).toBe(false);
  });
});
