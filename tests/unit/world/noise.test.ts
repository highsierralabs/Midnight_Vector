import { describe, expect, it } from 'vitest';
import { NoiseReg, createNoise } from '../../../src/world/noise';
import { octInt32, octLoHash, octNaive, type OctFn } from './support/mutants';
import { octaveReport } from './support/metrics';

const WLS = [512, 256, 128, 64, 32] as const;
const noise = createNoise(1985, 0);
const real: OctFn = (x, iz, zs, zLocal, wl) => noise.oct(x, iz, zs, zLocal, wl);

function assertAlive(D: number): void {
  for (const wl of WLS) {
    const r = octaveReport(real, D, wl);
    expect(r.range, `range at ${D} wl ${wl}`).toBeGreaterThanOrEqual(0.5);
    expect(r.zeroFrac, `zeroFrac at ${D} wl ${wl}`).toBeLessThan(0.01);
    expect(r.outOfBounds, `bounds at ${D} wl ${wl}`).toBe(0);
  }
}

describe('noise goldens', () => {
  const cases: readonly (readonly [number, number, number, number, number, number])[] = [
    [437.25, 1000, 2, 0.5, 512, 0.07184933147057126],
    [437.25, 1000, 2, 0.5, 32, -0.5145153581947712],
    [-1212.5, 15625000, 64, 3.25, 128, -0.15316878872587994],
    [1287.5, 500000000, 2, 1.25, 256, -0.009746942939047648],
    [150.75, 500000000000, 2, 0.75, 64, -0.08922293236122636],
    [150.75, 500000000000000, 2, 0.75, 32, -0.14889955578140582],
    [2000.125, 2 ** 52, 2, 1.5, 512, -0.07321358019691425],
  ];
  for (const [x, iz, zs, zLocal, wl, value] of cases) {
    it(`oct(${x}, ${iz}, ${zs}, ${zLocal}, ${wl})`, () => {
      expect(noise.oct(x, iz, zs, zLocal, wl)).toBe(value);
    });
  }
});

describe('noise at huge distance', () => {
  it('per octave non-flat at 1e9', () => assertAlive(1e9));
  it('per octave non-flat at 1e12', () => assertAlive(1e12));
  it('per octave non-flat at 1e15', () => assertAlive(1e15));
  it('per octave non-flat at 1.8e16', () => assertAlive(1.8e16));

  it('fine step at 1e15', () => {
    for (const D of [1e9, 1e12, 1e15, 1.8e16]) {
      for (const wl of WLS) {
        expect(octaveReport(real, D, wl).eqStep, `eqStep at ${D} wl ${wl}`).toBeLessThan(0.01);
      }
    }
  });

  it('no high-word alias', () => {
    for (const wl of WLS) {
      let equal = 0;
      for (let i = 0; i < 500; i++) {
        const x = 187.3 + i * 3.7;
        const iz = 1000 + i;
        if (noise.oct(x, iz, 2, 0.5, wl) === noise.oct(x, iz + 2 ** 32 * (wl / 2), 2, 0.5, wl)) equal++;
      }
      expect(equal, `aliased samples at wl ${wl}`).toBe(0);
    }
  });

  it('wraps exactly at its period', () => {
    const periodic = createNoise(1985, 1024);
    for (const wl of WLS) {
      const P = 1024 * 64 / wl;
      for (let i = 0; i < 200; i++) {
        const x = 187.3 + i * 3.7;
        const iz = 1000 + i * 13;
        const zLocal = (i % 16) / 8;
        expect(periodic.oct(x, iz + P * (wl / 2), 2, zLocal, wl)).toBe(periodic.oct(x, iz, 2, zLocal, wl));
      }
    }
  });

  it('any split of the same point gives the identical double', () => {
    for (const wl of WLS) {
      for (let i = 0; i < 200; i++) {
        const x = 300.5 + i;
        // World z = 2^40 + 64 * i + 16, through spacing 2, 16 and 64.
        const baseChunk = 2 ** 34 + i;
        const a = noise.oct(x, baseChunk * 32 + 8, 2, 0, wl);
        const b = noise.oct(x, baseChunk * 4 + 1, 16, 0, wl);
        const c = noise.oct(x, baseChunk, 64, 16, wl);
        expect(b).toBe(a);
        expect(c).toBe(a);
      }
    }
  });
});

