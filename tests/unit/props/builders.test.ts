// A13: MeshBuilder's edge distances and winding.
import { describe, expect, it } from 'vitest';
import { buildUnitBox, EDGE_SENTINEL, MeshBuilder, type V3 } from '../../../src/render/props/builders';
import { signedVolume } from './volume';

function edgeAt(m: ReturnType<MeshBuilder['finish']>, vertex: number): number[] {
  return Array.from(m.edge.slice(vertex * 4, vertex * 4 + 4));
}

describe('tri', () => {
  it('gives own edges 0 and the opposite edge the altitude, on a 3-4-5', () => {
    const b = new MeshBuilder();
    b.tri([0, 0, 0], [3, 0, 0], [0, 4, 0]);
    const m = b.finish();
    const altitudeFromA = (3 * 4) / 5;
    // Edges in order ab, bc, ca.
    expect(edgeAt(m, 0)[0]).toBeCloseTo(0, 6);
    expect(edgeAt(m, 0)[1]).toBeCloseTo(altitudeFromA, 6);
    expect(edgeAt(m, 0)[2]).toBeCloseTo(0, 6);
    expect(edgeAt(m, 1)[0]).toBeCloseTo(0, 6);
    expect(edgeAt(m, 1)[1]).toBeCloseTo(0, 6);
    expect(edgeAt(m, 1)[2]).toBeCloseTo(3, 6);
    expect(edgeAt(m, 2)[0]).toBeCloseTo(4, 6);
    expect(edgeAt(m, 2)[1]).toBeCloseTo(0, 6);
    expect(edgeAt(m, 2)[2]).toBeCloseTo(0, 6);
    expect(edgeAt(m, 0)[3]).toBe(EDGE_SENTINEL);
    expect(m.tris).toBe(1);
  });

  it('puts the sentinel on masked edges, and on every edge of a root face', () => {
    const b = new MeshBuilder();
    b.tri([0, 0, 0], [3, 0, 0], [0, 4, 0], { edges: 1 });
    b.tri([0, 0, 0], [3, 0, 0], [0, 4, 0], { root: true });
    const m = b.finish();
    expect(edgeAt(m, 2)[0]).toBeCloseTo(4, 6);
    expect(edgeAt(m, 2)[1]).toBe(EDGE_SENTINEL);
    expect(edgeAt(m, 2)[2]).toBe(EDGE_SENTINEL);
    for (let v = 3; v < 6; v++) for (const e of edgeAt(m, v)) expect(e).toBe(EDGE_SENTINEL);
  });
});

describe('panel', () => {
  const a: V3 = [0, 0, 0];
  const bb: V3 = [6, 0, 0];
  const c: V3 = [4, 3, 0];
  const d: V3 = [2, 3, 0];

  it('gives correct distances at a trapezoid corners', () => {
    const b = new MeshBuilder();
    b.panel(a, bb, c, d);
    const m = b.finish();
    // Height 3 to ab and cd. Slant line length hypot(2, 3).
    expect(edgeAt(m, 2)[0]).toBeCloseTo(3, 6);
    expect(edgeAt(m, 0)[2]).toBeCloseTo(3, 6);
    // Distance from a to line bc: |cross| / length, by hand.
    const toBc = (3 * 6) / Math.hypot(2, 3);
    expect(edgeAt(m, 0)[1]).toBeCloseTo(toBc, 5);
    const toDa = (3 * 6) / Math.hypot(2, 3);
    expect(edgeAt(m, 1)[3]).toBeCloseTo(toDa, 5);
    expect(m.tris).toBe(2);
  });

  it('interpolates affinely: a midpoint is the mean of its ends', () => {
    const b = new MeshBuilder();
    b.panel(a, bb, c, d);
    const m = b.finish();
    // Midpoint of the diagonal a-c lies on the shared triangle edge, so its interpolated value is the mean, and that equals the true distance.
    const mid: V3 = [2, 1.5, 0];
    const interp = (edgeAt(m, 0)[1]! + edgeAt(m, 2)[1]!) / 2;
    const d2 = Math.abs((c[0] - bb[0]) * (bb[1] - mid[1]) - (bb[0] - mid[0]) * (c[1] - bb[1])) / Math.hypot(2, 3);
    expect(interp).toBeCloseTo(d2, 5);
    const interpTop = (edgeAt(m, 0)[0]! + edgeAt(m, 2)[0]!) / 2;
    expect(interpTop).toBeCloseTo(1.5, 5);
  });

  it('keeps the given uv and per-vertex params', () => {
    const b = new MeshBuilder();
    b.panel(a, bb, c, d, { uv: [[0, 0], [1, 0], [1, 1], [0, 1]], param: [0, 0.25, 0.5, 0.75], part: 3 });
    const m = b.finish();
    expect(Array.from(m.uv.slice(4, 6))).toEqual([1, 1]);
    expect(Array.from(m.tag.slice(4, 6))).toEqual([3, 0.5]);
  });
});

describe('winding', () => {
  it('gives the unit box a positive signed volume of 1', () => {
    expect(signedVolume(buildUnitBox())).toBeCloseTo(1, 6);
  });

  it('turns negative when the winding is reversed', () => {
    const b = new MeshBuilder();
    b.tri([0, 0, 0], [0, 1, 0], [1, 0, 0]);
    b.tri([0, 0, 0], [0, 0, 1], [0, 1, 0]);
    b.tri([0, 0, 0], [1, 0, 0], [0, 0, 1]);
    b.tri([1, 0, 0], [0, 1, 0], [0, 0, 1]);
    expect(signedVolume(b.finish())).toBeGreaterThan(0);
    const c = new MeshBuilder();
    c.tri([0, 1, 0], [0, 0, 0], [1, 0, 0]);
    c.tri([0, 0, 1], [0, 0, 0], [0, 1, 0]);
    c.tri([1, 0, 0], [0, 0, 0], [0, 0, 1]);
    c.tri([0, 1, 0], [1, 0, 0], [0, 0, 1]);
    expect(signedVolume(c.finish())).toBeLessThan(0);
  });
});

describe('finish', () => {
  it('reports the bounding box', () => {
    const m = buildUnitBox();
    expect(m.bbox.min).toEqual([-0.5, -0.5, -0.5]);
    expect(m.bbox.max).toEqual([0.5, 0.5, 0.5]);
    expect(m.tris).toBe(12);
  });
});
