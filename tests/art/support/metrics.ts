// Pure stills metrics for T11's gates (plan section 4 and M1). Every function takes (w, h, rgba) with rows TOP-DOWN,
// as capture.ts returns them after flipping pixels(). No DOM, no three: metrics.spec runs them on hand-built images.
// Rec.709 luma in code values throughout. Definitions follow section 8.1 and plan section 2's terms.

export interface Box { x0: number; y0: number; x1: number; y1: number }   // half-open, x1 and y1 exclusive

export function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** W1. Percent of pixels with min(r, g, b) > 235 (section 8.1). */
export function nearWhitePct(w: number, h: number, rgba: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < w * h * 4; i += 4) if (Math.min(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!) > 235) n++;
  return (100 * n) / (w * h);
}

/** W2. Mean of max(r, g, b) - min(r, g, b) over all pixels (section 8.1). */
export function meanChroma(w: number, h: number, rgba: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < w * h * 4; i += 4) {
    const r = rgba[i]!, g = rgba[i + 1]!, b = rgba[i + 2]!;
    s += Math.max(r, g, b) - Math.min(r, g, b);
  }
  return s / (w * h);
}

export function meanLuma(w: number, h: number, rgba: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < w * h * 4; i += 4) s += luma(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
  return s / (w * h);
}

/** True when pixel (x, y) lies inside uv radius r of the frame centre: an ellipse in pixels on a wide frame. */
export function inCentre(x: number, y: number, w: number, h: number, r: number): boolean {
  const u = (x + 0.5) / w - 0.5, v = (y + 0.5) / h - 0.5;
  return u * u + v * v < r * r;
}

/**
 * W3. Centre haze: mean luma inside uv radius maskR of `on`, minus the same of `off`, the same frame at bloomGain 0
 * (plan section 2, S-53). Pixels outside the mask do not count.
 */
export function centreHaze(w: number, h: number, on: Uint8Array, off: Uint8Array, maskR = 0.26): number {
  if (on.length !== off.length) throw new Error('centreHaze: frames differ in size');
  const mask = centreMask(w, h, maskR);
  let s = 0, n = 0;
  for (let p = 0; p < w * h; p++) {
    if (!mask[p]) continue;
    const i = p * 4;
    s += luma(on[i]!, on[i + 1]!, on[i + 2]!) - luma(off[i]!, off[i + 1]!, off[i + 2]!);
    n++;
  }
  return n === 0 ? 0 : s / n;
}

// Masks depend only on the frame shape and fixed parameters, so they are computed once per shape. The cache cannot
// change a result: it holds exactly what the per-pixel test would return.
const MASKS = new Map<string, Uint8Array>();

/** 1 where inCentre(x, y, w, h, r). */
export function centreMask(w: number, h: number, r: number): Uint8Array {
  const key = `c:${w}:${h}:${r}`;
  let m = MASKS.get(key);
  if (!m) {
    m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = inCentre(x, y, w, h, r) ? 1 : 0;
    MASKS.set(key, m);
  }
  return m;
}

/** Section 8.1's whole-frame haze lift: mean luma of on minus off. Kept for DR1's fallback (plan M3). */
export function hazeLiftWhole(w: number, h: number, on: Uint8Array, off: Uint8Array): number {
  return meanLuma(w, h, on) - meanLuma(w, h, off);
}

/** Percentile p in [0, 1] of luma over rows [firstRow, lastRow], by an exact sort. */
export function lumaPercentile(w: number, h: number, rgba: Uint8Array, p: number, firstRow: number, lastRow = h - 1): number {
  const r0 = Math.max(0, firstRow), r1 = Math.min(h - 1, lastRow);
  const n = (r1 - r0 + 1) * w;
  if (n <= 0) return 0;
  const l = new Float32Array(n);
  let k = 0;
  for (let y = r0; y <= r1; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      l[k++] = luma(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
    }
  }
  l.sort();
  return l[Math.min(n - 1, Math.max(0, Math.floor(p * (n - 1))))]!;
}

