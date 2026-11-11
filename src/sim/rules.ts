// Speed, boost, scoring, shields and mode transitions (section 7.1, section 7.2). Rules never read the event buffer,
// so a full buffer drops events and changes no rule.
import {
  Ev, EVENT_CAPACITY, SIM_HZ, SimMode, SPEED_CRUISE, SPEED_MAX, SHIP_FORWARD,
  type ControlFrame, type EventBuffer, type ItemRow, type SimCommand, type SimState,
} from '../contracts/index';
import { travelMod } from '../core/coords';
import { Crossing } from './collision';
import type { Autopilot } from './autopilot';
import {
  accumulate, launchSector, onGateThreaded, onGraze, onHit, onShardMissed, onShardTaken, onSignalLost, type ObjectiveTracker,
} from './objectives';
import type { Tuning } from './tuning';

const DT = 1 / SIM_HZ;

/** Durations, computed once from seconds. Timers are "until tick" integers, so nothing drifts. */
export interface DerivedTicks {
  readonly ghost: number; readonly signalLost: number; readonly launchGrace: number; readonly resumeGrace: number;
  readonly idle: number; readonly hitRecover: number; readonly boostLockTap: number;
}

export function deriveTicks(t: Tuning): DerivedTicks {
  return {
    ghost: Math.round(t.GHOST_S * SIM_HZ),
    signalLost: Math.round(t.SIGNAL_LOST_S * SIM_HZ),
    launchGrace: Math.round(t.LAUNCH_GRACE_S * SIM_HZ),
    resumeGrace: Math.round(t.RESUME_GRACE_S * SIM_HZ),
    idle: Math.round(t.IDLE_TIMEOUT_S * SIM_HZ),
    hitRecover: Math.round(t.HIT_RECOVER_S * SIM_HZ),
    boostLockTap: Math.round(t.BOOST_LOCK_TAP_S * SIM_HZ),
  };
}

/** Private per-instance state. Doubles live in object fields, so writing one allocates nothing. */
export interface SimPrivate {
  vx: number;
  vy: number;
  speedBase: number;
  /** REDUCED_MOTION_SCALE when reduced motion is on, else 1. */
  scale: number;
  boostActive: boolean;
  /** What BOOST_ON and BOOST_OFF last said, so each edge fires once. */
  boostReported: boolean;
  /** A double tap locked boost on: it holds without input until overdrive is 0, a hit lands, or the next press. */
  boostLocked: boolean;
  /** ControlFrame.boost on the previous step, so a press is a rising edge and a frame reused across steps is one press. */
  boostHeldPrev: boolean;
  /** Tick of the press that can open a double tap, or -1e9 when none can. */
  boostPressTick: number;
  lastHitTick: number;
  ghostUntil: number;
  signalLostUntil: number;
  lastHumanTick: number;
  /** The current or last SIGNAL_LOST came from live play, so it is the player's and its boundaries are graded (DI-94). */
  lossLive: boolean;
  zoneChanged: boolean;
}

export function createPrivate(): SimPrivate {
  return {
    vx: 0, vy: 0, speedBase: SPEED_CRUISE, scale: 1, boostActive: false, boostReported: false,
    boostLocked: false, boostHeldPrev: false, boostPressTick: -1e9, lastHitTick: -1e9, ghostUntil: 0, signalLostUntil: 0, lastHumanTick: 0, lossLive: false, zoneChanged: false,
  };
}

export interface RuleContext {
  readonly s: SimState;
  readonly p: SimPrivate;
  readonly o: ObjectiveTracker;
  readonly events: EventBuffer;
  readonly t: Tuning;
  readonly ticks: DerivedTicks;
  readonly pilot: Autopilot;
}

/** x and y are always the ship's. Past EVENT_CAPACITY the event is dropped and nothing else changes. */
export function emit(s: Readonly<SimState>, e: EventBuffer, kind: Ev, value: number, chunk: number, index: number): void {
  const i = e.count;
  if (i >= EVENT_CAPACITY) return;
  e.kind[i] = kind;
  e.x[i] = s.x;
  e.y[i] = s.y;
  e.value[i] = value;
  e.chunk[i] = chunk;
  e.index[i] = index;
  e.count = i + 1;
}

