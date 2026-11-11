import { describe, expect, it } from 'vitest';
import { buildIndex, buildVertices } from '../../../src/render/terrain/geometry';
import { HOLE, HOLE_S2 } from '../../../src/render/terrain/layout';

const W = 129;

function cr(index: number): { c: number; r: number } {
  return { c: index % W, r: Math.floor(index / W) };
}

/** Render-space position at unit height: x is the column, z is minus the row. */
function pos(index: number): readonly [number, number, number] {
  const { c, r } = cr(index);
  return [c, 1, -r];
}

describe('vertices', () => {
  it('are (c, r, 0) for 129 x 97', () => {
    const v = buildVertices();
    expect(v.length / 3).toBe(12513);
    for (let i = 0; i < 12513; i += 97) {
      const { c, r } = cr(i);
      expect(v[i * 3]).toBe(c);
      expect(v[i * 3 + 1]).toBe(r);
      expect(v[i * 3 + 2]).toBe(0);
    }
    expect(v[12512 * 3]).toBe(128);
    expect(v[12512 * 3 + 1]).toBe(96);
  });
});

describe('index', () => {
  it('has the triangle counts of section 6.4', () => {
    expect(buildIndex(1, false, 0).length / 3).toBe(24576);
    expect(buildIndex(1, true, 0).length / 3).toBe(19176);
    expect(buildIndex(2, false, 0).length / 3).toBe(6144);
    expect(buildIndex(2, true, 0).length / 3).toBe(4824);
    // The frame's totals: level 0 plus five holed levels.
    expect(24576 + 5 * 19176).toBe(120456);
    expect(6144 + 5 * 4824).toBe(30264);
  });

  for (const [stride, hole] of [[1, false], [1, true], [2, false], [2, true]] as const) {
    it(`stride ${stride}, hole ${hole}: every index in range, +y normals, the uniform diagonal`, () => {
      const idx = buildIndex(stride, hole, 0);
      expect(idx.length % 6).toBe(0);
      for (let i = 0; i < idx.length; i += 6) {
        const a = idx[i]!, b = idx[i + 1]!, d = idx[i + 2]!, b2 = idx[i + 3]!, e = idx[i + 4]!, d2 = idx[i + 5]!;
        for (const v of [a, b, d, e]) expect(v).toBeLessThanOrEqual(12512);
        // The two triangles of a quad share exactly b and d.
        expect(b2).toBe(b);
        expect(d2).toBe(d);
        const ca = cr(a);
        // The shared edge runs (c + stride, r) to (c, r + stride).
        expect(cr(b)).toEqual({ c: ca.c + stride, r: ca.r });
        expect(cr(d)).toEqual({ c: ca.c, r: ca.r + stride });
        expect(cr(e)).toEqual({ c: ca.c + stride, r: ca.r + stride });
        for (const [p, q, s] of [[a, b, d], [b, e, d]] as const) {
          const P = pos(p), Q = pos(q), S = pos(s);
          const ux = Q[0] - P[0], uz = Q[2] - P[2], vx = S[0] - P[0], vz = S[2] - P[2];
          // y of (Q - P) x (S - P), at unit heights.
          expect(uz * vx - ux * vz).toBeGreaterThan(0);
        }
      }
    });
  }

  it('no holed triangle lies in the hole cells', () => {
    for (const [stride, h] of [[1, HOLE], [2, HOLE_S2]] as const) {
      const idx = buildIndex(stride, true, 0);
      for (let i = 0; i < idx.length; i += 6) {
        const { c, r } = cr(idx[i]!);
        const inside = r >= h.r0 && r < h.r1 && c >= h.c0 && c < h.c1;
        expect(inside).toBe(false);
      }
    }
  });

  it('every cell outside the hole is drawn', () => {
    const idx = buildIndex(1, true, 0);
    const seen = new Set<number>();
    for (let i = 0; i < idx.length; i += 6) seen.add(idx[i]!);
    for (let r = 0; r < 96; r++) {
      for (let c = 0; c < 128; c++) {
        const inside = r < HOLE.r1 && c >= HOLE.c0 && c < HOLE.c1;
        expect(seen.has(r * W + c)).toBe(!inside);
      }
    }
  });

  it('holeRows overrides the row bound only', () => {
    expect(buildIndex(1, true, 0, 44).length / 3).toBe((128 * 96 - 60 * 44) * 2);
    expect(buildIndex(1, true, 0, 45)).toEqual(buildIndex(1, true, 0));
    expect(buildIndex(1, false, 0, 44).length / 3).toBe(24576);
  });

  it('grow enlarges the hole by that many cells on its three sides', () => {
    // Stride 1, grow 4: 68 columns by 49 rows instead of 60 by 45.
    expect(buildIndex(1, true, 4).length / 3).toBe((128 * 96 - 68 * 49) * 2);
    expect(buildIndex(1, false, 4).length / 3).toBe(24576);
  });
});