/** W4. Floor black: 25th percentile of luma in the floor band, rows 612 to 1079 at 1080 (scaled for other heights). */
export function floorBlack(w: number, h: number, rgba: Uint8Array, firstRow = Math.round((612 / 1080) * h)): number {
  return lumaPercentile(w, h, rgba, 0.25, firstRow);
}

/** W5. Lit saturation: mean (max - min) / max over pixels with max(r, g, b) >= minMax. */
export function litSaturation(w: number, h: number, rgba: Uint8Array, minMax = 32): number {
  let s = 0, n = 0;
  for (let i = 0; i < w * h * 4; i += 4) {
    const r = rgba[i]!, g = rgba[i + 1]!, b = rgba[i + 2]!;
    const hi = Math.max(r, g, b);
    if (hi < minMax) continue;
    s += (hi - Math.min(r, g, b)) / hi;
    n++;
  }
  return n === 0 ? 0 : s / n;
}

/** C1. Percent of pixels with max(r, g, b) >= 254. */
export function clippedPct(w: number, h: number, rgba: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < w * h * 4; i += 4) if (Math.max(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!) >= 254) n++;
  return (100 * n) / (w * h);
}

export interface ChannelBand { channel: number; levels: number; changesPerLevel: number }

/**
 * T04's banding metric (src/render/sky/dev/metrics.ts bandChanges), on top-down rows: every 4th column of the box,
 * value changes between vertically adjacent pixels divided by the column's (max - min) levels, summed per channel.
 * An undithered monotone ramp reads exactly 1.00; dither crosses each level several times.
 */
export function banding(w: number, h: number, rgba: Uint8Array, box: Box): ChannelBand[] {
  const out: ChannelBand[] = [];
  for (let k = 0; k < 3; k++) {
    let changes = 0, span = 0, cols = 0;
    for (let x = box.x0; x < box.x1; x += 4) {
      let prev = -1, lo = 255, hi = 0;
      for (let y = box.y0; y < box.y1; y++) {
        const v = rgba[(y * w + x) * 4 + k]!;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
        if (prev >= 0 && v !== prev) changes++;
        prev = v;
      }
      span += hi - lo;
      cols++;
    }
    out.push({ channel: k, levels: span / Math.max(cols, 1), changesPerLevel: changes / Math.max(span, 1) });
  }
  return out;
}

/**
 * banding() made robust to small bright features on a real sky (B1, plan M2 calibration): in each sampled column, a row
 * whose value differs from the median of its 9-row window by more than `outlier` levels is a star or a prop edge, and
 * is skipped; changes count only between two adjacent kept rows, and the span is over kept rows. A column with under
 * 80% of its rows kept is not used. `cols` reports how many columns counted.
 */
export function bandingRobust(w: number, h: number, rgba: Uint8Array, box: Box, outlier = 4): (ChannelBand & { cols: number })[] {
  const out: (ChannelBand & { cols: number })[] = [];
  const n = box.y1 - box.y0;
  const v = new Int16Array(n), keep = new Uint8Array(n), win: number[] = [];
  for (let k = 0; k < 3; k++) {
    let changes = 0, span = 0, cols = 0;
    for (let x = box.x0; x < box.x1; x += 4) {
      for (let i = 0; i < n; i++) v[i] = rgba[((box.y0 + i) * w + x) * 4 + k]!;
      let kept = 0;
      for (let i = 0; i < n; i++) {
        win.length = 0;
        for (let j = Math.max(0, i - 4); j <= Math.min(n - 1, i + 4); j++) win.push(v[j]!);
        win.sort((a, b) => a - b);
        const med = win[win.length >> 1]!;
        keep[i] = Math.abs(v[i]! - med) <= outlier ? 1 : 0;
        kept += keep[i]!;
      }
      if (kept < 0.8 * n) continue;
      let lo = 255, hi = 0;
      for (let i = 0; i < n; i++) {
        if (!keep[i]) continue;
        if (v[i]! < lo) lo = v[i]!;
        if (v[i]! > hi) hi = v[i]!;
        if (i > 0 && keep[i - 1] && v[i] !== v[i - 1]) changes++;
      }
      span += hi - lo;
      cols++;
    }
    out.push({ channel: k, levels: span / Math.max(cols, 1), changesPerLevel: changes / Math.max(span, 1), cols });
  }
  return out;
}

