import { describe, expect, it } from 'vitest';
import {
  bandChanges, countPeaks, diffBytes, findStars, firstEdgeRow, hashBytes, lumaImage, meanRadius, peakRow, photometry, pixelAt, trackStars,
  type Frame,
} from '../../../src/render/sky/dev/metrics';

const W = 64, H = 200;

/** Rows counted from the top, as a screen is read; stored bottom-up, as pixels() returns them. */
function makeFrame(w: number, h: number, value: (x: number, row: number) => number): Frame {
  const data = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row++) {
    for (let x = 0; x < w; x++) {
      const i = ((h - 1 - row) * w + x) * 4;
      const v = value(x, row);
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, w, h };
}

/** Deterministic pseudo-noise in [0, 1). */
function noise(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function gaussianStar(w: number, h: number, cx: number, cy: number, peak: number, sigma: number): Float32Array {
  const l = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      l[y * w + x] = peak * Math.exp(-d2 / (2 * sigma * sigma));
    }
  }
  return l;
}

describe('bandChanges', () => {
  it('reads exactly 1.00 changes per level on a staircase, and over 1.3 on a dithered one', () => {
    const ramp = (row: number): number => 20 + row / 8;
    const staircase = makeFrame(W, H, (_x, row) => Math.floor(ramp(row)));
    const dithered = makeFrame(W, H, (x, row) => Math.floor(ramp(row) + noise(x, row)));
    const a = bandChanges(staircase, 0, W, 0, H);
    const b = bandChanges(dithered, 0, W, 0, H);
    for (const c of a) {
      expect(c.levels).toBeGreaterThanOrEqual(8);
      expect(c.changesPerLevel).toBe(1);
    }
    for (const c of b) expect(c.changesPerLevel).toBeGreaterThan(1.3);
  });
});

describe('trackStars', () => {
  const w = 120, h = 120;
  function run(peakAt: (f: number) => number, dx: number, dy: number) {
    const frames: Float32Array[] = [];
    for (let f = 0; f < 40; f++) frames.push(gaussianStar(w, h, 60 + dx * f, 60 + dy * f, peakAt(f), 1.1));
    const stars = findStars(frames[0]!, w, h, { x0: 0, x1: w, y0: 0, y1: h, minPeak: 50, maxNeighbour: 10, radius: 9 });
    return trackStars(frames, w, h, stars, dx, dy);
  }

  it('finds a stable star moving by a fraction of a pixel, under .05 CV', () => {
    const t = run(() => 200, 0.17, -0.17);
    expect(t.stars).toBe(1);
    expect(t.fluxP95).toBeLessThan(0.05);
  });

  it('reads over .4 on a flickering star', () => {
    const t = run((f) => (f % 2 === 0 ? 220 : 60), 0, 0);
    expect(t.stars).toBe(1);
    expect(t.fluxP95).toBeGreaterThan(0.4);
    expect(t.peakP95).toBeGreaterThan(0.4);
  });

  it('reads high when the motion is compensated with the wrong sign', () => {
    const frames: Float32Array[] = [];
    for (let f = 0; f < 40; f++) frames.push(gaussianStar(w, h, 40 + f, 60, 200, 1.1));
    const stars = findStars(frames[0]!, w, h, { x0: 0, x1: w, y0: 0, y1: h, minPeak: 50, maxNeighbour: 10, radius: 9 });
    expect(trackStars(frames, w, h, stars, -1, 0).fluxP95).toBeGreaterThan(0.4);
    expect(trackStars(frames, w, h, stars, 1, 0).fluxP95).toBeLessThan(0.05);
  });
});