describe('ridged, the inlined octave loop', () => {
  /** Section 5.2's loop over the verbatim oct. */
  function byOct(n: typeof noise, x: number, iz: number, zs: number, zLocal: number, gain: number): number {
    let a = 1;
    let wl = 512;
    let v = 0;
    let w = 0;
    for (let o = 0; o < 5; o++) {
      const q = 1 - Math.abs(n.oct(x + 37, iz, zs, zLocal, wl)) * 1.6;
      v += a * q * q;
      w += a;
      a *= gain;
      wl /= 2;
    }
    return v / w;
  }

  it('equals the sum over oct by toBe, at every distance, spacing and period', () => {
    for (const period of [0, 1024]) {
      const n = createNoise(1985, period);
      const r = n.regs;
      let compared = 0;
      for (const base of [0, 15625000, 1.5625e10, 1.5625e13, 2 ** 47, -40]) {
        for (const zs of [2, 4, 16, 64, 128, 256, 1024]) {
          for (let i = 0; i < 40; i++) {
            const x = 86.5 + i * 97.25;
            const iz = Math.floor(base * 64 / zs) + i * 3;
            const zLocal = (i % 8) / 8 * zs;
            const gain = i % 2 === 0 ? 0.52 : 0.46;
            r[NoiseReg.X] = x;
            r[NoiseReg.IZ] = iz;
            r[NoiseReg.ZS] = zs;
            r[NoiseReg.Z_LOCAL] = zLocal;
            r[NoiseReg.GAIN] = gain;
            n.ridged();
            expect(r[NoiseReg.OUT]).toBe(byOct(n, x, iz, zs, zLocal, gain));
            compared++;
          }
        }
      }
      expect(compared).toBe(6 * 7 * 40);
    }
  });

  it('the row cache cannot change a result: the same row after another, and after a neighbour in each key field', () => {
    const n = createNoise(1985, 0);
    const r = n.regs;
    const at = (x: number, iz: number, zs: number, zLocal: number): number => {
      r[NoiseReg.X] = x;
      r[NoiseReg.IZ] = iz;
      r[NoiseReg.ZS] = zs;
      r[NoiseReg.Z_LOCAL] = zLocal;
      r[NoiseReg.GAIN] = 0.52;
      n.ridged();
      return r[NoiseReg.OUT]!;
    };
    for (let i = 0; i < 300; i++) {
      const x = 90.5 + i * 11;
      const iz = 2 ** 33 + (i % 7);
      const want = byOct(n, x, iz, 2, 0.5, 0.52);
      expect(at(x, iz, 2, 0.5)).toBe(want);
      expect(at(x + 1, iz, 2, 0.5)).toBe(byOct(n, x + 1, iz, 2, 0.5, 0.52));
      // Each neighbour differs from the call before it, which is the cached row, in exactly one key field:
      // (iz, 2, .5) -> (iz, 2, 1.5) zLocal, -> (iz, 4, 1.5) zs, -> (iz + 1, 4, 1.5) iz. A key that drops any one field fails its line.
      expect(at(x, iz, 2, 1.5), `zLocal neighbour at ${i}`).toBe(byOct(n, x, iz, 2, 1.5, 0.52));
      expect(at(x, iz, 4, 1.5), `zs neighbour at ${i}`).toBe(byOct(n, x, iz, 4, 1.5, 0.52));
      expect(at(x, iz + 1, 4, 1.5), `iz neighbour at ${i}`).toBe(byOct(n, x, iz + 1, 4, 1.5, 0.52));
      expect(at(x, iz, 2, 0.5), `back to the first row at ${i}`).toBe(want);
    }
  });
});

describe('the metrics catch each mutant', () => {
  const int32 = octInt32(noise);
  const naive = octNaive(noise);
  const loHash = octLoHash(noise);

  it('octInt32 passes every rule at 1e9, which is why 1e9 alone is not enough', () => {
    for (const wl of WLS) {
      const r = octaveReport(int32, 1e9, wl);
      expect(r.range).toBeGreaterThanOrEqual(0.5);
      expect(r.zeroFrac).toBeLessThan(0.01);
      expect(r.eqStep).toBeLessThan(0.01);
    }
  });

  it('octInt32 is flat at wl 256 to 32 at 1e12, with only wl 512 alive', () => {
    expect(octaveReport(int32, 1e12, 512).range).toBeGreaterThanOrEqual(0.5);
    for (const wl of [256, 128, 64, 32]) {
      const r = octaveReport(int32, 1e12, wl);
      expect(r.range, `range at wl ${wl}`).toBeLessThan(0.5);
      expect(r.zeroFrac, `zeroFrac at wl ${wl}`).toBeGreaterThanOrEqual(0.01);
    }
  });

  it('octInt32 is flat at every wl at 1e15', () => {
    for (const wl of WLS) {
      const r = octaveReport(int32, 1e15, wl);
      expect(r.range, `range at wl ${wl}`).toBeLessThan(0.5);
      expect(r.zeroFrac, `zeroFrac at wl ${wl}`).toBeGreaterThanOrEqual(0.01);
    }
  });

  it('octNaive passes range and fails the fine step at 1e15', () => {
    for (const wl of WLS) {
      const r = octaveReport(naive, 1e15, wl);
      expect(r.range, `range at wl ${wl}`).toBeGreaterThanOrEqual(0.5);
      expect(r.eqStep, `eqStep at wl ${wl}`).toBeGreaterThanOrEqual(0.01);
    }
    expect(octaveReport(naive, 1e12, 128).eqStep).toBeLessThan(0.01);
  });

  it('octLoHash aliases every sample 2^32 cells apart', () => {
    for (const wl of WLS) {
      let equal = 0;
      for (let i = 0; i < 500; i++) {
        const x = 187.3 + i * 3.7;
        const iz = 1000 + i;
        if (loHash(x, iz, 2, 0.5, wl) === loHash(x, iz + 2 ** 32 * (wl / 2), 2, 0.5, wl)) equal++;
      }
      expect(equal, `aliased samples at wl ${wl}`).toBe(500);
    }
  });
});
