// src/world/grounding.ts -- section 5.7. The GPU surface differs from true height because coarse clipmap levels sag,
// so a grounded object is sunk, and rejected if it would still float or would be mostly buried.
// Scatter runs this per candidate, and a double through a non-inlined call is boxed (Agents.md, hot paths). V8's
// inlining budget runs out inside a placement, so the working forms below read and write one register array, whatever
// gets inlined. The argument forms at the end run the same code, for tests and callers outside a hot path.
import { CLIP_BASE_SPACING, CLIP_COLS, CLIP_DROP, CLIP_LEVELS, CLIP_REAR_ROWS, CLIP_ROWS, CHUNK_LEN } from '../contracts/index';
import { SAG_CLASS, type SagTable } from './biomes';
import { HeightReg, type HeightCore } from './height';

// Hoisted from the imports. This is the per-sample path, and every read of an imported binding is a getter on a module
// object under Vitest's transform, which measured 3 to 5 times slower than the same code in a plain bundle.
const BASE_SPACING = CLIP_BASE_SPACING;
const COLS = CLIP_COLS;
const ROWS = CLIP_ROWS;
const LEVELS = CLIP_LEVELS;
const REAR = CLIP_REAR_ROWS;
const DROPS = CLIP_DROP;
const CHUNK = CHUNK_LEN;
const H_X = HeightReg.X;
const H_IZ = HeightReg.IZ;
const H_ZS = HeightReg.ZS;
const H_Z_LOCAL = HeightReg.Z_LOCAL;
const H_OUT = HeightReg.OUT;
const SAG_CLASS_OF = SAG_CLASS;

/** Registers of a placement. In: X, CHUNK, Z_LOCAL (reduced chunk), ABS_X, REACH (the archetype's maxDist), TOP, ROOT, SCALE, KEEPOUT_K. Out: the rest. */
export const GroundReg = {
  X: 0, ABS_X: 1, CHUNK: 2, Z_LOCAL: 3, REACH: 4, TOP: 5, ROOT: 6, SCALE: 7, KEEPOUT_K: 8,
  S: 9, DROP: 10, SINK: 11, GROUND: 12, SURFACE: 13, Y: 14,
} as const;
export const GROUND_REGS = 15;

/** Past this share of a level's reach it has begun morphing to its parent (section 6.4). */
const MORPH_START = 0.6;
const SAG_BANDS = 4;
const SAG_SPACINGS = 6;
const SAG_CLASSES = 4;
/** The object is mostly buried when the surface passes this share of its top. */
const BURY_LIMIT = 0.7;
/** Sink is at most this share of the object's top, or sinking by the p95 drowns small objects (section 5.7 rule 2). */
const SINK_LIMIT = 0.3;

/** First level whose grid reaches ABS_X and REACH. */
function levelOf(r: Float64Array): number {
  const absX = r[GroundReg.ABS_X]!;
  const reach = r[GroundReg.REACH]!;
  let s = BASE_SPACING;
  for (let L = 0; L < LEVELS - 1; L++) {
    if (absX < COLS / 2 * s && reach < (ROWS - REAR[L]!) * s) return L;
    s *= 2;
  }
  return LEVELS - 1;
}

/** Writes S, the spacing of the surface the clipmap draws there, the level's or its parent's once the morph has begun, and DROP. */
export function surfaceInto(r: Float64Array): void {
  const L = levelOf(r);
  const s = BASE_SPACING * 2 ** L;
  const halfW = COLS / 2 * s;
  const forward = (ROWS - REAR[L]!) * s;
  r[GroundReg.S] = Math.max(r[GroundReg.ABS_X]! / halfW, r[GroundReg.REACH]! / forward) > MORPH_START ? s * 2 : s;
  r[GroundReg.DROP] = DROPS[L]!;
}

function sagIndex(r: Float64Array, biome: number): number {
  const absX = r[GroundReg.ABS_X]!;
  const band = absX < 200 ? 0 : absX < 500 ? 1 : absX < 1400 ? 2 : 3;
  // log2(s) - 2 through clz32: s is a power of two from 4 to 128 at every placement, and clamped for a level-0 caller.
  let si = 29 - Math.clz32(r[GroundReg.S]!);
  if (si < 0) si = 0;
  else if (si >= SAG_SPACINGS) si = SAG_SPACINGS - 1;
  return (SAG_CLASS_OF[biome]! * SAG_SPACINGS + si) * SAG_BANDS + band;
}

/** Writes SINK: the p95 sag of this biome's terrain class at ABS_X and S, capped by the object's top. */
export function sinkInto(r: Float64Array, flat: Float64Array, biome: number): void {
  r[GroundReg.SINK] = Math.min(flat[sagIndex(r, biome)]!, SINK_LIMIT * r[GroundReg.TOP]! * r[GroundReg.SCALE]!);
}

/**
 * Writes SURFACE: height of the triangle the clipmap draws at spacing S, under X and Z_LOCAL of CHUNK. Lattice columns and rows
 * are on multiples of s, and each cell is split by the diagonal from (c + s, row) to (c, row + s), the uniform diagonal of section 6.4's morph.
 */
