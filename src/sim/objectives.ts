// Sector progress and grades, in T01's units: GATES threaded count, CHAIN consecutive shards, GRAZES count,
// NO_HIT longest hit-free distance in u, BOOST boosted distance in u. Progress is 0 at a sector start, changes only
// while rules are live, and never falls within a sector.
import { Objective, type SimState, type Travel, type ZoneState } from '../contracts/index';
import { between } from '../core/coords';
import type { Tuning } from './tuning';

export interface ObjectiveTracker {
  kind: Objective;
  target: number;
  /** The current run: consecutive shards for CHAIN, hit-free u for NO_HIT. Progress holds the best of it. */
  run: number;
  readonly lastTaken: Travel;
  gradeEligible: boolean;
}

export function createObjectives(): ObjectiveTracker {
  return { kind: Objective.GATES, target: 0, run: 0, lastTaken: { chunk: 0, local: 0 }, gradeEligible: false };
}

/** Takes the objective of `zone`, clears progress and every run. */
export function startSector(o: ObjectiveTracker, s: SimState, zone: Readonly<ZoneState>, eligible: boolean): void {
  o.kind = zone.objective;
  o.target = zone.objectiveTarget;
  o.run = 0;
  o.gradeEligible = eligible;
  s.objectiveProgress = 0;
}

/**
 * Launch clears progress and runs, keeps the sector's objective and its full target, and makes the sector eligible (DI-97):
 * it is graded against the zone's own target, the one the HUD shows, so a late launch tends to earn a lower grade and a
 * grade only ever adds a bonus. DEMO leaves the tracker ineligible, so this must set it, not merely leave it. Warp uses
 * startSector with false and stays ungraded.
 */
export function launchSector(o: ObjectiveTracker, s: SimState): void {
  o.run = 0;
  o.gradeEligible = true;
  s.objectiveProgress = 0;
}

export function onGateThreaded(o: ObjectiveTracker, s: SimState): void {
  if (o.kind === Objective.GATES) s.objectiveProgress += 1;
}

export function onGraze(o: ObjectiveTracker, s: SimState): void {
  if (o.kind === Objective.GRAZES) s.objectiveProgress += 1;
}

export function onShardTaken(o: ObjectiveTracker, s: SimState): void {
  if (o.kind !== Objective.CHAIN) return;
  o.run += 1;
  o.lastTaken.chunk = s.travel.chunk;
  o.lastTaken.local = s.travel.local;
  if (o.run > s.objectiveProgress) s.objectiveProgress = o.run;
}

/** A double rail puts two shards on one row, so one miss breaks nothing: only a gap longer than CHAIN_BREAK_U does. */
export function onShardMissed(o: ObjectiveTracker, s: SimState, t: Tuning): void {
  if (o.kind === Objective.CHAIN && o.run > 0 && between(s.travel, o.lastTaken) > t.CHAIN_BREAK_U) o.run = 0;
}

export function onHit(o: ObjectiveTracker): void {
  if (o.kind === Objective.NO_HIT) o.run = 0;
}

/** SIGNAL_LOST ends a chain and a hit-free run alike. */
export function onSignalLost(o: ObjectiveTracker): void {
  if (o.kind === Objective.CHAIN || o.kind === Objective.NO_HIT) o.run = 0;
}

/** One live step. */
export function accumulate(o: ObjectiveTracker, s: SimState, boosting: boolean): void {
  if (o.kind === Objective.NO_HIT) {
    o.run += s.stepDist;
    if (o.run > s.objectiveProgress) s.objectiveProgress = o.run;
  } else if (o.kind === Objective.BOOST && boosting) {
    s.objectiveProgress += s.stepDist;
  }
}

/** Rank 0 S, 1 A, 2 B, 3 C. A target at or below 0 counts as complete, and a NaN ratio lands on C. */
export function gradeRank(o: Readonly<ObjectiveTracker>, s: Readonly<SimState>, t: Tuning): number {
  const ratio = o.target <= 0 ? 1 : s.objectiveProgress / o.target;
  return ratio >= t.GRADE_RATIO_S ? 0 : ratio >= t.GRADE_RATIO_A ? 1 : ratio >= t.GRADE_RATIO_B ? 2 : 3;
}
