import { describe, expect, it } from 'vitest';
import { PALETTE_COUNT, PALETTE_FLOATS, PaletteId } from '../../../src/contracts/index';
import { PALETTE_HEX, mixPalette, writePalette } from '../../../src/world/palettes';

const SLOTS = 7;
const GRID = 5;
const ACCENT = 6;

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}
function hexLinear(hex: string): [number, number, number] {
  return [
    srgbToLinear(parseInt(hex.slice(1, 3), 16) / 255),
    srgbToLinear(parseInt(hex.slice(3, 5), 16) / 255),
    srgbToLinear(parseInt(hex.slice(5, 7), 16) / 255),
  ];
}
/** HSV saturation of a linear colour, measured in sRGB. */
function saturation(r: number, g: number, b: number): number {
  const R = linearToSrgb(r);
  const G = linearToSrgb(g);
  const B = linearToSrgb(b);
  const hi = Math.max(R, G, B);
  const lo = Math.min(R, G, B);
  return hi === 0 ? 0 : (hi - lo) / hi;
}
function cbrt3(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}
function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
  const l = L + 0.3963377774 * a + 0.2158037573 * b;
  const m = L - 0.1055613458 * a - 0.0638541728 * b;
  const s = L - 0.0894841775 * a - 1.2914855480 * b;
  const l3 = l * l * l;
  const m3 = m * m * m;
  const s3 = s * s * s;
  return [
    Math.min(1, Math.max(0, 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3)),
    Math.min(1, Math.max(0, -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3)),
    Math.min(1, Math.max(0, -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3)),
  ];
}

describe('palettes', () => {
  it('writePalette equals the section 6.8 hex conversion, and has PALETTE_FLOATS values', () => {
    expect(PALETTE_FLOATS).toBe(21);
    const out = new Float32Array(PALETTE_FLOATS);
    for (let p = 0; p < PALETTE_COUNT; p++) {
      writePalette(p, out);
      for (let s = 0; s < SLOTS; s++) {
        const [r, g, b] = hexLinear(PALETTE_HEX[p]![s]!);
        expect(Math.abs(out[s * 3]! - r)).toBeLessThan(1e-6);
        expect(Math.abs(out[s * 3 + 1]! - g)).toBeLessThan(1e-6);
        expect(Math.abs(out[s * 3 + 2]! - b)).toBeLessThan(1e-6);
      }
    }
  });

  it('Sunset Drive horizon #FD3777 is .98225, .03820, .18447', () => {
    const out = new Float32Array(PALETTE_FLOATS);
    writePalette(PaletteId.SUNSET_DRIVE, out);
    expect(Math.abs(out[6]! - 0.98225)).toBeLessThan(1e-4);
    expect(Math.abs(out[7]! - 0.03820)).toBeLessThan(1e-4);
    expect(Math.abs(out[8]! - 0.18447)).toBeLessThan(1e-4);
  });

  it('the mix lands on its endpoints, within 1e-6', () => {
    const a = new Float32Array(PALETTE_FLOATS);
    const b = new Float32Array(PALETTE_FLOATS);
    const mixed = new Float32Array(PALETTE_FLOATS);
    for (let p = 0; p < PALETTE_COUNT; p++) {
      for (let q = 0; q < PALETTE_COUNT; q++) {
        writePalette(p, a);
        writePalette(q, b);
        mixPalette(p, q, 0, mixed);
        for (let i = 0; i < PALETTE_FLOATS; i++) expect(Math.abs(mixed[i]! - a[i]!)).toBeLessThan(1e-6);
        mixPalette(p, q, 1, mixed);
        for (let i = 0; i < PALETTE_FLOATS; i++) expect(Math.abs(mixed[i]! - b[i]!)).toBeLessThan(1e-6);
      }
    }
  });

  it('the mix approaches its endpoints continuously', () => {
    const a = new Float32Array(PALETTE_FLOATS);
    const b = new Float32Array(PALETTE_FLOATS);
    const near = new Float32Array(PALETTE_FLOATS);
    let worst = 0;
    for (let p = 0; p < PALETTE_COUNT; p++) {
      for (let q = 0; q < PALETTE_COUNT; q++) {
        if (p === q) continue;
        writePalette(p, a);
        writePalette(q, b);
        mixPalette(p, q, 1e-5, near);
        for (let i = 0; i < PALETTE_FLOATS; i++) worst = Math.max(worst, Math.abs(near[i]! - a[i]!));
        mixPalette(p, q, 1 - 1e-5, near);
        for (let i = 0; i < PALETTE_FLOATS; i++) worst = Math.max(worst, Math.abs(near[i]! - b[i]!));
      }
    }
    expect(worst).toBeLessThan(2e-4);
  });

  it('all 30 ordered pairs, 21 steps: finite and in [0, 1]', () => {
    const out = new Float32Array(PALETTE_FLOATS);
    let pairs = 0;
    for (let p = 0; p < PALETTE_COUNT; p++) {
      for (let q = 0; q < PALETTE_COUNT; q++) {
        if (p === q) continue;
        pairs++;
        for (let k = 0; k <= 20; k++) {
          mixPalette(p, q, k / 20, out);
          for (let i = 0; i < PALETTE_FLOATS; i++) {
            expect(Number.isFinite(out[i]!)).toBe(true);
            expect(out[i]!).toBeGreaterThanOrEqual(0);
            expect(out[i]!).toBeLessThanOrEqual(1);
          }
        }
      }
    }
    expect(pairs).toBe(30);
  });

  it('grid and accent stay saturated through a crossfade: at least .40, all 30 pairs at .25, .5, .75', () => {
    const out = new Float32Array(PALETTE_FLOATS);
    let worst = 1;
    for (let p = 0; p < PALETTE_COUNT; p++) {
      for (let q = 0; q < PALETTE_COUNT; q++) {
        if (p === q) continue;
        for (const m of [0.25, 0.5, 0.75]) {
          mixPalette(p, q, m, out);
          for (const s of [GRID, ACCENT]) {
            worst = Math.min(worst, saturation(out[s * 3]!, out[s * 3 + 1]!, out[s * 3 + 2]!));
          }
        }
      }
    }
    expect(worst).toBeGreaterThanOrEqual(0.40);
  });

  it('negative control: a straight OKLab mix reads worst under .25, so the metric can fail', () => {
    let worst = 1;
    for (let p = 0; p < PALETTE_COUNT; p++) {
      for (let q = 0; q < PALETTE_COUNT; q++) {
        if (p === q) continue;
        for (const m of [0.25, 0.5, 0.75]) {
          for (const s of [GRID, ACCENT]) {
            const [ar, ag, ab] = hexLinear(PALETTE_HEX[p]![s]!);
            const [br, bg, bb] = hexLinear(PALETTE_HEX[q]![s]!);
            const A = cbrt3(ar, ag, ab);
            const B = cbrt3(br, bg, bb);
            const [r, g, b] = oklabToLinear(A[0] + (B[0] - A[0]) * m, A[1] + (B[1] - A[1]) * m, A[2] + (B[2] - A[2]) * m);
            worst = Math.min(worst, saturation(r, g, b));
          }
        }
      }
    }
    expect(worst).toBeLessThan(0.25);
  });
});
