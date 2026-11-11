// A5: every instrument against a known answer, and shown able to fail.
import { describe, expect, it } from 'vitest';
import {
  badCount, bandDb, bandShares, bassMarginDb, chromaInChord, clipCount, corr, crestDb, dc, fft, goertzelDb, maxAbsDiff, maxStepDiff,
  monoDb, onsets, peak, rmsDb, segDb, spectrogram,
} from '../../../src/audio/analysis';

const SR = 48000;

function sine(freq: number, seconds: number, amp = 1, sr = SR): Float32Array {
  const n = Math.floor(seconds * sr);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return x;
}

function square(freq: number, seconds: number, amp = 1): Float32Array {
  return sine(freq, seconds).map((v) => (v >= 0 ? amp : -amp));
}

function saw(freq: number, seconds: number, amp = 1): Float32Array {
  const n = Math.floor(seconds * SR);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * (2 * ((i * freq) / SR - Math.floor((i * freq) / SR + 0.5)));
  return x;
}

function noise(n: number, seed = 1): Float32Array {
  let a = seed;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    a = (a * 1664525 + 1013904223) % 4294967296;
    x[i] = a / 2147483648 - 1;
  }
  return x;
}

describe('A5 levels', () => {
  it('sine RMS is -3.01 dB', () => {
    expect(rmsDb(sine(997, 1))).toBeCloseTo(-3.01, 2);
  });
  it('a square has crest 0, and a sine has crest 3.01', () => {
    expect(crestDb(square(100, 1))).toBeCloseTo(0, 6);
    expect(crestDb(sine(997, 1))).toBeCloseTo(3.01, 2);
  });
  it('DC .25 reads .25', () => {
    expect(dc(new Float32Array(1000).fill(0.25))).toBeCloseTo(0.25, 9);
    expect(dc(sine(100, 1))).toBeCloseTo(0, 3);
  });
  it('peak finds the largest absolute sample', () => {
    const x = new Float32Array(10);
    x[3] = -0.7;
    x[4] = 0.5;
    expect(peak(x)).toBeCloseTo(0.7, 6);
  });
  it('silence reads below -200 and does not throw', () => {
    const z = new Float32Array(1000);
    expect(rmsDb(z)).toBeLessThan(-200);
    expect(rmsDb(new Float32Array(0))).toBeLessThan(-200);
    expect(segDb(z, SR, 0, 0.01)).toBeLessThan(-200);
    expect(Number.isFinite(crestDb(z))).toBe(true);
    expect(corr(z, z)).toBe(0);
    expect(Number.isFinite(monoDb(z, z))).toBe(true);
    expect(chromaInChord(z, SR, 0, [0])).toBe(0);
    expect(() => bandShares(z, SR)).not.toThrow();
    expect(onsets(z, SR, 0)).toEqual([]);
  });
  it('clipCount: a clipped sine counts, a sine at .9 does not', () => {
    const clipped = sine(100, 0.2, 1.5).map((v) => Math.max(-1, Math.min(1, v)));
    expect(clipCount(clipped)).toBeGreaterThan(0);
    expect(clipCount(sine(100, 0.2, 0.9))).toBe(0);
  });
  it('badCount: one NaN counts 1, and Infinity counts', () => {
    const x = new Float32Array(100);
    x[5] = NaN;
    expect(badCount(x)).toBe(1);
    x[6] = Infinity;
    expect(badCount(x)).toBe(2);
    expect(badCount(new Float32Array(10))).toBe(0);
  });
  it('segDb reads only its range', () => {
    const x = new Float32Array(SR);
    x.set(sine(1000, 0.5), 0);
    expect(segDb(x, SR, 0.1, 0.4)).toBeCloseTo(-3.01, 1);
    expect(segDb(x, SR, 0.6, 0.9)).toBeLessThan(-200);
  });
});

describe('A5 stereo', () => {
  it('L = -R has corr -1 and a very low monoDb', () => {
    const l = sine(440, 0.5);
    const r = l.map((v) => -v);
    expect(corr(l, r)).toBeCloseTo(-1, 6);
    expect(monoDb(l, r)).toBeLessThan(-100);
  });
  it('L = R has corr 1 and monoDb 0', () => {
    const l = sine(440, 0.5);
    expect(corr(l, l)).toBeCloseTo(1, 6);
    expect(monoDb(l, l)).toBeCloseTo(0, 6);
  });
  it('unrelated noise has corr near 0 and monoDb near -3', () => {
    const l = noise(100000, 1);
    const r = noise(100000, 77);
    expect(Math.abs(corr(l, r))).toBeLessThan(0.05);
    expect(monoDb(l, r)).toBeCloseTo(-3, 0);
  });
});

