// Every number the forever and perf gates judge, with one definition each. Pure functions on RGBA arrays and number
// arrays: no three, no DOM, no clock. Imported by Node tests and exposed on window.__mvLab.
//
// Orientation: px is bottom-up, as gl.readPixels gives it. Row arguments count from the top of the frame, so row r is
// y = h - 1 - r. Code values are 0 to 255.

export interface ByteDiff { bytes: number; max: number; first: number }
export interface EdgeCounts { ok: number; bad: number; interior: number; clear: number; other: number }
export interface Washout { nearWhitePct: number; meanChroma: number; meanLuma: number; blackP10: number }
export interface WindowMedian { median: number; dropped: number }
/** worst is the largest distance of one of the last three medians from their mean, as a fraction of the mean. */
export interface WindowStability { stable: boolean; mean: number; worst: number }
export interface ProbeShift { moved: number; error: number; ok: boolean }
export interface LeakStats { growth: number; lastThreeSpread: number; max: number }

type Bytes = ArrayLike<number>;

const R709 = 0.2126;
const G709 = 0.7152;
const B709 = 0.0722;

/** T03's sky predicate: DebugPaint.CLEAR after any encoding the debug paths apply. */
function isSky(r: number, g: number, b: number): boolean {
  return r > 200 && g < 60 && b > 200;
}

function checkShape(px: Bytes, w: number, h: number): void {
  if (px.length !== w * h * 4) throw new RangeError(`frame holds ${px.length} bytes, expected ${w * h * 4} for ${w}x${h}`);
}

/** Differing bytes between two frames of equal length. first is -1 when there are none. */
export function byteDiff(a: Bytes, b: Bytes): ByteDiff {
  if (a.length !== b.length) throw new RangeError(`byteDiff: lengths differ, ${a.length} and ${b.length}`);
  return byteDiffRange(a, 0, b, a.length);
}

/** byteDiff of a[offset .. offset + length) against b[0 .. length), so a frame held in one long store compares in place. */
export function byteDiffRange(a: Bytes, offset: number, b: Bytes, length: number): ByteDiff {
  let bytes = 0;
  let max = 0;
  let first = -1;
  for (let i = 0; i < length; i++) {
    const d = Math.abs(a[offset + i]! - b[i]!);
    if (d !== 0) {
      bytes++;
      if (d > max) max = d;
      if (first < 0) first = i;
    }
  }
  return { bytes, max, first };
}

/** Mean absolute difference over R, G and B in rows r0 to r1 - 1, counted from the top. */
export function bandDiff(a: Bytes, b: Bytes, w: number, h: number, r0: number, r1: number): number {
  checkShape(a, w, h);
  checkShape(b, w, h);
  if (r0 < 0 || r1 > h || r1 <= r0) throw new RangeError(`bandDiff: rows ${r0} to ${r1} do not fit a height of ${h}`);
  let sum = 0;
  for (let r = r0; r < r1; r++) {
    const start = (h - 1 - r) * w * 4;
    const end = start + w * 4;
    for (let i = start; i < end; i += 4) {
      sum += Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!);
    }
  }
  return sum / ((r1 - r0) * w * 3);
}

/** T03's band, rows just under the horizon: 615 to 650 at 1080p. */
export function shimmerBand(h: number): [number, number] {
  return [Math.round((615 * h) / 1080), Math.round((650 * h) / 1080)];
}

/** T03's detector. Scanning each column from the top, a sky pixel below the column's first non-sky pixel counts. */
export function crackCount(px: Bytes, w: number, h: number): number {
  checkShape(px, w, h);
  const covered = new Uint8Array(w);
  let n = 0;
  for (let r = 0; r < h; r++) {
    const start = (h - 1 - r) * w * 4;
    for (let c = 0; c < w; c++) {
      const i = start + c * 4;
      const sky = isSky(px[i]!, px[i + 1]!, px[i + 2]!);
      if (covered[c] === 0) {
        if (!sky) covered[c] = 1;
      } else if (sky) {
        n++;
      }
    }
  }
  return n;
}