// ---- stage A, plain arithmetic only: numbers and booleans, nothing that can throw ----

/**
 * Hold to boost. Two presses within `ticks.boostLockTap`, press to press, lock it on; the next press, overdrive at 0 or a
 * hit (applyHit) unlocks it, and a button still held then keeps boosting as a plain hold. Presses count only in live PLAY.
 */
export function resolveBoost(s: Readonly<SimState>, p: SimPrivate, c: Readonly<ControlFrame>, t: Tuning, ticks: DerivedTicks): void {
  const press = c.boost && !p.boostHeldPrev;
  p.boostHeldPrev = c.boost;
  if (s.mode === SimMode.DEMO) {
    const period = t.AP_DEMO_BOOST_PERIOD_TICKS;
    p.boostActive = s.tick % period >= period - t.AP_DEMO_BOOST_TICKS;
    p.boostLocked = false;
  } else if (s.mode === SimMode.PLAY && !s.autopilot) {
    if (press) {
      if (p.boostLocked) {
        // A tap while locked cancels, and is not the first tap of another lock.
        p.boostLocked = false;
        p.boostPressTick = -1e9;
      } else if (s.tick - p.boostPressTick <= ticks.boostLockTap && s.overdrive >= t.BOOST_MIN_START) {
        p.boostLocked = true;
        p.boostPressTick = -1e9;
      } else {
        p.boostPressTick = s.tick;
      }
    }
    if (p.boostLocked && s.overdrive <= 0) p.boostLocked = false;
    const want = c.boost || p.boostLocked;
    if (p.boostActive) {
      if (!want || s.overdrive <= 0) p.boostActive = false;
    } else if (want && s.overdrive >= t.BOOST_MIN_START) {
      p.boostActive = true;
    }
  } else {
    p.boostActive = false;
    p.boostLocked = false;
  }
}

/** Writes s.speed. The last line lands a NaN on the floor, so the floor holds whatever came before it. */
export function updateSpeed(s: SimState, p: SimPrivate, t: Tuning, ticks: DerivedTicks): void {
  const scale = p.scale;
  const target = (p.boostActive ? SPEED_MAX : SPEED_CRUISE) * scale;
  const delta = target - p.speedBase;
  const up = t.SPEED_ACCEL * DT;
  const down = t.SPEED_DECEL * DT;
  p.speedBase += delta > up ? up : delta < -down ? -down : delta;
  const base = p.speedBase;

  const since = s.tick - p.lastHitTick - 1;
  const recovering = since < ticks.hitRecover;
  const hitFactor = recovering ? t.HIT_SPEED_FACTOR + (1 - t.HIT_SPEED_FACTOR) * (since / ticks.hitRecover) : 1;

  let trim = 0;
  const off = base - SPEED_CRUISE;
  if (scale === 1 && !p.boostActive && !recovering && off < t.BEAT_LOCK_BASE_EPS && off > -t.BEAT_LOCK_BASE_EPS) {
    // travel has not moved yet this step, so it is compared with the tick it belongs to, tick - 1.
    const plane = travelMod(s.travel, t.BAR_U) + SHIP_FORWARD;
    let e = plane % t.BEAT_U - ((s.tick - 1) % t.BEAT_TICKS) * (SPEED_CRUISE / SIM_HZ);
    e -= t.BEAT_U * Math.round(e / t.BEAT_U);
    trim = -e * t.BEAT_LOCK_GAIN;
    if (trim > t.BEAT_LOCK_MAX) trim = t.BEAT_LOCK_MAX;
    else if (trim < -t.BEAT_LOCK_MAX) trim = -t.BEAT_LOCK_MAX;
  }

  const raw = base * hitFactor + trim;
  const floor = t.speedFloor * scale;
  s.speed = raw >= floor ? raw : floor;
}

// ---- modes ----

function refreshGhost(s: SimState, p: Readonly<SimPrivate>): void {
  const left = p.ghostUntil - s.tick;
  s.ghost = left > 0 ? left / SIM_HZ : 0;
}

