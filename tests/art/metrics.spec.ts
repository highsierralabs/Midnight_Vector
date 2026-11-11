// A1 and A1n: T11's stills metrics on hand-built images, with synthetic negative controls, and the in-page temporal
// kernel run in Node against a fake harness. No browser: this file uses playwright/test's base test, because the
// shared fixture in tests/support/pw.ts opens a page for its console guard.
import { test, expect } from 'playwright/test';
import { washout } from '../../src/render/fx/dev/metrics';
import { LIMITS, passes, CENTRE_R, SPARKLE_THRESH, BANDS, CAM } from './support/thresholds';
import {
  nearWhitePct, meanChroma, centreHaze, floorBlack, litSaturation, clippedPct, changesPerLevel, banding, bandingRobust, flashLuma,
  sparkleShare, meanFrameDiff, lumaImage, discAt, discCentre, propCoverage, emptyColumns, inCentre, shipMask, discOcclusion,
  rasterTriangles, maskCount, codeToLinear, crtFlashCodes, flashFloorAllowance,
} from './support/metrics';
import { decodePng, encodePng } from './support/png';
import { flood, lift, dim, desat } from './support/plant';
import { runSequence, type SeqArgs } from './support/temporalPage';
import type { Rgba } from './support/sheet';

function img(w: number, h: number, f: (x: number, y: number) => [number, number, number]): Rgba {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = f(x, y);
    const i = (y * w + x) * 4;
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
  }
  return { w, h, rgba };
}

function mixc(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  return [Math.round(a[0]! + (b[0]! - a[0]!) * t), Math.round(a[1]! + (b[1]! - a[1]!) * t), Math.round(a[2]! + (b[2]! - a[2]!) * t)];
}

/**
 * A synthetic synthwave frame at 1920 x 1080: violet sky to a pink horizon, a banded yellow-to-magenta disc at the
 * analytic disc position, a near-black floor with a magenta grid. Not the game: a fixed scene for the controls.
 */
function scene(): Rgba {
  const W = 1920, H = 1080;
  const c = discCentre(W, H, CAM);
  return img(W, H, (x, y) => {
    if (y < 590) {
      const d = discAt(x, y, W, H, CAM);
      if (d.inside && d.above) {
        const v = (y - (c.y - c.radiusPx)) / (2 * c.radiusPx);
        if (v > 0.55 && Math.floor(y / 14) % 3 === 0) return mixc([13, 2, 33], [253, 55, 119], 0.7);
        return mixc([255, 211, 25], [246, 1, 157], Math.min(1, Math.max(0, v)));
      }
      const t = y / 590;
      return mixc([13, 2, 33], [200, 30, 110], t * t);
    }
    const yy = y - 590;
    const z = 4000 / (yy + 4);
    const onRow = Math.abs(((z / 8) % 1) - 0.5) > 0.45;
    const xr = (x - 960) / (yy + 4);
    const onCol = Math.abs(((xr * 6) % 1 + 1) % 1 - 0.5) > 0.4;
    if (onRow || onCol) return [230, 40, 170];
    return [8, 2, 20];
  });
}

const W1 = (i: Rgba): number => nearWhitePct(i.w, i.h, i.rgba);
const W2 = (i: Rgba): number => meanChroma(i.w, i.h, i.rgba);
const W4 = (i: Rgba): number => floorBlack(i.w, i.h, i.rgba);
const W5 = (i: Rgba): number => litSaturation(i.w, i.h, i.rgba);

