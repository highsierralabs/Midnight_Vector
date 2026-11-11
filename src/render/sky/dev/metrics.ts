// Pure metrics over RGBA8 frames, rows bottom-up as DevShell.pixels() returns them. No three, no DOM. Unit-tested on
// synthetic inputs, so each metric is shown able to fail on its own before it judges a real frame.

export interface Frame { readonly data: Uint8Array; readonly w: number; readonly h: number }
export interface Star { readonly x: number; readonly y: number }     // y in buffer rows, rising upward, as the frame is stored
export interface Diff { bytes: number; max: number }
export interface Photometry { nearWhite: number; meanChroma: number; meanLuma: number }
export interface ChannelBanding { channel: number; levels: number; changesPerLevel: number }
export interface StarTrack { stars: number; fluxP50: number; fluxP95: number; peakP50: number; peakP95: number }

function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** RGB at column x and a row counted from the top of the screen. */
export function pixelAt(f: Frame, x: number, row: number): [number, number, number] {
  const i = ((f.h - 1 - row) * f.w + x) * 4;
  return [f.data[i]!, f.data[i + 1]!, f.data[i + 2]!];
}

export function lumaAt(f: Frame, x: number, row: number): number {
  const i = ((f.h - 1 - row) * f.w + x) * 4;
  return luma(f.data[i]!, f.data[i + 1]!, f.data[i + 2]!);
}

/** Whole-frame luminance in Float32, same layout as the frame. */
export function lumaImage(f: Frame): Float32Array {
  const out = new Float32Array(f.w * f.h);
  for (let p = 0, i = 0; p < out.length; p++, i += 4) out[p] = luma(f.data[i]!, f.data[i + 1]!, f.data[i + 2]!);
  return out;
}

/** Section 8.1's definitions: near-white is min channel above 235; chroma is mean (max - min). */
export function photometry(f: Frame): Photometry {
  let nw = 0, chroma = 0, sum = 0;
  const n = f.w * f.h;
  for (let i = 0; i < n * 4; i += 4) {
    const r = f.data[i]!, g = f.data[i + 1]!, b = f.data[i + 2]!;
    const lo = Math.min(r, g, b), hi = Math.max(r, g, b);
    if (lo > 235) nw++;
    chroma += hi - lo;
    sum += luma(r, g, b);
  }
  return { nearWhite: nw / n, meanChroma: chroma / n, meanLuma: sum / n };
}

export function diffBytes(a: Uint8Array, b: Uint8Array): Diff {
  if (a.length !== b.length) throw new Error(`diffBytes: lengths differ, ${a.length} and ${b.length}`);
  let bytes = 0, max = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i]! - b[i]!);
    if (d !== 0) {
      bytes++;
      if (d > max) max = d;
    }
  }
  return { bytes, max };
}

