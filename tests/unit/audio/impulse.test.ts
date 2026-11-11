// A5: fillImpulse and fillNoise. D-009: their resumable jobs, and the kit's normalising job.
import { describe, expect, it } from 'vitest';
import { safetyClipCurve, softClipCurve } from '../../../src/audio/graph';
import { fillImpulse, fillNoise, impulseJob, noiseJob, normaliseJob, type FillJob } from '../../../src/audio/impulse';

// The one-pass code as it stood before repair D1, frozen here as the reference the jobs must reproduce byte for byte.
function refNoise(out: Float32Array, seed: number): number {
  let a = seed | 0;
  for (let i = 0; i < out.length; i++) {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    out[i] = ((t ^ (t >>> 14)) >>> 0) / 2147483648 - 1;
  }
  return a;
}
function refImpulse(out: Float32Array, sampleRate: number, tauS: number, seed: number, darken: number): void {
  refNoise(out, seed);
  const n = out.length;
  const dur = n / sampleRate;
  let lp = 0;
  let energy = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const k = darken > 0 ? Math.max(0.05, 1 - (t / dur) * darken) : 1;
    lp += (out[i]! - lp) * k;
    const v = lp * Math.exp(-t / tauS);
    out[i] = v;
    energy += v * v;
  }
  const scale = energy > 0 ? 1 / Math.sqrt(energy) : 0;
  for (let i = 0; i < n; i++) out[i] = out[i]! * scale;
}
function refNormalise(chans: Float32Array[]): void {
  let m = 0;
  for (const d of chans) for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]!); if (a > m) m = a; }
  if (m > 0) {
    const g = 1 / m;
    for (const d of chans) for (let i = 0; i < d.length; i++) d[i] = d[i]! * g;
  }
}
function same(a: Float32Array, b: Float32Array): boolean {
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
}
function run(job: FillJob, chunk: number): number {
  let calls = 1;
  while (!job.step(chunk)) calls += 1;
  return calls;
}

describe('D-009 resumable fills', () => {
  const sr = 48000;
  const CHUNKS = [1, 7, 4096, 16384, 100000, Infinity];

  it('impulseJob in any chunk size writes the reference bytes: the reverb and the gated impulse', () => {
    for (const [seconds, tau, seed, darken] of [[2.2, 0.55, 99, 0.9], [2.2, 0.55, 100, 0.9], [0.9, 0.42, 77, 0], [0.9, 0.42, 78, 0]] as const) {
      const ref = new Float32Array(Math.ceil(seconds * sr));
      refImpulse(ref, sr, tau, seed, darken);
      for (const chunk of CHUNKS) {
        const x = new Float32Array(ref.length);
        const calls = run(impulseJob(x, sr, tau, seed, darken), chunk);
        expect(same(x, ref), `seed ${seed} chunk ${chunk}`).toBe(true);
        if (chunk === 16384) expect(calls).toBe(Math.ceil((3 * ref.length) / 16384));
      }
      const one = new Float32Array(ref.length);
      fillImpulse(one, sr, tau, seed, darken);
      expect(same(one, ref)).toBe(true);
    }
  });

  it('noiseJob and fillNoise write the reference bytes, and the job returns the same final state', () => {
    for (const [n, seed] of [[96000, 53], [48000, 61], [288, 11], [91200, 42]] as const) {
      const ref = new Float32Array(n);
      const refState = refNoise(ref, seed);
      for (const chunk of CHUNKS) {
        const x = new Float32Array(n);
        run(noiseJob(x, seed), chunk);
        expect(same(x, ref), `seed ${seed} chunk ${chunk}`).toBe(true);
      }
      const y = new Float32Array(n);
      expect(fillNoise(y, seed)).toBe(refState);
      expect(same(y, ref)).toBe(true);
    }
  });

  it('normaliseJob over two channels in any chunk size writes the reference bytes, and leaves silence alone', () => {
    const mk = (): Float32Array[] => {
      const l = new Float32Array(91200);
      const r = new Float32Array(91200);
      refImpulse(l, sr, 0.42, 5, 0);
      refImpulse(r, sr, 0.42, 6, 0.3);
      r[777] = -3;   // the peak is on the second channel, and negative
      return [l, r];
    };
    const ref = mk();
    refNormalise(ref);
    expect(Math.max(...ref.map((d) => Math.max(...Array.from(d, Math.abs))))).toBe(1);
    for (const chunk of CHUNKS) {
      const x = mk();
      run(normaliseJob(x), chunk);
      expect(same(x[0]!, ref[0]!) && same(x[1]!, ref[1]!), `chunk ${chunk}`).toBe(true);
    }
    const quiet = [new Float32Array(100), new Float32Array(0)];
    run(normaliseJob(quiet), 7);
    expect(quiet[0]!.every((v) => v === 0)).toBe(true);
    expect(run(normaliseJob([]), 5)).toBe(1);
  });

  it('control: slicing naively, as two independent fills, does not give the same bytes, so the comparison can fail', () => {
    const ref = new Float32Array(Math.ceil(0.9 * sr));
    refImpulse(ref, sr, 0.42, 77, 0);
    const x = new Float32Array(ref.length);
    const half = Math.floor(ref.length / 2);
    fillImpulse(x.subarray(0, half), sr, 0.42, 77, 0);
    fillImpulse(x.subarray(half), sr, 0.42, 77, 0);
    expect(same(x, ref)).toBe(false);
    const n = new Float32Array(1000);
    const nr = new Float32Array(1000);
    refNoise(nr, 9);
    fillNoise(n.subarray(0, 500), 9);
    fillNoise(n.subarray(500), 9);
    expect(same(n, nr)).toBe(false);
  });
});