test.describe('A1 definitions', () => {
  test('near-white, chroma, floor black, lit saturation and clipped are exact on hand-built images', () => {
    // 10 x 10: 3 near-white (236,236,236), 2 clipped-only (254,0,0), rest (10,20,30).
    const a = img(10, 10, (x, y) => {
      const k = y * 10 + x;
      if (k < 3) return [236, 236, 236];
      if (k < 5) return [254, 0, 0];
      return [10, 20, 30];
    });
    expect(nearWhitePct(a.w, a.h, a.rgba)).toBeCloseTo(3, 12);
    expect(meanChroma(a.w, a.h, a.rgba)).toBeCloseTo((3 * 0 + 2 * 254 + 95 * 20) / 100, 12);
    // Clipped is max >= 254: only the two reds; the near-whites peak at 236.
    expect(clippedPct(a.w, a.h, a.rgba)).toBeCloseTo(2, 12);
    // Lit saturation: only max >= 32 counts: the 3 whites (0) and 2 reds (1), so .4.
    expect(litSaturation(a.w, a.h, a.rgba)).toBeCloseTo(0.4, 12);
    // A boundary pixel at exactly 235 is not near-white, and 253 is not clipped.
    const b = img(2, 1, (x) => (x === 0 ? [235, 240, 240] : [253, 0, 0]));
    expect(nearWhitePct(b.w, b.h, b.rgba)).toBe(0);
    expect(clippedPct(b.w, b.h, b.rgba)).toBe(0);
    // Floor black: rows 612 and below of a 1080-row image; 25th percentile of luma there.
    const f = img(4, 1080, (x, y) => (y < 612 ? [255, 255, 255] : x === 0 ? [0, 0, 0] : [100, 100, 100]));
    expect(floorBlack(f.w, f.h, f.rgba)).toBe(0);
    const g = img(4, 1080, (x, y) => (y < 612 ? [0, 0, 0] : x < 2 ? [20, 20, 20] : [100, 100, 100]));
    expect(floorBlack(g.w, g.h, g.rgba)).toBeCloseTo(20, 4);
  });

  test("near-white and chroma equal T06's washout on one image within 1e-9", () => {
    const s = scene();
    const t06 = washout(s.rgba);
    expect(Math.abs(nearWhitePct(s.w, s.h, s.rgba) - t06.nearWhitePct)).toBeLessThan(1e-9);
    expect(Math.abs(meanChroma(s.w, s.h, s.rgba) - t06.meanChroma)).toBeLessThan(1e-9);
  });

  test('centre haze: a change outside uv radius .26 does nothing, one inside does', () => {
    const W = 192, H = 108;
    const off = img(W, H, () => [10, 10, 10]);
    const base = centreHaze(W, H, off.rgba, off.rgba, CENTRE_R);
    expect(base).toBe(0);
    const outside = off.rgba.slice();
    let ox = -1, oy = -1, ix = -1, iy = -1;
    for (let y = 0; y < H && ox < 0; y++) for (let x = 0; x < W; x++) if (!inCentre(x, y, W, H, CENTRE_R)) { ox = x; oy = y; break; }
    for (let y = 0; y < H && ix < 0; y++) for (let x = 0; x < W; x++) if (inCentre(x, y, W, H, CENTRE_R)) { ix = x; iy = y; break; }
    outside.set([250, 250, 250], (oy * W + ox) * 4);
    expect(centreHaze(W, H, outside, off.rgba, CENTRE_R)).toBe(0);
    const inside = off.rgba.slice();
    inside.set([250, 250, 250], (iy * W + ix) * 4);
    expect(centreHaze(W, H, inside, off.rgba, CENTRE_R)).toBeGreaterThan(0);
  });

  test('PNG round trip is byte-identical', () => {
    const s = scene();
    const d = decodePng(encodePng(s.w, s.h, s.rgba));
    expect(d.w).toBe(s.w);
    expect(d.h).toBe(s.h);
    expect(Buffer.from(d.rgba).equals(Buffer.from(s.rgba))).toBe(true);
    const noise = img(37, 23, (x, y) => [(x * 97 + y * 13) & 255, (x * y * 7) & 255, (x ^ y) & 255]);
    const n2 = decodePng(encodePng(noise.w, noise.h, noise.rgba));
    expect(Buffer.from(n2.rgba).equals(Buffer.from(noise.rgba))).toBe(true);
  });

  test('disc projection: the analytic centre sits near row 467 and the horizon near row 589', () => {
    const c = discCentre(1920, 1080, CAM);
    expect(c.y).toBeGreaterThan(460);
    expect(c.y).toBeLessThan(475);
    expect(c.radiusPx).toBeGreaterThan(195);
    expect(c.radiusPx).toBeLessThan(220);
    expect(discAt(960, 588, 1920, 1080, CAM).above).toBe(true);
    expect(discAt(960, 590, 1920, 1080, CAM).above).toBe(false);
  });

  test('prop coverage and empty columns count changed pixels above the horizon only', () => {
    const W = 160, H = 108;
    const off = img(W, H, () => [5, 5, 5]);
    const on = img(W, H, (x, y) => (y < 50 && x < 30 ? [200, 5, 5] : [5, 5, 5]));
    expect(propCoverage(W, H, on.rgba, off.rgba, 59)).toBeCloseTo((30 * 50) / (W * 60), 12);
    // Columns are 10 px; columns 0 to 2 have coverage, so of the 12 outer columns 9 are empty.
    expect(emptyColumns(W, H, on.rgba, off.rgba, 59)).toBe(9);
  });

  test('ship mask: what props change in both zones alike; O1 ignores it, and still counts the rest (r04)', () => {
    const W = 1920, H = 1080;
    const off = img(W, H, () => [40, 10, 60]);
    // Zone A and B share the ship, a 200 x 30 block at the disc's foot, and differ in scenery.
    const isShip = (x: number, y: number): boolean => x >= 860 && x < 1060 && y >= 560 && y < 590;
    const a = img(W, H, (x, y) => (isShip(x, y) ? [20, 220, 200] : x < 300 && y > 400 && y < 590 ? [250, 20, 20] : [40, 10, 60]));
    const b = img(W, H, (x, y) => (isShip(x, y) ? [20, 220, 200] : x > 1600 && y > 400 && y < 590 ? [20, 250, 20] : [40, 10, 60]));
    const m = shipMask(W, H, a.rgba, off.rgba, b.rgba, off.rgba, 0);
    let n = 0, wrong = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (m[y * W + x]) { n++; if (!isShip(x, y)) wrong++; } }
    expect(n).toBe(200 * 30);
    expect(wrong).toBe(0);
    const withShip = discOcclusion(W, H, a.rgba, off.rgba, CAM);
    const without = discOcclusion(W, H, a.rgba, off.rgba, CAM, m);
    expect(withShip).toBeGreaterThan(0);
    expect(without).toBe(0);
    // Negative control: scenery over the disc still counts with the ship excluded.
    const c = img(W, H, (x, y) => (isShip(x, y) ? [20, 220, 200] : x > 900 && x < 1000 && y > 400 && y < 560 ? [250, 20, 20] : [40, 10, 60]));
    expect(discOcclusion(W, H, c.rgba, off.rgba, CAM, m)).toBeGreaterThan(0.05);
  });

  test('triangle raster (A24 ship mask): pixel centres inside, either winding, then a square dilation', () => {
    // Right triangle (0,0) (10,0) (0,10): centres (x + .5, y + .5) with x + y <= 9 are inside or on it, 55 of them.
    const a = rasterTriangles(16, 16, [0, 0, 10, 0, 0, 10]);
    const b = rasterTriangles(16, 16, [0, 0, 0, 10, 10, 0]);
    expect(maskCount(a)).toBe(55);
    expect(maskCount(b)).toBe(55);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) expect(a[y * 16 + x]).toBe(x + y <= 9 ? 1 : 0);
    // One pixel's worth of triangle, dilated by 2, is a 5 x 5 square; within counts the overlap.
    const one = rasterTriangles(16, 16, [7, 7, 8, 7, 7, 8, 8, 7, 8, 8, 7, 8], 2);
    expect(maskCount(one)).toBe(25);
    expect(maskCount(one, a)).toBe(maskCount(Uint8Array.from(one, (v, p) => (v && a[p] ? 1 : 0))));
    // Degenerate and behind-camera-free input: a zero-area triangle adds nothing.
    expect(maskCount(rasterTriangles(16, 16, [1, 1, 5, 5, 9, 9]))).toBe(0);
  });

  test("flash allowance (A24 boost-run W4): exactly 13 at no flash; T06's formula on a clean floor passes; a lifted floor fails", () => {
    // Sunset Drive's grid colour #F6019D, linear, scaled to linear luma .2, as postParams.ts makes uFlashColor.
    const g = [0xf6, 0x01, 0x9d].map(codeToLinear) as [number, number, number];
    const k = 0.2 / (0.2126 * g[0] + 0.7152 * g[1] + 0.0722 * g[2]);
    const F: [number, number, number] = [g[0] * k, g[1] * k, g[2] * k];
    expect(flashFloorAllowance(0, F)).toBe(13);
    // The CPU formula agrees with itself at no flash, and raises a dark pixel toward the flash colour.
    expect(crtFlashCodes([10, 4, 20], 0, F).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([10, 4, 20]);
    expect(crtFlashCodes([10, 4, 20], 0.3, F)[0]).toBeGreaterThan(60);
    const fs = [0.03, 0.06, 0.12, 0.3, 0.6];
    const allow = fs.map((f) => flashFloorAllowance(f, F));
    for (let i = 1; i < allow.length; i++) expect(allow[i]!).toBeGreaterThan(allow[i - 1]!);
    // A synthetic floor: dark tinted cells (the 25th percentile sits in them) and bright grid lines. Clean: floor black 6 to 13.
    const floor = (lifted: number, f: number, base: number): Rgba => {
      const im = img(64, 64, (x, y) => {
        const line = x % 8 === 0 || y % 8 === 0;
        const t = ((x * 7 + y * 13) % 17) / 16;
        let c: [number, number, number] = line ? [246, 1, 157] : [Math.round(base * (0.6 + 0.8 * t)), Math.round(base * 0.35), Math.round(base * (1.4 - 0.4 * t))];
        c = [c[0] + (255 - c[0]) * lifted, c[1] + (255 - c[1]) * lifted, c[2] + (255 - c[2]) * lifted];
        const o = f > 0 ? crtFlashCodes(c, f, F) : c;
        return [Math.round(o[0]), Math.round(o[1]), Math.round(o[2])];
      });
      return im;
    };
    const rows: string[] = [];
    for (let i = 0; i < fs.length; i++) {
      const f = fs[i]!;
      const cleanAt = floorBlack(64, 64, floor(0, 0, 12).rgba, 0);
      const designed = floorBlack(64, 64, floor(0, f, 12).rgba, 0);
      const lifted = floorBlack(64, 64, floor(0.08, f, 12).rgba, 0);
      rows.push(`f ${f}: allowance ${allow[i]!.toFixed(2)}, clean ${cleanAt} -> flashed ${designed}, lift .08 then flashed ${lifted}`);
      expect(cleanAt).toBeLessThanOrEqual(13);
      expect(designed, `designed flash at ${f} on a clean floor`).toBeLessThanOrEqual(allow[i]!);
      // The negative control: a floor lifted .08 before the flash fails the allowance at shard and gate flash strengths.
      if (f <= 0.12) expect(lifted, `lift .08 at flash ${f}`).toBeGreaterThan(allow[i]!);
    }
    console.log(`A24 flash allowance, Sunset Drive's grid colour: ${rows.join('; ')}`);
  });
});

