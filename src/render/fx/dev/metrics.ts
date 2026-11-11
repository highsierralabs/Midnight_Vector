// Pixel metrics over RGBA8 arrays, so the page and Node run the same code. Definitions are section 8.1's comment above
// HarnessApi and section 6.7. Rows are whatever the caller's array holds; gl.readPixels gives them bottom-up.

export interface Washout {
  /** Percent of pixels with min(r, g, b) > 235. */
  nearWhitePct: number;
  /** Mean of max(r, g, b) - min(r, g, b). */
  meanChroma: number;
}

export function washout(rgba: Uint8Array): Washout {
  const n = rgba.length / 4;
  let white = 0;
  let chroma = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;
    const lo = Math.min(r, g, b);
    if (lo > 235) white++;
    chroma += Math.max(r, g, b) - lo;
  }
  return { nearWhitePct: (100 * white) / n, meanChroma: chroma / n };
}

/** Mean Rec.709 luma of the frame in code values. */
export function meanLuma(rgba: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    sum += 0.2126 * rgba[i]! + 0.7152 * rgba[i + 1]! + 0.0722 * rgba[i + 2]!;
  }
  return sum / (rgba.length / 4);
}

/** Mean luma of the frame minus the same for the same frame at bloomGain 0. */
export function hazeLift(on: Uint8Array, off: Uint8Array): number {
  return meanLuma(on) - meanLuma(off);
}

/** Mean of (max - min) / max over pixels whose largest channel is at least minMax: how coloured the lit part is. */
export function litSaturation(rgba: Uint8Array, minMax = 32): number {
  let n = 0;
  let sum = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;
    const hi = Math.max(r, g, b);
    if (hi < minMax) continue;
    n++;
    sum += (hi - Math.min(r, g, b)) / hi;
  }
  return n === 0 ? 0 : sum / n;
}

/**
 * Mean of (max - min) / max in `after`, over pixels whose largest channel in `before` was under darkBelow: how
 * coloured the surfaces that were dark stay once something lights them. Pixels black in `after` are skipped.
 */
export function darkSaturation(after: Uint8Array, before: Uint8Array, darkBelow = 64): { saturation: number; pixels: number } {
  if (after.length !== before.length) throw new Error(`darkSaturation: lengths differ, ${after.length} and ${before.length}`);
  let n = 0;
  let sum = 0;
  for (let i = 0; i < after.length; i += 4) {
    if (Math.max(before[i]!, before[i + 1]!, before[i + 2]!) >= darkBelow) continue;
    const hi = Math.max(after[i]!, after[i + 1]!, after[i + 2]!);
    if (hi === 0) continue;
    n++;
    sum += (hi - Math.min(after[i]!, after[i + 1]!, after[i + 2]!)) / hi;
  }
  return { saturation: n === 0 ? 0 : sum / n, pixels: n };
}

export interface RowChanges {
  /** Rows where more than half the pixels differ by more than tol in some channel. */
  swapped: number;
  /** Rows where some pixels do, but not more than half. */
  partial: number;
  rows: number;
}

/** Compares two equal-size frames row by row. Differences of tol or less are ignored. */
export function rowChanges(a: Uint8Array, b: Uint8Array, width: number, tol: number): RowChanges {
  if (a.length !== b.length) throw new Error(`rowChanges: lengths differ, ${a.length} and ${b.length}`);
  const rows = a.length / 4 / width;
  let swapped = 0;
  let partial = 0;
  for (let y = 0; y < rows; y++) {
    let n = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (Math.abs(a[i]! - b[i]!) > tol || Math.abs(a[i + 1]! - b[i + 1]!) > tol || Math.abs(a[i + 2]! - b[i + 2]!) > tol) n++;
    }
    if (2 * n > width) swapped++;
    else if (n > 0) partial++;
  }
  return { swapped, partial, rows };
}

export interface LightRadius {
  /** Mean distance from the centre, weighted by the light on adds over off. */
  radius: number;
  /** Total added light, in code values summed over r, g and b. */
  light: number;
}

/**
 * Where the light that on adds over off sits, as a mean distance from (cx, cy) in pixels, counting only pixels
 * between rMin and rMax. Coordinates are in the array's own row order.
 */
