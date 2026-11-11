import { describe, expect, it } from 'vitest';
import { CHUNK_LEN, CHUNK_LIMIT, CLIP_LEVELS, CLIP_REAR_ROWS, CLIP_ROWS, type Travel } from '../../../src/contracts/index';
import { HOLE, HOLE_S2, baseMod, baseRow, forwardOf, halfWidthOf, rowOffset, spacing } from '../../../src/render/terrain/layout';

/** Half-open uRowOffset ranges from section 5's M1 table: (lo, hi]. */
const OFFSET_RANGE: readonly (readonly [number, number])[] = [[-36, -32], [-40, -32], [-48, -32], [-64, -32], [-128, -64], [-256, -128]];
const CHUNKS = [0, 2 ** 40 + 3, CHUNK_LIMIT - 1];

function locals(n: number): number[] {
  return Array.from({ length: n }, (_, i) => (i * CHUNK_LEN) / n);
}

/** baseRow recomputed in BigInt, so a rounding error in the doubles cannot agree with itself. */
function exactBaseRow(k: number, cam: Travel): bigint {
  const s = spacing(k);
  const camRow = BigInt(cam.chunk) * BigInt(CHUNK_LEN / s) + BigInt(Math.floor(cam.local / s));
  return (camRow / 2n) * 2n - BigInt(CLIP_REAR_ROWS[k]!);
}

interface Margins { lateral: number; forward: number; rear: number }
/**
 * Cells of level k between its hole's edge and the footprint of the finer level, k - 1. A positive margin means the fine level
 * covers past the hole's edge; negative means a gap (or, at the rear, an overrun behind the camera).
 */
function holeMargins(k: number, cam: Travel, grow: number, hole: { c0: number; c1: number; r1: number } = HOLE): Margins {
  const s = spacing(k);
  const right = (halfWidthOf(k - 1) - (hole.c1 + grow - 64) * s) / s;
  const left = (halfWidthOf(k - 1) - (64 - (hole.c0 - grow)) * s) / s;
  const holeFar = (hole.r1 + grow) * s + rowOffset(k, cam);
  const fineFar = CLIP_ROWS * spacing(k - 1) + rowOffset(k - 1, cam);
  return {
    lateral: Math.min(left, right),
    forward: (fineFar - holeFar) / s,
    rear: (rowOffset(k, cam) - rowOffset(k - 1, cam)) / s,
  };
}

/** A phase of level 5's 128 u cycle is two chunks. Half-unit local steps visit every phase of every level. */
function everyPhase(visit: (cam: Travel) => void): void {
  for (const chunk of [0, 1, 2 ** 40, 2 ** 40 + 1, CHUNK_LIMIT - 2, CHUNK_LIMIT - 1]) {
    for (let local = 0; local < CHUNK_LEN; local += 0.5) visit({ chunk, local });
  }
}

describe('level table', () => {
  it('matches section 6.4', () => {
    expect([0, 1, 2, 3, 4, 5].map(spacing)).toEqual([2, 4, 8, 16, 32, 64]);
    expect([0, 1, 2, 3, 4, 5].map(forwardOf)).toEqual([160, 352, 736, 1504, 3008, 6016]);
    expect([0, 1, 2, 3, 4, 5].map(halfWidthOf)).toEqual([128, 256, 512, 1024, 2048, 4096]);
  });
});

describe('rows at any distance', () => {
  it('base row is even, offset is in range and slot is in [0, 128), checked against BigInt', () => {
    let checked = 0;
    for (const chunk of CHUNKS) {
      for (const local of locals(64)) {
        const cam = { chunk, local };
        for (let k = 0; k < CLIP_LEVELS; k++) {
          const base = baseRow(k, cam);
          expect(Number.isInteger(base)).toBe(true);
          expect(base % 2 === 0).toBe(true);
          expect(BigInt(base)).toBe(exactBaseRow(k, cam));
          const off = rowOffset(k, cam);
          const [lo, hi] = OFFSET_RANGE[k]!;
          expect(off).toBeGreaterThan(lo);
          expect(off).toBeLessThanOrEqual(hi);
          const mod = baseMod(k, cam);
          expect(Number.isInteger(mod)).toBe(true);
          expect(mod).toBeGreaterThanOrEqual(0);
          expect(mod).toBeLessThan(128);
          expect(BigInt(mod)).toBe(((BigInt(base) % 128n) + 128n) % 128n);
          checked++;
        }
      }
    }
    expect(checked).toBe(3 * 64 * 6);
  });

  it('rows can be negative near chunk 0, and baseMod stays non-negative', () => {
    expect(baseRow(0, { chunk: 0, local: 0 })).toBe(-16);
    expect(baseRow(5, { chunk: 0, local: 0 })).toBe(-2);
    expect(baseMod(0, { chunk: 0, local: 0 })).toBe(112);
    // cam can read chunk -1 for one frame after warpTo(0, 0) (FrameView).
    expect(baseMod(5, { chunk: -1, local: 63 })).toBeGreaterThanOrEqual(0);
    expect(rowOffset(0, { chunk: -1, local: 63 })).toBeLessThanOrEqual(-32);
  });

  it('the row at CHUNK_LIMIT - 1 plus 96 stays below 2^53', () => {
    const cam = { chunk: CHUNK_LIMIT - 1, local: 63.75 };
    for (let k = 0; k < CLIP_LEVELS; k++) {
      expect(baseRow(k, cam) + CLIP_ROWS + 2).toBeLessThan(2 ** 53);
      expect(BigInt(baseRow(k, cam)) + 98n).toBeLessThan(2n ** 53n);
    }
  });
});

describe('hole margins', () => {
  it('match the M1 table across every phase', () => {
    let visits = 0;
    everyPhase((cam) => {
      visits++;
      for (let k = 1; k < CLIP_LEVELS; k++) {
        const m = holeMargins(k, cam, 0);
        expect(m.lateral).toBe(2);
        if (k <= 3) {
          expect(m.forward).toBeGreaterThanOrEqual(3);
          expect(m.forward).toBeLessThanOrEqual(4);
          expect(m.rear).toBeGreaterThanOrEqual(-1);
          expect(m.rear).toBeLessThanOrEqual(0);
        } else {
          expect(m.forward).toBeGreaterThanOrEqual(4);
          expect(m.forward).toBeLessThanOrEqual(5);
          expect(m.rear).toBeGreaterThanOrEqual(-2);
          expect(m.rear).toBeLessThanOrEqual(-1);
        }
        // The rear overrun is behind the camera, so it can never be seen.
        expect(rowOffset(k, cam)).toBeLessThan(0);
      }
    });
    expect(visits).toBe(6 * 128);
  });

  it('negative control: at grow 4 the same helper reports a gap of 2 cells', () => {
    everyPhase((cam) => {
      for (let k = 1; k < CLIP_LEVELS; k++) expect(holeMargins(k, cam, 4).lateral).toBe(-2);
    });
  });

  it('at stride 2 the hole stays aligned to 2x2 cells and its margin is not smaller', () => {
    expect(HOLE_S2.r1 % 2).toBe(0);
    expect(HOLE_S2.c0 % 2).toBe(0);
    expect(HOLE_S2.c1 % 2).toBe(0);
    everyPhase((cam) => {
      for (let k = 1; k < CLIP_LEVELS; k++) {
        const m = holeMargins(k, cam, 0, HOLE_S2);
        expect(m.lateral).toBe(2);
        expect(m.forward).toBeGreaterThanOrEqual(holeMargins(k, cam, 0).forward);
      }
    });
  });
});
