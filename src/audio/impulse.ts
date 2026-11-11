// Seeded noise and convolver impulses, written into typed arrays. Pure. Mulberry32, so no Math.random.
// Each fill also comes as a resumable job that writes a bounded number of samples per call, so a live build can spread
// it over frames (D-009, DI-79). A job run to the end writes exactly the bytes the one-call form writes.

/** Fills out[from, to) with white noise in [-1, 1), continuing the PRNG from `state`. Returns the state after. */
export function fillNoiseRange(out: Float32Array, from: number, to: number, state: number): number {
  let a = state | 0;
  for (let i = from; i < to; i++) {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    out[i] = ((t ^ (t >>> 14)) >>> 0) / 2147483648 - 1;
  }
  return a;
}

/** Fills out with white noise in [-1, 1). Returns the PRNG's final state, so a second channel can continue the stream. */
export function fillNoise(out: Float32Array, seed: number): number {
  return fillNoiseRange(out, 0, out.length, seed);
}

/** A fill that can stop and resume. step writes at most `budget` samples' worth of work and returns true when done. */
export interface FillJob {
  step(budget: number): boolean;
}

/** fillNoise as a job. */
export function noiseJob(out: Float32Array, seed: number): FillJob {
  const st = { i: 0, a: seed | 0 };
  return {
    step(budget: number): boolean {
      const to = Math.min(out.length, st.i + budget);
      st.a = fillNoiseRange(out, st.i, to, st.a);
      st.i = to;
      return st.i >= out.length;
    },
  };
}

/**
 * fillImpulse as a job: noise, then the decaying lowpass with its energy sum, then the unit-energy scale, each pass
 * resumable. The sums run in the same order as the one-call form, so the bytes match it exactly.
 */
export function impulseJob(out: Float32Array, sampleRate: number, tauS: number, seed: number, darken: number): FillJob {
  const n = out.length;
  const dur = n / sampleRate;
  const st = { pass: 0, i: 0, a: seed | 0, lp: 0, energy: 0, scale: 0 };
  return {
    step(budget: number): boolean {
      let left = budget;
      while (left > 0 && st.pass < 3) {
        const to = Math.min(n, st.i + left);
        if (st.pass === 0) {
          st.a = fillNoiseRange(out, st.i, to, st.a);
        } else if (st.pass === 1) {
          let lp = st.lp;
          let energy = st.energy;
          for (let i = st.i; i < to; i++) {
            const t = i / sampleRate;
            const k = darken > 0 ? Math.max(0.05, 1 - (t / dur) * darken) : 1;
            lp += (out[i]! - lp) * k;
            const v = lp * Math.exp(-t / tauS);
            out[i] = v;
            energy += v * v;
          }
          st.lp = lp;
          st.energy = energy;
        } else {
          const scale = st.scale;
          for (let i = st.i; i < to; i++) out[i] = out[i]! * scale;
        }
        left -= to - st.i;
        st.i = to;
        if (st.i >= n) {
          st.pass += 1;
          st.i = 0;
          if (st.pass === 2) st.scale = st.energy > 0 ? 1 / Math.sqrt(st.energy) : 0;
        }
      }
      return st.pass >= 3;
    },
  };
}

/**
 * Scales channels so their joint peak is 1: a peak scan over every channel, then the scale, both resumable. The same
 * arithmetic as one pass, so the bytes match it. All-zero channels are left alone.
 */
export function normaliseJob(chans: readonly Float32Array[]): FillJob {
  const st = { pass: 0, ch: 0, i: 0, m: 0, g: 0 };
  return {
    step(budget: number): boolean {
      let left = budget;
      while (left > 0 && st.pass < 2) {
        if (st.ch >= chans.length) {
          st.pass += 1;
          st.ch = 0;
          st.i = 0;
          if (st.pass === 1) {
            if (st.m > 0) st.g = 1 / st.m;
            else st.pass = 2;
          }
          continue;
        }
        const d = chans[st.ch]!;
        const to = Math.min(d.length, st.i + left);
        if (st.pass === 0) {
          let m = st.m;
          for (let i = st.i; i < to; i++) {
            const a = Math.abs(d[i]!);
            if (a > m) m = a;
          }
          st.m = m;
        } else {
          const g = st.g;
          for (let i = st.i; i < to; i++) d[i] = d[i]! * g;
        }
        left -= to - st.i;
        st.i = to;
        if (st.i >= d.length) {
          st.ch += 1;
          st.i = 0;
        }
      }
      return st.pass >= 2;
    },
  };
}

/**
 * An exponentially decaying noise impulse, scaled to unit energy. Unit-amplitude noise under normalize = false has
 * about 114x gain, which took the first mix to -7.6 dBFS and correlation .04 [O: T07 prototype]. darken in [0, 1]:
 * 0 leaves the noise white, and higher values lowpass the tail harder as it decays.
 */
export function fillImpulse(out: Float32Array, sampleRate: number, tauS: number, seed: number, darken: number): void {
  impulseJob(out, sampleRate, tauS, seed, darken).step(Infinity);
}
