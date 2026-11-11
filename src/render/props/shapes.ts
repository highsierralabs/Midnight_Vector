// Shape helpers, all through panel and tri. Pure, no three. Each takes an edge policy, so a smooth shape can draw ring
// lines and leave its other seams dark. Convention: a ring runs counter-clockwise seen from +y, so with bands rising,
// a band's panel a, b, c, d has its outward normal facing away from the axis.
import { add, cross, dot, len, MeshBuilder, norm, scale3, sub, type FaceOpts, type V3 } from './builders';

const TAU = 2 * Math.PI;

export interface LoftOpts {
  /** Close each ring, joining its last point to its first. Default true. */
  closed?: boolean;
  /** Edge mask per panel: ab and cd run along the rings, bc and da are the seams. */
  mask?: number | ((band: number, seg: number) => number);
  part?: number | ((band: number, seg: number) => number);
  param?: number | ((band: number, seg: number, corner: number) => number);
  root?: boolean | ((band: number, seg: number) => boolean);
  /** uv.x runs along the ring, uv.y along the bands, both in u. Default true. */
  arcUv?: boolean;
}

export const MASK_ALL = 15;
export const MASK_RINGS = 5;    // ab and cd
export const MASK_SEAMS = 10;   // bc and da
export const MASK_LOWER = 1;    // ab
export const MASK_UPPER = 4;    // cd

export function ring(cx: number, y: number, cz: number, rx: number, rz: number, n: number, phase = 0): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    const t = phase + (TAU * i) / n;
    out.push([cx + rx * Math.cos(t), y, cz - rz * Math.sin(t)]);
  }
  return out;
}

/** Four corners, counter-clockwise from above. */
export function rectRing(cx: number, y: number, cz: number, hx: number, hz: number): V3[] {
  return [[cx + hx, y, cz + hz], [cx + hx, y, cz - hz], [cx - hx, y, cz - hz], [cx - hx, y, cz + hz]];
}

export function loft(b: MeshBuilder, rings: readonly (readonly V3[])[], o: LoftOpts = {}): void {
  const closed = o.closed ?? true;
  const arcUv = o.arcUv ?? true;
  for (let band = 0; band + 1 < rings.length; band++) {
    const lo = rings[band]!;
    const hi = rings[band + 1]!;
    const segs = closed ? lo.length : lo.length - 1;
    let arc = 0;
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % lo.length;
      const a = lo[s]!;
      const bb = lo[s1]!;
      const c = hi[s1]!;
      const d = hi[s]!;
      const mask = typeof o.mask === 'function' ? o.mask(band, s) : (o.mask ?? MASK_ALL);
      const part = typeof o.part === 'function' ? o.part(band, s) : (o.part ?? 0);
      const root = typeof o.root === 'function' ? o.root(band, s) : (o.root ?? false);
      const f: FaceOpts & { edges: number; part: number; root: boolean } = { edges: mask, part, root };
      const pr = o.param;
      if (pr !== undefined) {
        f.param = typeof pr === 'function' ? [pr(band, s, 0), pr(band, s, 1), pr(band, s, 2), pr(band, s, 3)] : pr;
      }
      if (arcUv) {
        const w = len(sub(bb, a));
        const h0 = bandCoord(rings, band, s);
        const h1 = h0 + len(sub(d, a));
        const h2 = h0 + len(sub(c, bb));
        f.uv = [[arc, h0], [arc + w, h0], [arc + w, h2], [arc, h1]];
        arc += w;
      }
      b.panel(a, bb, c, d, f);
    }
  }
}

function bandCoord(rings: readonly (readonly V3[])[], band: number, s: number): number {
  let h = 0;
  for (let i = 0; i < band; i++) h += len(sub(rings[i + 1]![s]!, rings[i]![s]!));
  return h;
}

/** Closes a ring seen from outside at +y (up true) or -y. */
export function cap(b: MeshBuilder, r: readonly V3[], up: boolean, o: FaceOpts = {}): void {
  const n = r.length;
  if (n === 4) {
    if (up) b.panel(r[0]!, r[1]!, r[2]!, r[3]!, o);
    else b.panel(r[3]!, r[2]!, r[1]!, r[0]!, o);
    return;
  }
  for (let i = 1; i + 1 < n; i++) {
    let mask = 2;   // the outer edge
    if (i === 1) mask |= 1;
    if (i === n - 2) mask |= 4;
    const f: FaceOpts = { ...o, edges: (o.edges ?? 7) & mask };
    if (up) b.tri(r[0]!, r[i]!, r[i + 1]!, f);
    else {
      // Reversed winding swaps which edge is which.
      let m2 = 2;
      if (i === 1) m2 |= 4;
      if (i === n - 2) m2 |= 1;
      b.tri(r[i + 1]!, r[i]!, r[0]!, { ...o, edges: (o.edges ?? 7) & m2 });
    }
  }
}

