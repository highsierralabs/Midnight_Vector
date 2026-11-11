// Image-space defects, for the planted sheet (plan M2 step 3) and the synthetic metric controls (A1n). `noprops` is
// not here: it is a real render with setLayerVisible('props', false). All take and return top-down RGBA.
import { luma } from './metrics';
import type { Rgba } from './sheet';

function map(src: Rgba, f: (r: number, g: number, b: number, out: Float64Array) => void): Rgba {
  const out = new Uint8Array(src.rgba.length);
  const t = new Float64Array(3);
  for (let i = 0; i < src.rgba.length; i += 4) {
    f(src.rgba[i]!, src.rgba[i + 1]!, src.rgba[i + 2]!, t);
    out[i] = Math.max(0, Math.min(255, Math.round(t[0]!)));
    out[i + 1] = Math.max(0, Math.min(255, Math.round(t[1]!)));
    out[i + 2] = Math.max(0, Math.min(255, Math.round(t[2]!)));
    out[i + 3] = 255;
  }
  return { w: src.w, h: src.h, rgba: out };
}

/** Every channel moved a fraction f toward white. */
export function lift(src: Rgba, f: number): Rgba {
  return map(src, (r, g, b, o) => { o[0] = r + (255 - r) * f; o[1] = g + (255 - g) * f; o[2] = b + (255 - b) * f; });
}

/** Every channel scaled by f. */
export function dim(src: Rgba, f: number): Rgba {
  return map(src, (r, g, b, o) => { o[0] = r * f; o[1] = g * f; o[2] = b * f; });
}

/** Each pixel moved a fraction f toward its own luma. */
export function desat(src: Rgba, f: number): Rgba {
  return map(src, (r, g, b, o) => { const l = luma(r, g, b); o[0] = r + (l - r) * f; o[1] = g + (l - g) * f; o[2] = b + (l - b) * f; });
}

/** Each pixel moved a fraction f toward one colour; the default is a mid purple. */
export function toward(src: Rgba, f: number, c: readonly [number, number, number] = [127, 64, 160]): Rgba {
  return map(src, (r, g, b, o) => { o[0] = r + (c[0] - r) * f; o[1] = g + (c[1] - g) * f; o[2] = b + (c[2] - b) * f; });
}

function boxBlur(buf: Float32Array, w: number, h: number, r: number): void {
  const tmp = new Float32Array(buf.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      for (let k = 0; k < 3; k++) {
        let s = 0, n = 0;
        for (let x = -r; x <= r; x++) if (x >= 0 && x < w) { s += buf[(y * w + x) * 3 + k]!; n++; }
        for (let x = 0; x < w; x++) {
          tmp[(y * w + x) * 3 + k] = s / n;
          const add = x + r + 1, rem = x - r;
          if (add < w) { s += buf[(y * w + add) * 3 + k]!; n++; }
          if (rem >= 0) { s -= buf[(y * w + rem) * 3 + k]!; n--; }
        }
      }
    }
    for (let x = 0; x < w; x++) {
      for (let k = 0; k < 3; k++) {
        let s = 0, n = 0;
        for (let y = -r; y <= r; y++) if (y >= 0 && y < h) { s += tmp[(y * w + x) * 3 + k]!; n++; }
        for (let y = 0; y < h; y++) {
          buf[(y * w + x) * 3 + k] = s / n;
          const add = y + r + 1, rem = y - r;
          if (add < h) { s += tmp[(add * w + x) * 3 + k]!; n++; }
          if (rem >= 0) { s -= tmp[(rem * w + x) * 3 + k]!; n--; }
        }
      }
    }
  }
}

/**
 * A bloom made in image space: a bright pass over luma `threshold`, blurred at radiusFrac of the width on a 4x smaller
 * copy, upsampled bilinearly and SCREEN-blended at `strength`, as the real bloom blends (architecture.md 6.6).
 */
export function screenBloom(src: Rgba, threshold: number, radiusFrac: number, strength: number): Rgba {
  const ds = 4;
  const w = Math.max(1, Math.floor(src.w / ds)), h = Math.max(1, Math.floor(src.h / ds));
  const small = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < ds; dy++) for (let dx = 0; dx < ds; dx++) {
        const i = (((y * ds + dy) * src.w) + x * ds + dx) * 4;
        const l = luma(src.rgba[i]!, src.rgba[i + 1]!, src.rgba[i + 2]!);
        const k = l <= threshold ? 0 : Math.min(1, (l - threshold) / Math.max(1, 255 - threshold));
        r += (src.rgba[i]! / 255) * k; g += (src.rgba[i + 1]! / 255) * k; b += (src.rgba[i + 2]! / 255) * k;
      }
      const o = (y * w + x) * 3;
      small[o] = r / (ds * ds); small[o + 1] = g / (ds * ds); small[o + 2] = b / (ds * ds);
    }
  }
  boxBlur(small, w, h, Math.max(1, Math.round(radiusFrac * w)));
  const out = new Uint8Array(src.rgba.length);
  for (let y = 0; y < src.h; y++) {
    const fy = Math.min(h - 1, Math.max(0, (y + 0.5) / ds - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < src.w; x++) {
      const fx = Math.min(w - 1, Math.max(0, (x + 0.5) / ds - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0;
      const i = (y * src.w + x) * 4;
      for (let k = 0; k < 3; k++) {
        const a = small[(y0 * w + x0) * 3 + k]! * (1 - tx) + small[(y0 * w + x1) * 3 + k]! * tx;
        const b = small[(y1 * w + x0) * 3 + k]! * (1 - tx) + small[(y1 * w + x1) * 3 + k]! * tx;
        const bl = Math.min(1, (a * (1 - ty) + b * ty) * strength);
        const c = src.rgba[i + k]! / 255;
        out[i + k] = Math.round(255 * (1 - (1 - c) * (1 - bl)));
      }
      out[i + 3] = 255;
    }
  }
  return { w: src.w, h: src.h, rgba: out };
}

/** A bloom flood: low threshold, wide, strong (plan 5's "Flood, threshold .1, intensity 3"). */
export function flood(src: Rgba): Rgba {
  return screenBloom(src, 26, 0.06, 3);
}

/** A mild extra glow: weak plant. */
export function glow(src: Rgba): Rgba {
  return screenBloom(src, 120, 0.02, 0.6);
}

export const STRONG = ['flood', 'noprops', 'lift.08', 'dim.6', 'desat.4'] as const;
export const WEAK = ['desat.2', 'toward.15', 'glow'] as const;
export type PlantKind = (typeof STRONG)[number] | (typeof WEAK)[number];

/** The image-space plants by name. `noprops` needs a real render and is not here. */
export function applyPlant(kind: Exclude<PlantKind, 'noprops'>, src: Rgba): Rgba {
  switch (kind) {
    case 'flood': return flood(src);
    case 'lift.08': return lift(src, 0.08);
    case 'dim.6': return dim(src, 0.6);
    case 'desat.4': return desat(src, 0.4);
    case 'desat.2': return desat(src, 0.2);
    case 'toward.15': return toward(src, 0.15);
    case 'glow': return glow(src);
  }
}
