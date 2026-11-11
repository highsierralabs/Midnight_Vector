import { describe, expect, it } from 'vitest';
import { DebugPaint } from '../../../src/contracts/index';
import {
  bandDiff, byteDiff, byteDiffRange, crackCount, edgeCounts, hazeLift, leakStats, meanLuma, nonZeroCount, percentile, probeShift, shimmerBand,
  silhouetteStd, skyCount, slopePerFrame, washout, windowMedian, windowStability,
} from '../../../src/harness/metrics';

const SKY = [255, 0, 255, 255] as const;
const GROUND = [20, 120, 60, 255] as const;

/** Rows are listed from the top, and stored bottom-up, as gl.readPixels gives them. */
function frame(rows: readonly (readonly (readonly number[])[])[]): { px: Uint8Array; w: number; h: number } {
  const h = rows.length;
  const w = rows[0]!.length;
  const px = new Uint8Array(w * h * 4);
  rows.forEach((row, r) => {
    row.forEach((p, c) => { px.set(p, ((h - 1 - r) * w + c) * 4); });
  });
  return { px, w, h };
}

function fill(w: number, h: number, p: readonly number[]): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set(p, i * 4);
  return px;
}

describe('byteDiff', () => {
  it('counts one changed byte as exactly one, with its size and place', () => {
    const a = fill(4, 4, [10, 20, 30, 255]);
    const b = a.slice();
    b[17] = 27;
    expect(byteDiff(a, a)).toEqual({ bytes: 0, max: 0, first: -1 });
    expect(byteDiff(a, b)).toEqual({ bytes: 1, max: 7, first: 17 });
  });

  it('sums every differing byte and keeps the largest', () => {
    const a = new Uint8Array([0, 0, 0, 0]);
    const b = new Uint8Array([1, 0, 250, 3]);
    expect(byteDiff(a, b)).toEqual({ bytes: 3, max: 250, first: 0 });
  });

  it('refuses frames of different length', () => {
    expect(() => byteDiff(new Uint8Array(4), new Uint8Array(8))).toThrow(RangeError);
  });

  it('compares a frame held inside a long store, at the right offset', () => {
    const store = new Uint8Array(12);
    store.set([1, 2, 3, 4], 4);
    expect(byteDiffRange(store, 4, new Uint8Array([1, 2, 3, 4]), 4).bytes).toBe(0);
    expect(byteDiffRange(store, 0, new Uint8Array([1, 2, 3, 4]), 4).bytes).toBe(4);
    expect(byteDiffRange(store, 4, new Uint8Array([1, 2, 9, 4]), 4)).toEqual({ bytes: 1, max: 6, first: 2 });
  });
});

describe('bandDiff', () => {
  it('is the mean over R, G and B, ignoring alpha', () => {
    const a = fill(2, 2, [10, 10, 10, 0]);
    const b = fill(2, 2, [13, 10, 4, 255]);
    expect(bandDiff(a, b, 2, 2, 0, 2)).toBeCloseTo((3 + 0 + 6) / 3, 9);
  });

  it('counts rows from the top, so a frame flipped top for bottom differs on an asymmetric band', () => {
    const top = [200, 200, 200, 255];
    const bottom = [0, 0, 0, 255];
    const a = frame([[top, top], [bottom, bottom], [bottom, bottom]]);
    const flipped = frame([[bottom, bottom], [bottom, bottom], [top, top]]);
    const black = fill(2, 3, bottom);
    expect(bandDiff(a.px, black, 2, 3, 0, 1)).toBe(200);
    expect(bandDiff(a.px, black, 2, 3, 2, 3)).toBe(0);
    expect(bandDiff(flipped.px, black, 2, 3, 0, 1)).toBe(0);
    expect(bandDiff(flipped.px, black, 2, 3, 2, 3)).toBe(200);
  });

  it('refuses a band that does not fit', () => {
    expect(() => bandDiff(fill(2, 2, GROUND), fill(2, 2, GROUND), 2, 2, 1, 3)).toThrow(RangeError);
    expect(() => bandDiff(fill(2, 2, GROUND), fill(2, 2, GROUND), 2, 2, 1, 1)).toThrow(RangeError);
  });
});

describe('shimmerBand', () => {
  it('is T03 band at 1080p, and scales', () => {
    expect(shimmerBand(1080)).toEqual([615, 650]);
    expect(shimmerBand(900)).toEqual([513, 542]);
  });
});