/** B1's reading: changes per level of each channel, as banding() computes them. */
export function changesPerLevel(w: number, h: number, rgba: Uint8Array, box: Box): number[] {
  return banding(w, h, rgba, box).map((c) => c.changesPerLevel);
}

export interface Cam { fovDeg: number; pitch: number }

/**
 * Section 8.2's disc test for one pixel, analytically: the world ray through the pixel centre, pitched up by cam.pitch
 * about +x, in gnomonic coordinates g = rd.xy / -rd.z, inside radius .215 of (0, .125). above: rd.y > 0.
 */
export function discAt(x: number, y: number, w: number, h: number, cam: Cam): { inside: boolean; above: boolean; d: number } {
  const t = Math.tan((cam.fovDeg * Math.PI) / 360);
  const nx = ((x + 0.5) / w) * 2 - 1, ny = 1 - ((y + 0.5) / h) * 2;
  const dx = nx * t * (w / h), dy = ny * t, dz = -1;
  const c = Math.cos(cam.pitch), s = Math.sin(cam.pitch);
  const wy = c * dy - s * dz, wz = s * dy + c * dz;
  const gx = dx / -wz, gy = wy / -wz;
  const d = Math.hypot(gx, gy - 0.125) / 0.215;
  return { inside: d < 1, above: wy > 0, d };
}

/** The disc's centre on screen in pixels, top-down, from the same projection. */
export function discCentre(w: number, h: number, cam: Cam): { x: number; y: number; radiusPx: number } {
  const t = Math.tan((cam.fovDeg * Math.PI) / 360);
  const c = Math.cos(cam.pitch), s = Math.sin(cam.pitch);
  // Camera-space direction of world (0, .125, -1): rotate by -pitch.
  const cy = c * 0.125 + s * -1, cz = -s * 0.125 + c * -1;
  const ny = cy / -cz / t;
  // Radius in pixels along y, from the projection of the top edge, world gnomonic y = .125 + .215.
  const ty = c * 0.34 + s * -1, tz = -s * 0.34 + c * -1;
  const nyTop = ty / -tz / t;
  const y = ((1 - ny) / 2) * h;
  const yTop = ((1 - nyTop) / 2) * h;
  return { x: w / 2 - 0.5, y: y - 0.5, radiusPx: y - yTop };
}

/**
 * O1. Share of disc pixels above the horizon, by discAt, where `all` (bare, all layers) differs from `skyOnly`
 * (bare, sky only) by more than 24 on any channel.
 */
export function discOcclusion(w: number, h: number, all: Uint8Array, skyOnly: Uint8Array, cam: Cam, exclude?: Uint8Array): number {
  const mask = discMask(w, h, cam);
  let n = 0, hit = 0;
  for (let p = 0; p < w * h; p++) {
    if (!mask[p] || (exclude && exclude[p])) continue;
    n++;
    const i = p * 4;
    if (Math.abs(all[i]! - skyOnly[i]!) > 24 || Math.abs(all[i + 1]! - skyOnly[i + 1]!) > 24 || Math.abs(all[i + 2]! - skyOnly[i + 2]!) > 24) hit++;
  }
  return n === 0 ? 0 : hit / n;
}

/** 1 where discAt says inside and above the horizon. */
export function discMask(w: number, h: number, cam: Cam): Uint8Array {
  const key = `d:${w}:${h}:${cam.fovDeg}:${cam.pitch}`;
  let m = MASKS.get(key);
  if (!m) {
    m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const d = discAt(x, y, w, h, cam); m[y * w + x] = d.inside && d.above ? 1 : 0; }
    MASKS.set(key, m);
  }
  return m;
}

function changed(on: Uint8Array, off: Uint8Array, i: number, tol: number): boolean {
  return Math.abs(on[i]! - off[i]!) > tol || Math.abs(on[i + 1]! - off[i + 1]!) > tol || Math.abs(on[i + 2]! - off[i + 2]!) > tol;
}

