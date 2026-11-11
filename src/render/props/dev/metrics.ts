// Pure image metrics. T05's own definitions of near-white and chroma [A]: section 6.7 gives thresholds, and T09 or T11 own the final
// metric, so a failure here means investigate. The contract's wash-out definitions (section 8.1) are here too, and printed beside them.

/**
 * Threshold dark pixels, crop to the bounding box, scale the longer side to 64 and centre it. Aspect is preserved, because a pyramid
 * and an obelisk normalised to one box would look alike when their proportions are most of the difference. Rows are as given.
 */
export function silhouetteMask(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number, threshold = 128): Uint8Array {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4]! < threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const mask = new Uint8Array(64 * 64);
  if (x1 < 0) return mask;
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const scale = 64 / Math.max(bw, bh);
  const dw = Math.max(1, Math.round(bw * scale));
  const dh = Math.max(1, Math.round(bh * scale));
  const ox = Math.floor((64 - dw) / 2);
  const oy = Math.floor((64 - dh) / 2);
  for (let j = 0; j < dh; j++) {
    for (let i = 0; i < dw; i++) {
      // Sample the source region under this mask cell: any dark pixel in it counts, so a thin mast survives.
      const sx0 = x0 + Math.floor(i / scale);
      const sx1 = Math.max(sx0, Math.min(x1, x0 + Math.ceil((i + 1) / scale) - 1));
      const sy0 = y0 + Math.floor(j / scale);
      const sy1 = Math.max(sy0, Math.min(y1, y0 + Math.ceil((j + 1) / scale) - 1));
      let hit = 0;
      for (let y = sy0; y <= sy1 && !hit; y++) {
        for (let x = sx0; x <= sx1; x++) {
          if (rgba[(y * w + x) * 4]! < threshold) {
            hit = 1;
            break;
          }
        }
      }
      mask[(oy + j) * 64 + ox + i] = hit;
    }
  }
  return mask;
}

export function iou(a: Uint8Array, b: Uint8Array): number {
  let both = 0;
  let any = 0;
  for (let i = 0; i < a.length; i++) {
    const p = a[i]! > 0;
    const q = b[i]! > 0;
    if (p && q) both++;
    if (p || q) any++;
  }
  return any === 0 ? 0 : both / any;
}

export interface PairScore { a: number; b: number; iou: number }

/** Every pair, highest first. */
export function pairScores(masks: readonly Uint8Array[]): PairScore[] {
  const out: PairScore[] = [];
  for (let i = 0; i < masks.length; i++) {
    for (let j = i + 1; j < masks.length; j++) out.push({ a: i, b: j, iou: iou(masks[i]!, masks[j]!) });
  }
  out.sort((m, n) => n.iou - m.iou);
  return out;
}

export function maxPairIoU(masks: readonly Uint8Array[]): number {
  let best = 0;
  for (let i = 0; i < masks.length; i++) {
    for (let j = i + 1; j < masks.length; j++) best = Math.max(best, iou(masks[i]!, masks[j]!));
  }
  return best;
}

/** T05's definition: all channels at or above 245. */
export function nearWhiteFraction(rgba: Uint8Array | Uint8ClampedArray): number {
  let n = 0;
  const total = rgba.length / 4;
  for (let i = 0; i < rgba.length; i += 4) if (rgba[i]! >= 245 && rgba[i + 1]! >= 245 && rgba[i + 2]! >= 245) n++;
  return total === 0 ? 0 : n / total;
}

/** T05's definition: mean of max minus min over pixels with max at or above 32. */
export function meanChroma(rgba: Uint8Array | Uint8ClampedArray): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;
    const mx = Math.max(r, g, b);
    if (mx < 32) continue;
    sum += mx - Math.min(r, g, b);
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

/** Section 8.1's definition, for T06, T09 and T11: share of pixels with min(r, g, b) > 235. */
export function contractNearWhite(rgba: Uint8Array | Uint8ClampedArray): number {
  let n = 0;
  const total = rgba.length / 4;
  for (let i = 0; i < rgba.length; i += 4) if (Math.min(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!) > 235) n++;
  return total === 0 ? 0 : n / total;
}

/** Section 8.1's definition: mean of max minus min over the whole frame. */
export function contractChroma(rgba: Uint8Array | Uint8ClampedArray): number {
  let sum = 0;
  const total = rgba.length / 4;
  for (let i = 0; i < rgba.length; i += 4) {
    sum += Math.max(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!) - Math.min(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
  }
  return total === 0 ? 0 : sum / total;
}

/** Mean absolute byte difference over a row range, y from the top of an image whose rows run bottom-up when flip is true. */
export function frameDiff(a: Uint8Array | Uint8ClampedArray, b: Uint8Array | Uint8ClampedArray, w: number, h: number, y0 = 0, y1 = h, flip = false): number {
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    const row = flip ? h - 1 - y : y;
    for (let x = 0; x < w; x++) {
      const o = (row * w + x) * 4;
      sum += Math.abs(a[o]! - b[o]!) + Math.abs(a[o + 1]! - b[o + 1]!) + Math.abs(a[o + 2]! - b[o + 2]!);
      n += 3;
    }
  }
  return n === 0 ? 0 : sum / n;
}

/** Pixels where any channel differs, and differing bytes and the largest difference. */
export function pixelDiff(a: Uint8Array | Uint8ClampedArray, b: Uint8Array | Uint8ClampedArray): { pixels: number; bytes: number; max: number } {
  let pixels = 0;
  let bytes = 0;
  let max = 0;
  for (let i = 0; i < a.length; i += 4) {
    let any = false;
    for (let k = 0; k < 4; k++) {
      const d = Math.abs(a[i + k]! - b[i + k]!);
      if (d > 0) {
        any = true;
        bytes++;
        if (d > max) max = d;
      }
    }
    if (any) pixels++;
  }
  return { pixels, bytes, max };
}

/** Centroid of pixels whose max channel is above the threshold. y from the top when flip is true. */
export function centroid(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number, threshold = 16, flip = true): { x: number; y: number; count: number; minY: number; maxY: number; minX: number; maxX: number } {
  let sx = 0;
  let sy = 0;
  let n = 0;
  let minY = h;
  let maxY = -1;
  let minX = w;
  let maxX = -1;
  for (let y = 0; y < h; y++) {
    const row = flip ? h - 1 - y : y;
    for (let x = 0; x < w; x++) {
      const o = (row * w + x) * 4;
      if (Math.max(rgba[o]!, rgba[o + 1]!, rgba[o + 2]!) > threshold) {
        sx += x + 0.5;
        sy += y + 0.5;
        n++;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }
  return { x: n ? sx / n : 0, y: n ? sy / n : 0, count: n, minY, maxY, minX, maxX };
}

/** Mean Rec.709 luma over a mask or everything, 0 to 255. */
export function meanLuma(rgba: Uint8Array | Uint8ClampedArray): number {
  let s = 0;
  const n = rgba.length / 4;
  for (let i = 0; i < rgba.length; i += 4) s += 0.2126 * rgba[i]! + 0.7152 * rgba[i + 1]! + 0.0722 * rgba[i + 2]!;
  return n === 0 ? 0 : s / n;
}