export interface BoxOpts extends FaceOpts { rows?: number; noBottom?: boolean; noTop?: boolean; sideMask?: number; capMask?: number }

/** A box from y0 to y1, with its side split into rows. */
export function box(b: MeshBuilder, cx: number, y0: number, y1: number, cz: number, hx: number, hz: number, o: BoxOpts = {}): void {
  frustumRect(b, cx, y0, y1, cz, hx, hz, hx, hz, o);
}

/** A rectangular frustum, tapering from (hx0, hz0) at y0 to (hx1, hz1) at y1. */
export function frustumRect(b: MeshBuilder, cx: number, y0: number, y1: number, cz: number, hx0: number, hz0: number, hx1: number, hz1: number, o: BoxOpts = {}): void {
  const rows = o.rows ?? 1;
  const rings: V3[][] = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    rings.push(rectRing(cx, y0 + (y1 - y0) * t, cz, hx0 + (hx1 - hx0) * t, hz0 + (hz1 - hz0) * t));
  }
  const lo: LoftOpts = { mask: o.sideMask ?? MASK_ALL, part: o.part ?? 0, root: o.root ?? false };
  if (o.param !== undefined && typeof o.param === 'number') lo.param = o.param;
  loft(b, rings, lo);
  const capOpts: FaceOpts = { part: o.part ?? 0, root: o.root ?? false, edges: o.capMask ?? 15 };
  if (o.param !== undefined) capOpts.param = o.param;
  if (!o.noTop) cap(b, rings[rows]!, true, capOpts);
  if (!o.noBottom) cap(b, rings[0]!, false, capOpts);
}

export interface FrustumOpts extends LoftOpts { phase?: number; cx?: number; cz?: number; topCap?: boolean; bottomCap?: boolean }

/** An n-gon frustum about the y axis. */
export function frustum(b: MeshBuilder, n: number, y0: number, r0: number, y1: number, r1: number, o: FrustumOpts = {}): void {
  const cx = o.cx ?? 0;
  const cz = o.cz ?? 0;
  const lo = ring(cx, y0, cz, r0, r0, n, o.phase ?? 0);
  const hi = ring(cx, y1, cz, r1, r1, n, o.phase ?? 0);
  loft(b, [lo, hi], o);
  const part = typeof o.part === 'number' ? o.part : 0;
  if (o.topCap) cap(b, hi, true, { part });
  if (o.bottomCap) cap(b, lo, false, { part });
}

/** A profile of (radius, y) points rotated about the y axis. A point at radius 0 closes as a fan. Bands run bottom to top. */
export function lathe(b: MeshBuilder, profile: readonly (readonly [number, number])[], segs: number, o: LoftOpts & { cx?: number; cz?: number; phase?: number } = {}): void {
  const cx = o.cx ?? 0;
  const cz = o.cz ?? 0;
  const phase = o.phase ?? 0;
  for (let band = 0; band + 1 < profile.length; band++) {
    const [r0, y0] = profile[band]!;
    const [r1, y1] = profile[band + 1]!;
    const lo = ring(cx, y0, cz, r0, r0, segs, phase);
    const hi = ring(cx, y1, cz, r1, r1, segs, phase);
    const slant = Math.hypot(r1 - r0, y1 - y0);
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      const mask = typeof o.mask === 'function' ? o.mask(band, s) : (o.mask ?? MASK_RINGS);
      const part = typeof o.part === 'function' ? o.part(band, s) : (o.part ?? 0);
      const root = typeof o.root === 'function' ? o.root(band, s) : (o.root ?? false);
      // uv.x is the fraction round the ring in cells of 1, uv.y along the profile in u.
      const u0 = s / segs;
      const u1 = (s + 1) / segs;
      const pr = o.param;
      const params = (i: number): number => (typeof pr === 'function' ? pr(band, s, i) : (pr ?? 0));
      if (r0 === 0) {
        b.tri(lo[s]!, hi[s1]!, hi[s]!, { part, root, edges: (mask & MASK_UPPER) !== 0 ? 2 : 0, param: [params(0), params(2), params(3)], uv: [[(u0 + u1) / 2, 0], [u1, slant], [u0, slant]] });
      } else if (r1 === 0) {
        b.tri(lo[s]!, lo[s1]!, hi[s]!, { part, root, edges: (mask & MASK_LOWER) !== 0 ? 1 : 0, param: [params(0), params(1), params(3)], uv: [[u0, 0], [u1, 0], [(u0 + u1) / 2, slant]] });
      } else {
        b.panel(lo[s]!, lo[s1]!, hi[s1]!, hi[s]!, { part, root, edges: mask, param: [params(0), params(1), params(2), params(3)], uv: [[u0, 0], [u1, 0], [u1, slant], [u0, slant]] });
      }
    }
  }
}

