// BeatClock: sim.beat against the audio clock. Pure, no allocation. State lives in object fields, because a
// module-level let holding a large double allocates [O: T07 prototype].
//   timeOfStep(step) = anchorTime + (step / 4 - anchorBeat) * .6 - comp
//   drift            = anchorTime + (simBeat - anchorBeat) * .6 - audioNow
// Positive drift means the sim is ahead of the audio clock. comp moves the sound and is not part of drift, so a
// latency change cannot cause a re-anchor.
import { BEAT_S } from './theory';

export const DRIFT_TAU_S = 0.4;
export const SLEW_PER_S = 0.002;
export const REANCHOR_S = 0.03;
export const FAST_REANCHOR_S = 0.15;
export const COMP_FLOOR_S = 0.02;
export const COMP_MAX_S = 0.3;
export const COMP_DEADBAND_S = 0.01;

export interface BeatClock {
  anchorTime: number;
  anchorBeat: number;
  comp: number;
  /** Filtered drift, seconds. */
  ema: number;
  /** Last raw drift, seconds. */
  raw: number;
  /** Consecutive observes with raw drift above FAST_REANCHOR_S. */
  over: number;
  /** Times anchored, the first one included. The sequencer watches this. */
  anchors: number;
}

export function createBeatClock(): BeatClock {
  return { anchorTime: 0, anchorBeat: 0, comp: 0, ema: 0, raw: 0, over: 0, anchors: 0 };
}

export function anchorClock(c: BeatClock, simBeat: number, audioNow: number): void {
  c.anchorTime = audioNow;
  c.anchorBeat = simBeat;
  c.ema = 0;
  c.raw = 0;
  c.over = 0;
  c.anchors += 1;
}

export function observe(c: BeatClock, simBeat: number, audioNow: number, dt: number): void {
  const raw = c.anchorTime + (simBeat - c.anchorBeat) * BEAT_S - audioNow;
  c.raw = raw;
  if (Math.abs(raw) > FAST_REANCHOR_S) {
    c.over += 1;
    if (c.over >= 2) {
      anchorClock(c, simBeat, audioNow);
      return;
    }
  } else {
    c.over = 0;
  }
  const step = dt > 0 ? dt : 0;
  c.ema += (raw - c.ema) * (1 - Math.exp(-step / DRIFT_TAU_S));
  if (Math.abs(c.ema) > REANCHOR_S) {
    anchorClock(c, simBeat, audioNow);
    return;
  }
  const limit = SLEW_PER_S * step;
  const move = c.ema > limit ? limit : c.ema < -limit ? -limit : c.ema;
  c.anchorTime -= move;
  c.ema -= move;
}

/** clamp(L - .02, 0, .3), applied only if it moved by more than 10 ms. Read once per bar by the engine. */
export function setOutputLatency(c: BeatClock, seconds: number): void {
  const L = seconds - COMP_FLOOR_S;
  const next = L < 0 ? 0 : L > COMP_MAX_S ? COMP_MAX_S : L;
  if (Math.abs(next - c.comp) > COMP_DEADBAND_S) c.comp = next;
}

export function timeOfStep(c: Readonly<BeatClock>, step: number): number {
  return c.anchorTime + (step / 4 - c.anchorBeat) * BEAT_S - c.comp;
}

/** The smallest integer step whose time is at or after `time`. */
export function stepAtOrAfter(c: Readonly<BeatClock>, time: number): number {
  const beat = (time + c.comp - c.anchorTime) / BEAT_S + c.anchorBeat;
  const s = Math.ceil(beat * 4);
  if (timeOfStep(c, s - 1) >= time) return s - 1;
  if (timeOfStep(c, s) < time) return s + 1;
  return s;
}