export function lightRadius(on: Uint8Array, off: Uint8Array, width: number, cx: number, cy: number, rMin: number, rMax: number): LightRadius {
  if (on.length !== off.length) throw new Error(`lightRadius: lengths differ, ${on.length} and ${off.length}`);
  const rows = on.length / 4 / width;
  let light = 0;
  let moment = 0;
  for (let y = 0; y < rows; y++) {
    const dy = y - cy;
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r < rMin || r > rMax) continue;
      const i = (y * width + x) * 4;
      const l = on[i]! - off[i]! + on[i + 1]! - off[i + 1]! + on[i + 2]! - off[i + 2]!;
      if (l <= 0) continue;
      light += l;
      moment += l * r;
    }
  }
  return { radius: light === 0 ? 0 : moment / light, light };
}

export interface ByteDiff { bytes: number; max: number; sum: number }

/** Over every byte, alpha included. */
export function byteDiff(a: Uint8Array, b: Uint8Array): ByteDiff {
  if (a.length !== b.length) throw new Error(`byteDiff: lengths differ, ${a.length} and ${b.length}`);
  let bytes = 0;
  let max = 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i]! - b[i]!);
    if (d > 0) {
      bytes++;
      sum += d;
      if (d > max) max = d;
    }
  }
  return { bytes, max, sum };
}

export interface Rect { x0: number; x1: number; y0: number; y1: number }

/** Mean of one channel per row over x0 <= x < x1, for y0 <= y < y1, in the array's own row order. */
export function rowMeans(rgba: Uint8Array, width: number, r: Readonly<Rect>, channel: 0 | 1 | 2): Float64Array {
  const out = new Float64Array(r.y1 - r.y0);
  const n = r.x1 - r.x0;
  for (let y = r.y0; y < r.y1; y++) {
    let sum = 0;
    for (let x = r.x0; x < r.x1; x++) sum += rgba[(y * width + x) * 4 + channel]!;
    out[y - r.y0] = sum / n;
  }
  return out;
}

/** Largest step between adjacent row means, over the three channels. */
export function maxRowStep(rgba: Uint8Array, width: number, r: Readonly<Rect>): number {
  let max = 0;
  for (const channel of [0, 1, 2] as const) {
    const rows = rowMeans(rgba, width, r, channel);
    for (let i = 1; i < rows.length; i++) {
      const d = Math.abs(rows[i]! - rows[i - 1]!);
      if (d > max) max = d;
    }
  }
  return max;
}

/** Standard deviation of one channel over a rectangle, taking every step-th row, so a test can hold one scan phase. */
export function channelStd(rgba: Uint8Array, width: number, r: Readonly<Rect>, channel: 0 | 1 | 2, step: number): number {
  let n = 0;
  let sum = 0;
  let sq = 0;
  for (let y = r.y0; y < r.y1; y += step) {
    for (let x = r.x0; x < r.x1; x++) {
      const v = rgba[(y * width + x) * 4 + channel]!;
      n++;
      sum += v;
      sq += v * v;
    }
  }
  const mean = sum / n;
  return Math.sqrt(Math.max(sq / n - mean * mean, 0));
}

export interface Spectrum {
  /** The strongest period in rows, and its amplitude: half the swing of a sine of that period. */
  period: number;
  amp: number;
  /** The largest amplitude among periods above 1.8 times the top period. This is what a moire beat shows up as. */
  low: number;
}

/** A plain DFT of the rows with their mean removed. */
export function spectrum(rows: Readonly<ArrayLike<number>>): Spectrum {
  const n = rows.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += rows[i]!;
  mean /= n;
  const half = Math.floor(n / 2);
  const amps = new Float64Array(half + 1);
  let topK = 1;
  for (let k = 1; k <= half; k++) {
    let re = 0;
    let im = 0;
    const w = (2 * Math.PI * k) / n;
    for (let i = 0; i < n; i++) {
      const v = rows[i]! - mean;
      re += v * Math.cos(w * i);
      im -= v * Math.sin(w * i);
    }
    const a = (2 * Math.hypot(re, im)) / n;
    amps[k] = a;
    if (a > amps[topK]!) topK = k;
  }
  const period = n / topK;
  let low = 0;
  for (let k = 1; k <= half; k++) {
    if (n / k > 1.8 * period && amps[k]! > low) low = amps[k]!;
  }
  return { period, amp: amps[topK]!, low };
}