/**
 * Standard deviation over columns of each column's first non-sky row. Returns 0 if any column has none, so an all-sky
 * or part-sky frame cannot pass a lower limit by mixing rows with a sentinel.
 */
export function silhouetteStd(px: Bytes, w: number, h: number): number {
  checkShape(px, w, h);
  const first = new Int32Array(w).fill(-1);
  let found = 0;
  for (let r = 0; r < h && found < w; r++) {
    const start = (h - 1 - r) * w * 4;
    for (let c = 0; c < w; c++) {
      if (first[c]! >= 0) continue;
      const i = start + c * 4;
      if (!isSky(px[i]!, px[i + 1]!, px[i + 2]!)) {
        first[c] = r;
        found++;
      }
    }
  }
  if (found < w) return 0;
  let sum = 0;
  for (let c = 0; c < w; c++) sum += first[c]!;
  const mean = sum / w;
  let sq = 0;
  for (let c = 0; c < w; c++) sq += (first[c]! - mean) * (first[c]! - mean);
  return Math.sqrt(sq / w);
}

/** T03's decode of the edge-paint frame. Each pixel lands in exactly one class. */
export function edgeCounts(px: Bytes, w: number, h: number): EdgeCounts {
  checkShape(px, w, h);
  const out: EdgeCounts = { ok: 0, bad: 0, interior: 0, clear: 0, other: 0 };
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i]!, g = px[i + 1]!, b = px[i + 2]!;
    if (g > 200 && r < 60) out.ok++;
    else if (r > 200 && g < 60 && b < 60) out.bad++;
    else if (isSky(r, g, b)) out.clear++;
    else if (Math.abs(r - 26) <= 6 && Math.abs(g - 26) <= 6 && Math.abs(b - 26) <= 6) out.interior++;
    else out.other++;
  }
  return out;
}

/** Pixels matching the sky predicate. */
export function skyCount(px: Bytes): number {
  let n = 0;
  for (let i = 0; i < px.length; i += 4) if (isSky(px[i]!, px[i + 1]!, px[i + 2]!)) n++;
  return n;
}

/** Pixels with any non-zero colour channel. Alpha does not count, because a final alpha-1 write would hide a blank frame. */
export function nonZeroCount(px: Bytes): number {
  let n = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i] !== 0 || px[i + 1] !== 0 || px[i + 2] !== 0) n++;
  return n;
}

/** Mean Rec.709 luma over the whole frame, on 8-bit values. */
export function meanLuma(px: Bytes): number {
  if (px.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += R709 * px[i]! + G709 * px[i + 1]! + B709 * px[i + 2]!;
  return sum / (px.length / 4);
}

/** The wash-out metrics of section 8.1's comment above HarnessApi, on final 8-bit RGBA. */
export function washout(px: Bytes, w: number, h: number): Washout {
  checkShape(px, w, h);
  const n = w * h;
  const histogram = new Uint32Array(256);
  let nearWhite = 0;
  let chroma = 0;
  let luma = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i]!, g = px[i + 1]!, b = px[i + 2]!;
    const lo = Math.min(r, g, b);
    if (lo > 235) nearWhite++;
    chroma += Math.max(r, g, b) - lo;
    const y = R709 * r + G709 * g + B709 * b;
    luma += y;
    histogram[Math.round(y)]!++;
  }
  // Nearest rank: the smallest value with at least ceil(.1 * n) pixels at or below it.
  const rank = Math.ceil(0.1 * n);
  let seen = 0;
  let blackP10 = 0;
  for (let v = 0; v < 256; v++) {
    seen += histogram[v]!;
    if (seen >= rank) {
      blackP10 = v;
      break;
    }
  }
  return { nearWhitePct: (100 * nearWhite) / n, meanChroma: chroma / n, meanLuma: luma / n, blackP10 };
}