describe('crackCount', () => {
  it('counts a sky pixel under terrain', () => {
    const f = frame([[SKY, SKY], [GROUND, GROUND], [SKY, GROUND], [GROUND, GROUND]]);
    expect(crackCount(f.px, f.w, f.h)).toBe(1);
  });

  it('does not count sky above terrain', () => {
    const f = frame([[SKY, SKY], [SKY, GROUND], [GROUND, GROUND]]);
    expect(crackCount(f.px, f.w, f.h)).toBe(0);
  });

  it('reads 0 on all sky and on all terrain', () => {
    expect(crackCount(fill(3, 3, SKY), 3, 3)).toBe(0);
    expect(crackCount(fill(3, 3, GROUND), 3, 3)).toBe(0);
  });

  it('flipping a frame turns sky above into sky below, so orientation is pinned', () => {
    const f = frame([[SKY, SKY], [GROUND, GROUND]]);
    const flipped = frame([[GROUND, GROUND], [SKY, SKY]]);
    expect(crackCount(f.px, f.w, f.h)).toBe(0);
    expect(crackCount(flipped.px, flipped.w, flipped.h)).toBe(2);
  });

  it('holds its predicate at the edges of DebugPaint.CLEAR', () => {
    const lit = [201, 59, 201, 255];
    const notSky = [200, 59, 201, 255];
    const a = frame([[GROUND], [lit]]);
    const b = frame([[GROUND], [notSky]]);
    expect(crackCount(a.px, a.w, a.h)).toBe(1);
    expect(crackCount(b.px, b.w, b.h)).toBe(0);
  });
});

describe('silhouetteStd', () => {
  it('reads 0 on a flat skyline and more on a sawtooth', () => {
    const flat = frame([[SKY, SKY, SKY, SKY], [GROUND, GROUND, GROUND, GROUND]]);
    expect(silhouetteStd(flat.px, flat.w, flat.h)).toBe(0);
    const saw = frame([[GROUND, SKY, GROUND, SKY], [GROUND, GROUND, GROUND, GROUND]]);
    expect(silhouetteStd(saw.px, saw.w, saw.h)).toBeCloseTo(0.5, 9);
  });

  it('reads 0 if any column has no terrain, so a part-sky frame cannot pass a lower limit', () => {
    const part = frame([[GROUND, SKY], [GROUND, SKY]]);
    expect(silhouetteStd(part.px, part.w, part.h)).toBe(0);
    expect(silhouetteStd(fill(3, 3, SKY), 3, 3)).toBe(0);
  });
});

describe('edgeCounts', () => {
  const byte = (v: number): number => Math.round(v * 255);
  const of = (c: readonly number[]): number[] => [byte(c[0]!), byte(c[1]!), byte(c[2]!), 255];

  it('classifies the exact DebugPaint values', () => {
    const f = frame([[of(DebugPaint.EDGE_OK), of(DebugPaint.EDGE_BAD), of(DebugPaint.EDGE_INTERIOR), SKY, of(DebugPaint.FLAT)]]);
    expect(edgeCounts(f.px, f.w, f.h)).toEqual({ ok: 1, bad: 1, interior: 1, clear: 1, other: 1 });
  });

  it('keeps interior at 26 plus or minus 6, on all channels', () => {
    const f = frame([[[20, 32, 26, 255], [19, 26, 26, 255], [26, 33, 26, 255]]]);
    expect(edgeCounts(f.px, f.w, f.h)).toEqual({ ok: 0, bad: 0, interior: 1, clear: 0, other: 2 });
  });

  it('every pixel lands in exactly one class', () => {
    const f = fill(5, 5, [100, 100, 100, 255]);
    const c = edgeCounts(f, 5, 5);
    expect(c.ok + c.bad + c.interior + c.clear + c.other).toBe(25);
  });
});