/** A closed sphere of `lat` latitude bands and `lon` meridians, with triangle fans at the poles. */
export function uvSphere(b: MeshBuilder, c: V3, r: number, lat: number, lon: number, o: LoftOpts = {}): void {
  const profile: [number, number][] = [];
  for (let i = 0; i <= lat; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / lat;
    profile.push([i === 0 || i === lat ? 0 : r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  lathe(b, profile, lon, { ...o, cx: c[0], cz: c[2] });
}

/** A torus in the x-y plane, axis along z. rings[minor][major]. uv.x is arc along the major circle, uv.y along the minor, both in u. */
export function torus(b: MeshBuilder, c: V3, R: number, r: number, major: number, minor: number, o: LoftOpts = {}): void {
  const at = (i: number, j: number): V3 => {
    const alpha = (TAU * i) / major;
    const beta = (TAU * j) / minor;
    const rad = R + r * Math.cos(beta);
    return [c[0] + rad * Math.cos(alpha), c[1] + rad * Math.sin(alpha), c[2] + r * Math.sin(beta)];
  };
  // uv.x is arc along the centre line, the same on every band, so a pattern running round the ring stays straight.
  const arc = (TAU * R) / major;
  const across = (TAU * r) / minor;
  for (let j = 0; j < minor; j++) {
    for (let i = 0; i < major; i++) {
      const mask = typeof o.mask === 'function' ? o.mask(j, i) : (o.mask ?? MASK_ALL);
      const part = typeof o.part === 'function' ? o.part(j, i) : (o.part ?? 0);
      b.panel(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1), {
        edges: mask, part,
        uv: [[i * arc, j * across], [(i + 1) * arc, j * across], [(i + 1) * arc, (j + 1) * across], [i * arc, (j + 1) * across]],
      });
    }
  }
}

/** A tube along a path, with a ring of `sides` per path point. Bands run along the path. */
export function tube(b: MeshBuilder, path: readonly V3[], radii: number | readonly number[], sides: number, o: LoftOpts = {}): readonly (readonly V3[])[] {
  const rings = tubeRings(path, radii, sides);
  loft(b, rings, o);
  return rings;
}

export function tubeRings(path: readonly V3[], radii: number | readonly number[], sides: number): V3[][] {
  const rings: V3[][] = [];
  const first = norm(sub(path[1]!, path[0]!));
  let u = norm(Math.abs(first[1]) > 0.9 ? cross([0, 0, -1], first) : cross([0, 1, 0], first));
  for (let i = 0; i < path.length; i++) {
    const prev = path[Math.max(i - 1, 0)]!;
    const next = path[Math.min(i + 1, path.length - 1)]!;
    const t = norm(sub(next, prev));
    u = norm(sub(u, scale3(t, dot(u, t))));
    const v = cross(t, u);
    const r = typeof radii === 'number' ? radii : radii[i]!;
    const row: V3[] = [];
    for (let s = 0; s < sides; s++) {
      const a = (TAU * s) / sides;
      row.push(add(path[i]!, add(scale3(u, r * Math.cos(a)), scale3(v, r * Math.sin(a)))));
    }
    rings.push(row);
  }
  return rings;
}

export interface BladeOpts {
  part?: number;
  /** Fold depth as a fraction of the half width. */
  fold?: number;
  /** Which way is "up" for the fold. */
  up?: V3;
}

/**
 * A V-folded blade along a spine, tapering to a point at the end. One side strip per side per segment. Lines run along
 * the midrib and the outline. param is the fraction along the blade, so a shader can sway it.
 */
export function blade(b: MeshBuilder, spine: readonly V3[], widths: readonly number[], o: BladeOpts = {}): void {
  const up = o.up ?? [0, 1, 0];
  const fold = o.fold ?? 0.45;
  const segs = spine.length - 1;
  const part = o.part ?? 0;
  const side: V3[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = norm(sub(spine[Math.min(i + 1, segs)]!, spine[Math.max(i - 1, 0)]!));
    side.push(norm(cross(t, up)));
  }
  const edge = (i: number, sign: number): V3 => {
    const w = widths[i]!;
    return add(add(spine[i]!, scale3(side[i]!, sign * w)), scale3(up, -fold * w));
  };
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    const end = widths[i + 1]! === 0;
    if (end) {
      // The last segment closes to a point.
      b.tri(spine[i]!, edge(i, 1), spine[i + 1]!, { part, edges: 6, param: [t0, t0, t1] });
      b.tri(edge(i, -1), spine[i]!, spine[i + 1]!, { part, edges: 6, param: [t0, t0, t1] });
      continue;
    }
    // Right strip: a midrib i, b midrib i + 1, c outline i + 1, d outline i. Lines on ab and cd.
    b.panel(spine[i]!, spine[i + 1]!, edge(i + 1, 1), edge(i, 1), { part, edges: 5, param: [t0, t1, t1, t0] });
    b.panel(edge(i, -1), edge(i + 1, -1), spine[i + 1]!, spine[i]!, { part, edges: 5, param: [t0, t1, t1, t0] });
  }
}

/** Two fans about the y axis, meeting at the equator. */
export function bipyramid(b: MeshBuilder, c: V3, r: number, hh: number, n: number, o: FaceOpts = {}): void {
  const eq = ring(c[0], c[1], c[2], r, r, n);
  const top: V3 = [c[0], c[1] + hh, c[2]];
  const bot: V3 = [c[0], c[1] - hh, c[2]];
  for (let i = 0; i < n; i++) {
    const p = eq[i]!;
    const q = eq[(i + 1) % n]!;
    b.tri(p, q, top, o);
    b.tri(q, p, bot, o);
  }
}

/**
 * The top half of a frequency-4 icosahedron with a vertex at the zenith: 5 cap faces and the upper half of 10 band faces,
 * 16 small triangles per large one, 160 in all. The band's midline sits exactly at y = 0 by antipodal symmetry, so the base is flat.
 */
export function geodesicHalf(b: MeshBuilder, radius: number, o: FaceOpts = {}): void {
  const yU = 1 / Math.sqrt(5);
  const rU = 2 / Math.sqrt(5);
  const apex: V3 = [0, 1, 0];
  const upper: V3[] = [];
  const lower: V3[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (TAU * i) / 5;
    upper.push([rU * Math.cos(a), yU, -rU * Math.sin(a)]);
    const a2 = a + TAU / 10;
    lower.push([rU * Math.cos(a2), -yU, -rU * Math.sin(a2)]);
  }
  const big: (readonly [V3, V3, V3])[] = [];
  for (let i = 0; i < 5; i++) {
    const u0 = upper[i]!;
    const u1 = upper[(i + 1) % 5]!;
    const l0 = lower[i]!;
    const lm = lower[(i + 4) % 5]!;
    big.push([u0, u1, apex]);
    big.push([u0, l0, u1]);    // pointing down
    big.push([lm, l0, u0]);    // pointing up
  }
  const F = 4;
  const project = (p: V3): V3 => {
    const n = norm(p);
    // The midline's lattice points have y = 0 before normalising, and normalising keeps that. Guard rounding.
    return [n[0] * radius, Math.abs(n[1]) < 1e-9 ? 0 : n[1] * radius, n[2] * radius];
  };
  for (const [p0, p1, p2] of big) {
    const at = (i: number, j: number): V3 => {
      // Barycentric lattice: i along p0 to p1, j along p0 to p2.
      const w = (F - i - j) / F;
      return [p0[0] * w + p1[0] * (i / F) + p2[0] * (j / F), p0[1] * w + p1[1] * (i / F) + p2[1] * (j / F), p0[2] * w + p1[2] * (i / F) + p2[2] * (j / F)];
    };
    for (let j = 0; j < F; j++) {
      for (let i = 0; i < F - j; i++) {
        tryTri(b, project(at(i, j)), project(at(i + 1, j)), project(at(i, j + 1)), o);
        if (i + j < F - 1) tryTri(b, project(at(i + 1, j)), project(at(i + 1, j + 1)), project(at(i, j + 1)), o);
      }
    }
  }
}

function tryTri(b: MeshBuilder, a: V3, bb: V3, c: V3, o: FaceOpts): void {
  if (a[1] < -1e-6 || bb[1] < -1e-6 || c[1] < -1e-6) return;
  b.tri(a, bb, c, o);
}

/** Rotates p about the origin: x then z, in radians. */
export function rotXZ(p: V3, ax: number, az: number): V3 {
  const cx = Math.cos(ax);
  const sx = Math.sin(ax);
  const y1 = p[1] * cx - p[2] * sx;
  const z1 = p[1] * sx + p[2] * cx;
  const cz = Math.cos(az);
  const sz = Math.sin(az);
  return [p[0] * cz - y1 * sz, p[0] * sz + y1 * cz, z1];
}
