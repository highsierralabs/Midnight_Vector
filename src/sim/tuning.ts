// Every sim constant, in one object, so a retune touches one file and a negative control needs no production switch.
// Values are unplaytested starting points [A] unless a comment says otherwise. T11 may change values here, never names.
import {
  ITEM_WINDOW_BEHIND, PHASE_PERIOD_TICKS, SHIELD_MAX, SHIP_FORWARD, SIM_HZ, SPEED_CRUISE, SPEED_FLOOR, SYNC_MAX,
} from '../contracts/index';

const BEAT_TICKS: number = PHASE_PERIOD_TICKS[0];
const BEAT_U = (SPEED_CRUISE * BEAT_TICKS) / SIM_HZ;

const VALUES = {
  // Start. The ship plane lands on a beat at tick 0, and no row or camera position is negative in normal play.
  SIM_START_CHUNK: 3,
  SIM_START_LOCAL: 48 - SHIP_FORWARD,
  SHIP_START_X: 0,
  SHIP_Y_REST: 6,

  // Ship motion, u/s and s.
  SHIP_RATE_X: 60,
  SHIP_RATE_Y: 24,
  SHIP_VEL_TAU: 0.09,
  SHIP_ABS_GAIN: 6,
  SHIP_HIT_RADIUS: 1.6,
  SHIP_PICKUP_RADIUS: 1.5,

  // Speed, u/s and u/s^2. speedFloor is here so a negative control can remove it.
  speedFloor: SPEED_FLOOR,
  REDUCED_MOTION_SCALE: 0.6,
  SPEED_ACCEL: 70,
  SPEED_DECEL: 45,
  HIT_SPEED_FACTOR: 0.65,
  HIT_RECOVER_S: 1.5,

  // Beat lock (section 5.8).
  BEAT_TICKS,
  BEAT_U,
  BAR_U: 4 * BEAT_U,
  BEAT_LOCK_GAIN: 1,
  BEAT_LOCK_MAX: 4.8,
  BEAT_LOCK_BASE_EPS: 0.5,

  // Scoring (section 7.1).
  SHARD_POINTS: 100,
  SHARD_OVERDRIVE: 0.08,
  GATE_POINTS: 500,
  GATE_SYNC_GAIN: 1,
  GATE_MISS_SYNC_LOSS: 1,
  SYNC_MIN: 1,
  SYNC_MAX,
  GRAZE_POINTS: 50,
  GRAZE_OVERDRIVE: 0.05,
  GRAZE_RADIUS_FACTOR: 1.5,
  BOOST_SCORE_MULT: 2,

  // Boost.
  BOOST_DRAIN_PER_S: 0.2,
  BOOST_MIN_START: 0.05,
  /** Two boost presses this close, press to press, lock boost on until overdrive runs out, a hit, or another press. */
  BOOST_LOCK_TAP_S: 0.3,
  OVERDRIVE_START: 0.25,

  // Hits.
  SHIELD_MAX,
  HIT_SYNC_DIVISOR: 2,
  GHOST_S: 1.2,
  SIGNAL_LOST_S: 3,
  LAUNCH_GRACE_S: 1.5,
  RESUME_GRACE_S: 1,
  FENCE_GRAZE_MARGIN: 2,

  // Idle.
  IDLE_TIMEOUT_S: 10,

  // Item ring: rows c - back .. c + ahead are held, and the sweep reads c - back .. c + sweepAhead.
  ITEM_ROWS_BACK: ITEM_WINDOW_BEHIND,
  ITEM_ROWS_AHEAD: 5,
  SWEEP_ROWS_AHEAD: 1,

  // Objectives.
  CHAIN_BREAK_U: 36,
  GRADE_RATIO_S: 1,
  GRADE_RATIO_A: 0.75,
  GRADE_RATIO_B: 0.5,
  GRADE_BONUS: [5000, 2500, 1000, 250] as readonly number[],

  // Autopilot [O: rehearsal, a synthetic world, not the real one].
  AP_ENABLED: true,
  AP_REPLAN_TICKS: 6,
  AP_GRID_NX: 17,
  AP_GRID_NY: 5,
  AP_HORIZON_S: 2.6,
  AP_COMMIT_S: 1.1,
  AP_APERTURE: 0.45,
  AP_LAG_S: 0.08,
  AP_W_GATE: 40,
  AP_W_HAZARD: 60,
  AP_W_SHARD: 3,
  AP_W_SWITCH: 0.05,
  AP_W_SWITCH_Y: 0.5,
  AP_SHARD_SIGMA2: 18,
  AP_SHARD_URGENCY_S: 1,
  AP_FEAS: 0.75,
  AP_GATE_INNER: 0.5,
  AP_GATE_SHORT_X_U: 10,
  AP_GATE_SHORT_Y_U: 5,
  AP_FENCE_BASE: 0.3,
  AP_FENCE_OFF_U: 10,
  AP_FENCE_CLEAR_U: 1,
  AP_HAZARD_MARGIN: 1.25,
  AP_HAZARD_BASE: 0.2,
  AP_URGENCY_S: 0.5,
  AP_TARGET_TAU: 0.12,
  AP_WEAVE_X: 2.5,
  AP_WEAVE_Y: 0.8,
  AP_COMMIT_WEAVE_R: 0.2,
  AP_MAX_DIGEST: 96,

  // Demo boost: 4.8 s of every 32 s.
  AP_DEMO_BOOST_PERIOD_TICKS: 3840,
  AP_DEMO_BOOST_TICKS: 576,
};

type Widen<T> = T extends number ? number : T extends boolean ? boolean : T;
export type Tuning = { readonly [K in keyof typeof VALUES]: Widen<(typeof VALUES)[K]> };

export const TUNING: Tuning = Object.freeze(VALUES);