test.describe('A1n controls on a synthetic scene', () => {
  const s = scene();
  const clean = { W1: W1(s), W2: W2(s), W4: W4(s), W5: W5(s) };

  test('the clean scene passes W1, W2, W4 and W5', () => {
    console.log(`A1n clean W1 ${clean.W1.toFixed(4)} W2 ${clean.W2.toFixed(2)} W4 ${clean.W4.toFixed(2)} W5 ${clean.W5.toFixed(3)}`);
    expect(passes('W1', clean.W1)).toBe(true);
    expect(passes('W2', clean.W2)).toBe(true);
    expect(passes('W4', clean.W4)).toBe(true);
    expect(passes('W5', clean.W5)).toBe(true);
  });

  test('image-space flood fails W3 and W4, and passes W1 and W2', () => {
    const f = flood(s);
    const haze = centreHaze(f.w, f.h, f.rgba, s.rgba, CENTRE_R);
    console.log(`A1n flood W1 ${W1(f).toFixed(4)} W2 ${W2(f).toFixed(2)} W3 ${haze.toFixed(2)} W4 ${W4(f).toFixed(2)} W5 ${W5(f).toFixed(3)}`);
    expect(passes('W3', haze)).toBe(false);
    expect(passes('W4', W4(f))).toBe(false);
    expect(passes('W1', W1(f))).toBe(true);
    expect(passes('W2', W2(f))).toBe(true);
  });

  test('lift .08 fails W4 and W5', () => {
    const f = lift(s, 0.08);
    console.log(`A1n lift.08 W1 ${W1(f).toFixed(4)} W2 ${W2(f).toFixed(2)} W4 ${W4(f).toFixed(2)} W5 ${W5(f).toFixed(3)}`);
    expect(passes('W4', W4(f))).toBe(false);
    expect(passes('W5', W5(f))).toBe(false);
  });

  test('desat .4 fails W2 and W5', () => {
    const f = desat(s, 0.4);
    console.log(`A1n desat.4 W1 ${W1(f).toFixed(4)} W2 ${W2(f).toFixed(2)} W4 ${W4(f).toFixed(2)} W5 ${W5(f).toFixed(3)}`);
    expect(passes('W2', W2(f))).toBe(false);
    expect(passes('W5', W5(f))).toBe(false);
  });

  test('dim .6 fails W2 only, so it is not called wash-out', () => {
    const f = dim(s, 0.6);
    const haze = centreHaze(f.w, f.h, f.rgba, f.rgba, CENTRE_R);
    console.log(`A1n dim.6 W1 ${W1(f).toFixed(4)} W2 ${W2(f).toFixed(2)} W3 ${haze.toFixed(2)} W4 ${W4(f).toFixed(2)} W5 ${W5(f).toFixed(3)}`);
    expect(passes('W2', W2(f))).toBe(false);
    expect(passes('W1', W1(f))).toBe(true);
    expect(passes('W3', haze)).toBe(true);
    expect(passes('W4', W4(f))).toBe(true);
    expect(passes('W5', W5(f))).toBe(true);
  });

  test('a white frame fails F2, and the clean scene passes it', () => {
    const white = img(64, 36, () => [255, 255, 255]);
    expect(passes('F2', flashLuma(white.w, white.h, white.rgba))).toBe(false);
    expect(passes('F2', flashLuma(s.w, s.h, s.rgba))).toBe(true);
  });

  test('sparkle: 0.5% toggling pixels fails S1; a static sequence reads 0 and fails S2', () => {
    const W = 200, H = 100, N = 12;
    const frames: Float32Array[] = [];
    for (let t = 0; t < N; t++) {
      const f = new Float32Array(W * H).fill(20);
      for (let p = 0; p < W * H; p++) if (p % 200 === 7 && t % 2 === 0) f[p] = 200;   // .5% of pixels toggle
      frames.push(f);
    }
    const sp = sparkleShare(W, frames, 0, H, SPARKLE_THRESH);
    expect(sp).toBeCloseTo(0.005, 9);
    expect(passes('S1obj', sp)).toBe(false);
    const still = Array.from({ length: N }, () => new Float32Array(W * H).fill(20));
    expect(sparkleShare(W, still, 0, H, SPARKLE_THRESH)).toBe(0);
    expect(meanFrameDiff(W, still, 0, H)).toBe(0);
    expect(passes('S2', meanFrameDiff(W, still, 0, H))).toBe(false);
  });

  test('a stepped ramp reads 1.00 changes per level; a dithered one over 1.3', () => {
    const ramp = img(256, 240, (_x, y) => [Math.floor(y / 6), Math.floor(y / 4), Math.floor(y / 3)]);
    for (const c of banding(ramp.w, ramp.h, ramp.rgba, { x0: 0, y0: 0, x1: 256, y1: 240 })) {
      expect(c.levels).toBeGreaterThanOrEqual(8);
      expect(c.changesPerLevel).toBeCloseTo(1, 9);
    }
    const dith = img(256, 240, (x, y) => {
      const n = 1.5 * ((((x * 73856093) ^ (y * 19349663)) >>> 0) % 1000) / 1000;
      return [Math.floor(y / 6 + n), Math.floor(y / 4 + n), Math.floor(y / 3 + n)];
    });
    for (const v of changesPerLevel(dith.w, dith.h, dith.rgba, { x0: 0, y0: 0, x1: 256, y1: 240 })) expect(v).toBeGreaterThan(1.3);
  });

  test('with stars added, plain banding is fooled and the robust form is not (B1 on a real sky)', () => {
    const box = { x0: 0, y0: 0, x1: 256, y1: 240 };
    const star = (x: number, y: number): boolean => ((x * 31 + y * 17) % 97) === 0;
    const ramp = img(256, 240, (x, y) => (star(x, y) ? [250, 250, 250] : [Math.floor(y / 6), Math.floor(y / 4), Math.floor(y / 3)]));
    const dith = img(256, 240, (x, y) => {
      if (star(x, y)) return [250, 250, 250];
      const n = 1.5 * ((((x * 73856093) ^ (y * 19349663)) >>> 0) % 1000) / 1000;
      return [Math.floor(y / 6 + n), Math.floor(y / 4 + n), Math.floor(y / 3 + n)];
    });
    const plainDith = changesPerLevel(dith.w, dith.h, dith.rgba, box);
    console.log(`B1 with stars: plain dithered ${plainDith.map((v) => v.toFixed(2)).join(' ')}`);
    expect(Math.min(...plainDith)).toBeLessThan(1.3);   // stars inflate the span, so a dithered sky reads as banded
    for (const c of bandingRobust(ramp.w, ramp.h, ramp.rgba, box)) { expect(c.cols).toBeGreaterThan(50); expect(c.changesPerLevel).toBeLessThan(1.05); }
    for (const c of bandingRobust(dith.w, dith.h, dith.rgba, box)) { expect(c.cols).toBeGreaterThan(50); expect(c.changesPerLevel).toBeGreaterThan(1.3); }
  });
});

