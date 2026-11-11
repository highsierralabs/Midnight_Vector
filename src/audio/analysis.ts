// Dev only. Measurements on Float32Arrays, all pure, every one shown able to fail in analysis.test.ts. Never in the bundle.

const FLOOR = 1e-24;

function db10(p: number): number {
  return 10 * Math.log10(p + FLOOR);
}

export function peak(x: Float32Array): number {
  let m = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]!);
    if (a > m) m = a;
  }
  return m;
}

/** Samples at |x| >= .999. */
export function clipCount(x: Float32Array): number {
  let n = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]!) >= 0.999) n++;
  return n;
}

/** Non-finite samples. */
export function badCount(x: Float32Array): number {
  let n = 0;
  for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i]!)) n++;
  return n;
}

export function dc(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]!;
  return x.length > 0 ? s / x.length : 0;
}

export function rmsDb(x: Float32Array): number {
  let e = 0;
  for (let i = 0; i < x.length; i++) e += x[i]! * x[i]!;
  return db10(x.length > 0 ? e / x.length : 0);
}

export function crestDb(x: Float32Array): number {
  return 20 * Math.log10(peak(x) + 1e-12) - rmsDb(x);
}

/** L/R correlation in [-1, 1]. 0 if a channel is silent. */
export function corr(l: Float32Array, r: Float32Array): number {
  let ll = 0;
  let rr = 0;
  let lr = 0;
  const n = Math.min(l.length, r.length);
  for (let i = 0; i < n; i++) {
    ll += l[i]! * l[i]!;
    rr += r[i]! * r[i]!;
    lr += l[i]! * r[i]!;
  }
  return ll > 0 && rr > 0 ? lr / Math.sqrt(ll * rr) : 0;
}

/** Mid RMS relative to stereo RMS, dB. 0 for a mono signal, very low for L = -R. */
export function monoDb(l: Float32Array, r: Float32Array): number {
  let mm = 0;
  let ss = 0;
  const n = Math.min(l.length, r.length);
  for (let i = 0; i < n; i++) {
    const m = (l[i]! + r[i]!) / 2;
    mm += m * m;
    ss += (l[i]! * l[i]! + r[i]! * r[i]!) / 2;
  }
  return db10(n > 0 ? mm / n : 0) - db10(n > 0 ? ss / n : 0);
}

/** In-place radix-2 FFT. The length must be a power of two. */
export function fft(re: Float32Array | Float64Array, im: Float32Array | Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1;
    for (; j & b; b >>= 1) j ^= b;
    j ^= b;
    if (i < j) {
      let t = re[i]!; re[i] = re[j]!; re[j] = t;
      t = im[i]!; im[i] = im[j]!; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      const half = len >> 1;
      for (let j = 0; j < half; j++) {
        const a = i + j;
        const b = a + half;
        const vr = re[b]! * cr - im[b]! * ci;
        const vi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - vr;
        im[b] = im[a]! - vi;
        re[a] = re[a]! + vr;
        im[a] = im[a]! + vi;
        const nc = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nc;
      }
    }
  }
}

export function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

export const BAND_EDGES: readonly number[] = [250, 2000, 8000];

/** Share of FFT power in dB for bands below 250 Hz, 250 to 2 k, 2 to 8 k, and above 8 k. Hann, 8192 points, hopping a full window. */
export function bandShares(x: Float32Array, sampleRate: number): [number, number, number, number] {
  const N = 8192;
  const win = hann(N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const p = [0, 0, 0, 0];
  for (let s = 0; s + N <= x.length; s += N) {
    for (let i = 0; i < N; i++) {
      re[i] = x[s + i]! * win[i]!;
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const f = (k * sampleRate) / N;
      const pw = re[k]! * re[k]! + im[k]! * im[k]!;
      const b = f < 250 ? 0 : f < 2000 ? 1 : f < 8000 ? 2 : 3;
      p[b] = p[b]! + pw;
    }
  }
  const total = p[0]! + p[1]! + p[2]! + p[3]!;
  return [db10(p[0]! / (total + FLOOR)), db10(p[1]! / (total + FLOOR)), db10(p[2]! / (total + FLOOR)), db10(p[3]! / (total + FLOOR))];
}

/** RMS level of a time segment in dB. */
export function segDb(x: Float32Array, sampleRate: number, t0: number, t1: number): number {
  const a = Math.max(0, Math.floor(t0 * sampleRate));
  const b = Math.min(x.length, Math.floor(t1 * sampleRate));
  let e = 0;
  for (let i = a; i < b; i++) e += x[i]! * x[i]!;
  return db10(b > a ? e / (b - a) : 0);
}

/** Power at one frequency over a segment, Hann windowed, dB. */
export function goertzelDb(x: Float32Array, sampleRate: number, t0: number, t1: number, freq: number): number {
  const a = Math.max(0, Math.floor(t0 * sampleRate));
  const b = Math.min(x.length, Math.floor(t1 * sampleRate));
  const w = (2 * Math.PI * freq) / sampleRate;
  const c = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  const n = b - a;
  for (let i = a; i < b; i++) {
    const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i - a)) / n);
    const s = x[i]! * h + c * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return db10(s1 * s1 + s2 * s2 - c * s1 * s2);
}

function midiHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/**
 * The sum of harmonics 3 to 6 at midi, minus the larger of the same sum at midi - 1 and midi + 1. Not the
 * fundamental: an eighth-note gate has sidebands at 3.33 Hz and a semitone at G1 is 2.9 Hz, so the fundamental
 * scored -18.7 dB on a correct note [O: T07 prototype].
 */
