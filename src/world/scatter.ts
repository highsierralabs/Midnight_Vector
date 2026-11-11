// src/world/scatter.ts -- section 5.5. One row of prop records, a pure function of (seed, chunk, archetype, i).
// Density is built in, not left to chance: floor(expected + dither) per archetype, one stratified z slot per candidate,
// alternating sides, a golden-ratio band pick per row, and up to 4 retries inside the same slot.
// Hot path: plain loops, no closures made per call, no double through a non-inlined call. Doubles cross between the
// helpers below through the R and D registers. All scratch lives in this factory's closure, never at module level, or
// two worlds would share it.
import {
  ARCHETYPE_COUNT, ARCHETYPE_SPEC, Archetype, BIOME_COUNT, Biome, CHUNK_LEN, PROP_STRIDE, PropField,
  VALLEY_HALF, ZONE_CHUNKS, ZONE_FADE_CHUNKS,
  type PropRow,
} from '../contracts/index';
import { hash01 } from '../core/hash';
import { drawInto } from './draws';
import { YawMode, type Placement, type SagTable } from './biomes';
import { GROUND_REGS, GroundReg, coarseInto, flattenSag, gateRejects, sinkInto, surfaceInto } from './grounding';
import { HeightReg, type HeightCore } from './height';
import { fitKeepOutAt } from './keepout';
import type { Zones } from './zones';

// Hoisted from the imports. This is the per-sample path, and every read of an imported binding is a getter on a module
// object under Vitest's transform, which measured 3 to 5 times slower than the same code in a plain bundle.
const G_X = GroundReg.X;
const G_ABS_X = GroundReg.ABS_X;
const G_CHUNK = GroundReg.CHUNK;
const G_Z_LOCAL = GroundReg.Z_LOCAL;
const G_REACH = GroundReg.REACH;
const G_TOP = GroundReg.TOP;
const G_ROOT = GroundReg.ROOT;
const G_SCALE = GroundReg.SCALE;
const G_K = GroundReg.KEEPOUT_K;
const G_SINK = GroundReg.SINK;
const G_GROUND = GroundReg.GROUND;
const G_Y = GroundReg.Y;
const H_X = HeightReg.X;
const H_IZ = HeightReg.IZ;
const H_ZS = HeightReg.ZS;
const H_Z_LOCAL = HeightReg.Z_LOCAL;
const H_OUT = HeightReg.OUT;
const F_X = PropField.X;
const F_Y = PropField.Y;
const F_Z = PropField.Z_LOCAL;
const F_YAW = PropField.YAW;
const F_SCALE = PropField.SCALE;
const F_KEEP = PropField.KEEP;
const F_TINT = PropField.TINT_SEED;
const F_VARIANT = PropField.VARIANT;
const STRIDE = PROP_STRIDE;
const COUNT = ARCHETYPE_COUNT;
const CHUNK = CHUNK_LEN;
const VALLEY = VALLEY_HALF;
const ZONE = ZONE_CHUNKS;
const FADE = ZONE_FADE_CHUNKS;
const A_RING = Archetype.RING;
const A_PYLON = Archetype.PYLON;
const A_SEARCHLIGHT = Archetype.SEARCHLIGHT;
const A_REFLECTOR = Archetype.REFLECTOR;
const CANYON = Biome.CYBER_CANYON;
const YAW_UNIFORM = YawMode.UNIFORM;
const YAW_NARROW = YawMode.NARROW;
const YAW_FACING = YawMode.FACING;
const draw = drawInto;
const fit = fitKeepOutAt;
const surface = surfaceInto;
const sink = sinkInto;
const coarse = coarseInto;
const rejects = gateRejects;

export interface ScatterTable {
  readonly quota: readonly (readonly number[])[];
  readonly place: readonly Placement[];
  readonly sag: SagTable;
  readonly keepoutK: number;
}

const TAU = 2 * Math.PI;
const GOLDEN = 0.6180339887;
const UNIT_MAX = 0.99999994;
const ZLOCAL_MAX = 63.99999;
const TRIES = 4;
const LANDMARK_CHUNKS = 48;
const SEARCHLIGHT_CHUNKS = 6;
const PYLON_X = 100;
const REFLECTOR_X = 44.5;
const RING_Y = 65.14;
const RING_Z = 32;
const PYLON_KEEP_LEFT = 0.1;
const PYLON_KEEP_RIGHT = 0.6;
const PYLON_WIRE = 0.75;
const PYLON_NO_WIRE = 0.25;
const FADE_START = ZONE_CHUNKS - ZONE_FADE_CHUNKS;