function energy(x: Float32Array): number {
  let e = 0;
  for (let i = 0; i < x.length; i++) e += x[i]! * x[i]!;
  return e;
}

describe('A5 impulse', () => {
  it('fillImpulse has unit energy within 1e-6', () => {
    for (const [tau, seed, darken] of [[0.55, 99, 0.9], [0.42, 77, 0], [0.1, 3, 0.5]] as const) {
      const x = new Float32Array(48000);
      fillImpulse(x, 48000, tau, seed, darken);
      expect(Math.abs(energy(x) - 1)).toBeLessThan(1e-6);
    }
  });
  it('same seed gives the same bytes, another seed differs', () => {
    const a = new Float32Array(4096);
    const b = new Float32Array(4096);
    const c = new Float32Array(4096);
    fillImpulse(a, 48000, 0.3, 5, 0.5);
    fillImpulse(b, 48000, 0.3, 5, 0.5);
    fillImpulse(c, 48000, 0.3, 6, 0.5);
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
    expect(Buffer.from(a.buffer).equals(Buffer.from(c.buffer))).toBe(false);
  });
  it('it decays with tau: the first tau holds far more energy than the fourth', () => {
    const x = new Float32Array(48000 * 2);
    const tau = 0.2;
    fillImpulse(x, 48000, tau, 9, 0);
    const n = Math.floor(tau * 48000);
    expect(energy(x.subarray(0, n))).toBeGreaterThan(energy(x.subarray(3 * n, 4 * n)) * 100);
  });
  it('darken removes high-frequency energy from the tail, and only darken does', () => {
    const roughness = (x: Float32Array, from: number, to: number): number => {
      let e = 0;
      let d = 0;
      for (let i = from + 1; i < to; i++) {
        e += x[i]! * x[i]!;
        d += (x[i]! - x[i - 1]!) * (x[i]! - x[i - 1]!);
      }
      return d / e;
    };
    const bright = new Float32Array(48000);
    const dark = new Float32Array(48000);
    fillImpulse(bright, 48000, 2, 4, 0);
    fillImpulse(dark, 48000, 2, 4, 0.9);
    expect(roughness(dark, 40000, 47000)).toBeLessThan(roughness(bright, 40000, 47000) / 2);
  });
  it('fillNoise stays in [-1, 1), is roughly centred, and is seeded', () => {
    const x = new Float32Array(100000);
    fillNoise(x, 42);
    let sum = 0;
    for (let i = 0; i < x.length; i++) {
      expect(x[i]!).toBeGreaterThanOrEqual(-1);
      expect(x[i]!).toBeLessThan(1);
      sum += x[i]!;
    }
    expect(Math.abs(sum / x.length)).toBeLessThan(0.02);
    const y = new Float32Array(100000);
    fillNoise(y, 42);
    expect(y[12345]).toBe(x[12345]);
  });
});

describe('A9c clip curves', () => {
  it('the soft clip is linear to .7 over u in [-2, 2], then bounded near .98', () => {
    const c = softClipCurve();
    expect(c).toHaveLength(4097);
    const at = (u: number): number => c[Math.round(((u / 2 + 1) / 2) * (c.length - 1))]!;
    expect(at(0)).toBe(0);
    expect(at(0.5)).toBeCloseTo(0.5, 5);
    expect(at(-0.5)).toBeCloseTo(-0.5, 5);
    expect(at(0.7)).toBeCloseTo(0.7, 3);   // the nearest of 4097 points to .7 is .7002
    expect(at(1)).toBeGreaterThan(0.85);
    expect(at(2)).toBeLessThanOrEqual(0.98);
    expect(at(2)).toBeGreaterThan(0.97);
    expect(at(-2)).toBeCloseTo(-at(2), 6);
    for (let i = 1; i < c.length; i++) expect(c[i]!).toBeGreaterThanOrEqual(c[i - 1]!);
  });
  it('the safety clip is identity to .97 and never passes .982', () => {
    const c = safetyClipCurve();
    const at = (x: number): number => c[Math.round(((x + 1) / 2) * (c.length - 1))]!;
    for (const x of [0, 0.25, -0.5, 0.9, 0.97]) expect(at(x)).toBeCloseTo(x, 3);
    expect(at(1)).toBeLessThanOrEqual(0.982);
    expect(at(1)).toBeGreaterThan(0.97);
    expect(at(-1)).toBeCloseTo(-at(1), 6);
    for (let i = 1; i < c.length; i++) expect(c[i]!).toBeGreaterThanOrEqual(c[i - 1]!);
  });
});