describe('A5 spectrum', () => {
  it('fft: a bin-centred sine lands in its bin', () => {
    const N = 1024;
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = Math.sin((2 * Math.PI * 37 * i) / N);
    fft(re, im);
    let best = 0;
    let bestP = 0;
    for (let k = 0; k < N / 2; k++) {
      const p = re[k]! * re[k]! + im[k]! * im[k]!;
      if (p > bestP) { bestP = p; best = k; }
    }
    expect(best).toBe(37);
    expect(Math.sqrt(bestP)).toBeCloseTo(N / 2, 6);
  });
  it('bandShares: a sine in each band owns that band', () => {
    for (const [f, band] of [[100, 0], [1000, 1], [4000, 2], [12000, 3]] as const) {
      const s = bandShares(sine(f, 1), SR);
      expect(s[band]).toBeGreaterThan(-0.1);
      for (let b = 0; b < 4; b++) if (b !== band) expect(s[b]!).toBeLessThan(-30);
    }
  });
  it('bandDb: inside a band reads much higher than outside it', () => {
    const x = sine(200, 1);
    expect(bandDb(x, SR, 0.1, 0.4, 100, 300) - bandDb(x, SR, 0.1, 0.4, 2000, 4000)).toBeGreaterThan(40);
  });
  it('goertzel: on-frequency beats off-frequency', () => {
    const x = sine(440, 1);
    expect(goertzelDb(x, SR, 0, 1, 440) - goertzelDb(x, SR, 0, 1, 470)).toBeGreaterThan(40);
  });
  it('chromaInChord: a sine at a known pitch reads near 1 for its class and near 0 for others', () => {
    const a4 = sine(440, 1);
    expect(chromaInChord(a4, SR, 0.1, [9])).toBeGreaterThan(0.99);
    expect(chromaInChord(a4, SR, 0.1, [0, 3, 7])).toBeLessThan(0.01);
  });
  it('bassMarginDb: a saw at its own note beats a semitone away, in both directions', () => {
    const f = 440 * Math.pow(2, (45 - 69) / 12);   // A2
    const x = saw(f, 2, 0.5);
    expect(bassMarginDb(x, SR, 0.1, 1.9, 45)).toBeGreaterThan(5);
    expect(bassMarginDb(x, SR, 0.1, 1.9, 44)).toBeLessThan(-5);
    expect(bassMarginDb(x, SR, 0.1, 1.9, 46)).toBeLessThan(-5);
  });
  it('spectrogram: a sine draws one bright row, and the array is the right size', () => {
    const x = sine(1000, 1);
    const w = 16;
    const h = 64;
    const img = spectrogram(x, SR, 0.2, 0.8, w, h);
    expect(img.length).toBe(w * h * 4);
    const col = 8;
    let bestRow = 0;
    let best = -1;
    let dark = 0;
    for (let row = 0; row < h; row++) {
      const v = img[(row * w + col) * 4]!;
      if (v > best) { best = v; bestRow = row; }
      if (v < 60) dark++;
    }
    const f = 30 * Math.pow(16000 / 30, (h - 1 - bestRow) / (h - 1));
    expect(f / 1000).toBeGreaterThan(0.85);
    expect(f / 1000).toBeLessThan(1.15);
    expect(dark).toBeGreaterThan(h / 2);
    expect(img[3]).toBe(255);
  });
});

describe('A5 onsets and differences', () => {
  function clicks(times: readonly number[], seconds: number): Float32Array {
    const x = new Float32Array(Math.floor(seconds * SR));
    for (const t of times) {
      const at = Math.floor(t * SR);
      for (let i = 0; i < 2400; i++) x[at + i] = Math.exp(-i / 500) * Math.sin(i * 0.05);
    }
    return x;
  }
  it('onsets finds each burst, once, close to its time', () => {
    const times = [0.1, 0.4, 0.7, 1.0];
    const got = onsets(clicks(times, 1.3), SR, 0);
    expect(got).toHaveLength(4);
    got.forEach((t, i) => expect(Math.abs(t - times[i]!)).toBeLessThan(0.006));
  });
  it('onsets with a lowpass still finds low bursts, and a moved burst moves the answer', () => {
    const a = onsets(clicks([0.2], 0.5), SR, 200);
    const b = onsets(clicks([0.22], 0.5), SR, 200);
    expect(a).toHaveLength(1);
    expect(b[0]! - a[0]!).toBeCloseTo(0.02, 2);
  });
  it('minGapS stops a low sound retriggering on its own cycles, and leaves separate sounds separate', () => {
    const n = SR;
    const x = new Float32Array(n);
    for (const start of [0.1, 0.7]) {
      for (let i = 0; i < 0.3 * SR; i++) x[Math.floor(start * SR) + i] = Math.exp(-i / (0.1 * SR)) * Math.sin((2 * Math.PI * 50 * i) / SR);
    }
    expect(onsets(x, SR, 200, 0.002, 0.3).length).toBeGreaterThan(2);
    const once = onsets(x, SR, 200, 0.002, 0.3, 0.3);
    expect(once).toHaveLength(2);
    expect(once[1]! - once[0]!).toBeCloseTo(0.6, 2);
  });
  it('maxStepDiff sees a click in a smooth signal and only in its range', () => {
    const x = sine(100, 0.2, 0.5);
    const smooth = maxStepDiff(x, SR);
    x[SR / 10] = x[SR / 10]! + 0.5;
    expect(maxStepDiff(x, SR)).toBeGreaterThan(smooth * 5);
    expect(maxStepDiff(x, SR, 0.15, 0.2)).toBeCloseTo(smooth, 3);
  });
  it('maxAbsDiff is 0 for equal arrays, the largest gap otherwise, and infinite for a length mismatch', () => {
    const a = sine(100, 0.1);
    const b = a.slice();
    expect(maxAbsDiff(a, b)).toBe(0);
    b[7] = b[7]! + 0.25;
    expect(maxAbsDiff(a, b)).toBeCloseTo(0.25, 6);
    expect(maxAbsDiff(a, a.subarray(1))).toBe(Infinity);
  });
});