/** D1. Share of pixels in rows [0, lastRow] where props change any channel by more than 12 (on: bare all, off: bare no props). */
export function propCoverage(w: number, h: number, on: Uint8Array, off: Uint8Array, lastRow: number): number {
  let hit = 0;
  const rows = Math.min(lastRow, h - 1) + 1;
  for (let y = 0; y < rows; y++) for (let x = 0; x < w; x++) if (changed(on, off, (y * w + x) * 4, 12)) hit++;
  return hit / (rows * w);
}

/** Per-column coverage over 16 equal screen columns, rows [0, lastRow]. */
export function columnCoverage(w: number, h: number, on: Uint8Array, off: Uint8Array, lastRow: number, columns = 16): number[] {
  const out: number[] = [];
  const rows = Math.min(lastRow, h - 1) + 1;
  for (let c = 0; c < columns; c++) {
    const x0 = Math.round((c * w) / columns), x1 = Math.round(((c + 1) * w) / columns);
    let hit = 0;
    for (let y = 0; y < rows; y++) for (let x = x0; x < x1; x++) if (changed(on, off, (y * w + x) * 4, 12)) hit++;
    out.push(hit / ((x1 - x0) * rows));
  }
  return out;
}

/** D2. Of the 16 columns above the horizon, the 12 outside the centre 4, how many have coverage under .5%. */
export function emptyColumns(w: number, h: number, on: Uint8Array, off: Uint8Array, lastRow: number): number {
  const cov = columnCoverage(w, h, on, off, lastRow, 16);
  let n = 0;
  for (let c = 0; c < 16; c++) {
    if (c >= 6 && c <= 9) continue;
    if (cov[c]! < 0.005) n++;
  }
  return n;
}