describe('washout', () => {
  it('holds near-white at min(r, g, b) above 235: 235 is not, 236 is', () => {
    const f = frame([[[235, 255, 255, 255], [236, 236, 236, 255], [255, 255, 235, 255], [240, 240, 240, 255]]]);
    expect(washout(f.px, f.w, f.h).nearWhitePct).toBe(50);
  });

  it('gives exact chroma and luma on a small frame', () => {
    const f = frame([[[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [10, 10, 10, 255]]]);
    const m = washout(f.px, f.w, f.h);
    expect(m.meanChroma).toBe((255 * 3) / 4);
    expect(m.meanLuma).toBeCloseTo((255 * (0.2126 + 0.7152 + 0.0722) + 10) / 4, 9);
  });

  it('blackP10 is a nearest-rank percentile of rounded luma', () => {
    const rows = [Array.from({ length: 20 }, (_, i) => [i * 10, i * 10, i * 10, 255])];
    const f = frame(rows);
    // ceil(.1 * 20) = 2, so the second smallest.
    expect(washout(f.px, f.w, f.h).blackP10).toBe(10);
    const one = frame([[[7, 7, 7, 255]]]);
    expect(washout(one.px, one.w, one.h).blackP10).toBe(7);
  });
});

describe('hazeLift and meanLuma', () => {
  it('is mean luma of on minus off, exact to 1e-9', () => {
    const on = fill(2, 2, [100, 50, 25, 255]);
    const off = fill(2, 2, [80, 50, 25, 255]);
    expect(hazeLift(on, off, 2, 2)).toBeCloseTo(0.2126 * 20, 9);
    expect(Math.abs(hazeLift(on, off, 2, 2) - 4.252)).toBeLessThan(1e-9);
  });

  it('meanLuma of a one-colour frame is its luma', () => {
    expect(meanLuma(fill(3, 3, [255, 255, 255, 255]))).toBeCloseTo(255, 9);
    expect(meanLuma(new Uint8Array(0))).toBe(0);
  });
});

describe('counts', () => {
  it('nonZeroCount ignores alpha, so a blank opaque frame reads 0', () => {
    expect(nonZeroCount(fill(2, 2, [0, 0, 0, 255]))).toBe(0);
    expect(nonZeroCount(fill(2, 2, [0, 1, 0, 0]))).toBe(4);
  });

  it('skyCount uses the sky predicate', () => {
    expect(skyCount(fill(2, 2, SKY))).toBe(4);
    expect(skyCount(fill(2, 2, GROUND))).toBe(0);
  });
});

describe('percentile', () => {
  it('uses nearest rank on a sorted copy, and leaves its input alone', () => {
    const v = [5, 1, 4, 2, 3];
    expect(percentile(v, 0.5)).toBe(3);
    expect(percentile(v, 0.95)).toBe(5);
    expect(percentile(v, 0)).toBe(1);
    expect(percentile(v, 1)).toBe(5);
    expect(v).toEqual([5, 1, 4, 2, 3]);
  });

  it('reads NaN on nothing', () => {
    expect(percentile([], 0.5)).toBeNaN();
  });
});

describe('windowMedian', () => {
  it('drops negatives, and divides by the window length', () => {
    expect(windowMedian([100, -5000, 120, 110], 10)).toEqual({ median: 11, dropped: 1 });
  });

  it('averages the two middle values of an even count', () => {
    expect(windowMedian([10, 20, 30, 40], 1)).toEqual({ median: 25, dropped: 0 });
  });

  it('keeps zero, because a window with no allocation is real', () => {
    expect(windowMedian([0, 0, 0], 10)).toEqual({ median: 0, dropped: 0 });
  });

  it('reads NaN when every window held a scavenge, so a caller cannot read it as clean', () => {
    const r = windowMedian([-1, -2], 10);
    expect(r.median).toBeNaN();
    expect(r.dropped).toBe(2);
  });
});

describe('windowStability, B19s stability line (DI-77)', () => {
  const FRAC = 0.05;

  it('passes the app series T10 measured, which never agreed within 1 B', () => {
    // D-005: spreads of 296, 234.4 and 293.8 B over about 8.8 KB [O: T10].
    expect(windowStability([8812, 8629.2, 8925.2], FRAC).stable).toBe(true);
    expect(windowStability([8782.8, 8648.8, 8883.2], FRAC).stable).toBe(true);
    expect(windowStability([8770, 8630.4, 8924.2], FRAC).stable).toBe(true);
  });

  it('reports the mean and the worst deviation from it, as a fraction', () => {
    const r = windowStability([95, 100, 105], FRAC);
    expect(r.mean).toBe(100);
    expect(r.worst).toBe(0.05);
    expect(r.stable).toBe(true);
  });

  it('passes the shell series, which settled within 1 B', () => {
    expect(windowStability([3848.4, 3761.8, 3761.6], FRAC).stable).toBe(true);
    const flat = windowStability([3761.6, 3761.6, 3761.6], FRAC);
    expect(flat.stable).toBe(true);
    expect(flat.mean).toBeCloseTo(3761.6, 9);
    expect(flat.worst).toBeCloseTo(0, 12);
  });

  it('control: fails a truly unstable series', () => {
    // Climbing 10% a run, as an allocation that grows with distance would.
    const climb = windowStability([8000, 8800, 9680], FRAC);
    expect(climb.stable).toBe(false);
    expect(climb.worst).toBeGreaterThan(0.09);
    // One run 25% off, as a burst of streaming or a JIT deopt would.
    expect(windowStability([8800, 8800, 11000], FRAC).stable).toBe(false);
    // Just past the line on either side of the mean.
    expect(windowStability([94, 100, 106], FRAC).stable).toBe(false);
  });

  it('reads only the last three', () => {
    expect(windowStability([20000, 8812, 8629.2, 8925.2], FRAC).stable).toBe(true);
    expect(windowStability([8812, 8629.2, 8925.2, 20000], FRAC).stable).toBe(false);
  });

  it('is not stable on fewer than three, a non-finite median, or a mean that is not positive', () => {
    expect(windowStability([8800, 8800], FRAC).stable).toBe(false);
    expect(windowStability([], FRAC).stable).toBe(false);
    expect(windowStability([8800, Number.NaN, 8800], FRAC).stable).toBe(false);
    expect(windowStability([8800, Number.POSITIVE_INFINITY, 8800], FRAC).stable).toBe(false);
    expect(windowStability([0, 0, 0], FRAC).stable).toBe(false);
  });
});

describe('probeShift, B19s windows control (DI-84)', () => {
  // Window medians with and without the probe, in B/frame, from repair D's probe runs [O: T09, d-pairs-app and d-pairs-shell].
  // These hold the function at DI-84's 256 B tolerances. The lines B19 runs per target, the app's 1024 +/- 256 since
  // DI-86(2), are WINDOWS_CONTROL in tests/perf/support/heap.ts, tested in heap.test.ts.
  const APP = 64;
  const SHELL = 16;

  it('passes every interleaved 256 B reading on the app at 256 +/- 64', () => {
    const pairs: readonly (readonly [number, number])[] = [
      [8980.4, 8772.8], [8765.6, 8544.8], [8752.8, 8525.4], [9213.4, 8949.2], [9049, 8801.2], [8794, 8565],
    ];
    for (const [on, off] of pairs) expect(probeShift(on, off, 256, APP).ok, `${on} - ${off}`).toBe(true);
    const r = probeShift(9213.4, 8949.2, 256, APP);
    expect(r.moved).toBeCloseTo(264.2, 6);
    expect(r.error).toBeCloseTo(8.2, 6);
  });

  it('control: a probe of 0 fails the interleaved form, on either target', () => {
    // No probe either side: what an "on" window reads when the probe does nothing.
    expect(probeShift(8966.4, 9062.8, 256, APP).ok).toBe(false);
    expect(probeShift(8951.2, 8955.8, 256, APP).ok).toBe(false);
    expect(probeShift(3761.6, 3761.6, 256, APP).ok).toBe(false);
    expect(probeShift(3761.6, 3761.6, 256, SHELL).ok).toBe(false);
  });

  it('fails the sequential app readings at +/- 64 too, so the form matters and not only the tolerance', () => {
    expect(probeShift(9277.6, 8761.2, 256, APP).ok).toBe(false);
    expect(probeShift(9007.6, 8443.2, 256, APP).ok).toBe(false);
    expect(probeShift(8772.8, 8684, 256, APP).ok).toBe(false);
  });

  it('passes the shell at 256 +/- 16, and fails it just past', () => {
    expect(probeShift(4018, 3761.6, 256, SHELL).ok).toBe(true);
    expect(probeShift(4017.6, 3761.6, 256, SHELL).ok).toBe(true);
    // At the edges, values exact in binary, so the line is tested and not a rounding error.
    expect(probeShift(4033.5, 3761.5, 256, SHELL).ok).toBe(true);
    expect(probeShift(4001.5, 3761.5, 256, SHELL).ok).toBe(true);
    expect(probeShift(4034, 3761.5, 256, SHELL).ok).toBe(false);
    expect(probeShift(4001, 3761.5, 256, SHELL).ok).toBe(false);
  });

  it('a 1024 B probe reads within the app tolerance, so the instrument still measures there', () => {
    expect(probeShift(9737.2, 8737.6, 1024, APP).ok).toBe(true);
    expect(probeShift(4785.6, 3761.6, 1024, SHELL).ok).toBe(true);
  });

  it('a reading that measured nothing fails', () => {
    expect(probeShift(Number.NaN, 3761.6, 256, SHELL).ok).toBe(false);
    expect(probeShift(4017.6, Number.NaN, 256, APP).ok).toBe(false);
    expect(probeShift(Number.POSITIVE_INFINITY, 3761.6, 256, APP).ok).toBe(false);
  });

  it('refuses a control no larger than its tolerance, which a probe of 0 would pass', () => {
    expect(() => probeShift(3761.6, 3761.6, 64, APP)).toThrow(RangeError);
    expect(() => probeShift(3761.6, 3761.6, 0, SHELL)).toThrow(RangeError);
  });
});

describe('leakStats', () => {
  it('reads a known array exactly', () => {
    expect(leakStats([100, 90, 140, 130, 135])).toEqual({ growth: 35, lastThreeSpread: 10, max: 140 });
  });

  it('copes with fewer than three samples', () => {
    expect(leakStats([5, 8])).toEqual({ growth: 3, lastThreeSpread: 3, max: 8 });
    expect(leakStats([])).toEqual({ growth: 0, lastThreeSpread: 0, max: 0 });
  });
});

describe('slopePerFrame', () => {
  it('is bytes per frame', () => {
    expect(slopePerFrame(1000, 5000, 400)).toBe(10);
  });
});