export function coarseInto(h: HeightCore, r: Float64Array): void {
  const x = r[GroundReg.X]!;
  const chunk = r[GroundReg.CHUNK]!;
  const zLocal = r[GroundReg.Z_LOCAL]!;
  const s = r[GroundReg.S]!;
  const hr = h.regs;
  let iz: number;
  let fz: number;
  if (s <= CHUNK) {
    const inRow = Math.floor(zLocal / s);
    iz = chunk * (CHUNK / s) + inRow;
    fz = (zLocal - inRow * s) / s;
  } else {
    const ra = s / CHUNK;
    iz = Math.floor(chunk / ra);
    fz = ((chunk - iz * ra) * CHUNK + zLocal) / s;
  }
  const cx = Math.floor(x / s) * s;
  const fx = (x - cx) / s;
  const lower = fx + fz <= 1;
  hr[H_ZS] = s;
  hr[H_Z_LOCAL] = 0;
  // Each triangle needs 3 corners: lower, (c, row); upper, (c + s, row + s); both, the two on the diagonal.
  hr[H_X] = lower ? cx : cx + s;
  hr[H_IZ] = lower ? iz : iz + 1;
  h.run();
  const corner = hr[H_OUT]!;
  hr[H_X] = cx + s;
  hr[H_IZ] = iz;
  h.run();
  const h10 = hr[H_OUT]!;
  hr[H_X] = cx;
  hr[H_IZ] = iz + 1;
  h.run();
  const h01 = hr[H_OUT]!;
  r[GroundReg.SURFACE] = lower
    ? corner + fx * (h10 - corner) + fz * (h01 - corner)
    : corner + (1 - fx) * (h01 - corner) + (1 - fz) * (h10 - corner);
}

/**
 * Section 5.7 rule 3. Rejects a candidate that would show daylight under its root, or that the surface would mostly bury.
 * Reads GROUND, SURFACE, DROP, SINK, Y, TOP, ROOT, SCALE. Y is ground minus sink, and SCALE is after any keep-out fit.
 */
export function gateRejects(r: Float64Array): boolean {
  const g = r[GroundReg.SURFACE]! - r[GroundReg.DROP]!;
  const scale = r[GroundReg.SCALE]!;
  if (r[GroundReg.GROUND]! - g - r[GroundReg.SINK]! > r[GroundReg.ROOT]! * scale) return true;
  if (g - r[GroundReg.Y]! > BURY_LIMIT * r[GroundReg.TOP]! * scale) return true;
  return false;
}

/** A flat copy of a sag table, addressed by sinkInto and sag95. */
export function flattenSag(table: SagTable): Float64Array {
  const out = new Float64Array(SAG_CLASSES * SAG_SPACINGS * SAG_BANDS);
  for (let c = 0; c < SAG_CLASSES; c++) {
    for (let s = 0; s < SAG_SPACINGS; s++) {
      for (let b = 0; b < SAG_BANDS; b++) out[(c * SAG_SPACINGS + s) * SAG_BANDS + b] = table[c]![s]![b]!;
    }
  }
  return out;
}

// ---- argument forms, not for a hot path. Every register is written before it is read, so this scratch holds no state.
const scratch = new Float64Array(GROUND_REGS);

/** First level whose grid reaches this lateral distance and this forward draw distance. */
export function levelAt(absX: number, maxDist: number): number {
  scratch[GroundReg.ABS_X] = absX;
  scratch[GroundReg.REACH] = maxDist;
  return levelOf(scratch);
}

/** Spacing of the surface the clipmap draws there. */
export function spacingAt(absX: number, maxDist: number): number {
  scratch[GroundReg.ABS_X] = absX;
  scratch[GroundReg.REACH] = maxDist;
  surfaceInto(scratch);
  return scratch[GroundReg.S]!;
}

/** The drop of the level the surface comes from. */
export function dropAt(absX: number, maxDist: number): number {
  scratch[GroundReg.ABS_X] = absX;
  scratch[GroundReg.REACH] = maxDist;
  surfaceInto(scratch);
  return scratch[GroundReg.DROP]!;
}

/** Absolute p95 of true height minus coarse surface, for a biome's terrain class at this lateral distance and spacing. */
export function sag95(flat: Float64Array, biome: number, absX: number, s: number): number {
  scratch[GroundReg.ABS_X] = absX;
  scratch[GroundReg.S] = s;
  return flat[sagIndex(scratch, biome)]!;
}

/** Height of the triangle the clipmap draws at spacing s, at a point of a chunk. */
export function coarseSurface(h: HeightCore, x: number, chunk: number, zLocal: number, s: number): number {
  scratch[GroundReg.X] = x;
  scratch[GroundReg.CHUNK] = chunk;
  scratch[GroundReg.Z_LOCAL] = zLocal;
  scratch[GroundReg.S] = s;
  coarseInto(h, scratch);
  return scratch[GroundReg.SURFACE]!;
}