/** Mean luma per block of a bw x bh grid, row-major. X2 uses 64 x 36, F2 the mean of the same grid. */
export function blockMeans(w: number, h: number, rgba: Uint8Array, bw = 64, bh = 36): Float64Array {
  const out = new Float64Array(bw * bh);
  const cnt = new Float64Array(bw * bh);
  for (let y = 0; y < h; y++) {
    const by = Math.min(bh - 1, Math.floor((y * bh) / h));
    for (let x = 0; x < w; x++) {
      const bx = Math.min(bw - 1, Math.floor((x * bw) / w));
      const i = (y * w + x) * 4;
      out[by * bw + bx]! += luma(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
      cnt[by * bw + bx]! += 1;
    }
  }
  for (let k = 0; k < out.length; k++) out[k] = cnt[k]! > 0 ? out[k]! / cnt[k]! : 0;
  return out;
}

/** F2. Mean luma of the 64 x 36 block grid of one frame. */
export function flashLuma(w: number, h: number, rgba: Uint8Array): number {
  const b = blockMeans(w, h, rgba, 64, 36);
  let s = 0;
  for (let k = 0; k < b.length; k++) s += b[k]!;
  return s / b.length;
}

/** Luma image, row-major top-down. */
export function lumaImage(w: number, h: number, rgba: Uint8Array): Float32Array {
  const out = new Float32Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) out[p] = luma(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
  return out;
}

/**
 * S1, pure form. Share of (pixel, t) in rows [y0, y1) with abs(L[t+1] - 2 L[t] + L[t-1]) > thresh, over a luma
 * sequence. temporalPage.ts computes the same in the page; metrics.spec checks they agree.
 */
export function sparkleShare(w: number, frames: readonly Float32Array[], y0: number, y1: number, thresh = 60): number {
  let hit = 0, n = 0;
  for (let t = 1; t + 1 < frames.length; t++) {
    const a = frames[t - 1]!, b = frames[t]!, c = frames[t + 1]!;
    for (let p = y0 * w; p < y1 * w; p++) {
      if (Math.abs(c[p]! - 2 * b[p]! + a[p]!) > thresh) hit++;
      n++;
    }
  }
  return n === 0 ? 0 : hit / n;
}

/** S2, pure form. Mean abs(L[t] - L[t-1]) over rows [y0, y1) and all consecutive pairs. */
export function meanFrameDiff(w: number, frames: readonly Float32Array[], y0: number, y1: number): number {
  let s = 0, n = 0;
  for (let t = 1; t < frames.length; t++) {
    const a = frames[t - 1]!, b = frames[t]!;
    for (let p = y0 * w; p < y1 * w; p++) {
      s += Math.abs(b[p]! - a[p]!);
      n++;
    }
  }
  return n === 0 ? 0 : s / n;
}

/** Luma standard deviation and distinct-colour count, for A4's non-blank check. */
export function imageVariety(w: number, h: number, rgba: Uint8Array): { lumaStd: number; colours: number } {
  let s = 0, s2 = 0;
  const seen = new Set<number>();
  for (let i = 0; i < w * h * 4; i += 4) {
    const l = luma(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
    s += l;
    s2 += l * l;
    if (seen.size <= 4096) seen.add((rgba[i]! << 16) | (rgba[i + 1]! << 8) | rgba[i + 2]!);
  }
  const n = w * h;
  const mean = s / n;
  return { lumaStd: Math.sqrt(Math.max(0, s2 / n - mean * mean)), colours: seen.size };
}

/** p-quantile of an array of numbers, p in [0, 1], nearest rank. */
export function quantile(values: ArrayLike<number>, p: number): number {
  const a = Array.from(values).sort((x, y) => x - y);
  if (a.length === 0) return Number.NaN;
  return a[Math.min(a.length - 1, Math.max(0, Math.ceil(p * a.length) - 1))]!;
}

export function median(values: ArrayLike<number>): number {
  const a = Array.from(values).sort((x, y) => x - y);
  if (a.length === 0) return Number.NaN;
  const m = a.length >> 1;
  return a.length % 2 === 1 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

/** sRGB saturation (max - min) / max of a linear RGB triple after encoding, as X0 reads it. */
export function srgbSaturationOfLinear(r: number, g: number, b: number): number {
  const enc = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  const R = enc(Math.min(1, Math.max(0, r))), G = enc(Math.min(1, Math.max(0, g))), B = enc(Math.min(1, Math.max(0, b)));
  const hi = Math.max(R, G, B);
  return hi <= 0 ? 0 : (hi - Math.min(R, G, B)) / hi;
}

/**
 * T11 r04, superseded at A24 (Decision log): the player's ship, as a screen mask, from two frames of one palette in different zones
 * at the same fixed pose. A pixel is the ship where props change it by more than 24 in both frames and the two frames agree within 8
 * on every channel there: scenery differs between zones, the ship does not. Dilated by r pixels. The independent A24 reviewer
 * refused it: nothing in the test identifies the ship, so props drawn alike in both zones join it, and it is rebuilt from the art
 * under test. Kept only to print O1oldMask beside the fixed mask below.
 */
export function shipMask(w: number, h: number, allA: Uint8Array, offA: Uint8Array, allB: Uint8Array, offB: Uint8Array, r = 3): Uint8Array {
  const core = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (!changed(allA, offA, i, 24) || !changed(allB, offB, i, 24)) continue;
    if (Math.abs(allA[i]! - allB[i]!) <= 8 && Math.abs(allA[i + 1]! - allB[i + 1]!) <= 8 && Math.abs(allA[i + 2]! - allB[i + 2]!) <= 8) core[p] = 1;
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!core[y * w + x]) continue;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h) out[yy * w + xx] = 1;
    }
  }
  return out;
}

/**
 * A24: a screen mask from triangles already projected to pixel coordinates, rows top-down, (x, y) per vertex and 6 numbers per
 * triangle. A pixel is in when its centre (x + .5, y + .5) lies inside or on a triangle, whatever the winding; then the mask is
 * dilated by r pixels (a square). The ship's mask is built this way from the ship's own geometry and pose, so nothing drawn
 * by any other layer or prop can enter it.
 */
