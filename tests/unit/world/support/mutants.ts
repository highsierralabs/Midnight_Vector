// Deliberately broken octaves on the real gradP, so only the fault differs. They prove the noise metrics can fail.
import type { Noise } from '../../../../src/world/noise';

export interface OctFn { (x: number, iz: number, zs: number, zLocal: number, wl: number): number }

/** The simplex-noise failure class: the cell is forced through int32, and the fraction is taken from the wrapped cell. */
export function octInt32(n: Noise): OctFn {
  return (x, iz, zs, zLocal, wl) => {
    const z = iz * zs + zLocal;
    const zc = Math.floor(z / wl) | 0;
    const fz = z / wl - zc;
    if (fz > 1 || fz < 0) return 0;
    const xf = x / wl;
    const xc = Math.floor(xf);
    return n.gradP(xc, xf - xc, zc, fz, 0);
  };
}

/** A plain double world z. Alive at every distance, but steps smaller than the ulp vanish. */
export function octNaive(n: Noise): OctFn {
  return (x, iz, zs, zLocal, wl) => {
    const z = iz * zs + zLocal;
    const zc = Math.floor(z / wl);
    const fz = z / wl - zc;
    const xf = x / wl;
    const xc = Math.floor(xf);
    return n.gradP(xc, xf - xc, zc, fz, 0);
  };
}

/** The correct cell, with the high word dropped before hashing, so cells 2^32 apart alias. */
export function octLoHash(n: Noise): OctFn {
  return (x, iz, zs, zLocal, wl) => {
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
    return n.gradP(xc, xf - xc, zc % 2 ** 32, fz, 0);
  };
}
