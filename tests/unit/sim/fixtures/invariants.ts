// checkStep is pure, so it can be tested alone against hand-broken transitions (fuzz.test.ts), and a test that cannot fail
// is not evidence. Checks run in an order chosen so each broken transition names its own field.
import {
  EVENT_CAPACITY, CHUNK_LEN, PLAY_HALF_X, PLAY_Y_MAX, PLAY_Y_MIN, SHIELD_MAX, SIM_HZ, SimMode, SPEED_FLOOR, SPEED_MAX, SYNC_MAX,
  type EventBuffer, type SimState,
} from '../../../../src/contracts/index';
import { between } from '../../../../src/core/coords';

/** A plain copy of what a step can change. */
export interface Snap {
  tick: number; beat: number; speed: number; stepDist: number;
  chunk: number; local: number;
  x: number; y: number; prevX: number; prevY: number;
  mode: number; score: number; sync: number; shields: number; overdrive: number; ghost: number;
  sectorIndex: number; objectiveProgress: number; autopilot: boolean; warpSerial: number; eventCount: number;
}

export function createSnap(): Snap {
  return {
    tick: 0, beat: 0, speed: 0, stepDist: 0, chunk: 0, local: 0, x: 0, y: 0, prevX: 0, prevY: 0, mode: 0, score: 0, sync: 1,
    shields: 0, overdrive: 0, ghost: 0, sectorIndex: 0, objectiveProgress: 0, autopilot: true, warpSerial: 0, eventCount: 0,
  };
}

export function copySnap(s: Readonly<SimState>, e: Readonly<EventBuffer>, out: Snap): Snap {
  out.tick = s.tick; out.beat = s.beat; out.speed = s.speed; out.stepDist = s.stepDist;
  out.chunk = s.travel.chunk; out.local = s.travel.local;
  out.x = s.x; out.y = s.y; out.prevX = s.prevX; out.prevY = s.prevY;
  out.mode = s.mode; out.score = s.score; out.sync = s.sync; out.shields = s.shields; out.overdrive = s.overdrive; out.ghost = s.ghost;
  out.sectorIndex = s.sectorIndex; out.objectiveProgress = s.objectiveProgress; out.autopilot = s.autopilot; out.warpSerial = s.warpSerial;
  out.eventCount = e.count;
  return out;
}

export interface StepContext {
  /** The setting during this step: the floor is 27 when on, 45 when off. */
  reducedMotion: boolean;
}

/** prev is the state straight before one step, so a command or a warp made before the step is already in it. */
export function checkStep(prev: Readonly<Snap>, cur: Readonly<Snap>, ctx: Readonly<StepContext>): string | null {
  if (cur.tick !== prev.tick + 1) return `tick went ${prev.tick} -> ${cur.tick}`;
  if (cur.beat !== cur.tick / 72) return `beat ${cur.beat} is not tick / 72 at tick ${cur.tick}`;
  if (!(cur.stepDist > 0)) return `stepDist ${cur.stepDist} is not above 0`;
  if (!(cur.local >= 0 && cur.local < CHUNK_LEN)) return `local ${cur.local} is outside [0, 64)`;
  if (!Number.isInteger(cur.chunk)) return `chunk ${cur.chunk} is not an integer`;

  const moved = between({ chunk: cur.chunk, local: cur.local }, { chunk: prev.chunk, local: prev.local });
  if (!(moved > 0)) return `travel did not rise: moved ${moved}`;

  const floor = ctx.reducedMotion ? SPEED_FLOOR * 0.6 : SPEED_FLOOR;
  if (!Number.isFinite(cur.speed)) return `speed ${cur.speed} is not finite`;
  if (cur.speed < floor) return `speed floor: ${cur.speed} is below ${floor}`;
  if (cur.speed > SPEED_MAX) return `speed ${cur.speed} is above ${SPEED_MAX}`;
  if (cur.stepDist !== cur.speed / SIM_HZ) return `stepDist ${cur.stepDist} is not speed / ${SIM_HZ}: dt was scaled`;
  if (Math.abs(moved - cur.stepDist) > 1e-9) return `travel moved ${moved}, not stepDist ${cur.stepDist}`;

  if (!(Math.abs(cur.x) <= PLAY_HALF_X)) return `x ${cur.x} is outside the play box or not finite`;
  if (!(cur.y >= PLAY_Y_MIN && cur.y <= PLAY_Y_MAX)) return `y ${cur.y} is outside the play box or not finite`;
  if (!Object.is(cur.prevX, prev.x)) return `prevX ${cur.prevX} is not the previous x ${prev.x}`;
  if (!Object.is(cur.prevY, prev.y)) return `prevY ${cur.prevY} is not the previous y ${prev.y}`;

  if (!Number.isInteger(cur.sync) || cur.sync < 1 || cur.sync > SYNC_MAX) return `sync ${cur.sync}`;
  if (!Number.isInteger(cur.shields) || cur.shields < 0 || cur.shields > SHIELD_MAX) return `shields ${cur.shields}`;
  if (!(cur.overdrive >= 0 && cur.overdrive <= 1)) return `overdrive ${cur.overdrive}`;
  if (!(cur.ghost >= 0)) return `ghost ${cur.ghost}`;
  if (!Number.isInteger(cur.score)) return `score ${cur.score} is not an integer`;
  if (cur.score < prev.score) return `score fell: ${prev.score} -> ${cur.score}`;
  if (!Number.isFinite(cur.objectiveProgress) || cur.objectiveProgress < 0) return `objectiveProgress ${cur.objectiveProgress}`;

  if (!(cur.mode === SimMode.DEMO || cur.mode === SimMode.PLAY || cur.mode === SimMode.CRUISE || cur.mode === SimMode.SIGNAL_LOST)) return `mode ${cur.mode}`;
  if (cur.mode !== SimMode.PLAY && !cur.autopilot) return `autopilot false in mode ${cur.mode}`;
  if (cur.warpSerial < prev.warpSerial) return `warpSerial fell: ${prev.warpSerial} -> ${cur.warpSerial}`;
  if (cur.eventCount > EVENT_CAPACITY) return `events.count ${cur.eventCount} is above ${EVENT_CAPACITY}`;
  return null;
}