export function rasterTriangles(w: number, h: number, xy: ArrayLike<number>, r = 0): Uint8Array {
  const core = new Uint8Array(w * h);
  for (let t = 0; t + 5 < xy.length; t += 6) {
    const ax = xy[t]!, ay = xy[t + 1]!, bx = xy[t + 2]!, by = xy[t + 3]!, cx = xy[t + 4]!, cy = xy[t + 5]!;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (!Number.isFinite(area) || area === 0) continue;
    const s = area > 0 ? 1 : -1;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const e0 = s * ((bx - ax) * (py - ay) - (by - ay) * (px - ax));
      const e1 = s * ((cx - bx) * (py - by) - (cy - by) * (px - bx));
      const e2 = s * ((ax - cx) * (py - cy) - (ay - cy) * (px - cx));
      if (e0 >= 0 && e1 >= 0 && e2 >= 0) core[y * w + x] = 1;
    }
  }
  if (r <= 0) return core;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!core[y * w + x]) continue;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h) out[yy * w + xx] = 1;
    }
  }
  return out;
}

/** Number of set pixels in a mask, and how many of them are also set in `within` when given. */
export function maskCount(mask: Uint8Array, within?: Uint8Array): number {
  let n = 0;
  for (let p = 0; p < mask.length; p++) if (mask[p] && (!within || within[p])) n++;
  return n;
}

/** sRGB code value (0 to 255) to linear, and back, unclamped in, clamped out. */
export function codeToLinear(v: number): number {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}
export function linearToCode(c: number): number {
  const x = Math.min(1, Math.max(0, c));
  return 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
}

/**
 * T06's hit flash on one pixel, from src/render/fx/crt.frag.glsl, on the CPU: with c linear and luma its Rec.709 linear luma,
 * d = 1 - smoothstep(0, .3, luma) and c' = c * (1 - flash * d) + flashColour * flash. flashColour is uFlashColor, linear (the
 * palette grid colour scaled to linear luma .2, postParams.ts). Takes and returns sRGB code values, unrounded. Scan, grain and the
 * vignette, which come after it in the stack, are not applied.
 */
export function crtFlashCodes(codes: readonly [number, number, number], flash: number, flashColour: readonly [number, number, number]): [number, number, number] {
  const r = codeToLinear(codes[0]), g = codeToLinear(codes[1]), b = codeToLinear(codes[2]);
  const t = Math.min(1, Math.max(0, (0.2126 * r + 0.7152 * g + 0.0722 * b) / 0.3));
  const d = 1 - t * t * (3 - 2 * t);
  const k = 1 - flash * d;
  return [linearToCode(r * k + flashColour[0] * flash), linearToCode(g * k + flashColour[1] * flash), linearToCode(b * k + flashColour[2] * flash)];
}

/**
 * A24: W4's allowance on a frame whose Crt flash is `flash` with colour `flashColour`: the largest code-value luma that T06's
 * formula can give a pixel whose luma was at most `limit`, over every colour (a grid of red and green, blue solved, so each
 * reference sits exactly at the limit). The formula raises a pixel's linear luma monotonically, so a frame whose floor black
 * was at most `limit` before the flash reads at most this after it, and a frame lifted beyond `limit` by anything else reads
 * more. At flash 0 it is `limit` exactly. It ignores the vignette and scan after the flash, which only darken, so a frame
 * lifted by up to their share of the flash still passes (plan Decision log, A24).
 */
export function flashFloorAllowance(flash: number, flashColour: readonly [number, number, number], limit = 13): number {
  if (!(flash > 0)) return limit;
  let best = limit;
  const rMax = limit / 0.2126, gMax = limit / 0.7152;
  for (let ri = 0; ri <= 64; ri++) {
    const r = (ri / 64) * rMax;
    for (let gi = 0; gi <= 32; gi++) {
      const g = (gi / 32) * gMax;
      const b = (limit - 0.2126 * r - 0.7152 * g) / 0.0722;
      if (b < 0 || b > 255) continue;
      const o = crtFlashCodes([r, g, b], flash, flashColour);
      const l = 0.2126 * o[0] + 0.7152 * o[1] + 0.0722 * o[2];
      if (l > best) best = l;
    }
  }
  return best;
}