test.describe('temporalPage kernel against metrics.ts', () => {
  test('runSequence on a fake harness gives sparkleShare, meanFrameDiff and block steps exactly', () => {
    const W = 96, H = 54, N = 9;
    const frameAt = (t: number): Uint8Array => {
      const u = new Uint8Array(W * H * 4);
      for (let p = 0; p < W * H; p++) {
        const v = (p * 31 + t * 57 + ((p * t) % 13) * 9) & 255;
        u[p * 4] = v; u[p * 4 + 1] = (v * 3) & 255; u[p * 4 + 2] = 255 - v; u[p * 4 + 3] = 255;
      }
      return u;
    };
    let t = -1;
    const fake = {
      __mv: {
        setPost(): void { /* recorded nowhere */ }, setLayerVisible(): void { /* nothing */ }, forceFeel(): void { /* nothing */ },
        renderAt(): number { t++; return 1; },
        pixels(): Uint8Array { return frameAt(t); },
        stats(): { width: number; height: number } { return { width: W, height: H }; },
      },
    };
    (globalThis as unknown as { window: unknown }).window = fake;
    const args: SeqArgs = {
      chunk: 10, local: 60, tick: 0, frames: N, du: 1.3333, dticks: 2, post: 'full', layers: [], feel: null,
      sparkleBands: [[0, 20], [20, H]], diffBands: [[0, H]], thresh: SPARKLE_THRESH, heat: true, heatGain: 8,
      slitRows: [5], slitCols: [7], blocks: true, curvesEvery: 3, stripBox: [0, 0, 16, 9], stripAt: 2, stripCount: 3, keepFramesAt: [4],
    };
    const r = runSequence(args);
    delete (globalThis as unknown as { window?: unknown }).window;
    // Node's view: the same frames flipped to top-down, then the pure metrics.
    const top: Rgba[] = [];
    for (let k = 0; k < N; k++) {
      const bu = frameAt(k), td = new Uint8Array(bu.length);
      for (let y = 0; y < H; y++) td.set(bu.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
      top.push({ w: W, h: H, rgba: td });
    }
    const L = top.map((f) => lumaImage(W, H, f.rgba));
    expect(r.sparkle[0]).toBeCloseTo(sparkleShare(W, L, 0, 20, SPARKLE_THRESH), 12);
    expect(r.sparkle[1]).toBeCloseTo(sparkleShare(W, L, 20, H, SPARKLE_THRESH), 12);
    expect(r.diff[0]).toBeCloseTo(meanFrameDiff(W, L, 0, H), 9);
    expect(r.kept[0]!.frame).toBe(4);
    expect(Buffer.from(r.kept[0]!.b64, 'base64').equals(Buffer.from(top[4]!.rgba))).toBe(true);
    expect(r.strips.length).toBe(3);
    expect(r.curves.map((c) => c.frame)).toEqual([0, 3, 6]);
    expect(r.ends[1]).toEqual({ chunk: 10 + Math.floor((60 + 8 * 1.3333) / 64), local: 60 + 8 * 1.3333 - 64, tick: 16 });
    expect(r.meanLuma.length).toBe(N);
    // Slit row 5 at frame 2 equals row 5 of top-down frame 2.
    const slit = Buffer.from(r.slitRows[0]!, 'base64');
    expect(slit.subarray(2 * W * 4, 3 * W * 4).equals(Buffer.from(top[2]!.rgba.subarray(5 * W * 4, 6 * W * 4)))).toBe(true);
  });

  test('the unused-band and limit tables are consistent', () => {
    expect(BANDS.farFloor[0]).toBeLessThan(BANDS.farFloor[1]);
    expect(LIMITS.W3.dir).toBe('max');
    expect(LIMITS.W2.dir).toBe('min');
  });
});
