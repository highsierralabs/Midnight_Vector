// Tier change state machine. Pure, no three. Section 6.5 and plans/T05-props.md M2.
// Going down: ramp uDensity over 90 ticks, then refill one ring per frame. Going up: refill first, then ramp.
// A refill changes only which dead slots exist, so it must be invisible.
import type { RingPlanEntry } from './plan';

export const RAMP_TICKS = 90;
/** What uDensity uploads at full density, so the shader's shrink factor is 1 for every keep' < 1. */
export const FULL_DENSITY_UNIFORM = 1.03;

export function densityUniform(d: number): number {
  return d >= 1 ? FULL_DENSITY_UNIFORM : d;
}

/** Evaluated left to right on purpose: at perChunk 6, d = .4 another order gives 3 instead of 4. */
export function perRowClamp(perChunk: number, d: number): number {
  return Math.min(perChunk, Math.ceil(perChunk * d * 1.25));
}

export function ringModulus(p: Readonly<RingPlanEntry>, d: number): number {
  if (!p.filtered) return p.cap;
  return perRowClamp(p.perChunk, d) * (p.reach + 1 + p.rear);
}

export function ringClamp(p: Readonly<RingPlanEntry>, d: number): number {
  return p.filtered ? perRowClamp(p.perChunk, d) : p.perChunk;
}

/** The filter a ring wants at density d. RING and items never filter. */
export function ringFilter(p: Readonly<RingPlanEntry>, d: number): number {
  return p.filtered ? d : 1;
}

export type DensityPhase = 'idle' | 'ramp' | 'refill';

export class DensityMachine {
  /** The raw uDensity value. */
  current = FULL_DENSITY_UNIFORM;
  /** The density requested, in [0, 1]. */
  target = 1;
  phase: DensityPhase = 'idle';
  private rampFrom = FULL_DENSITY_UNIFORM;
  private rampTo = FULL_DENSITY_UNIFORM;
  private rampStart = 0;
  /** True while the ramp or refill in progress is going up: refill first, ramp last. */
  private goingUp = false;

  /** First call and every rebuild: at once, phase idle. The caller applies filter and modulus to every ring. */
  applyNow(d: number): void {
    this.target = d;
    this.current = densityUniform(d);
    this.phase = 'idle';
    this.goingUp = false;
  }

  /** A request made outside rendering. Restarts toward d from the current uDensity. */
  request(d: number, tick: number): void {
    if (d === this.target) return;
    this.target = d;
    const to = densityUniform(d);
    if (to < this.current) {
      this.goingUp = false;
      this.startRamp(to, tick);
    } else {
      this.goingUp = true;
      this.phase = 'refill';
    }
  }

  private startRamp(to: number, tick: number): void {
    this.rampFrom = this.current;
    this.rampTo = to;
    this.rampStart = tick;
    this.phase = 'ramp';
  }

  /**
   * One frame. Returns the index of the ring to refill this frame, or -1. A ring is refilled whenever its filter
   * differs from the target's. Modulus is not the test: a perChunk 1 ring keeps one modulus at every density, so a ring
   * refilled at a low filter and skipped on the way back up would miss records.
   */
  step(tick: number, plan: readonly Readonly<RingPlanEntry>[], filters: Float32Array): number {
    if (this.phase === 'ramp') {
      // A tick going backwards finishes the ramp at once.
      const k = tick < this.rampStart ? 1 : Math.min(1, (tick - this.rampStart) / RAMP_TICKS);
      this.current = this.rampFrom + (this.rampTo - this.rampFrom) * k;
      if (k >= 1) {
        this.current = this.rampTo;
        // A ramp up comes after its refill, so it is the last step. A ramp down still has the refill to do.
        this.phase = this.goingUp ? 'idle' : 'refill';
        if (this.goingUp) this.goingUp = false;
      }
    }
    if (this.phase === 'refill') {
      const want = Math.fround(this.target);
      for (let i = 0; i < plan.length; i++) {
        const f = plan[i]!.filtered ? want : 1;
        if (filters[i] !== f) return i;
      }
      if (this.goingUp) {
        this.startRamp(densityUniform(this.target), tick);
      } else {
        this.phase = 'idle';
      }
    }
    return -1;
  }
}
