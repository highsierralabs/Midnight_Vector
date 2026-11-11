import { PHASE_COUNT, PHASE_PERIOD_TICKS } from '../contracts/index';

const TAU = 2 * Math.PI;

function fract(x: number): number {
  return x - Math.floor(x);
}

/**
 * u added to zLocal, forward, in [0, travel); phase index 7. The GLSL twin in common.glsl:
 * float trafficOffset(float travel, float k, float seed, float phase) { return travel * fract(k * phase + seed); }
 */
export function trafficOffset(travel: number, k: number, seed: number, phase: number): number {
  return travel * fract(k * phase + seed);
}

/**
 * u added to x; phase index 3. The GLSL twin in common.glsl:
 * float droneOffset(float amp, float k, float seed, float phase) { return amp * sin(TAU * (k * phase + seed)); }
 */
export function droneOffset(amp: number, k: number, seed: number, phase: number): number {
  return amp * Math.sin(TAU * (k * phase + seed));
}

/** ((tick % PHASE_PERIOD_TICKS[i]) + alpha) / PHASE_PERIOD_TICKS[i], from section 4.5. */
export function phaseOf(tick: number, alpha: number, i: number): number {
  const p = PHASE_PERIOD_TICKS[i]!;
  return ((tick % p) + alpha) / p;
}

/** Writes all PHASE_COUNT phases in place. No allocation. */
export function writePhases(tick: number, alpha: number, out: Float32Array): void {
  for (let i = 0; i < PHASE_COUNT; i++) {
    const p = PHASE_PERIOD_TICKS[i]!;
    out[i] = ((tick % p) + alpha) / p;
  }
}