describe('findStars', () => {
  it('rejects a star with a neighbour inside the isolation radius, and one below the peak limit', () => {
    const w = 80, h = 80;
    const lone = gaussianStar(w, h, 40, 40, 200, 1);
    expect(findStars(lone, w, h, { x0: 0, x1: w, y0: 0, y1: h, minPeak: 50, maxNeighbour: 10, radius: 9 })).toEqual([{ x: 40, y: 40 }]);
    const near = gaussianStar(w, h, 40, 40, 200, 1);
    const other = gaussianStar(w, h, 46, 40, 200, 1);
    for (let i = 0; i < near.length; i++) near[i]! += other[i]!;
    expect(findStars(near, w, h, { x0: 0, x1: w, y0: 0, y1: h, minPeak: 50, maxNeighbour: 10, radius: 9 })).toEqual([]);
    expect(findStars(lone, w, h, { x0: 0, x1: w, y0: 0, y1: h, minPeak: 250, maxNeighbour: 10, radius: 9 })).toEqual([]);
  });

  it('countPeaks counts both of two close stars, and a flat top once', () => {
    const w = 80, h = 80;
    const near = gaussianStar(w, h, 30, 40, 200, 1);
    const other = gaussianStar(w, h, 46, 40, 200, 1);
    for (let i = 0; i < near.length; i++) near[i]! += other[i]!;
    expect(countPeaks(near, w, h, 0, w, 0, h, 50)).toBe(2);
    const flat = new Float32Array(w * h);
    flat[40 * w + 40] = flat[40 * w + 41] = 100;
    expect(countPeaks(flat, w, h, 0, w, 0, h, 50)).toBe(1);
  });

  it('meanRadius scales with the star', () => {
    const w = 80, h = 80;
    const small = gaussianStar(w, h, 40, 40, 200, 1);
    const big = gaussianStar(w, h, 40, 40, 200, 2);
    const stars = [{ x: 40, y: 40 }];
    expect(meanRadius(big, w, stars, 9) / meanRadius(small, w, stars, 9)).toBeGreaterThan(1.7);
  });
});

describe('photometry', () => {
  it('counts near-white by the minimum channel, and chroma as max - min', () => {
    const white = makeFrame(10, 10, () => 240);
    expect(photometry(white)).toMatchObject({ nearWhite: 1, meanChroma: 0 });
    const grey = makeFrame(10, 10, () => 235);
    expect(photometry(grey).nearWhite).toBe(0);
    const magenta: Frame = { w: 2, h: 1, data: Uint8Array.from([255, 0, 200, 255, 255, 250, 240, 255]) };
    const p = photometry(magenta);
    expect(p.nearWhite).toBe(0.5);
    expect(p.meanChroma).toBe((255 + 15) / 2);
  });
});

describe('frame helpers', () => {
  it('diffBytes counts differing bytes and the largest difference', () => {
    expect(diffBytes(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 3))).toEqual({ bytes: 0, max: 0 });
    expect(diffBytes(Uint8Array.of(1, 2, 3), Uint8Array.of(9, 2, 4))).toEqual({ bytes: 2, max: 8 });
    expect(() => diffBytes(Uint8Array.of(1), Uint8Array.of(1, 2))).toThrow();
  });

  it('hashBytes changes on any one byte, in any position', () => {
    const a = new Uint8Array(4096);
    const base = hashBytes(a);
    expect(hashBytes(new Uint8Array(4096))).toBe(base);
    for (const at of [0, 1, 2048, 4095]) {
      const b = new Uint8Array(4096);
      b[at] = 1;
      expect(hashBytes(b)).not.toBe(base);
    }
  });

  it('reads rows from the top, though frames are stored bottom-up', () => {
    const f = makeFrame(4, 3, (_x, row) => row * 10);
    expect(pixelAt(f, 0, 0)).toEqual([0, 0, 0]);
    expect(pixelAt(f, 3, 2)).toEqual([20, 20, 20]);
  });

  it('firstEdgeRow finds a sharp rise, ignores a gentle slope, and reports none on a flat column', () => {
    const f = makeFrame(4, 100, (_x, row) => (row < 50 ? row * 0.5 : 200));
    expect(firstEdgeRow(f, 0, 0, 100, 8)).toBe(50);
    const flat = makeFrame(4, 100, () => 30);
    expect(firstEdgeRow(flat, 0, 0, 100, 8)).toBe(-1);
  });

  it('peakRow finds the brightest row, and lumaImage keeps the frame layout', () => {
    const f = makeFrame(4, 100, (_x, row) => (row === 37 ? 250 : 10));
    expect(peakRow(f, 2, 0, 100)).toBe(37);
    const l = lumaImage(f);
    expect(l[(100 - 1 - 37) * 4 + 2]).toBeCloseTo(250, 3);
  });
});
