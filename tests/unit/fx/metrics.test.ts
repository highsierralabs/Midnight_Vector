// A6: the pixel metrics, on synthetic arrays with known answers, so a gate built on them means what it says.
import { describe, expect, it } from 'vitest';
import {
  byteDiff, channelStd, darkSaturation, hazeLift, lightRadius, litSaturation, maxRowStep, meanLuma, rowChanges, rowMeans, spectrum,
  washout,
} from '../../../src/render/fx/dev/metrics';

function frame(pixels: readonly (readonly [number, number, number])[]): Uint8Array {
  const out = new Uint8Array(pixels.length * 4);
  pixels.forEach(([r, g, b], i) => {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  });
  return out;
}

describe('washout', () => {
  it('counts near-white by the minimum channel, exactly', () => {
    const w = washout(frame([[236, 236, 236], [235, 255, 255], [255, 255, 236], [0, 0, 0]]));
    expect(w.nearWhitePct).toBe(50);
  });

  it('means max minus min over all pixels, exactly', () => {
    const w = washout(frame([[100, 50, 0], [10, 10, 10], [255, 0, 0], [30, 40, 50]]));
    expect(w.meanChroma).toBe((100 + 0 + 255 + 20) / 4);
  });
});

describe('hazeLift', () => {
  it('is the difference of Rec.709 mean lumas, exactly', () => {
    const on = frame([[10, 20, 30], [40, 50, 60]]);
    const off = frame([[0, 0, 0], [10, 10, 10]]);
    const lum = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    expect(meanLuma(off)).toBeCloseTo(5, 9);
    expect(hazeLift(on, off)).toBeCloseTo((lum(10, 20, 30) + lum(40, 50, 60)) / 2 - 5, 9);
  });
});

describe('litSaturation', () => {
  it('means (max - min) / max over lit pixels only, exactly', () => {
    // 100,50,50 is .5; 200,200,200 is 0; 31,0,0 is below the cut and ignored; 64,0,32 is 1.
    expect(litSaturation(frame([[100, 50, 50], [200, 200, 200], [31, 0, 0], [64, 0, 32]]))).toBe(0.5);
    expect(litSaturation(frame([[31, 0, 0]]))).toBe(0);
    expect(litSaturation(frame([[31, 0, 0]]), 31)).toBe(1);
  });
});

describe('darkSaturation', () => {
  it('reads saturation after, only where before was dark, skipping black', () => {
    const before = frame([[10, 20, 30], [63, 0, 0], [64, 0, 0], [0, 0, 0]]);
    // .5 and 0 count; the third was not dark before; the fourth is black after.
    const after = frame([[100, 50, 50], [90, 90, 90], [255, 0, 0], [0, 0, 0]]);
    expect(darkSaturation(after, before)).toEqual({ saturation: 0.25, pixels: 2 });
    expect(darkSaturation(after, before, 65)).toEqual({ saturation: 0.5, pixels: 3 });
  });

  it('refuses arrays of different size', () => {
    expect(() => darkSaturation(new Uint8Array(4), new Uint8Array(8))).toThrow();
  });
});

describe('rowChanges', () => {
  // Three rows of 4 pixels. Row 0 equal, row 1 all changed by 9, row 2 one pixel by 9 and one by exactly tol.
  const a = frame(Array.from({ length: 12 }, () => [50, 60, 70] as const));
  const b = frame([
    [50, 60, 70], [50, 60, 70], [50, 60, 70], [50, 60, 70],
    [59, 60, 70], [50, 69, 70], [50, 60, 79], [41, 60, 70],
    [50, 60, 79], [51, 60, 70], [50, 60, 70], [50, 60, 70],
  ]);

  it('counts whole and partial rows, ignoring differences of tol or less', () => {
    expect(rowChanges(a, b, 4, 1)).toEqual({ swapped: 1, partial: 1, rows: 3 });
    expect(rowChanges(a, b, 4, 9)).toEqual({ swapped: 0, partial: 0, rows: 3 });
  });

  it('refuses arrays of different size', () => {
    expect(() => rowChanges(new Uint8Array(16), new Uint8Array(32), 4, 1)).toThrow();
  });
});

describe('lightRadius', () => {
  // One row of 5 pixels, centre at x 0. Light 30 at x 2 and 10 at x 4: radius (60 + 40) / 40 = 2.5.
  const off = frame([[5, 5, 5], [5, 5, 5], [5, 5, 5], [5, 5, 5], [5, 5, 5]]);
  const on = frame([[5, 5, 5], [5, 5, 5], [15, 15, 15], [4, 4, 4], [15, 5, 5]]);

  it('weights distance by added light, ignoring pixels that lost light', () => {
    expect(lightRadius(on, off, 5, 0, 0, 0, 10)).toEqual({ radius: 2.5, light: 40 });
  });

  it('counts only the annulus asked for', () => {
    expect(lightRadius(on, off, 5, 0, 0, 3, 10)).toEqual({ radius: 4, light: 10 });
    expect(lightRadius(off, off, 5, 0, 0, 0, 10)).toEqual({ radius: 0, light: 0 });
  });
});

describe('byteDiff', () => {
  it('counts bytes and the largest difference', () => {
    const d = byteDiff(new Uint8Array([1, 2, 3, 4]), new Uint8Array([1, 3, 3, 9]));
    expect(d).toEqual({ bytes: 2, max: 5, sum: 6 });
  });

  it('refuses arrays of different size rather than comparing a prefix', () => {
    expect(() => byteDiff(new Uint8Array(4), new Uint8Array(8))).toThrow();
  });
});

describe('rows', () => {
  // Two rows of 2 pixels: green 10, 20 then 30, 50.
  const px = frame([[0, 10, 0], [0, 20, 0], [0, 30, 0], [0, 50, 0]]);
  const r = { x0: 0, x1: 2, y0: 0, y1: 2 };

  it('rowMeans', () => {
    expect(Array.from(rowMeans(px, 2, r, 1))).toEqual([15, 40]);
  });

  it('maxRowStep takes the largest channel', () => {
    expect(maxRowStep(px, 2, r)).toBe(25);
  });

  it('channelStd over a known pair, with a row step that skips the other row', () => {
    expect(channelStd(px, 2, r, 1, 2)).toBeCloseTo(5, 9);
    expect(channelStd(px, 2, r, 0, 1)).toBe(0);
  });
});

describe('spectrum', () => {
  /** The Crt's own rule in rows: dark when mod(i, p) is at or past p - dark - .5. */
  function hard(n: number, p: number, swing: number): Float64Array {
    const dark = Math.floor(p / 3 + 0.5);
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = 100 - (i % p >= p - dark - 0.5 ? swing : 0);
    return out;
  }

  it('finds period 3 on a 3-row pattern, with nothing below it', () => {
    const s = spectrum(hard(300, 3, 10));
    expect(s.period).toBe(3);
    expect(s.amp).toBeGreaterThan(1);
    expect(s.low).toBeLessThan(0.01);
  });

  it('sees the beat of a period 2.2 pattern, which is what moire looks like', () => {
    const s = spectrum(hard(512, 2.2, 10));
    expect(s.low).toBeGreaterThan(0.5);
  });

  it('leaks very little at the 512 rows the DPR test reads', () => {
    expect(spectrum(hard(512, 3, 3)).low).toBeLessThan(0.05);
  });
});