/** Ends boost at once and says so, if it was on. */
function stopBoost(x: RuleContext): void {
  x.p.boostActive = false;
  x.p.boostLocked = false;
  x.p.boostPressTick = -1e9;
  if (x.p.boostReported) {
    x.p.boostReported = false;
    emit(x.s, x.events, Ev.BOOST_OFF, 0, x.s.travel.chunk, 0);
  }
}

function enterSignalLost(x: RuleContext): void {
  const { s, p } = x;
  // The hit rule runs only while live. A harness loss forced from idle PLAY is nobody's, so it grades nothing.
  p.lossLive = s.mode === SimMode.PLAY && !s.autopilot;
  s.shields = 0;
  s.sync = x.t.SYNC_MIN;
  s.mode = SimMode.SIGNAL_LOST;
  s.autopilot = true;
  x.pilot.activate();
  stopBoost(x);
  p.signalLostUntil = s.tick + x.ticks.signalLost;
  onSignalLost(x.o);
  emit(s, x.events, Ev.SIGNAL_LOST, 0, s.travel.chunk, 0);
}

export function forceSignalLost(x: RuleContext): void {
  if (x.s.mode === SimMode.PLAY) enterSignalLost(x);
}

export function command(x: RuleContext, c: SimCommand): void {
  const { s, p, t } = x;
  if (c === 'launch') {
    if (s.mode !== SimMode.DEMO) return;
    stopBoost(x);
    s.mode = SimMode.PLAY;
    s.autopilot = false;
    s.score = 0;
    s.sync = t.SYNC_MIN;
    s.shields = t.SHIELD_MAX;
    s.overdrive = t.OVERDRIVE_START;
    launchSector(x.o, s);
    p.ghostUntil = s.tick + x.ticks.launchGrace;
    p.lastHumanTick = s.tick;
    refreshGhost(s, p);
  } else if (c === 'pause') {
    if (s.mode !== SimMode.PLAY) return;
    stopBoost(x);
    s.mode = SimMode.CRUISE;
    if (!s.autopilot) {
      s.autopilot = true;
      x.pilot.activate();
    }
  } else if (c === 'resume') {
    if (s.mode !== SimMode.CRUISE) return;
    s.mode = SimMode.PLAY;
    s.autopilot = false;
    const until = s.tick + x.ticks.resumeGrace;
    if (until > p.ghostUntil) p.ghostUntil = until;
    p.lastHumanTick = s.tick;
    refreshGhost(s, p);
  }
}

/** Step 8: the end of SIGNAL_LOST, the idle timer, the ghost readout. */
export function updateModes(x: RuleContext, c: Readonly<ControlFrame>): void {
  const { s, p } = x;
  if (s.mode === SimMode.SIGNAL_LOST) {
    // DI-94: a person's input still counts while the planner steers, and the exit itself is not input. So the exit keeps
    // the last real input's tick, and with nobody at the controls for IDLE_TIMEOUT it returns to idle autopilot.
    if (c.human) p.lastHumanTick = s.tick;
    if (s.tick >= p.signalLostUntil) {
      s.mode = SimMode.PLAY;
      s.autopilot = s.tick - p.lastHumanTick >= x.ticks.idle;
      s.shields = x.t.SHIELD_MAX;
      p.ghostUntil = s.tick + x.ticks.ghost;
    }
  } else if (s.mode === SimMode.PLAY) {
    if (c.human) {
      p.lastHumanTick = s.tick;
      s.autopilot = false;
    } else if (!s.autopilot && s.tick - p.lastHumanTick >= x.ticks.idle) {
      s.autopilot = true;
      x.pilot.activate();
      stopBoost(x);
    }
  }
  refreshGhost(s, p);
}

/** Step 9: overdrive drain, boost edges, the distance objectives. */
export function updateBoost(x: RuleContext): void {
  const { s, p, t } = x;
  const live = s.mode === SimMode.PLAY && !s.autopilot;
  if (live) {
    if (p.boostActive) {
      const left = s.overdrive - t.BOOST_DRAIN_PER_S * DT;
      s.overdrive = left > 0 ? left : 0;
    }
    accumulate(x.o, s, p.boostActive);
  }
  if (p.boostActive !== p.boostReported) {
    p.boostReported = p.boostActive;
    emit(s, x.events, p.boostActive ? Ev.BOOST_ON : Ev.BOOST_OFF, 0, s.travel.chunk, 0);
  }
}

