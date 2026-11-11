// src/world/palettes.ts -- section 6.8. Authored in sRGB, uploaded linear, crossfaded on the CPU in OKLCh, per slot.
// T11 may retune this file. Matrices are Bjorn Ottosson's OKLab.
import { PALETTE_COUNT, PALETTE_FLOATS } from '../contracts/index';

const SLOTS = 7;
const TAU = 2 * Math.PI;
/** Below this OKLCh chroma a hue is numerically meaningless, so the other end's is used. */
const CHROMA_FLOOR = 0.02;

/** Slot order: top, mid, horizon, discTop, discBottom, grid, accent. Palette order is PaletteId. */
export const PALETTE_HEX: readonly (readonly string[])[] = [
  ['#0D0221', '#3A0F6B', '#FD3777', '#FFD319', '#F6019D', '#F6019D', '#2DE2E6'],   // Sunset Drive
  ['#120458', '#7A04EB', '#FF2A6D', '#FFE66D', '#FF6C11', '#05D9E8', '#FF2A6D'],   // Miami Dusk
  ['#03001C', '#301E67', '#8A2BE2', '#FF6BE6', '#7B2FF7', '#B026FF', '#00FFC8'],   // Ultraviolet (T11 r02: disc top #E0D4FF, pale lilac on violet)
  ['#020F0D', '#0B3D2E', '#00FF9F', '#D1F7FF', '#00B8FF', '#00FF9F', '#FF00A0'],   // Toxic Arcade
  ['#1A0005', '#5C0A2E', '#FF4500', '#FFB000', '#FF0054', '#FF0054', '#FF7A00'],   // Ember (T11 r02: accent #FFB000, ochre at low L)
  ['#020B2E', '#0F3C8C', '#7DF9FF', '#D8F6FF', '#4CC9F0', '#4CC9F0', '#F72585'],   // Arctic Laser
];

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Linear RGB per palette and slot, then OKLCh L, C, h per palette and slot. */
const LINEAR = new Float64Array(PALETTE_COUNT * PALETTE_FLOATS);
const LCH = new Float64Array(PALETTE_COUNT * SLOTS * 3);

for (let p = 0; p < PALETTE_COUNT; p++) {
  for (let s = 0; s < SLOTS; s++) {
    const hex = PALETTE_HEX[p]![s]!;
    const r = srgbToLinear(parseInt(hex.slice(1, 3), 16) / 255);
    const g = srgbToLinear(parseInt(hex.slice(3, 5), 16) / 255);
    const b = srgbToLinear(parseInt(hex.slice(5, 7), 16) / 255);
    const li = (p * SLOTS + s) * 3;
    LINEAR[li] = r;
    LINEAR[li + 1] = g;
    LINEAR[li + 2] = b;
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const q = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const labL = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * q;
    const labA = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * q;
    const labB = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * q;
    const o = (p * SLOTS + s) * 3;
    LCH[o] = labL;
    LCH[o + 1] = Math.sqrt(labA * labA + labB * labB);
    LCH[o + 2] = Math.atan2(labB, labA);
  }
}

/**
 * T11 (M6): dark slots take the long way round the olive band. A shortest arc from red to green passes yellow, and yellow at
 * low lightness is olive-brown: Ember to Toxic Arcade's top and mid slots read #0f0a00 and #472d00 at m = .5, the "olive
 * midpoint" look note. Where both ends are outside the band, the arc contains its centre, and both ends' OKLab L are under
 * DARK_L, the hue goes the other way, through blue and violet (#07081a, #1c305e). Bright slots keep the shortest arc: yellow there
 * is gold, not olive. Fixed per palette pair and slot at load, so the mix stays continuous in m and allocates nothing.
 */
const OLIVE_C = (100 / 180) * Math.PI;
const OLIVE_HALF = (25 / 180) * Math.PI;
const DARK_L = 0.5;
const LONG_ARC = new Uint8Array(PALETTE_COUNT * PALETTE_COUNT * SLOTS);

function hueIn(h: number, c: number, half: number): boolean {
  let d = h - c;
  d -= TAU * Math.round(d / TAU);
  return Math.abs(d) <= half;
}

