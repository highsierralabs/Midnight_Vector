// src/world/noise.ts -- section 4.4 lattice gradient noise, seeded gradient table.
// World z is split into an integer cell plus a fraction, and the hash reads the high and low words of the cell,
// so every octave stays exact and non-flat up to 2^53. The body of oct, gradP and hsh is section 4.4's text.
// ridged is the same arithmetic inlined by hand into the octave loop. A double through a non-inlined call is boxed
// (Agents.md, hot paths), and height runs this per sample, so it takes and gives its numbers through regs.
import { hash01 } from '../core/hash';

const W32 = 4294967296;
const OCTAVES = 5;
const LOWEST_WL = 512;
/** Added to x so the road's axis is not a lattice line. */
const X_SHIFT = 37;
const RIDGE = 1.6;

export const NoiseReg = { X: 0, IZ: 1, ZS: 2, Z_LOCAL: 3, GAIN: 4, OUT: 5 } as const;

export interface Noise {
  /** One octave at (x, iz * zs + zLocal). zs and wl are powers of two, iz is integer-valued and may be negative. Bounded by 1. */
  oct(x: number, iz: number, zs: number, zLocal: number, wl: number): number;
  /** The corner evaluation. Exposed so the test mutants change only the fault, not this. */
  gradP(ix: number, fx: number, iz: number, fz: number, P: number): number;
  /** In and out registers of ridged, addressed by NoiseReg. */
  readonly regs: Float64Array;
  /** Normalised sum over 5 octaves of a * (1 - 1.6 * abs(oct(x + 37, ...)))^2, as in section 5.2. Reads regs, writes regs[OUT]. Allocates nothing. */
  ridged(): void;
}