/** Mean luma of on minus off, whole frame, with off the same frame under forceFeel({ bloomGain: 0 }). */
export function hazeLift(on: Bytes, off: Bytes, w: number, h: number): number {
  checkShape(on, w, h);
  checkShape(off, w, h);
  return meanLuma(on) - meanLuma(off);
}

/** Nearest rank on a sorted copy, with q in [0, 1]. An empty list reads NaN. */
export function percentile(values: readonly number[] | Float64Array, q: number): number {
  const sorted = Float64Array.from(values).sort();
  if (sorted.length === 0) return Number.NaN;
  const rank = Math.ceil(q * sorted.length);
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank - 1))]!;
}

/**
 * Median of the non-negative entries divided by per, plus how many were dropped. A window holding a scavenge goes
 * negative, so dropping those keeps the median on windows that saw only allocation.
 */
export function windowMedian(deltas: readonly number[] | Float64Array, per: number): WindowMedian {
  const kept = Array.from(deltas).filter((d) => d >= 0).sort((a, b) => a - b);
  const dropped = deltas.length - kept.length;
  if (kept.length === 0) return { median: Number.NaN, dropped };
  const mid = kept.length >> 1;
  const m = kept.length % 2 === 1 ? kept[mid]! : (kept[mid - 1]! + kept[mid]!) / 2;
  return { median: m / per, dropped };
}

/**
 * B19's stability line (DI-77): the last three window medians are stable when each lies within frac of their mean. The
 * app's per-frame allocation varies with streaming and items along the route, so its medians spread by 234 to 296 B over
 * about 8.8 KB and never agreed within the old 1 B [O: T10, D-005]. Fewer than three medians, a non-finite one, or a mean
 * that is not positive is not stable, so a run that measured nothing cannot pass.
 */
export function windowStability(medians: readonly number[], frac: number): WindowStability {
  if (medians.length < 3) return { stable: false, mean: Number.NaN, worst: Number.NaN };
  const a = medians[medians.length - 3]!;
  const b = medians[medians.length - 2]!;
  const c = medians[medians.length - 1]!;
  const mean = (a + b + c) / 3;
  if (!Number.isFinite(mean) || mean <= 0) return { stable: false, mean, worst: Number.NaN };
  const worst = Math.max(Math.abs(a - mean), Math.abs(b - mean), Math.abs(c - mean)) / mean;
  return { stable: worst <= frac, mean, worst };
}

/**
 * B19's windows control (DI-84): a probe of bytes per frame should move the window median by that, within tol. moved is
 * the median with the probe minus the median without it; error is its distance from bytes. A non-finite reading fails.
 * The shell holds 256 +/- 16 with clean and probe runs 3000 frames apart. On the app the medians move with the route, so
 * there the two are interleaved over one stretch, with a 1024 B probe at 1024 +/- 256 (DI-86(2)). The per-target forms
 * are WINDOWS_CONTROL in tests/perf/support/heap.ts. A control no larger than its tolerance could pass with no probe at
 * all, so it throws.
 */
export function probeShift(withProbe: number, without: number, bytes: number, tol: number): ProbeShift {
  if (!(bytes > tol)) throw new RangeError(`probeShift: a control of ${bytes} B is not larger than its tolerance of ${tol} B`);
  const moved = withProbe - without;
  const error = Math.abs(moved - bytes);
  return { moved, error, ok: error <= tol };
}

/** growth is last minus first; lastThreeSpread is the range of the last three samples. */
export function leakStats(samples: readonly number[]): LeakStats {
  if (samples.length === 0) return { growth: 0, lastThreeSpread: 0, max: 0 };
  const tail = samples.slice(-3);
  return {
    growth: samples[samples.length - 1]! - samples[0]!,
    lastThreeSpread: Math.max(...tail) - Math.min(...tail),
    max: Math.max(...samples),
  };
}

/** Bytes per frame from two heap readings across a run of frames. */
export function slopePerFrame(before: number, after: number, frames: number): number {
  return (after - before) / frames;
}