/** Hash slots per archetype per row, before the candidate slots at base = 32 + i * 32 + t * 8. */
const ROW_DITHER = 0;
const ROW_BAND = 2;
const ROW_KEEP = 3;
const ROW_DRAWS = 4;
/** Candidate slots, after base. */
const DRAW_Z = 0;
const DRAW_LATERAL = 1;
const DRAW_SCALE = 2;
const DRAW_HOVER = 3;
const DRAW_YAW = 4;
const DRAW_TINT = 5;
const DRAW_VARIANT = 6;
const DRAW_SOURCE = 7;
const CANDIDATE_DRAWS = 8;

/** Registers past the placement ones: the biome mix at the row centre, the zone, and the row after this one. */
const R_M = GROUND_REGS;
const R_ZONE = GROUND_REGS + 1;
const R_NEXT = GROUND_REGS + 2;
const REGS = GROUND_REGS + 3;
/** Archetype table layout: top, root, scale min, scale span, hover min, hover span, yaw mode, first band. */
const PER = 8;

export function createScatter(seed: number, periodChunks: number, table: Readonly<ScatterTable>, h: HeightCore, zones: Zones): (chunk: number, out: PropRow) => void {
  const quota = new Float64Array(BIOME_COUNT * COUNT);
  for (let b = 0; b < BIOME_COUNT; b++) {
    for (let a = 0; a < COUNT; a++) quota[b * COUNT + a] = table.quota[b]![a]!;
  }
  const sag = flattenSag(table.sag);
  const arch = new Float64Array(COUNT * PER);
  const bandCount = new Int32Array(COUNT);
  let bandTotal = 0;
  for (let a = 0; a < COUNT; a++) bandTotal += table.place[a]!.bands.length;
  const bands = new Float64Array(bandTotal * 3);
  let bo = 0;
  for (let a = 0; a < COUNT; a++) {
    const p = table.place[a]!;
    const o = a * PER;
    arch[o] = p.top;
    arch[o + 1] = p.root;
    arch[o + 2] = p.scale[0];
    arch[o + 3] = p.scale[1] - p.scale[0];
    arch[o + 4] = p.hover[0];
    arch[o + 5] = p.hover[1] - p.hover[0];
    arch[o + 6] = p.yaw;
    arch[o + 7] = bo / 3;
    bandCount[a] = p.bands.length;
    for (let i = 0; i < p.bands.length; i++) {
      const band = p.bands[i]!;
      bands[bo++] = band[0];
      bands[bo++] = band[1];
      bands[bo++] = band[2];
    }
  }
  const maxDist = new Float64Array(COUNT);
  const perChunk = new Int32Array(COUNT);
  const floats = new Uint8Array(COUNT);
  for (let a = 0; a < COUNT; a++) {
    maxDist[a] = ARCHETYPE_SPEC[a]!.maxDist;
    perChunk[a] = ARCHETYPE_SPEC[a]!.perChunk;
    floats[a] = ARCHETYPE_SPEC[a]!.floats ? 1 : 0;
  }
  // A golden-ratio walk per archetype picks each row's starting side. Inside a row, sides alternate. A hash here let a
  // one-per-row archetype stray 6% to one side over 2000 rows; this keeps every archetype balanced at any row count.
  const sidePhase = new Float64Array(COUNT);
  for (let a = 0; a < COUNT; a++) sidePhase[a] = hash01(seed, 0, a, 1);
  const R = new Float64Array(REGS);
  R[G_K] = table.keepoutK;
  const D = new Float64Array(ROW_DRAWS + CANDIDATE_DRAWS);
  const hr = h.regs;
  // Zone memo: z, biome A, biome B.
  const zoneMemo = new Float64Array(3).fill(NaN);

  /** Biome memo of the zone in R_ZONE. */
  function biomesOf(): void {
    const z = R[R_ZONE]!;
    if (zoneMemo[0] === z) return;
    zoneMemo[0] = z;
    zones.biomePair(zoneMemo);
  }

  /** Writes the biome memo and the biome mix at the row centre into R_M, for a reduced chunk given in register reg. */
  function rowMix(reg: number): void {
    const c = R[reg]!;
    const z = Math.floor(c / ZONE);
    R[R_ZONE] = z;
    biomesOf();
    const t = (c - z * ZONE + 0.5 - FADE_START) / FADE;
    const f = t <= 0 ? 0 : t >= 1 ? 1 : t;
    R[R_M] = f * f * (3 - 2 * f);
  }

  /** PYLON's wire flag: does the next row hold a pair? The same formula after period reduction. */
  function nextHasPair(): boolean {
    const c = R[G_CHUNK]!;
    R[R_NEXT] = periodChunks > 0 ? ((c + 1) % periodChunks + periodChunks) % periodChunks : c + 1;
    rowMix(R_NEXT);
    const m = R[R_M]!;
    return (1 - m) * quota[zoneMemo[1]! * COUNT + A_PYLON]! + m * quota[zoneMemo[2]! * COUNT + A_PYLON]! >= 1;
  }

  /** The true height under the candidate, into GROUND. */
  function groundAt(): void {
    hr[H_X] = R[G_X]!;
    hr[H_IZ] = R[G_CHUNK]!;
    hr[H_ZS] = CHUNK;
    hr[H_Z_LOCAL] = R[G_Z_LOCAL]!;
    h.run();
    R[G_GROUND] = hr[H_OUT]!;
  }

  /** Section 5.7's steps for a grounded candidate. Reads X, Z_LOCAL, SCALE. On true, Y and SCALE hold the result. */
  function placeGrounded(a: number, source: number, exempt: boolean): boolean {
    const absX = Math.abs(R[G_X]!);
    R[G_ABS_X] = absX;
    R[G_TOP] = arch[a * PER]!;
    R[G_ROOT] = arch[a * PER + 1]!;
    if (absX <= VALLEY) {
      R[G_Y] = 0;
      if (!exempt) {
        fit(R);
        if (R[G_SCALE] === 0) return false;
      }
      return true;
    }
    groundAt();
    R[G_REACH] = maxDist[a]!;
    surface(R);
    sink(R, sag, source);
    R[G_Y] = R[G_GROUND]! - R[G_SINK]!;
    if (!exempt) {
      fit(R);
      if (R[G_SCALE] === 0) return false;
    }
    coarse(h, R);
    return !rejects(R);
  }

  return function fillProps(chunk: number, out: PropRow): void {
    const c = periodChunks > 0 ? ((chunk % periodChunks) + periodChunks) % periodChunks : chunk;
    const data = out.data;
    const start = out.start;
    R[G_CHUNK] = c;
    rowMix(G_CHUNK);
    const m = R[R_M]!;
    const biomeA = zoneMemo[1]!;
    const biomeB = zoneMemo[2]!;
    let w = 0;
    for (let a = 0; a < COUNT; a++) {
      start[a] = w;
      if (a === A_RING) {
        if (c % LANDMARK_CHUNKS === 0) {
          draw(seed, R, G_CHUNK, a, 32 + DRAW_TINT, D, 0, 2);
          const o = w * STRIDE;
          data[o + F_X] = 0;
          data[o + F_Y] = RING_Y;
          data[o + F_Z] = RING_Z;
          data[o + F_YAW] = 0;
          data[o + F_SCALE] = 1;
          data[o + F_KEEP] = 0;
          data[o + F_TINT] = Math.min(D[0]!, UNIT_MAX);
          data[o + F_VARIANT] = Math.min(D[1]!, UNIT_MAX);
          w++;
        }
        continue;
      }
      const fromA = (1 - m) * quota[biomeA * COUNT + a]!;
      const expected = fromA + m * quota[biomeB * COUNT + a]!;
      if (a === A_PYLON) {
        if (expected >= 1) {
          const wire = nextHasPair() ? PYLON_WIRE : PYLON_NO_WIRE;
          draw(seed, R, G_CHUNK, a, 32 + DRAW_TINT, D, 0, 1);
          draw(seed, R, G_CHUNK, a, 64 + DRAW_TINT, D, 1, 1);
          for (let q = 0; q < 2; q++) {
            const o = w * STRIDE;
            data[o + F_X] = q === 0 ? -PYLON_X : PYLON_X;
            data[o + F_Y] = 0;
            data[o + F_Z] = 0;
            data[o + F_YAW] = 0;
            data[o + F_SCALE] = 1;
            data[o + F_KEEP] = q === 0 ? PYLON_KEEP_LEFT : PYLON_KEEP_RIGHT;
            data[o + F_TINT] = Math.min(D[q]!, UNIT_MAX);
            data[o + F_VARIANT] = wire;
            w++;
          }
        }
        continue;
      }
      if (a === A_SEARCHLIGHT && c % SEARCHLIGHT_CHUNKS !== 0) continue;
      if (expected <= 0) continue;
      draw(seed, R, G_CHUNK, a, 0, D, 0, ROW_DRAWS);
      const dither = D[ROW_DITHER]!;
      let n: number;
      if (a === A_SEARCHLIGHT) n = dither < expected * SEARCHLIGHT_CHUNKS ? 1 : 0;
      else if (a === A_REFLECTOR) n = 2 * Math.round(expected / 2);
      else n = Math.floor(expected + dither);
      if (n > perChunk[a]!) n = perChunk[a]!;
      const rowKeep = D[ROW_KEEP]!;
      if (a === A_REFLECTOR) {
        const pairs = n / 2;
        for (let i = 0; i < n; i++) {
          const zr = Math.fround((Math.floor(i / 2) + 0.5) * CHUNK / pairs);
          draw(seed, R, G_CHUNK, a, 32 + i * 32 + DRAW_TINT, D, 0, 2);
          const kr = rowKeep + i * GOLDEN;
          const o = w * STRIDE;
          data[o + F_X] = ((i & 1) === 0 ? -1 : 1) * REFLECTOR_X;
          data[o + F_Y] = 0;
          data[o + F_Z] = zr;
          data[o + F_YAW] = 0;
          data[o + F_SCALE] = 1;
          data[o + F_KEEP] = Math.min(kr - Math.floor(kr), UNIT_MAX);
          data[o + F_TINT] = Math.min(D[0]!, UNIT_MAX);
          data[o + F_VARIANT] = Math.min(D[1]!, UNIT_MAX);
          w++;
        }
        continue;
      }
      const sideRaw = sidePhase[a]! + c * GOLDEN;
      const sideBase = Math.floor((sideRaw - Math.floor(sideRaw)) * 2);
      const bandBase = D[ROW_BAND]!;
      const po = a * PER;
      const scaleMin = arch[po + 2]!;
      const scaleSpan = arch[po + 3]!;
      const hoverMin = arch[po + 4]!;
      const hoverSpan = arch[po + 5]!;
      const yawMode = arch[po + 6]!;
      const firstBand = arch[po + 7]!;
      const nBands = bandCount[a]!;
      const isFloat = floats[a] === 1;
      const canKeepOut = a !== A_SEARCHLIGHT;
      for (let i = 0; i < n; i++) {
        const kr = rowKeep + i * GOLDEN;
        const sgn = ((i + sideBase) & 1) === 1 ? 1 : -1;
        for (let t = 0; t < TRIES; t++) {
          draw(seed, R, G_CHUNK, a, 32 + i * 32 + t * 8, D, ROW_DRAWS, CANDIDATE_DRAWS);
          const zLocal = Math.fround(Math.min((i + D[ROW_DRAWS + DRAW_Z]!) / n * CHUNK, ZLOCAL_MAX));
          // A golden-ratio walk through the band weights keeps the proportions stable inside every row.
          const rRaw = bandBase + i * GOLDEN + t * 0.37;
          const r = rRaw - Math.floor(rRaw);
          let band = firstBand;
          let cum = bands[band * 3 + 2]!;
          for (let b = 1; b < nBands && r >= cum; b++) {
            band = firstBand + b;
            cum += bands[band * 3 + 2]!;
          }
          const lo = bands[band * 3]!;
          const hi = bands[band * 3 + 1]!;
          const x = Math.fround(sgn * (lo + D[ROW_DRAWS + DRAW_LATERAL]! * (hi - lo)));
          R[G_X] = x;
          R[G_Z_LOCAL] = zLocal;
          R[G_SCALE] = scaleMin + D[ROW_DRAWS + DRAW_SCALE]! * scaleSpan;
          if (isFloat) {
            groundAt();
            R[G_Y] = R[G_GROUND]! + hoverMin + D[ROW_DRAWS + DRAW_HOVER]! * hoverSpan;
          } else {
            // The biome this candidate is drawn from sets its sag class and the Canyon exemption.
            const source = D[ROW_DRAWS + DRAW_SOURCE]! * expected < fromA ? biomeA : biomeB;
            if (!placeGrounded(a, source, !canKeepOut || source === CANYON)) continue;
          }
          const yawDraw = D[ROW_DRAWS + DRAW_YAW]!;
          const o = w * STRIDE;
          data[o + F_X] = x;
          data[o + F_Y] = R[G_Y]!;
          data[o + F_Z] = zLocal;
          data[o + F_YAW] = yawMode === YAW_UNIFORM ? yawDraw * TAU
            : yawMode === YAW_NARROW ? -0.35 + 0.7 * yawDraw
              : yawMode === YAW_FACING ? -sgn * (0.2 + 0.3 * yawDraw)
                : 0;
          data[o + F_SCALE] = R[G_SCALE]!;
          data[o + F_KEEP] = Math.min(kr - Math.floor(kr), UNIT_MAX);
          data[o + F_TINT] = Math.min(D[ROW_DRAWS + DRAW_TINT]!, UNIT_MAX);
          data[o + F_VARIANT] = Math.min(D[ROW_DRAWS + DRAW_VARIANT]!, UNIT_MAX);
          w++;
          break;
        }
      }
    }
    start[COUNT] = w;
    data.fill(0, w * STRIDE);
    out.chunk = chunk;
  };
}
