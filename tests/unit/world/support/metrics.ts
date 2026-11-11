// Measurements shared by the world tests. Nothing here decides a threshold; the tests do.
import {
  ARCHETYPE_COUNT, ARCHETYPE_SPEC, CAMERA_FOV, CHUNK_LEN, PROP_STRIDE, PropField,
  type PropRow,
} from '../../../../src/contracts/index';
import type { OctFn } from './mutants';

function fract(x: number): number {
  return x - Math.floor(x);
}

export interface OctaveReport { range: number; zeroFrac: number; outOfBounds: number; eqStep: number }

/** One octave at world distance D. 4000 scattered samples, then 1024 steps of 1/64 u at a fixed x. */
export function octaveReport(oct: OctFn, D: number, wl: number): OctaveReport {
  const chunk = Math.floor(D / 64);
  const base = chunk * 32;
  const zs = 2;
  let lo = Infinity;
  let hi = -Infinity;
  let zero = 0;
  let out = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const iz = base + (i * 7) % 1024;
    const zLocal = fract(i * 0.61803398875) * 2;
    const x = 187 + fract(i * 0.754877666) * 1500;
    const v = oct(x, iz, zs, zLocal, wl);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    if (v === 0) zero++;
    if (Math.abs(v) > 1) out++;
  }
  const STEPS = 1024;
  let eq = 0;
  let prev = NaN;
  for (let s = 0; s < STEPS; s++) {
    const iz = base + Math.floor(s / 128);
    const zLocal = (s % 128) / 64;
    const v = oct(437.3, iz, zs, zLocal, wl);
    if (v === prev) eq++;
    prev = v;
  }
  return { range: hi - lo, zeroFrac: zero / N, outOfBounds: out, eqStep: eq / (STEPS - 1) };
}

export function percentile(sorted: Float64Array, p: number): number {
  const i = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[i]!;
}

/** Forward distance from a camera at (camChunk, camLocal) to a record, in u. */
export function forwardOf(rowChunk: number, zLocal: number, camChunk: number, camLocal: number): number {
  return (rowChunk - camChunk) * CHUNK_LEN + zLocal - camLocal;
}

/** Rows the widest archetype can see, as in section 6.5: row 94 ahead is the farthest T05 fills. */
export const LIVE_ROWS = 95;

/** Rows holding every prop a camera at camChunk can see, ring keep ignored. */
export type RowFill = (chunk: number, out: PropRow) => void;

/** Count of records inside their maxDist, with forward distance at least 0. Rows are filled by the caller's world. */
export function liveCount(fill: RowFill, row: PropRow, camChunk: number, camLocal: number): number {
  let live = 0;
  for (let r = 0; r < LIVE_ROWS; r++) {
    const chunk = camChunk + r;
    fill(chunk, row);
    const total = row.start[ARCHETYPE_COUNT]!;
    for (let a = 0; a < ARCHETYPE_COUNT; a++) {
      const maxDist = ARCHETYPE_SPEC[a]!.maxDist;
      const end = row.start[a + 1]!;
      for (let i = row.start[a]!; i < end && i < total; i++) {
        const f = forwardOf(chunk, row.data[i * PROP_STRIDE + PropField.Z_LOCAL]!, camChunk, camLocal);
        if (f >= 0 && f <= maxDist) live++;
      }
    }
  }
  return live;
}

export const SCREEN_W = 1920;
export const SCREEN_H = 1080;
export const COLUMNS = 16;
const TAN_V = Math.tan((CAMERA_FOV / 2) * Math.PI / 180);

/** Pixel height at 1080p of something h u tall at forward distance f. */
export function screenPixels(h: number, f: number): number {
  return (h / f) / TAN_V * (SCREEN_H / 2);
}

/** Screen column of a lateral position at forward distance f, or -1 off screen. */
export function screenColumn(x: number, f: number): number {
  const sx = 0.5 + (x / f) / (TAN_V * SCREEN_W / SCREEN_H) / 2;
  if (sx < 0 || sx >= 1) return -1;
  return Math.floor(sx * COLUMNS);
}

/** Objects at least 8 px tall per screen column, seen from (camChunk, camLocal). Floating types are drawn 2 * top tall. */
export function columnCounts(fill: RowFill, row: PropRow, camChunk: number, camLocal: number, out: Int32Array): void {
  out.fill(0);
  for (let r = 0; r < LIVE_ROWS; r++) {
    const chunk = camChunk + r;
    fill(chunk, row);
    for (let a = 0; a < ARCHETYPE_COUNT; a++) {
      const spec = ARCHETYPE_SPEC[a]!;
      const end = row.start[a + 1]!;
      for (let i = row.start[a]!; i < end; i++) {
        const o = i * PROP_STRIDE;
        const f = forwardOf(chunk, row.data[o + PropField.Z_LOCAL]!, camChunk, camLocal);
        if (f < 1 || f > spec.maxDist) continue;
        const reach = (spec.floats ? 2 : 1) * spec.top * row.data[o + PropField.SCALE]!;
        if (screenPixels(reach, f) < 8) continue;
        const col = screenColumn(row.data[o + PropField.X]!, f);
        if (col >= 0) out[col] = out[col]! + 1;
      }
    }
  }
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += a[i]! * b[i]!;
    aa += a[i]! * a[i]!;
    bb += b[i]! * b[i]!;
  }
  return aa === 0 || bb === 0 ? 0 : ab / Math.sqrt(aa * bb);
}