for (let a = 0; a < PALETTE_COUNT; a++) {
  for (let b = 0; b < PALETTE_COUNT; b++) {
    for (let s = 0; s < SLOTS; s++) {
      const oa = (a * SLOTS + s) * 3;
      const ob = (b * SLOTS + s) * 3;
      const ha = LCH[oa + 2]!;
      const hb = LCH[ob + 2]!;
      if (LCH[oa + 1]! < CHROMA_FLOOR || LCH[ob + 1]! < CHROMA_FLOOR) continue;
      if (LCH[oa]! >= DARK_L || LCH[ob]! >= DARK_L) continue;
      if (hueIn(ha, OLIVE_C, OLIVE_HALF) || hueIn(hb, OLIVE_C, OLIVE_HALF)) continue;
      let dh = hb - ha;
      if (dh > Math.PI) dh -= TAU;
      else if (dh < -Math.PI) dh += TAU;
      // The arc from ha of signed length dh contains the band's centre.
      let t = dh >= 0 ? OLIVE_C - ha : ha - OLIVE_C;
      t -= TAU * Math.floor(t / TAU);
      if (t <= Math.abs(dh)) LONG_ARC[(a * PALETTE_COUNT + b) * SLOTS + s] = 1;
    }
  }
}

/** Writes one unmixed palette, linear. PALETTE_FLOATS values; index is reduced modulo PALETTE_COUNT. */
export function writePalette(index: number, out: Float32Array): void {
  const p = ((index % PALETTE_COUNT) + PALETTE_COUNT) % PALETTE_COUNT;
  const start = p * PALETTE_FLOATS;
  for (let i = 0; i < PALETTE_FLOATS; i++) out[i] = LINEAR[start + i]!;
}

/**
 * Per slot in OKLCh: lerp L, lerp C, shortest arc on hue, except a dark slot whose shortest arc crosses the olive band (LONG_ARC,
 * T11). If either end has chroma under CHROMA_FLOOR, its hue means
 * nothing, so the other end's is used (section 6.8). No slot of the shipped table is under the floor: the lowest is
 * Toxic Arcade's top at .0224. m at or beyond an end returns that end exactly. Clamped to [0, 1], because the mix can
 * leave the gamut. Allocates nothing.
 */
export function mixPalette(a: number, b: number, m: number, out: Float32Array): void {
  MIX[0] = m;
  mixPaletteAt(a, b, MIX, out);
}

const MIX = new Float64Array(1);

/** mixPalette, with m in mix[0], so no double crosses a real call on the hot path. */
export function mixPaletteAt(a: number, b: number, mix: Float64Array, out: Float32Array): void {
  const m = mix[0]!;
  if (m <= 0) { writePalette(a, out); return; }
  if (m >= 1) { writePalette(b, out); return; }
  for (let s = 0; s < SLOTS; s++) {
    const oa = (a * SLOTS + s) * 3;
    const ob = (b * SLOTS + s) * 3;
    const L = LCH[oa]! + (LCH[ob]! - LCH[oa]!) * m;
    const ca = LCH[oa + 1]!;
    const cb = LCH[ob + 1]!;
    const C = ca + (cb - ca) * m;
    const ha = LCH[oa + 2]!;
    const hb = LCH[ob + 2]!;
    let h: number;
    if (ca < CHROMA_FLOOR) h = hb;
    else if (cb < CHROMA_FLOOR) h = ha;
    else {
      let dh = hb - ha;
      if (dh > Math.PI) dh -= TAU;
      else if (dh < -Math.PI) dh += TAU;
      if (LONG_ARC[(a * PALETTE_COUNT + b) * SLOTS + s] === 1) dh -= dh >= 0 ? TAU : -TAU;
      h = ha + dh * m;
    }
    const labA = C * Math.cos(h);
    const labB = C * Math.sin(h);
    const l = L + 0.3963377774 * labA + 0.2158037573 * labB;
    const mm = L - 0.1055613458 * labA - 0.0638541728 * labB;
    const q = L - 0.0894841775 * labA - 1.2914855480 * labB;
    const l3 = l * l * l;
    const m3 = mm * mm * mm;
    const q3 = q * q * q;
    const r = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * q3;
    const g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * q3;
    const bl = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * q3;
    const i = s * 3;
    out[i] = r < 0 ? 0 : r > 1 ? 1 : r;
    out[i + 1] = g < 0 ? 0 : g > 1 ? 1 : g;
    out[i + 2] = bl < 0 ? 0 : bl > 1 ? 1 : bl;
  }
}
