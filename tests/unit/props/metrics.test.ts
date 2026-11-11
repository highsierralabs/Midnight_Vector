// A17: the judging tool itself, on hand-built images.
import { describe, expect, it } from 'vitest';
import {
  centroid, contractChroma, contractNearWhite, frameDiff, iou, maxPairIoU, meanChroma, nearWhiteFraction, pairScores, pixelDiff, silhouetteMask,
} from '../../../src/render/props/dev/metrics';

function blank(w: number, h: number, v = 255): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  out.fill(v);
  return out;
}

function fillRect(img: Uint8Array, w: number, x0: number, y0: number, x1: number, y1: number, v = 0): void {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) for (let k = 0; k < 3; k++) img[(y * w + x) * 4 + k] = v;
}

describe('silhouetteMask and iou', () => {
  it('gives a mask iou 1 with itself and 0 with a disjoint one', () => {
    const a = new Uint8Array(64 * 64);
    const b = new Uint8Array(64 * 64);
    a.fill(1, 0, 100);
    b.fill(1, 200, 300);
    expect(iou(a, a)).toBe(1);
    expect(iou(a, b)).toBe(0);
    expect(iou(new Uint8Array(4), new Uint8Array(4))).toBe(0);
  });

  it('crops and centres, whatever the position', () => {
    const w = 200;
    const h = 200;
    const left = blank(w, h);
    const right = blank(w, h);
    fillRect(left, w, 10, 10, 50, 90);
    fillRect(right, w, 120, 100, 160, 180);
    expect(iou(silhouetteMask(left, w, h), silhouetteMask(right, w, h))).toBeCloseTo(1, 3);
  });

  it('scales any size to the same mask', () => {
    const w = 400;
    const h = 400;
    const small = blank(w, h);
    const large = blank(w, h);
    fillRect(small, w, 10, 10, 30, 50);
    fillRect(large, w, 100, 100, 200, 300);
    expect(iou(silhouetteMask(small, w, h), silhouetteMask(large, w, h))).toBeGreaterThan(0.95);
  });

  it('preserves aspect: an obelisk-shaped and a pyramid-shaped mask score low', () => {
    const w = 400;
    const h = 400;
    const obelisk = blank(w, h);
    fillRect(obelisk, w, 195, 40, 215, 360);
    const pyramid = blank(w, h);
    // A pyramid 40 tall on a base 56 wide.
    for (let y = 100; y < 300; y++) {
      const half = ((y - 100) / 200) * 140;
      for (let x = Math.floor(200 - half); x < 200 + half; x++) for (let k = 0; k < 3; k++) pyramid[(y * w + x) * 4 + k] = 0;
    }
    const score = iou(silhouetteMask(obelisk, w, h), silhouetteMask(pyramid, w, h));
    console.log(`A17 obelisk against pyramid: ${score.toFixed(3)}`);
    expect(score).toBeLessThan(0.25);
  });

  it('negative control: without aspect, the same two would look more alike', () => {
    // Stretching both to fill a square raises the overlap, which is why aspect is preserved.
    const m = new Uint8Array(64 * 64);
    const n = new Uint8Array(64 * 64);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        m[y * 64 + x] = 1;
        n[y * 64 + x] = x >= 32 - y / 2 && x < 32 + y / 2 ? 1 : 0;
      }
    }
    expect(iou(m, n)).toBeGreaterThan(0.25);
  });

  it('finds a thin mast, which a point sample would miss', () => {
    const w = 640;
    const h = 640;
    const img = blank(w, h);
    fillRect(img, w, 300, 20, 301, 620);
    const mask = silhouetteMask(img, w, h);
    let lit = 0;
    for (let i = 0; i < mask.length; i++) lit += mask[i]!;
    expect(lit).toBeGreaterThanOrEqual(60);
  });

  it('returns an empty mask for a white image', () => {
    const mask = silhouetteMask(blank(8, 8), 8, 8);
    expect(mask.every((v) => v === 0)).toBe(true);
  });
});

describe('maxPairIoU and pairScores', () => {
  const a = new Uint8Array(16).fill(1);
  const b = new Uint8Array(16).fill(1);
  const c = new Uint8Array(16);
  c[0] = 1;
  it('finds identical masks at 1', () => {
    expect(maxPairIoU([a, b, c])).toBe(1);
  });
  it('sorts pairs, highest first', () => {
    const s = pairScores([a, b, c]);
    expect(s[0]!.iou).toBe(1);
    expect(s.length).toBe(3);
    expect(s[2]!.iou).toBeLessThan(0.1);
  });
});

describe('near-white and chroma', () => {
  const img = Uint8Array.from([
    255, 255, 255, 255,   // near-white
    250, 244, 250, 255,   // not, by T05's rule (244). Is, by the contract's (> 235)
    200, 40, 40, 255,     // chroma 160
    10, 10, 10, 255,      // too dark to count, by T05's rule
  ]);
  it('nearWhiteFraction takes all channels at or above 245', () => {
    expect(nearWhiteFraction(img)).toBeCloseTo(1 / 4, 6);
  });
  it('meanChroma takes pixels with max at or above 32', () => {
    expect(meanChroma(img)).toBeCloseTo((0 + 6 + 160) / 3, 6);
  });
  it('the contract definitions differ as section 8.1 says', () => {
    expect(contractNearWhite(img)).toBeCloseTo(2 / 4, 6);
    expect(contractChroma(img)).toBeCloseTo((0 + 6 + 160 + 0) / 4, 6);
  });
});

describe('frame comparison', () => {
  it('frameDiff averages bytes over a row range', () => {
    const a = new Uint8Array(4 * 4 * 2);
    const b = new Uint8Array(4 * 4 * 2);
    b[0] = 30;
    expect(frameDiff(a, b, 4, 2)).toBeCloseTo(30 / 24, 6);
    expect(frameDiff(a, b, 4, 2, 1, 2)).toBe(0);
  });
  it('pixelDiff counts a pixel once, whatever its channels', () => {
    const a = new Uint8Array(8);
    const b = Uint8Array.from([1, 2, 0, 0, 0, 0, 0, 0]);
    expect(pixelDiff(a, b)).toEqual({ pixels: 1, bytes: 2, max: 2 });
  });
  it('centroid finds the middle of a lit block', () => {
    const w = 10;
    const img = new Uint8Array(10 * 10 * 4);
    fillRect(img, w, 2, 4, 4, 6, 200);
    const c = centroid(img, w, 10, 16, false);
    expect(c.x).toBeCloseTo(3, 6);
    expect(c.y).toBeCloseTo(5, 6);
    expect(c.count).toBe(4);
  });
});