/** FNV-1a over two seeds, printed as hex. Equal strings mean 0 differing bytes, short of a 64-bit collision. */
export function hashBytes(a: Uint8Array): string {
  let h1 = 2166136261, h2 = 0x811c9dc5 ^ 0x5bd1e995;
  for (let i = 0; i < a.length; i++) {
    h1 = Math.imul(h1 ^ a[i]!, 16777619);
    h2 = Math.imul(h2 ^ a[i]!, 0x01000193) ^ (h2 >>> 13);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/**
 * Banding: every 4th column, value changes between adjacent rows, divided by total (max - min) levels, per channel.
 * An undithered monotone ramp reads exactly 1.00. Dither crosses each level several times. Rows counted from the top.
 */
export function bandChanges(f: Frame, x0: number, x1: number, row0: number, row1: number): ChannelBanding[] {
  const out: ChannelBanding[] = [];
  for (let k = 0; k < 3; k++) {
    let changes = 0, span = 0, cols = 0;
    for (let x = x0; x < x1; x += 4) {
      let previous = -1, lo = 255, hi = 0;
      for (let row = row0; row < row1; row++) {
        const v = f.data[((f.h - 1 - row) * f.w + x) * 4 + k]!;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
        if (previous >= 0 && v !== previous) changes++;
        previous = v;
      }
      span += hi - lo;
      cols++;
    }
    out.push({ channel: k, levels: span / Math.max(cols, 1), changesPerLevel: changes / Math.max(span, 1) });
  }
  return out;
}

export interface StarSearch { x0: number; x1: number; y0: number; y1: number; minPeak: number; maxNeighbour: number; radius: number }

/** Local maxima within +/-2 px, at least minPeak, with nothing above maxNeighbour elsewhere in +/-radius. */
export function findStars(l: Float32Array, w: number, h: number, s: StarSearch): Star[] {
  const stars: Star[] = [];
  const r = s.radius;
  for (let y = Math.max(s.y0, r); y < Math.min(s.y1, h - r); y++) {
    for (let x = Math.max(s.x0, r); x < Math.min(s.x1, w - r); x++) {
      const v = l[y * w + x]!;
      if (v < s.minPeak) continue;
      let keep = true;
      for (let j = -r; j <= r && keep; j++) {
        for (let i = -r; i <= r; i++) {
          if (i === 0 && j === 0) continue;
          const u = l[(y + j) * w + x + i]!;
          if (Math.abs(i) <= 2 && Math.abs(j) <= 2) {
            if (u > v) { keep = false; break; }
          } else if (u > s.maxNeighbour) { keep = false; break; }
        }
      }
      if (keep) stars.push({ x, y });
    }
  }
  return stars;
}

/** Local maxima within +/-2 px at least minPeak, with no isolation test. Ties go to the first pixel met. */
export function countPeaks(l: Float32Array, w: number, h: number, x0: number, x1: number, y0: number, y1: number, minPeak: number): number {
  let n = 0;
  for (let y = Math.max(y0, 2); y < Math.min(y1, h - 2); y++) {
    for (let x = Math.max(x0, 2); x < Math.min(x1, w - 2); x++) {
      const v = l[y * w + x]!;
      if (v < minPeak) continue;
      let top = true;
      for (let j = -2; j <= 2 && top; j++) {
        for (let i = -2; i <= 2; i++) {
          if (i === 0 && j === 0) continue;
          const u = l[(y + j) * w + x + i]!;
          if (u > v || (u === v && (j < 0 || (j === 0 && i < 0)))) { top = false; break; }
        }
      }
      if (top) n++;
    }
  }
  return n;
}

/** Mean equivalent radius, in buffer pixels, of the area at or above half of each star's peak. */
export function meanRadius(l: Float32Array, w: number, stars: readonly Star[], window: number): number {
  let sum = 0;
  for (const s of stars) {
    const peak = l[s.y * w + s.x]!;
    let area = 0;
    for (let j = -window; j <= window; j++) {
      for (let i = -window; i <= window; i++) {
        if (l[(s.y + j) * w + s.x + i]! >= peak / 2) area++;
      }
    }
    sum += Math.sqrt(area / Math.PI);
  }
  return stars.length > 0 ? sum / stars.length : 0;
}

function coefficientOfVariation(a: readonly number[]): number {
  let m = 0;
  for (const v of a) m += v;
  m /= a.length;
  let q = 0;
  for (const v of a) q += (v - m) * (v - m);
  return Math.sqrt(q / a.length) / (m > 0 ? m : 1);
}

function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

/**
 * Motion-compensated stability. dx and dy are pixels per frame in buffer axes. Sums a 15x15 window around each star's
 * predicted position in each frame, then reports the coefficient of variation of flux and of peak.
 */
export function trackStars(frames: readonly Float32Array[], w: number, h: number, stars: readonly Star[], dx: number, dy: number): StarTrack {
  const flux: number[] = [];
  const peak: number[] = [];
  for (const s of stars) {
    const fluxes: number[] = [];
    const peaks: number[] = [];
    frames.forEach((l, f) => {
      const X = Math.round(s.x + dx * f), Y = Math.round(s.y + dy * f);
      let sum = 0, top = 0;
      for (let j = -7; j <= 7; j++) {
        for (let i = -7; i <= 7; i++) {
          const yy = Y + j, xx = X + i;
          if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
          const v = l[yy * w + xx]!;
          sum += v;
          if (v > top) top = v;
        }
      }
      fluxes.push(sum);
      peaks.push(top);
    });
    flux.push(coefficientOfVariation(fluxes));
    peak.push(coefficientOfVariation(peaks));
  }
  flux.sort((a, b) => a - b);
  peak.sort((a, b) => a - b);
  return { stars: stars.length, fluxP50: percentile(flux, 0.5), fluxP95: percentile(flux, 0.95), peakP50: percentile(peak, 0.5), peakP95: percentile(peak, 0.95) };
}

/** The first row, counted from row0, whose luminance rises by at least minStep over the row above. -1 if none. */
export function firstEdgeRow(f: Frame, x: number, row0: number, row1: number, minStep: number): number {
  let previous = lumaAt(f, x, row0);
  for (let row = row0 + 1; row < row1; row++) {
    const v = lumaAt(f, x, row);
    if (v - previous >= minStep) return row;
    previous = v;
  }
  return -1;
}

/** The brightest row in a range at column x. */
export function peakRow(f: Frame, x: number, row0: number, row1: number): number {
  let best = row0, top = -1;
  for (let row = row0; row < row1; row++) {
    const v = lumaAt(f, x, row);
    if (v > top) { top = v; best = row; }
  }
  return best;
}
