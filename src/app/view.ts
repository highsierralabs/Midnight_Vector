// The app's one FrameView, mutated in place each frame, and the step 5 and 6 helpers of section 3.3. Pure.
import {
  CAMERA_Y, PHASE_COUNT, SIM_HZ,
  type BendState, type EventBuffer, type FeelState, type FrameView, type QualityProfile, type SimState, type Travel, type ZoneState,
} from '../contracts/index';
import { createBendState, createZoneState } from '../core/alloc';
import { advance } from '../core/coords';
import { FOLLOW_Y } from './follow';

/** FrameView with feel writable, so renderState can point it at neutral feel and back. Assigns to FrameView with no cast. */
export interface AppView {
  dt: number; tick: number; alpha: number;
  readonly cam: Travel;
  camX: number; camY: number;
  readonly phases: Float32Array;
  readonly sim: Readonly<SimState>;
  feel: Readonly<FeelState>;
  readonly zone: ZoneState;
  readonly bend: BendState;
  readonly events: EventBuffer;
  quality: Readonly<QualityProfile>;
  reducedMotion: boolean;
}

// Compile-time proof that AppView is a FrameView, with no cast.
const asFrameView: (v: AppView) => FrameView = (v) => v;
void asFrameView;

export function createAppView(sim: Readonly<SimState>, events: EventBuffer, feel: Readonly<FeelState>, quality: Readonly<QualityProfile>): AppView {
  return {
    dt: 0, tick: sim.tick, alpha: 0,
    cam: { chunk: sim.travel.chunk, local: sim.travel.local },
    camX: 0, camY: CAMERA_Y,
    phases: new Float32Array(PHASE_COUNT),
    sim, feel,
    zone: createZoneState(),
    bend: createBendState(),
    events,
    quality,
    reducedMotion: false,
  };
}

/** The loop's clock, read by step 5: the step accumulator in s. */
export interface StepClock { readonly acc: number }
/** Camera x per ship x, from sizing.ts. */
export interface Follow { readonly gainX: number }

/**
 * Step 5: alpha = acc * 120, at most 1; view.cam is travel moved back by (1 - alpha) of the last step, so it lies between
 * ticks T-1 and T; camX and camY follow the interpolated ship (section 6.1). The clock and the gain are read from their
 * objects rather than passed as doubles, so a non-inlined call boxes nothing (Agents.md).
 */
export function writeCamStep(v: AppView, s: Readonly<SimState>, clock: StepClock, follow: Follow): void {
  const a = clock.acc * SIM_HZ;
  const alpha = a < 1 ? a : 1;
  v.alpha = alpha;
  v.tick = s.tick;
  v.cam.chunk = s.travel.chunk;
  v.cam.local = s.travel.local;
  advance(v.cam, -(1 - alpha) * s.stepDist);
  const x = s.prevX + (s.x - s.prevX) * alpha;
  const y = s.prevY + (s.y - s.prevY) * alpha;
  v.camX = follow.gainX * x;
  v.camY = CAMERA_Y + FOLLOW_Y * (y - 6);
}

/**
 * Step 5 under renderState, after the caller has set v.cam to (chunk, local) and v.tick: alpha 0 and dt 0, so camX and
 * camY come from prevX and prevY.
 */
export function writeCamAt(v: AppView, s: Readonly<SimState>, follow: Follow): void {
  v.alpha = 0;
  v.dt = 0;
  v.camX = follow.gainX * s.prevX;
  v.camY = CAMERA_Y + FOLLOW_Y * (s.prevY - 6);
}

/** Fills dst with every FeelState field of src, in place. */
export function copyFeel(src: Readonly<FeelState>, dst: FeelState): void {
  dst.shakeX = src.shakeX; dst.shakeY = src.shakeY; dst.roll = src.roll; dst.fovDeg = src.fovDeg;
  dst.aberration = src.aberration; dst.flash = src.flash; dst.speedLines = src.speedLines; dst.bloomGain = src.bloomGain;
  dst.duck = src.duck; dst.shipHold = src.shipHold; dst.glitch = src.glitch;
}

/** Writes only the fields o defines. Not a spread, so a caller's object is never retained. */
export function applyFeelOverride(o: Readonly<Partial<FeelState>>, dst: FeelState): void {
  if (o.shakeX !== undefined) dst.shakeX = o.shakeX;
  if (o.shakeY !== undefined) dst.shakeY = o.shakeY;
  if (o.roll !== undefined) dst.roll = o.roll;
  if (o.fovDeg !== undefined) dst.fovDeg = o.fovDeg;
  if (o.aberration !== undefined) dst.aberration = o.aberration;
  if (o.flash !== undefined) dst.flash = o.flash;
  if (o.speedLines !== undefined) dst.speedLines = o.speedLines;
  if (o.bloomGain !== undefined) dst.bloomGain = o.bloomGain;
  if (o.duck !== undefined) dst.duck = o.duck;
  if (o.shipHold !== undefined) dst.shipHold = o.shipHold;
  if (o.glitch !== undefined) dst.glitch = o.glitch;
}