export function bassMarginDb(x: Float32Array, sampleRate: number, t0: number, t1: number, midi: number): number {
  const score = (m: number): number => {
    let p = 0;
    for (let h = 3; h <= 6; h++) p += Math.pow(10, goertzelDb(x, sampleRate, t0, t1, midiHz(m) * h) / 10);
    return db10(p);
  };
  return score(midi) - Math.max(score(midi - 1), score(midi + 1));
}

/** Fraction of 110 to 1800 Hz FFT power in the given pitch classes, over a 32768-point Hann window from t0. */
export function chromaInChord(x: Float32Array, sampleRate: number, t0: number, pcs: readonly number[]): number {
  const N = 32768;
  const win = hann(N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const s = Math.floor(t0 * sampleRate);
  for (let i = 0; i < N; i++) re[i] = (x[s + i] ?? 0) * win[i]!;
  fft(re, im);
  let on = 0;
  let total = 0;
  for (let k = 1; k < N / 2; k++) {
    const f = (k * sampleRate) / N;
    if (f < 110 || f > 1800) continue;
    const p = re[k]! * re[k]! + im[k]! * im[k]!;
    const pc = ((Math.round(69 + 12 * Math.log2(f / 440)) % 12) + 12) % 12;
    total += p;
    if (pcs.includes(pc)) on += p;
  }
  return total > 0 ? on / total : 0;
}

/**
 * Onset times in seconds: lowpass at lpHz (0 for none), a hop-sized RMS envelope, a threshold at thFrac of the
 * maximum, re-armed once the envelope falls below a third of the threshold and minGapS has passed. A 2 ms envelope
 * follows single cycles of a 50 Hz kick, so a low sound needs the gap or it triggers on its own zero crossings.
 */
export function onsets(x: Float32Array, sampleRate: number, lpHz: number, hopS = 0.002, thFrac = 0.3, minGapS = 0): number[] {
  const hop = Math.max(1, Math.round(hopS * sampleRate));
  const k = lpHz > 0 ? 1 - Math.exp((-2 * Math.PI * lpHz) / sampleRate) : 1;
  let y = 0;
  const env: number[] = [];
  let e = 0;
  let c = 0;
  let max = 0;
  for (let i = 0; i < x.length; i++) {
    y += k * (x[i]! - y);
    e += y * y;
    c++;
    if (c === hop) {
      const r = Math.sqrt(e / hop);
      env.push(r);
      if (r > max) max = r;
      e = 0;
      c = 0;
    }
  }
  const th = thFrac * max;
  const out: number[] = [];
  let armed = true;
  let lastT = -Infinity;
  for (let i = 0; i < env.length; i++) {
    const t = (i * hop) / sampleRate;
    if (armed && env[i]! > th && t - lastT >= minGapS) {
      out.push(t);
      lastT = t;
      armed = false;
    } else if (!armed && env[i]! < th * 0.3) {
      armed = true;
    }
  }
  return out;
}

/** Largest sample-to-sample step in a time range: a click detector. */
export function maxStepDiff(x: Float32Array, sampleRate: number, t0 = 0, t1 = Infinity): number {
  const a = Math.max(1, Math.floor(t0 * sampleRate));
  const b = Math.min(x.length, t1 === Infinity ? x.length : Math.floor(t1 * sampleRate));
  let m = 0;
  for (let i = a; i < b; i++) {
    const d = Math.abs(x[i]! - x[i - 1]!);
    if (d > m) m = d;
  }
  return m;
}

export function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return Infinity;
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i]! - b[i]!);
    if (d > m) m = d;
  }
  return m;
}

/** FFT power in a frequency band over a time range, dB. Hann over the whole range, up to 16384 points. */
export function bandDb(x: Float32Array, sampleRate: number, t0: number, t1: number, f0: number, f1: number): number {
  const N = 16384;
  const s = Math.floor(t0 * sampleRate);
  const n = Math.min(N, Math.floor((t1 - t0) * sampleRate));
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < n; i++) re[i] = (x[s + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  fft(re, im);
  let p = 0;
  for (let k = 1; k < N / 2; k++) {
    const f = (k * sampleRate) / N;
    if (f >= f0 && f < f1) p += re[k]! * re[k]! + im[k]! * im[k]!;
  }
  return db10(p);
}

/**
 * A log-frequency spectrogram into an RGBA array, width * height * 4, row 0 at the top and the highest frequency.
 * 30 Hz to 16 kHz, -90 to 0 dB, a black to orange to pale-yellow ramp.
 */
export function spectrogram(x: Float32Array, sampleRate: number, t0: number, t1: number, width: number, height: number): Uint8ClampedArray {
  const N = 4096;
  const win = hann(N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const out = new Uint8ClampedArray(width * height * 4);
  for (let col = 0; col < width; col++) {
    const center = Math.floor((t0 + ((t1 - t0) * col) / width) * sampleRate - N / 2);
    for (let i = 0; i < N; i++) {
      const j = center + i;
      re[i] = j >= 0 && j < x.length ? x[j]! * win[i]! : 0;
      im[i] = 0;
    }
    fft(re, im);
    for (let row = 0; row < height; row++) {
      const f = 30 * Math.pow(16000 / 30, (height - 1 - row) / (height - 1));
      const k = Math.max(1, Math.round((f * N) / sampleRate));
      const p = re[k]! * re[k]! + im[k]! * im[k]!;
      const d = 10 * Math.log10(p / ((N * N) / 16) + 1e-12);
      const v = Math.max(0, Math.min(1, (d + 90) / 90));
      const o = (row * width + col) * 4;
      out[o] = 255 * Math.min(1, v * 1.8);
      out[o + 1] = 255 * Math.max(0, v * 1.8 - 0.8);
      out[o + 2] = 255 * (v < 0.5 ? v * 1.2 : Math.max(0, 1.2 - v * 1.2));
      out[o + 3] = 255;
    }
  }
  return out;
}
