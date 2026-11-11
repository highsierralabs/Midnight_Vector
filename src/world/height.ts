// src/world/height.ts -- section 5.2. The single source of truth for ground, in doubles. The biome parameters crossfade
// as a pure function of the row's exact z, so height stays continuous across zones and chunks. A row evaluates its mix
// once, through a one-entry memo that cannot change a result.
// Callers inside the world use run and regs, so no double crosses a call boundary (Agents.md, hot paths).
import { BIOME_COUNT, CHUNK_LEN, VALLEY_HALF, ZONE_CHUNKS, ZONE_FADE_CHUNKS } from '../contracts/index';
import { TERRAIN, type TerrainParams } from './biomes';
import { NoiseReg, type Noise } from './noise';
import { smooth, type Zones } from './zones';

// Hoisted from the imports. This is the per-sample path, and every read of an imported binding is a getter on a module
// object under Vitest's transform, which measured 3 to 5 times slower than the same code in a plain bundle.
const VALLEY = VALLEY_HALF;
const CHUNK = CHUNK_LEN;
const ZONE = ZONE_CHUNKS;
const FADE = ZONE_FADE_CHUNKS;
const N_X = NoiseReg.X;
const N_IZ = NoiseReg.IZ;
const N_ZS = NoiseReg.ZS;
const N_Z_LOCAL = NoiseReg.Z_LOCAL;
const N_GAIN = NoiseReg.GAIN;
const N_OUT = NoiseReg.OUT;

export type { TerrainParams } from './biomes';
export type HeightFn = (x: number, iz: number, zs: number, zLocal: number) => number;

export const HeightReg = { X: 0, IZ: 1, ZS: 2, Z_LOCAL: 3, OUT: 4 } as const;

/** Height through registers: write x, iz, zs, zLocal, call run, read OUT. Allocates nothing. */
export interface HeightCore {
  readonly regs: Float64Array;
  run(): void;
}
export interface Height extends HeightCore {
  /** The same value as run, through arguments. This is WorldSource.height. */
  readonly at: HeightFn;
}

const ENVELOPE_START = 260;
const ENVELOPE_WIDTH = 1100;

/** Section 5.2 with fixed params. Pure. The golden and the statistics tests call this, so biome tuning cannot break them. */
export function heightWith(n: Noise, p: Readonly<TerrainParams>, x: number, iz: number, zs: number, zLocal: number): number {
  const d = Math.abs(x);
  const k = smooth((d - VALLEY_HALF) / p.rise);
  if (k === 0) return 0;
  let a = 1;
  let wl = 512;
  let v = 0;
  let w = 0;
  for (let o = 0; o < 5; o++) {
    const q = 1 - Math.abs(n.oct(x + 37, iz, zs, zLocal, wl)) * 1.6;
    v += a * q * q;
    w += a;
    a *= p.gain;
    wl /= 2;
  }
  return k * (v / w) * (p.a0 + p.a1 * smooth((d - ENVELOPE_START) / ENVELOPE_WIDTH));
}

/** terrain is for tests and T11's probes only. Real worlds use the TERRAIN table. */
export function createHeight(n: Noise, zones: Zones, periodChunks: number, terrain: readonly Readonly<TerrainParams>[] = TERRAIN): Height {
  const T = new Float64Array(BIOME_COUNT * 4);
  for (let b = 0; b < BIOME_COUNT; b++) {
    const p = terrain[b]!;
    T[b * 4] = p.rise;
    T[b * 4 + 1] = p.a0;
    T[b * 4 + 2] = p.a1;
    T[b * 4 + 3] = p.gain;
  }
  const regs = new Float64Array(5);
  const nr = n.regs;
  // Row memo: iz, zs, zLocal, then rise, a0, a1, gain. Zone memo: z, biome A, biome B, then the z asked for.
  const row = new Float64Array(7).fill(NaN);
  const zoneMemo = new Float64Array(4).fill(NaN);

  function fillRow(): void {
    const iz = regs[HeightReg.IZ]!;
    const zs = regs[HeightReg.ZS]!;
    const zLocal = regs[HeightReg.Z_LOCAL]!;
    let c: number;
    let frac: number;
    if (zs <= CHUNK) {
      const ra = CHUNK / zs;
      const q = Math.floor(iz / ra);
      const rem = iz - q * ra;
      const pos = (rem * zs + zLocal) / CHUNK;
      const fl = Math.floor(pos);
      c = q + fl;
      frac = pos - fl;
    } else {
      const ra = zs / CHUNK;
      const pos = zLocal / CHUNK;
      const fl = Math.floor(pos);
      c = iz * ra + fl;
      frac = pos - fl;
    }
    if (periodChunks > 0) c = ((c % periodChunks) + periodChunks) % periodChunks;
    const z = Math.floor(c / ZONE);
    const into = c - z * ZONE + frac;
    const t = (into - (ZONE - FADE)) / FADE;
    const f = t <= 0 ? 0 : t >= 1 ? 1 : t;
    const m = f * f * (3 - 2 * f);
    if (zoneMemo[3] !== z) {
      zoneMemo[3] = z;
      zoneMemo[0] = z;
      zones.biomePair(zoneMemo);
    }
    const ao = zoneMemo[1]! * 4;
    const bo = zoneMemo[2]! * 4;
    row[0] = iz;
    row[1] = zs;
    row[2] = zLocal;
    row[3] = T[ao]! + (T[bo]! - T[ao]!) * m;
    row[4] = T[ao + 1]! + (T[bo + 1]! - T[ao + 1]!) * m;
    row[5] = T[ao + 2]! + (T[bo + 2]! - T[ao + 2]!) * m;
    row[6] = T[ao + 3]! + (T[bo + 3]! - T[ao + 3]!) * m;
  }

  function run(): void {
    const x = regs[HeightReg.X]!;
    const d = Math.abs(x);
    if (d <= VALLEY) {
      regs[HeightReg.OUT] = 0;
      return;
    }
    if (row[0] !== regs[HeightReg.IZ] || row[1] !== regs[HeightReg.ZS] || row[2] !== regs[HeightReg.Z_LOCAL]) fillRow();
    const tk = (d - VALLEY) / row[3]!;
    const fk = tk >= 1 ? 1 : tk;
    const k = fk * fk * (3 - 2 * fk);
    if (k === 0) {
      regs[HeightReg.OUT] = 0;
      return;
    }
    nr[N_X] = x;
    nr[N_IZ] = regs[HeightReg.IZ]!;
    nr[N_ZS] = regs[HeightReg.ZS]!;
    nr[N_Z_LOCAL] = regs[HeightReg.Z_LOCAL]!;
    nr[N_GAIN] = row[6]!;
    n.ridged();
    const te = (d - ENVELOPE_START) / ENVELOPE_WIDTH;
    const fe = te <= 0 ? 0 : te >= 1 ? 1 : te;
    regs[HeightReg.OUT] = k * nr[N_OUT]! * (row[4]! + row[5]! * (fe * fe * (3 - 2 * fe)));
  }

  function at(x: number, iz: number, zs: number, zLocal: number): number {
    regs[HeightReg.X] = x;
    regs[HeightReg.IZ] = iz;
    regs[HeightReg.ZS] = zs;
    regs[HeightReg.Z_LOCAL] = zLocal;
    run();
    return regs[HeightReg.OUT]!;
  }

  return { at, regs, run };
}