// ---- scoring ----

function addOverdrive(s: SimState, gain: number): void {
  const next = s.overdrive + gain;
  s.overdrive = next < 1 ? next : 1;
}

function applyHit(x: RuleContext, row: Readonly<ItemRow>, index: number): void {
  const { s, p, t } = x;
  s.shields -= 1;
  const halved = Math.floor(s.sync / t.HIT_SYNC_DIVISOR);
  s.sync = halved > t.SYNC_MIN ? halved : t.SYNC_MIN;
  p.lastHitTick = s.tick;
  // A hit that lands ends a locked boost. A held button keeps boosting, as a plain hold, from the next step.
  p.boostLocked = false;
  p.ghostUntil = s.tick + x.ticks.ghost;
  refreshGhost(s, p);
  onHit(x.o);
  emit(s, x.events, Ev.HIT, s.shields, row.chunk, index);
  if (s.shields <= 0) enterSignalLost(x);
}

/** One crossing. The outcome is shape only: this is where mode, ghost and SYNC decide what it means. */
export function applyCrossing(x: RuleContext, outcome: Crossing, row: Readonly<ItemRow>, index: number): void {
  const { s, p, t, events } = x;
  if (s.mode !== SimMode.PLAY || s.autopilot) {
    // Rules off: the screensaver still reacts to what it flies through, and a menu over CRUISE stays quiet.
    if (s.mode === SimMode.CRUISE) return;
    if (outcome === Crossing.SHARD_TAKEN) emit(s, events, Ev.SHARD, 0, row.chunk, index);
    else if (outcome === Crossing.GATE_THREADED || outcome === Crossing.CHECKPOINT) emit(s, events, Ev.GATE, 0, row.chunk, index);
    else if (outcome === Crossing.HAZARD_GRAZE) emit(s, events, Ev.GRAZE, 0, row.chunk, index);
    return;
  }
  const mult = p.boostActive ? t.BOOST_SCORE_MULT : 1;
  if (outcome === Crossing.SHARD_TAKEN) {
    const value = t.SHARD_POINTS * s.sync * mult;
    s.score += value;
    addOverdrive(s, t.SHARD_OVERDRIVE);
    onShardTaken(x.o, s);
    emit(s, events, Ev.SHARD, value, row.chunk, index);
  } else if (outcome === Crossing.SHARD_MISSED) {
    onShardMissed(x.o, s, t);
  } else if (outcome === Crossing.GATE_THREADED) {
    const value = t.GATE_POINTS * s.sync * mult;
    s.score += value;
    const next = s.sync + t.GATE_SYNC_GAIN;
    s.sync = next < t.SYNC_MAX ? next : t.SYNC_MAX;
    onGateThreaded(x.o, s);
    emit(s, events, Ev.GATE, value, row.chunk, index);
  } else if (outcome === Crossing.GATE_MISSED) {
    const next = s.sync - t.GATE_MISS_SYNC_LOSS;
    s.sync = next > t.SYNC_MIN ? next : t.SYNC_MIN;
    emit(s, events, Ev.GATE_MISS, 0, row.chunk, index);
  } else if (outcome === Crossing.CHECKPOINT) {
    emit(s, events, Ev.GATE, 0, row.chunk, index);
  } else if (outcome === Crossing.HAZARD_GRAZE) {
    if (s.ghost > 0) return;
    const value = t.GRAZE_POINTS * s.sync * mult;
    s.score += value;
    addOverdrive(s, t.GRAZE_OVERDRIVE);
    onGraze(x.o, s);
    emit(s, events, Ev.GRAZE, value, row.chunk, index);
  } else if (outcome === Crossing.HAZARD_HIT) {
    if (s.ghost > 0) return;
    applyHit(x, row, index);
  }
}
