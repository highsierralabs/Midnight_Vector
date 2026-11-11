// The step. No mode, menu or error path can skip stage A, and stage A holds the only motion call in src/sim, so R1 is
// structural here as section 3.3 makes it structural in the loop. A world that throws is not caught: travel has already
// risen, and the exception reaches section 3.3's catch rather than hiding a defect.
import {
  Ev, PLAY_HALF_X, PLAY_Y_MAX, PLAY_Y_MIN, SIM_HZ, SimMode, SPEED_CRUISE,
  type ControlFrame, type ItemRow, type Sim, type SimCommand, type SimState, type Travel, type WorldSource,
} from '../contracts/index';
import { createEventBuffer, createZoneState } from '../core/alloc';
import { advance, canWarp } from '../core/coords';
import { createAutopilot } from './autopilot';
import { createItemRing, createSweep, type Crossing, type CrossingSink } from './collision';
import { createObjectives, gradeRank, startSector } from './objectives';
import {
  applyCrossing, command as applyCommand, createPrivate, deriveTicks, emit, forceSignalLost as enterForcedLoss, resolveBoost,
  updateBoost, updateModes, updateSpeed, type RuleContext,
} from './rules';
import type { Tuning } from './tuning';

const DT = 1 / SIM_HZ;

/**
 * Test hooks. T02's tests only: createSim passes none, and index.ts exports neither this nor createSimInternal.
 * Production code, T10's app included, constructs through createSim alone; structure.test.ts fails if it does not.
 */
export interface SimProbe {
  /** Every crossing of the ship plane, in every mode, before any rule reads it. */
  onCrossing?(outcome: Crossing, kind: number, row: Readonly<ItemRow>, index: number): void;
  /** The frame stage C is about to fly, a player's or the planner's. */
  onControl?(c: Readonly<ControlFrame>): void;
}

