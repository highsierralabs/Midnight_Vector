// A13: every helper goes through panel and tri, closed shapes wind outward, and the counts the roster depends on hold.
import { describe, expect, it } from 'vitest';
import { MeshBuilder } from '../../../src/render/props/builders';
import {
  bipyramid, blade, box, frustum, geodesicHalf, lathe, MASK_RINGS, MASK_SEAMS, ring, torus, tube, uvSphere,
} from '../../../src/render/props/shapes';
import { signedVolume } from './volume';

function built(fn: (b: MeshBuilder) => void) {
  const b = new MeshBuilder();
  fn(b);
  return b.finish();
}

describe('closed shapes wind outward', () => {
  it('box', () => {
    const m = built((b) => box(b, 1, 0, 3, 2, 2, 1));
    expect(signedVolume(m)).toBeCloseTo(4 * 2 * 3, 4);
    expect(m.tris).toBe(12);
  });
  it('box with rows splits only the sides', () => {
    expect(built((b) => box(b, 0, 0, 3, 0, 1, 1, { rows: 3 })).tris).toBe(3 * 8 + 4);
  });
  it('frustum with caps', () => {
    const m = built((b) => frustum(b, 6, 0, 2, 3, 1, { topCap: true, bottomCap: true }));
    expect(signedVolume(m)).toBeGreaterThan(0);
  });
  it('uvSphere: 12 x 20 is at most 480 tris, with volume near a sphere', () => {
    const m = built((b) => uvSphere(b, [0, 0, 0], 3, 12, 20));
    expect(m.tris).toBeLessThanOrEqual(480);
    expect(signedVolume(m)).toBeGreaterThan(0);
    const sphere = (4 / 3) * Math.PI * 27;
    expect(signedVolume(m) / sphere).toBeGreaterThan(0.9);
    expect(m.bbox.max[1]).toBeCloseTo(3, 5);
    expect(m.bbox.min[1]).toBeCloseTo(-3, 5);
  });
  it('torus: 48 x 12 is exactly 1152 tris, with volume near a torus', () => {
    const m = built((b) => torus(b, [0, 0, 0], 97, 3, 48, 12));
    expect(m.tris).toBe(1152);
    const v = signedVolume(m);
    const expected = 2 * Math.PI * Math.PI * 97 * 9;
    expect(v / expected).toBeGreaterThan(0.9);
    expect(v / expected).toBeLessThan(1.05);
    expect(m.bbox.max[1]).toBeCloseTo(100, 3);
  });
  it('bipyramid: 2n tris', () => {
    const m = built((b) => bipyramid(b, [0, 0, 0], 1, 3, 6));
    expect(m.tris).toBe(12);
    expect(signedVolume(m)).toBeGreaterThan(0);
  });
  it('lathe, closed at both poles', () => {
    const m = built((b) => lathe(b, [[0, -1], [2, 0], [0, 1]], 8));
    expect(m.tris).toBe(16);
    expect(signedVolume(m)).toBeGreaterThan(0);
  });
});

describe('geodesicHalf', () => {
  const m = built((b) => geodesicHalf(b, 10));
  it('has exactly 160 tris, a flat base and the right height', () => {
    expect(m.tris).toBe(160);
    expect(m.bbox.min[1]).toBeCloseTo(0, 6);
    expect(m.bbox.max[1]).toBeCloseTo(10, 5);
  });
  it('winds outward: every face normal has a positive dot with its centroid', () => {
    let wrong = 0;
    for (let i = 0; i < m.index.length; i += 3) {
      const at = (k: number): [number, number, number] => {
        const o = m.index[i + k]! * 3;
        return [m.position[o]!, m.position[o + 1]!, m.position[o + 2]!];
      };
      const a = at(0), b = at(1), c = at(2);
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3, cz = (a[2] + b[2] + c[2]) / 3;
      if (nx * cx + ny * cy + nz * cz <= 0) wrong++;
    }
    expect(wrong).toBe(0);
  });
});

describe('edge policy', () => {
  it('lets a tube draw only its seams', () => {
    const m = built((b) => tube(b, [[0, 0, 0], [0, 1, 0], [0, 2, 0]], 1, 4, { mask: MASK_SEAMS }));
    expect(m.tris).toBe(16);
    // ab and cd are off everywhere.
    for (let v = 0; v < m.position.length / 3; v++) {
      expect(m.edge[v * 4]).toBe(1000);
      expect(m.edge[v * 4 + 2]).toBe(1000);
    }
  });
  it('lets a lathe draw only its rings', () => {
    const m = built((b) => lathe(b, [[1, 0], [1, 1]], 6, { mask: MASK_RINGS }));
    for (let v = 0; v < m.position.length / 3; v++) {
      expect(m.edge[v * 4 + 1]).toBe(1000);
      expect(m.edge[v * 4 + 3]).toBe(1000);
    }
  });
});

describe('blade', () => {
  const spine: [number, number, number][] = [];
  const widths: number[] = [];
  for (let i = 0; i <= 6; i++) {
    spine.push([i, 0, 0]);
    widths.push(i === 6 ? 0 : 0.5);
  }
  const m = built((b) => blade(b, spine, widths));
  it('is 6 segments, 22 tris, closing to a point', () => {
    expect(m.tris).toBe(22);
    expect(m.bbox.max[0]).toBeCloseTo(6, 6);
  });
  it('tags each vertex with its fraction along the blade', () => {
    let top = 0;
    for (let v = 0; v < m.position.length / 3; v++) top = Math.max(top, m.tag[v * 2 + 1]!);
    expect(top).toBeCloseTo(1, 6);
  });
});

describe('ring', () => {
  it('runs counter-clockwise from above', () => {
    const r = ring(0, 0, 0, 1, 1, 4);
    // +x, then -z, then -x, then +z.
    expect(r[1]![2]).toBeLessThan(0);
    expect(r[2]![0]).toBeLessThan(0);
  });
});