export function createNoise(seed: number, periodChunks: number): Noise {
  const GX = new Float64Array(256);
  const GZ = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const t = hash01(seed, 0, 0x4E01, i) * 2 * Math.PI;
    GX[i] = Math.cos(t);
    GZ[i] = Math.sin(t);
  }
  const period = periodChunks;
  const regs = new Float64Array(6);

  function hsh(ix: number, iz: number): number {
    const lo = (iz % W32) | 0;
    const hi = Math.floor(iz / W32) | 0;
    let m = Math.imul(lo, 0x9E3779B1) ^ Math.imul(hi, 0x85EBCA77) ^ Math.imul(ix, 0xC2B2AE3D);
    m ^= m >>> 15;
    m = Math.imul(m, 0x2C1B3C6D);
    m ^= m >>> 13;
    return m & 255;
  }

  // Quintic fade and no extra scaling: the statistics in section 5.2 and 5.7 depend on this amplitude.
  function gradP(ix: number, fx: number, iz: number, fz: number, P: number): number {
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
    const z1 = P > 0 ? (iz + 1) % P : iz + 1;
    const a = hsh(ix, iz);
    const b = hsh(ix + 1, iz);
    const c = hsh(ix, z1);
    const d = hsh(ix + 1, z1);
    const n00 = GX[a]! * fx + GZ[a]! * fz;
    const n10 = GX[b]! * (fx - 1) + GZ[b]! * fz;
    const n01 = GX[c]! * fx + GZ[c]! * (fz - 1);
    const n11 = GX[d]! * (fx - 1) + GZ[d]! * (fz - 1);
    const k0 = n00 + (n10 - n00) * u;
    const k1 = n01 + (n11 - n01) * u;
    return k0 + (k1 - k0) * v;
  }

  function oct(x: number, iz: number, zs: number, zLocal: number, wl: number): number {
    let zc: number;
    let fz: number;
    if (wl >= zs) {
      const ra = wl / zs;
      const q = Math.floor(iz / ra);
      const rem = iz - q * ra;
      const fr = (rem * zs + zLocal) / wl;
      const fl = Math.floor(fr);
      zc = q + fl;
      fz = fr - fl;
    } else {
      const ra = zs / wl;
      const fr = zLocal / wl;
      const fl = Math.floor(fr);
      zc = iz * ra + fl;
      fz = fr - fl;
    }
    const xf = x / wl;
    const xc = Math.floor(xf);
    if (period > 0) {
      const P = period * 64 / wl;
      zc = ((zc % P) + P) % P;
      return gradP(xc, xf - xc, zc, fz, P);
    }
    return gradP(xc, xf - xc, zc, fz, 0);
  }

  // The z half of every octave is shared by a whole row, so it is kept for the last row asked for. It cannot change a result.
  const rowKey = new Float64Array(3).fill(NaN);
  const rowHash = new Int32Array(OCTAVES * 2);
  const rowZ = new Float64Array(OCTAVES * 2);

  function fillRowZ(): void {
    const iz = regs[NoiseReg.IZ]!;
    const zs = regs[NoiseReg.ZS]!;
    const zLocal = regs[NoiseReg.Z_LOCAL]!;
    rowKey[0] = iz;
    rowKey[1] = zs;
    rowKey[2] = zLocal;
    let wl = LOWEST_WL;
    for (let o = 0; o < OCTAVES; o++) {
      let zc: number;
      let fz: number;
      if (wl >= zs) {
        const ra = wl / zs;
        const q = Math.floor(iz / ra);
        const rem = iz - q * ra;
        const fr = (rem * zs + zLocal) / wl;
        const fl = Math.floor(fr);
        zc = q + fl;
        fz = fr - fl;
      } else {
        const ra = zs / wl;
        const fr = zLocal / wl;
        const fl = Math.floor(fr);
        zc = iz * ra + fl;
        fz = fr - fl;
      }
      let z1: number;
      if (period > 0) {
        const P = period * 64 / wl;
        zc = ((zc % P) + P) % P;
        z1 = (zc + 1) % P;
      } else {
        z1 = zc + 1;
      }
      // hsh's words. zc - hi * W32 is congruent to zc % W32 modulo 2^32, so ToInt32 gives the same word, without fmod.
      const hi0 = Math.floor(zc / W32);
      const hi1 = Math.floor(z1 / W32);
      rowHash[o * 2] = Math.imul((zc - hi0 * W32) | 0, 0x9E3779B1) ^ Math.imul(hi0 | 0, 0x85EBCA77);
      rowHash[o * 2 + 1] = Math.imul((z1 - hi1 * W32) | 0, 0x9E3779B1) ^ Math.imul(hi1 | 0, 0x85EBCA77);
      rowZ[o * 2] = fz;
      rowZ[o * 2 + 1] = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
      wl /= 2;
    }
  }

  function ridged(): void {
    const xs = regs[NoiseReg.X]! + X_SHIFT;
    const gain = regs[NoiseReg.GAIN]!;
    if (rowKey[0] !== regs[NoiseReg.IZ] || rowKey[1] !== regs[NoiseReg.ZS] || rowKey[2] !== regs[NoiseReg.Z_LOCAL]) fillRowZ();
    let amp = 1;
    let wl = LOWEST_WL;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < OCTAVES; o++) {
      const xf = xs / wl;
      const xc = Math.floor(xf);
      const fx = xf - xc;
      const fz = rowZ[o * 2]!;
      const v = rowZ[o * 2 + 1]!;
      const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
      const row0 = rowHash[o * 2]!;
      const row1 = rowHash[o * 2 + 1]!;
      const col0 = Math.imul(xc, 0xC2B2AE3D);
      const col1 = Math.imul(xc + 1, 0xC2B2AE3D);
      let a = row0 ^ col0;
      a ^= a >>> 15;
      a = Math.imul(a, 0x2C1B3C6D);
      a ^= a >>> 13;
      a &= 255;
      let b = row0 ^ col1;
      b ^= b >>> 15;
      b = Math.imul(b, 0x2C1B3C6D);
      b ^= b >>> 13;
      b &= 255;
      let c = row1 ^ col0;
      c ^= c >>> 15;
      c = Math.imul(c, 0x2C1B3C6D);
      c ^= c >>> 13;
      c &= 255;
      let d = row1 ^ col1;
      d ^= d >>> 15;
      d = Math.imul(d, 0x2C1B3C6D);
      d ^= d >>> 13;
      d &= 255;
      const n00 = GX[a]! * fx + GZ[a]! * fz;
      const n10 = GX[b]! * (fx - 1) + GZ[b]! * fz;
      const n01 = GX[c]! * fx + GZ[c]! * (fz - 1);
      const n11 = GX[d]! * (fx - 1) + GZ[d]! * (fz - 1);
      const k0 = n00 + (n10 - n00) * u;
      const k1 = n01 + (n11 - n01) * u;
      const value = k0 + (k1 - k0) * v;
      const q = 1 - Math.abs(value) * RIDGE;
      sum += amp * q * q;
      norm += amp;
      amp *= gain;
      wl /= 2;
    }
    regs[NoiseReg.OUT] = sum / norm;
  }

  return { oct, gradP, regs, ridged };
}