export function createSimInternal(world: WorldSource, t: Tuning, probe?: SimProbe): Sim {
  const travel: Travel = { chunk: t.SIM_START_CHUNK, local: t.SIM_START_LOCAL };
  const before: Travel = { chunk: travel.chunk, local: travel.local };
  const state: SimState = {
    tick: 0,
    travel,
    stepDist: SPEED_CRUISE / SIM_HZ,
    speed: SPEED_CRUISE,
    x: t.SHIP_START_X,
    y: t.SHIP_Y_REST,
    prevX: t.SHIP_START_X,
    prevY: t.SHIP_Y_REST,
    mode: SimMode.DEMO,
    score: 0,
    sync: t.SYNC_MIN,
    shields: t.SHIELD_MAX,
    overdrive: 0,
    ghost: 0,
    beat: 0,
    sectorIndex: 0,
    objectiveProgress: 0,
    autopilot: true,
    warpSerial: 0,
  };
  const events = createEventBuffer();
  const zone = createZoneState();
  const p = createPrivate();
  const o = createObjectives();
  const ticks = deriveTicks(t);
  const ring = createItemRing(world, t);
  const pilot = createAutopilot(ring, state, t);
  const rules: RuleContext = { s: state, p, o, events, t, ticks, pilot };

  ring.fillAll(travel.chunk);
  world.zoneAt(travel, zone);
  state.sectorIndex = zone.index;
  startSector(o, state, zone, false);

  const onCrossing = probe?.onCrossing;
  const onControl = probe?.onControl;
  const sink: CrossingSink = {
    crossing(outcome, kind, row, index): void {
      if (onCrossing !== undefined) onCrossing(outcome, kind, row, index);
      applyCrossing(rules, outcome, row, index);
    },
  };
  const sweep = createSweep(ring, state, before, t, sink);

  const velK = 1 - Math.exp(-DT / t.SHIP_VEL_TAU);
  const rateX = t.SHIP_RATE_X;
  const rateY = t.SHIP_RATE_Y;
  const gain = t.SHIP_ABS_GAIN;

  /** Stage C. One path for player and planner: NaN becomes 0, anything else clamps, and neither can throw. */
  function fly(c: Readonly<ControlFrame>): void {
    const rawX = c.moveX;
    const rawY = c.moveY;
    const mx = rawX > 1 ? 1 : rawX < -1 ? -1 : rawX === rawX ? rawX : 0;
    const my = rawY > 1 ? 1 : rawY < -1 ? -1 : rawY === rawY ? rawY : 0;
    let wantVx: number;
    let wantVy: number;
    if (c.absolute) {
      const toX = (mx * PLAY_HALF_X - state.x) * gain;
      const toY = (PLAY_Y_MIN + ((my + 1) / 2) * (PLAY_Y_MAX - PLAY_Y_MIN) - state.y) * gain;
      // Math.min and max, not a conditional: see the note on hot paths in autopilot.ts.
      wantVx = Math.max(-rateX, Math.min(rateX, toX));
      wantVy = Math.max(-rateY, Math.min(rateY, toY));
    } else {
      wantVx = mx * rateX;
      wantVy = my * rateY;
    }
    p.vx += (wantVx - p.vx) * velK;
    p.vy += (wantVy - p.vy) * velK;
    const nx = state.x + p.vx * DT;
    const ny = state.y + p.vy * DT;
    if (nx >= PLAY_HALF_X) {
      state.x = PLAY_HALF_X;
      p.vx = 0;
    } else if (nx <= -PLAY_HALF_X) {
      state.x = -PLAY_HALF_X;
      p.vx = 0;
    } else {
      state.x = nx;
    }
    if (ny >= PLAY_Y_MAX) {
      state.y = PLAY_Y_MAX;
      p.vy = 0;
    } else if (ny <= PLAY_Y_MIN) {
      state.y = PLAY_Y_MIN;
      p.vy = 0;
    } else {
      state.y = ny;
    }
  }

  /**
   * Step 11. The sector just left is judged by the objective it started with, which `zone` no longer holds. SIGNAL_LOST
   * counts as the player's only when it came from live play (DI-94), so a loss forced from idle grades nothing.
   */
  function closeSector(): void {
    p.zoneChanged = false;
    const graded = (state.mode === SimMode.PLAY && !state.autopilot) || (state.mode === SimMode.SIGNAL_LOST && p.lossLive);
    if (o.gradeEligible && graded) {
      const rank = gradeRank(o, state, t);
      const bonus = t.GRADE_BONUS[rank]!;
      state.score += bonus;
      emit(state, events, Ev.GRADE, bonus, travel.chunk, rank);
    }
    state.sectorIndex = zone.index;
    emit(state, events, Ev.SECTOR, zone.index, travel.chunk, 0);
    startSector(o, state, zone, graded);
  }

  function step(c: Readonly<ControlFrame>): void {
    // A. R1 core, plain arithmetic only.
    before.chunk = travel.chunk;
    before.local = travel.local;
    state.prevX = state.x;
    state.prevY = state.y;
    state.tick += 1;
    state.beat = state.tick / t.BEAT_TICKS;
    resolveBoost(state, p, c, t, ticks);
    updateSpeed(state, p, t, ticks);
    state.stepDist = state.speed / SIM_HZ;
    advance(travel, state.stepDist);

    // B. The item ring.
    if (travel.chunk !== before.chunk) {
      ring.fillAhead(travel.chunk);
      world.zoneAt(travel, zone);
      if (zone.index !== state.sectorIndex) p.zoneChanged = true;
    }

    // C. Steering.
    let control = c;
    if (state.autopilot) {
      pilot.update();
      control = pilot.control;
    }
    if (onControl !== undefined) onControl(control);
    fly(control);

    // D. Rules.
    updateModes(rules, c);
    updateBoost(rules);
    sweep();
    if (p.zoneChanged) closeSector();
  }

  return {
    state,
    events,
    step,
    command(c: SimCommand): void {
      applyCommand(rules, c);
    },
    warpTo(chunk: number, local: number): boolean {
      if (!canWarp(chunk, local)) return false;
      travel.chunk = chunk;
      travel.local = local;
      ring.fillAll(chunk);
      world.zoneAt(travel, zone);
      state.sectorIndex = zone.index;
      p.zoneChanged = false;
      startSector(o, state, zone, false);
      state.warpSerial += 1;
      return true;
    },
    setReducedMotion(on: boolean): void {
      p.scale = on ? t.REDUCED_MOTION_SCALE : 1;
      // DI-75 (D-001): set before the first step, it applies from that step, at the scaled cruise with no ease, and the
      // start state reads it too. tick is 0 only until the first step, since nothing resets it. After that, speed eases.
      if (state.tick === 0) {
        p.speedBase = SPEED_CRUISE * p.scale;
        state.speed = p.speedBase;
        state.stepDist = state.speed / SIM_HZ;
      }
    },
    forceSignalLost(): void {
      enterForcedLoss(rules);
    },
  };
}
