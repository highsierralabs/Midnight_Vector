// The player's camera (T13, plans/T13-views.md): which one is in force, and where the view origin and the eye are while
// it moves. Pure. First person moves the view origin ahead of the sim's travel and puts the eye on the ship; the camera
// itself never leaves render-space z = 0 (section 4), so no shader's position maths changes.
import { CHUNK_LEN, CamMode, SHIP_FORWARD, SimMode, type SimState, type Travel } from '../contracts/index';
import { advance, between } from '../core/coords';
import { SHIP_HALF_LENGTH } from '../render/props/ship';
import type { AppView } from './view';

/** The nose camera's view origin: the ship's nose tip, SHIP_HALF_LENGTH ahead of the ship plane. */
export const NOSE_AHEAD = SHIP_FORWARD + SHIP_HALF_LENGTH;
/** The eye above the ship's centre line, in u: inside the canopy (its top is at .64), and just over the nose. */
export const EYE_UP_COCKPIT = 0.5;
export const EYE_UP_NOSE = 0.05;
/** The view origin moves forward at this many u/s on top of the ship's own travel. */
export const CAM_FORWARD_RATE = 40;
/**
 * Moving back, camAhead gives up at most this share of what the sim travelled in the frame, so the view origin still moves
 * forward and the loop's backward-jump rebuild never fires on a camera change (R-6). Chase is regained in 14 / (.9 speed) s.
 */
export const CAM_BACK_SHARE = 0.9;
/** The eye height changes at this many u/s between the cockpit's and the nose's. */
export const EYE_UP_RATE = 2;
/** The cockpit arrives over the last COCKPIT_IN_SPAN u before the ship plane. */
export const COCKPIT_IN_SPAN = 4;
/** First person multiplies feel's roll, which already banks with the ship by up to BANK_ROLL_MAX (R-3). */
export const FIRST_PERSON_ROLL = 3;

export interface CamState {
  /** The player's choice (UiCommands.setCamMode). DEMO draws CHASE whatever it is. */
  want: CamMode;
  /** The camera in force this frame. */
  mode: CamMode;
  /** How far the view origin is ahead of the interpolated sim travel, in u. */
  ahead: number;
  /** 0 in chase, 1 once the view origin has reached the ship plane: how far camX and camY have moved onto the ship. */
  eye: number;
  eyeUp: number;
  cockpitIn: number;
  /** The interpolated sim travel of the last frame, before camAhead, and the warp serial it was read at. */
  readonly last: Travel;
  hasLast: boolean;
  lastWarp: number;
}

export function createCamState(): CamState {
  return {
    want: CamMode.CHASE, mode: CamMode.CHASE, ahead: 0, eye: 0, eyeUp: EYE_UP_COCKPIT, cockpitIn: 0,
    last: { chunk: 0, local: 0 }, hasLast: false, lastWarp: 0,
  };
}

/** The loop's clock, read by field so no double crosses the call (Agents.md). */
export interface CamClock { readonly dt: number }

/**
 * Called straight after writeCamStep or writeCamAt, while v.cam is still the sim's travel and camX, camY the chase values.
 * Moves camAhead toward the camera in force, then advances v.cam by it and moves camX and camY onto the ship by `eye`.
 * exact (renderState), a forced camera, the first call, a warp, and a travel that went backward or jumped a chunk all
 * snap to the target, with no move. With camAhead 0 it leaves v.cam, camX and camY exactly as it found them.
 */
export function moveCam(c: CamState, v: AppView, s: Readonly<SimState>, forced: CamMode | null, clock: CamClock, exact: boolean): void {
  const target: CamMode = forced !== null ? forced : s.mode === SimMode.DEMO ? CamMode.CHASE : c.want;
  const goal = target === CamMode.CHASE ? 0 : target === CamMode.COCKPIT ? SHIP_FORWARD : NOSE_AHEAD;
  const upGoal = target === CamMode.NOSE ? EYE_UP_NOSE : EYE_UP_COCKPIT;

  let snap = exact || forced !== null || !c.hasLast || s.warpSerial !== c.lastWarp;
  let moved = 0;
  if (!snap) {
    moved = between(v.cam, c.last);
    if (moved < 0 || moved > CHUNK_LEN) snap = true;
  }

  if (snap) {
    c.ahead = goal;
    c.eyeUp = upGoal;
    c.cockpitIn = target === CamMode.COCKPIT ? 1 : 0;
  } else {
    const dt = clock.dt;
    if (c.ahead < goal) {
      const a = c.ahead + CAM_FORWARD_RATE * dt;
      c.ahead = a < goal ? a : goal;
    } else if (c.ahead > goal) {
      const a = c.ahead - CAM_BACK_SHARE * moved;
      c.ahead = a > goal ? a : goal;
    }
    if (c.eyeUp < upGoal) {
      const u = c.eyeUp + EYE_UP_RATE * dt;
      c.eyeUp = u < upGoal ? u : upGoal;
    } else if (c.eyeUp > upGoal) {
      const u = c.eyeUp - EYE_UP_RATE * dt;
      c.eyeUp = u > upGoal ? u : upGoal;
    }
    // The cockpit is in while the view origin is at the ship plane: it rises over the last COCKPIT_IN_SPAN u from behind,
    // and leaves over the SHIP_HALF_LENGTH to the nose. A move that only passes the ship plane (chase to nose) never shows it.
    const a = c.ahead;
    let shape = a <= SHIP_FORWARD ? (a - (SHIP_FORWARD - COCKPIT_IN_SPAN)) / COCKPIT_IN_SPAN : 1 - (a - SHIP_FORWARD) / SHIP_HALF_LENGTH;
    shape = shape < 0 ? 0 : shape > 1 ? 1 : shape;
    // At rest the value is exact: 1 in the cockpit, 0 elsewhere (the nose's 16.2 - 14 over 2.2 is not exactly 1).
    if (a === goal) c.cockpitIn = target === CamMode.COCKPIT ? 1 : 0;
    else c.cockpitIn = target === CamMode.COCKPIT || shape < c.cockpitIn ? shape : c.cockpitIn;
  }

  c.last.chunk = v.cam.chunk;
  c.last.local = v.cam.local;
  c.hasLast = true;
  c.lastWarp = s.warpSerial;
  c.mode = target;
  const e = c.ahead < SHIP_FORWARD ? c.ahead / SHIP_FORWARD : 1;
  c.eye = e;

  v.camMode = target;
  v.camAhead = c.ahead;
  v.cockpitIn = c.cockpitIn;
  if (c.ahead > 0) {
    advance(v.cam, c.ahead);
    const x = s.prevX + (s.x - s.prevX) * v.alpha;
    const y = s.prevY + (s.y - s.prevY) * v.alpha;
    v.camX += (x - v.camX) * e;
    v.camY += (y + c.eyeUp - v.camY) * e;
  }
}
