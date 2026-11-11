// The twenty scenery meshes, with their looks, motions and parts. Pure, no three. Sizes are top / root at scale 1, as
// ARCHETYPE_SPEC says: a grounded mesh has its origin at ground contact, a floating one at its centre, and a mesh's front faces +z.
// Shape comes from geometry. A look may add light, never the shape.
import { Archetype } from '../../contracts/index';
import { add, MeshBuilder, norm, scale3, sub, type V3 } from './builders';
import {
  bipyramid, blade, box, geodesicHalf, lathe, loft, MASK_ALL, MASK_LOWER, MASK_SEAMS, MASK_UPPER,
  rectRing, ring, rotXZ, torus, tube, uvSphere,
} from './shapes';

/** uLook values. material.ts writes these into the shader as constants, so the two cannot drift. */
export const Look = {
  FLAT: 0, BASE: 1, REFLECTOR: 2, CHEVRON: 3, BILLBOARD: 4, TOTEM: 5, ARCOLOGY: 6, PYRAMID: 7, OBELISK: 8, PYLON: 9,
  COLONNADE: 10, TURBINE: 11, ORB: 12, CRYSTAL: 13, SAUCER: 14, BEAM: 15, DISH: 16, DOME: 17, CASSETTE: 18, RING: 19,
  SHARD: 20, GATE: 21, SPIKE: 22, FENCE: 23, FENCE_BEAM: 24, DRONE: 25, TRAFFIC: 26, SHIP: 27, SHIP_GLOW: 28, PALM: 29, CACTUS: 30,
} as const;
/** uMotion values, likewise. */
export const Motion = {
  NONE: 0, PALM: 1, CRYSTAL: 2, SAUCER: 3, SAUCER_BEAM: 4, SEARCHLIGHT: 5, TURBINE: 6, PYLON: 7, ARCOLOGY: 8, SHARD: 9,
  GATE: 10, SPIKE: 11, FENCE: 12, DRONE: 13, TRAFFIC: 14,
} as const;

/** How a mesh is drawn, per ring: all uniforms, so rings share programs. */
export interface LookDef {
  look: number;
  motion: number;
  /** Palette slots tintSeed chooses among: 2 horizon, 3 disc top, 5 grid, 6 accent. */
  tints: readonly [number, number, number];
  /** Body luminance as a multiplier on uPal[0], so body at most .2 once a look adds to it. */
  bodyL: number;
  /** Edge luminance, section 6.7's 1.4 to 2.4. */
  edgeL: number;
  /** Edge half width in u at scale 1. */
  edgeW: number;
  /** Yaw applies. Off for records whose yaw means something else. */
  yaw: boolean;
  /** A pivot in mesh space for rotating parts. */
  pivot?: V3;
  /** Grounded mesh: its origin is ground contact, and it has a root. */
  grounded: boolean;
}

export interface MeshDef extends LookDef {
  id: number;
  name: string;
  build(b: MeshBuilder): void;
  /** Second, additive draw. */
  buildBeam?(b: MeshBuilder): void;
  beam?: Omit<LookDef, 'pivot'>;
}

const TAU = 2 * Math.PI;

/** The searchlight's outward lean in radians at a phase. Always above zero, so the beam leans away from x = 0 and never crosses the disc. The vertex shader has the same expression. */
export function searchlightLean(phase6: number, yawOffset: number): number {
  return 0.34 + 0.2 * Math.sin(TAU * (phase6 + yawOffset / TAU));
}
export const SEARCHLIGHT_LENGTH = 520;

// ---- M5: road furniture ----

function buildPalm(b: MeshBuilder): void {
  const crown: V3 = [1.25, 11.6, 0.2];
  const path: V3[] = [[0, -1.5, 0], [0, 0, 0], [0.22, 3.2, 0.03], [0.62, 6.4, 0.08], [1.0, 9.3, 0.15], crown];
  // Trunk: 5-gon, 5 segments. Ring lines above ground only.
  tube(b, path, [0.5, 0.48, 0.42, 0.36, 0.31, 0.27], 5, {
    mask: (band) => (band === 0 ? 0 : MASK_UPPER),
    root: (band) => band === 0,
    part: 0,
  });
  const fronds = 9;
  for (let f = 0; f < fronds; f++) {
    const az = (TAU * f) / fronds + 0.21 * Math.sin(f * 2.4);
    const long = f % 2 === 0;
    const L = long ? 7.8 : 6.6;
    const peak = long ? 2.2 : 1.7;
    const drop = long ? 2.6 : 2.0;
    // y = y0 + a t - c t^2 rises to `peak` and ends `drop` below the crown base.
    const a = 2 * (peak + Math.sqrt(peak * (peak + drop)));
    const c = a + drop;
    const dir: V3 = [Math.cos(az), 0, Math.sin(az)];
    const spine: V3[] = [];
    const widths: number[] = [];
    const segs = 6;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      spine.push([crown[0] + dir[0] * L * t, crown[1] + a * t - c * t * t, crown[2] + dir[2] * L * t]);
      widths.push(i === segs ? 0 : 0.62 * Math.min(1, (t + 0.12) / 0.3) * Math.pow(1 - t, 0.55));
    }
    blade(b, spine, widths, { part: 1, fold: 0.5 });
  }
}

function buildReflector(b: MeshBuilder): void {
  // A stick with a wide diamond head: 8 tris of stick and 4 of head, so the head is what reads, and it is nothing like an obelisk.
  const h = 0.045;
  loft(b, [rectRing(0, -0.3, 0, h, h), rectRing(0, 0.72, 0, h * 0.8, h * 0.8)], { mask: 0, part: 0 });
  const tip = ring(0, 0.72, 0, 0.17, 0.17, 4, Math.PI / 4);
  const top: V3 = [0, 1, 0];
  for (let i = 0; i < 4; i++) b.tri(tip[i]!, tip[(i + 1) % 4]!, top, { part: 1, edges: 0, param: 1 });
}

function buildChevron(b: MeshBuilder): void {
  // Post, a crossed pair of 2-triangle ribbons: 4 tris.
  const p = 0.12;
  b.panel([-p, -1, 0.02], [p, -1, 0.02], [p, 3.45, 0.02], [-p, 3.45, 0.02], { part: 0, edges: 10 });
  b.panel([0, -1, -p], [0, -1, p], [0, 3.45, p], [0, 3.45, -p], { part: 0, edges: 10 });
  // Three cut arrows, each two parallelograms: 4 tris. The cut is in the geometry.
  const yc = 3.45;
  const h = 1.5;
  const w = 0.82;
  const t = 0.62;
  for (let i = 0; i < 3; i++) {
    const tipX = 2.4 - i * 1.6;
    const part = 1 + i;
    b.panel([tipX - t, yc, 0.1], [tipX, yc, 0.1], [tipX - w, yc + h, 0.1], [tipX - w - t, yc + h, 0.1], { part, edges: 15 });
    b.panel([tipX - w - t, yc - h, 0.1], [tipX - w, yc - h, 0.1], [tipX, yc, 0.1], [tipX - t, yc, 0.1], { part, edges: 15 });
  }
}

function buildCactus(b: MeshBuilder): void {
  // Trunk: 3 bands of a 6-gon, ribs only, and a closed crown.
  const trunk = [
    ring(0, -1.5, 0, 0.68, 0.68, 6),
    ring(0, 0, 0, 0.68, 0.68, 6),
    ring(0, 5.0, 0, 0.62, 0.62, 6),
    ring(0, 7.3, 0, 0.5, 0.5, 6),
  ];
  loft(b, trunk, { mask: (band) => (band === 0 ? 0 : MASK_SEAMS), root: (band) => band === 0, part: 0 });
  const domeTop: V3 = [0, 7.96, 0];
  for (let i = 0; i < 6; i++) b.tri(trunk[3]![i]!, trunk[3]![(i + 1) % 6]!, domeTop, { edges: 6, part: 0 });
  // Two elbowed arms, raised, one higher. Each: out, then up.
  const arm = (side: number, y: number, rise: number, out: number): void => {
    const path: V3[] = [[0, y, 0], [side * out, y + 0.18, 0], [side * (out + 0.1), y + rise, 0]];
    tube(b, path, [0.36, 0.38, 0.14], 6, { mask: MASK_SEAMS, part: 0 });
  };
  arm(1, 2.3, 2.6, 2.05);
  arm(-1, 3.5, 2.75, 1.9);
}

function buildBillboard(b: MeshBuilder): void {
  const tilt = 0.17;
  const zAt = (y: number): number => -tilt * (y - 5);
  // Two legs, 8 tris each, leaning with the face.
  for (const x of [-4.2, 4.2]) {
    loft(b, [rectRing(x, -4, -0.15, 0.28, 0.28), rectRing(x, 6, zAt(6) - 0.45, 0.2, 0.2)], { mask: MASK_SEAMS, part: 0, root: false });
  }
  const hw = 7.4;
  const y0 = 5;
  const y1 = 11.9;
  const t = 0.3;
  // Front, the lit sign. uv in u from its lower left.
  b.panel([-hw, y0, zAt(y0)], [hw, y0, zAt(y0)], [hw, y1, zAt(y1)], [-hw, y1, zAt(y1)], {
    part: 1, edges: 15, uv: [[0, 0], [2 * hw, 0], [2 * hw, y1 - y0], [0, y1 - y0]],
  });
  // Back.
  b.panel([hw, y0, zAt(y0) - t], [-hw, y0, zAt(y0) - t], [-hw, y1, zAt(y1) - t], [hw, y1, zAt(y1) - t], { part: 0, edges: 15 });
  // Top rim.
  b.panel([-hw, y1, zAt(y1)], [hw, y1, zAt(y1)], [hw, y1, zAt(y1) - t], [-hw, y1, zAt(y1) - t], { part: 0, edges: 0 });
  // Walkway lip, sticking out under the face: this is what a billboard has and a cassette has not.
  b.panel([-hw - 0.5, y0 - 0.1, zAt(y0) + 1.3], [hw + 0.5, y0 - 0.1, zAt(y0) + 1.3], [hw + 0.5, y0 - 0.1, zAt(y0) - t], [-hw - 0.5, y0 - 0.1, zAt(y0) - t], { part: 2, edges: 15 });
}

function buildTotem(b: MeshBuilder): void {
  // A tilted cube, then a cone, then a ball, each visibly off-axis and each a different palette colour.
  const half = 1.62;
  const tilt = 0.3;
  const cubeCy = -1.5 + half * (Math.cos(tilt) + Math.sin(tilt));
  const corner = (sx: number, sy: number, sz: number): V3 => {
    const r = rotXZ([sx * half, sy * half, sz * half], 0, tilt);
    return [r[0] + 0.35, r[1] + cubeCy, r[2]];
  };
  const f = { part: 1, edges: 15 };
  b.panel(corner(-1, -1, 1), corner(1, -1, 1), corner(1, 1, 1), corner(-1, 1, 1), f);
  b.panel(corner(1, -1, -1), corner(-1, -1, -1), corner(-1, 1, -1), corner(1, 1, -1), f);
  b.panel(corner(1, -1, 1), corner(1, -1, -1), corner(1, 1, -1), corner(1, 1, 1), f);
  b.panel(corner(-1, -1, -1), corner(-1, -1, 1), corner(-1, 1, 1), corner(-1, 1, -1), f);
  b.panel(corner(-1, 1, 1), corner(1, 1, 1), corner(1, 1, -1), corner(-1, 1, -1), f);
  b.panel(corner(-1, -1, -1), corner(1, -1, -1), corner(1, -1, 1), corner(-1, -1, 1), { ...f, root: true });
  const coneY = cubeCy + half * 0.96;
  lathe(b, [[1.5, coneY], [0, coneY + 2.75]], 8, { cx: -0.3, cz: 0.1, mask: MASK_LOWER, part: 2 });
  lathe(b, [[0, coneY], [1.5, coneY]], 8, { cx: -0.3, cz: 0.1, mask: 0, part: 2 });
  // uvSphere 6 x 9, 90 tris, so uv.x is the fraction round and uv.y the arc in u.
  uvSphere(b, [0.55, 6.72, -0.1], 1.95, 6, 9, { part: 3, mask: 0 });
}

// ---- M6: towers ----

function buildArcology(b: MeshBuilder): void {
  // Root: buried, no lines.
  loft(b, [rectRing(0, -20, 0, 10, 8), rectRing(0, 0, 0, 10, 8)], { root: true, part: 0, mask: 0 });
  const tiers: readonly (readonly [number, number, number, number, number, number, number])[] = [
    // y0, y1, cx, cz, hx, hz, rows
    [0, 19, 0, 0, 10, 8, 5],
    [19, 32, -1.6, 1.1, 7.6, 6, 4],
    [32, 41, 1.7, 1.6, 5, 3.9, 3],
    [41, 46.6, 2.6, 2.4, 2.9, 2.4, 2],
  ];
  tiers.forEach((t, i) => {
    const [y0, y1, cx, cz, hx, hz, rows] = t;
    const part = i === 3 ? 3 : 0;
    const param = i === 3 ? 40.9 : 0;
    box(b, cx, y0, y1, cz, hx, hz, { rows, noBottom: true, part, param, sideMask: MASK_ALL });
  });
  // Mast and beacon: these and the top tier collapse under `variant`.
  loft(b, [rectRing(2.6, 46.6, 2.4, 0.26, 0.26), rectRing(2.6, 49.1, 2.4, 0.1, 0.1)], { mask: 0, part: 5, param: 40.9 });
  const beacon = rectRing(2.6, 49.1, 2.4, 0.3, 0.3);
  const top: V3 = [2.6, 49.9, 2.4];
  for (let i = 0; i < 4; i++) b.tri(beacon[i]!, beacon[(i + 1) % 4]!, top, { part: 4, edges: 0, param: 40.9 });
}

function buildPyramid(b: MeshBuilder): void {
  const W = 28;
  const H = 38.6;
  const base = rectRing(0, 0, 0, W, W);
  const apex: V3 = [0, H, 0];
  for (let i = 0; i < 4; i++) b.tri(base[i]!, base[(i + 1) % 4]!, apex, { part: 0, edges: 7 });
  // Root skirt, straight down.
  loft(b, [rectRing(0, -20, 0, W, W), base], { root: true, part: 2, mask: 0 });
  // Apex beacon.
  const k = 1.6 / H;
  const r0 = W * k;
  const low = rectRing(0, H - 1.6, 0, r0, r0);
  const tip: V3 = [0, 40, 0];
  for (let i = 0; i < 4; i++) b.tri(low[i]!, low[(i + 1) % 4]!, tip, { part: 1, edges: 0 });
}

function buildObelisk(b: MeshBuilder): void {
  const base = 2.05;
  const neck = 1.25;
  const shaftTop = 37;
  // Root, then four tapered sides: the seams are the look.
  loft(b, [rectRing(0, -20, 0, base, base), rectRing(0, 0, 0, base, base)], { root: true, part: 2, mask: 0 });
  loft(b, [rectRing(0, 0, 0, base, base), rectRing(0, shaftTop, 0, neck, neck)], { mask: MASK_ALL, part: 0 });
  // Pyramidion.
  const n = rectRing(0, shaftTop, 0, neck, neck);
  const tip: V3 = [0, 40, 0];
  for (let i = 0; i < 4; i++) b.tri(n[i]!, n[(i + 1) % 4]!, tip, { part: 1, edges: 7 });
}

function bar(b: MeshBuilder, p: V3, q: V3, r: number, part: number): void {
  // A thin square bar with no caps: 8 tris. Thin parts glow whole rather than carry lines.
  const rings = [p, q];
  const t = norm(sub(q, p));
  const u = norm(Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [t[2], 0, -t[0]]);
  const v: V3 = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
  const ringAt = (c: V3): V3[] => [
    add(c, add(scale3(u, r), scale3(v, r))),
    add(c, add(scale3(u, -r), scale3(v, r))),
    add(c, add(scale3(u, -r), scale3(v, -r))),
    add(c, add(scale3(u, r), scale3(v, -r))),
  ];
  loft(b, rings.map(ringAt), { mask: 0, part, arcUv: false });
}

function ribbon(b: MeshBuilder, p: V3, q: V3, half: V3, part: number): void {
  b.panel(add(p, scale3(half, -1)), add(q, scale3(half, -1)), add(q, half), add(p, half), { part, edges: 0 });
}

function buildPylon(b: MeshBuilder): void {
  const y0 = -3;
  const y1 = 19.2;
  const r0 = 2.6;
  const r1 = 0.3;
  const rAt = (y: number): number => r0 + (r1 - r0) * ((y - y0) / (y1 - y0));
  const corners: readonly (readonly [number, number])[] = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  // 4 legs, 32 tris.
  // Horizontal end rings, so the root ends exactly at -3.
  for (const [sx, sz] of corners) {
    loft(b, [rectRing(sx * r0, y0, sz * r0, 0.2, 0.2), rectRing(sx * r1, y1, sz * r1, 0.16, 0.16)], { mask: 0, part: 0, arcUv: false });
  }
  // X-braces, 3 levels on 4 faces, a crossing pair of ribbons each: 48 tris. Real geometry, so you can see through it.
  const levels = [0.5, 5.6, 10.6, 15.5];
  for (let l = 0; l + 1 < levels.length; l++) {
    const ya = levels[l]!;
    const yb = levels[l + 1]!;
    for (let f = 0; f < 4; f++) {
      const c0 = corners[f]!;
      const c1 = corners[(f + 1) % 4]!;
      const ra = rAt(ya);
      const rb = rAt(yb);
      const p0: V3 = [c0[0] * ra, ya, c0[1] * ra];
      const p1: V3 = [c1[0] * rb, yb, c1[1] * rb];
      const p2: V3 = [c1[0] * ra, ya, c1[1] * ra];
      const p3: V3 = [c0[0] * rb, yb, c0[1] * rb];
      const thick = scale3([0, 1, 0], 0.13);
      ribbon(b, p0, p1, thick, 0);
      ribbon(b, p2, p3, thick, 0);
    }
  }
  // 2 crossarms, 12 tris each.
  const arm = (y: number, span: number): void => {
    bar(b, [-span, y, 0], [span, y, 0], 0.22, 0);
    const endR = rectRing(span, y, 0, 0.3, 0.3);
    b.panel(endR[0]!, endR[1]!, endR[2]!, endR[3]!, { part: 0, edges: 0 });
    const endL = rectRing(-span, y, 0, 0.3, 0.3);
    b.panel(endL[0]!, endL[1]!, endL[2]!, endL[3]!, { part: 0, edges: 0 });
  };
  arm(13.4, 6.6);
  arm(17, 4.2);
  // Top blinker.
  const blink = rectRing(0, 19.2, 0, 0.3, 0.3);
  const tip: V3 = [0, 20, 0];
  for (let i = 0; i < 4; i++) b.tri(blink[i]!, blink[(i + 1) % 4]!, tip, { part: 1, edges: 0 });
  // 3 wires, 8 segments of a diagonal ribbon: 48 tris. They run from the crossarm tips to mesh z = -64, the next pylon, and the
  // shader collapses them unless floor(variant * 2) === 1. param is the sag at that vertex, so collapsing can undo it.
  const wire = (x: number, y: number): void => {
    const segs = 8;
    const w = 0.09;
    const half: V3 = [w, w, 0];
    const sagMax = 4;
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs;
      const t1 = (i + 1) / segs;
      const s0 = sagMax * 4 * t0 * (1 - t0);
      const s1 = sagMax * 4 * t1 * (1 - t1);
      const p: V3 = [x, y - s0, -64 * t0];
      const q: V3 = [x, y - s1, -64 * t1];
      b.panel(add(p, scale3(half, -1)), add(q, scale3(half, -1)), add(q, half), add(p, half), { part: 2, edges: 0, param: [s0, s1, s1, s0] });
    }
  };
  wire(-6.6, 13.4);
  wire(6.6, 13.4);
  wire(0, 19.2);
}

function buildColonnade(b: MeshBuilder): void {
  const xs = [-5.2, 0, 5.2];
  const r = 1.0;
  const top = 10.5;
  const broken = 7.1;
  xs.forEach((x, i) => {
    // Plinth: from the root up.
    box(b, x, -1.5, 0.45, 0, 1.45, 1.45, { noBottom: true, part: 2, capMask: 15 });
    const h = i === 2 ? broken : top;
    const mid = (h + 0.45) / 2;
    // 12-gon, 2 segments: fluted stripes come from uv.x, in u round the shaft.
    const rings = [ring(x, 0.45, 0, r, r, 12), ring(x, mid, 0, r * 0.96, r * 0.96, 12), ring(x, h, 0, r * 0.92, r * 0.92, 12)];
    if (i === 2) {
      // Broken off at about 60%: a jagged top ring.
      const jag = rings[2]!.map((p, k): V3 => [p[0], p[1] + (k % 3 === 0 ? 0.75 : k % 3 === 1 ? -0.55 : 0.2), p[2]]);
      loft(b, [rings[0]!, rings[1]!, jag], { mask: 0, part: 0 });
      const centre: V3 = [x, broken - 0.5, 0];
      for (let k = 0; k < 12; k++) b.tri(jag[k]!, jag[(k + 1) % 12]!, centre, { part: 1, edges: 1 });
    } else {
      loft(b, rings, { mask: 0, part: 0 });
    }
  });
  // Lintel across the first two.
  box(b, (xs[0]! + xs[1]!) / 2, top, 11.95, 0, 4.3, 1.35, { part: 3 });
}

function buildTurbine(b: MeshBuilder): void {
  const hub: V3 = [0, 24, 1.9];
  // Tower, 6-gon.
  loft(b, [ring(0, -20, 0, 1.45, 1.45, 6), ring(0, 0, 0, 1.45, 1.45, 6), ring(0, 24, 0, 0.7, 0.7, 6)], {
    mask: (band) => (band === 0 ? 0 : MASK_SEAMS), root: (band) => band === 0, part: 0,
  });
  // Nacelle, 5 faces.
  box(b, 0, 23.1, 24.9, -0.1, 0.8, 1.9, { part: 0, noBottom: false, capMask: 15 });
  // Three long blades, 22 tris each, pointing out from the hub in the z plane.
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + (TAU * i) / 3;
    const dir: V3 = [Math.cos(a), Math.sin(a), 0];
    const perp: V3 = [-dir[1], dir[0], 0];
    const at = (t: number, w: number, d: number): V3[] => {
      const c: V3 = add(hub, scale3(dir, 16 * t));
      const sweep = add(c, scale3(perp, 0.28 * Math.sin(Math.PI * t) * (t < 0.2 ? 0.3 : 1)));
      return [
        add(sweep, add(scale3(perp, w), [0, 0, d])),
        add(sweep, add(scale3(perp, -w), [0, 0, d])),
        add(sweep, add(scale3(perp, -w), [0, 0, -d])),
        add(sweep, add(scale3(perp, w), [0, 0, -d])),
      ];
    };
    const stations = [at(0, 0.34, 0.2), at(0.3, 0.86, 0.13), at(0.72, 0.5, 0.08)];
    loft(b, stations, {
      mask: 0, part: 1, arcUv: false,
      param: (band, _s, corner) => (corner < 2 ? [0, 0.3][band]! : [0.3, 0.72][band]!),
    });
    const tip: V3 = add(hub, scale3(dir, 16));
    const last = stations[2]!;
    for (let k = 0; k < 4; k++) b.tri(last[k]!, last[(k + 1) % 4]!, tip, { part: 1, edges: 0, param: [0.72, 0.72, 1] });
    const first = stations[0]!;
    b.panel(first[3]!, first[2]!, first[1]!, first[0]!, { part: 1, edges: 0 });
  }
}

// ---- M7: floaters and oddities ----

function buildOrb(b: MeshBuilder): void {
  uvSphere(b, [0, 0, 0], 3.5, 12, 20, { mask: 0, part: 0 });
}

function buildCrystal(b: MeshBuilder): void {
  bipyramid(b, [0, 0, 0], 1.15, 3.5, 6, { part: 0 });
  bipyramid(b, [2.15, 0.9, 0.4], 0.36, 0.75, 3, { part: 1 });
  bipyramid(b, [-1.9, -1.0, -0.5], 0.3, 0.62, 3, { part: 1 });
}

function buildSaucer(b: MeshBuilder): void {
  // Flat and wide, nothing else in the roster has this outline. Lathe, 16 round, 3 profile bands plus the dome fan.
  lathe(b, [[0, -3], [3.8, -2.05], [13, 0]], 16, { part: (band) => (band === 0 ? 0 : 3), mask: (band) => (band === 1 ? MASK_UPPER : 0) });
  lathe(b, [[13, 0], [4.7, 1.55], [0, 3]], 16, { part: (band) => (band === 0 ? 1 : 2), mask: (band) => (band === 0 ? MASK_UPPER : 0) });
}

function buildSaucerBeam(b: MeshBuilder): void {
  // 12-gon open cone, down from the belly. param 0 at the saucer, 1 at the far end.
  const lo = ring(0, -44, 0, 11, 11, 12);
  const hi = ring(0, -2, 0, 1.6, 1.6, 12);
  loft(b, [lo, hi], { mask: 0, part: 0, param: (_band, _s, corner) => (corner < 2 ? 1 : 0), arcUv: false });
}

function buildSearchlight(b: MeshBuilder): void {
  // 12-gon open cone, 520 u long, additive. The shader leans it. Tag: param 0 at the ground, 1 at the far end.
  const lo = ring(0, 0, 0, 0.9, 0.9, 12);
  const hi = ring(0, SEARCHLIGHT_LENGTH, 0, 24, 24, 12);
  loft(b, [lo, hi], { mask: 0, part: 0, param: (_band, _s, corner) => (corner < 2 ? 0 : 1), arcUv: false });
}

function buildDish(b: MeshBuilder): void {
  // Mast, 6-gon, buried root.
  const bowlAt: V3 = [0, 11.15, 0];
  loft(b, [ring(0, -8, 0, 0.8, 0.8, 6), ring(0, 0, 0, 0.8, 0.8, 6), ring(0, 11, 0, 0.42, 0.42, 6)], {
    mask: (band) => (band === 0 ? 0 : MASK_SEAMS), root: (band) => band === 0, part: 0,
  });
  // A bowl tilted back toward +z and up, built about its own axis, then rotated.
  const tilt = 0.72;
  const place = (p: V3): V3 => add(rotXZ(p, tilt, 0), bowlAt);
  const rb = 7.4;
  const depth = 2.1;
  const profile: (readonly [number, number])[] = [[0, 0], [rb * 0.42, depth * 0.18], [rb * 0.78, depth * 0.61], [rb, depth]];
  const segs = 16;
  for (let band = 0; band + 1 < profile.length; band++) {
    const [r0, y0] = profile[band]!;
    const [r1, y1] = profile[band + 1]!;
    const lo = ring(0, y0, 0, r0, r0, segs).map(place);
    const hi = ring(0, y1, 0, r1, r1, segs).map(place);
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      if (r0 === 0) b.tri(lo[0]!, hi[s1]!, hi[s]!, { part: 1, edges: 0 });
      else b.panel(lo[s]!, lo[s1]!, hi[s1]!, hi[s]!, { part: 1, edges: band === 2 ? 0 : MASK_UPPER });
    }
  }
  // Rim: a flange, in neon.
  const [rEdge, yEdge] = profile[3]!;
  const r0 = ring(0, yEdge, 0, rEdge, rEdge, segs).map(place);
  const r1 = ring(0, yEdge + 0.16, 0, rEdge + 0.32, rEdge + 0.32, segs).map(place);
  loft(b, [r0, r1], { mask: 0, part: 2, arcUv: false });
  // Tripod feed: three struts to the focus, 6 tris each, and a blinker.
  const focus = place([0, 4.4, 0]);
  for (let i = 0; i < 3; i++) {
    const a = (TAU * i) / 3 + 0.5;
    const foot = place([rb * 0.76 * Math.cos(a), depth * 0.58, -rb * 0.76 * Math.sin(a)]);
    const d = norm(sub(focus, foot));
    const side = norm([d[2], 0, -d[0]]);
    const w = 0.07;
    b.panel(add(foot, scale3(side, -w)), add(foot, scale3(side, w)), add(focus, scale3(side, w)), add(focus, scale3(side, -w)), { part: 0, edges: 0 });
    const lift: V3 = [0, w, 0];
    b.panel(add(foot, scale3(lift, -1)), add(foot, lift), add(focus, lift), add(focus, scale3(lift, -1)), { part: 0, edges: 0 });
    b.tri(foot, add(foot, scale3(side, w)), add(focus, lift), { part: 0, edges: 0 });
    b.tri(foot, add(focus, scale3(side, -w)), add(foot, scale3(side, -w)), { part: 0, edges: 0 });
  }
  const f0 = rectRing(focus[0], focus[1] - 0.25, focus[2], 0.3, 0.3);
  const fTip: V3 = [focus[0], focus[1] + 0.35, focus[2]];
  for (let i = 0; i < 4; i++) b.tri(f0[i]!, f0[(i + 1) % 4]!, fTip, { part: 3, edges: 0 });
}

function buildDome(b: MeshBuilder): void {
  geodesicHalf(b, 19.9, { part: 0, edges: 7 });
  // Root: one spike per base segment, buried. Its top ring is the base's own.
  const segs = 20;
  const base = ring(0, 0, 0, 19.9, 19.9, segs);
  const below: V3 = [0, -6, 0];
  for (let i = 0; i < segs; i++) b.tri(base[i]!, below, base[(i + 1) % segs]!, { root: true, part: 2 });
}

function buildCassette(b: MeshBuilder): void {
  const tiltX = -0.16;
  const tiltZ = 0.11;
  // In the plane: x along the long edge, y up, the trapezoid bump at the bottom. uv is this plane, so a reel test reads it.
  const hw = 12.6;
  const y0 = 2.9;
  const y1 = 14.85;
  const k = 1.15;   // corner cut
  const outline: readonly (readonly [number, number])[] = [
    [-hw + k, y0], [-8.2, y0], [-6.4, 0.1], [6.4, 0.1], [8.2, y0], [hw - k, y0], [hw, y0 + k], [hw, y1 - k], [hw - k, y1], [-hw + k, y1], [-hw, y1 - k], [-hw, y0 + k],
  ];
  const place = (x: number, y: number, z: number): V3 => rotXZ([x, y, z], tiltX, tiltZ);
  const t = 0.85;
  const n = outline.length;
  const front = outline.map(([x, y]) => place(x, y, t));
  const back = outline.map(([x, y]) => place(x, y, -t));
  // Front and back are fans from the middle of the long body, so the fan never crosses the bump.
  const centreF = place(0, 8, t);
  const centreB = place(0, 8, -t);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [ax, ay] = outline[i]!;
    const [bx, by] = outline[j]!;
    b.tri(centreF, front[i]!, front[j]!, { part: 1, edges: 2, uv: [[0, 8], [ax, ay], [bx, by]] });
    b.tri(centreB, back[j]!, back[i]!, { part: 1, edges: 2, uv: [[0, 8], [bx, by], [ax, ay]] });
    // Rim.
    b.panel(front[j]!, front[i]!, back[i]!, back[j]!, { part: 2, edges: 5 });
  }
  // The root: straight down under the bump, to exactly 8 below ground.
  const bl = place(-6.4, 0.1, t);
  const br = place(6.4, 0.1, t);
  const blB = place(-6.4, 0.1, -t);
  const brB = place(6.4, 0.1, -t);
  const down = (p: V3): V3 => [p[0], -8, p[2]];
  b.panel(down(bl), down(br), br, bl, { root: true, part: 3 });
  b.panel(down(brB), down(blB), blB, brB, { root: true, part: 3 });
}

function buildRing(b: MeshBuilder): void {
  // Radius 97, tube 3, axis along z. Lines along the major circle on the inner and outer equator, and cross rings every 4 segments.
  torus(b, [0, 0, 0], 97, 3, 48, 12, {
    part: 0,
    mask: (band, seg) => {
      let m = 0;
      // Three bright rails on the near side and outer rim, and a cross ring every 4 segments.
      if (band === 0 || band === 2 || band === 10) m |= MASK_LOWER;
      if (seg % 4 === 0) m |= 8;
      return m;
    },
  });
}

const GROUNDED = true;
const FLOATS = false;

export const ARCHETYPE_DEFS: readonly MeshDef[] = [
  {
    id: Archetype.PALM, name: 'PALM', build: buildPalm, look: Look.PALM, motion: Motion.PALM, tints: [6, 5, 2],
    bodyL: 0.5, edgeL: 1.8, edgeW: 0.06, yaw: true, grounded: GROUNDED,
  },
  {
    id: Archetype.ARCOLOGY, name: 'ARCOLOGY', build: buildArcology, look: Look.ARCOLOGY, motion: Motion.ARCOLOGY, tints: [6, 2, 3],
    bodyL: 0.6, edgeL: 1.5, edgeW: 0.09, yaw: true, grounded: GROUNDED,
  },
  {
    id: Archetype.PYRAMID, name: 'PYRAMID', build: buildPyramid, look: Look.PYRAMID, motion: Motion.NONE, tints: [5, 6, 3],
    bodyL: 0.6, edgeL: 1.8, edgeW: 0.2, yaw: true, grounded: GROUNDED,
  },
  {
    id: Archetype.ORB, name: 'ORB', build: buildOrb, look: Look.ORB, motion: Motion.NONE, tints: [6, 6, 6],
    bodyL: 1, edgeL: 0, edgeW: 0.1, yaw: false, grounded: FLOATS,
  },
  {
    id: Archetype.COLONNADE, name: 'COLONNADE', build: buildColonnade, look: Look.COLONNADE, motion: Motion.NONE, tints: [3, 6, 6],
    bodyL: 0.5, edgeL: 1.7, edgeW: 0.06, yaw: true, grounded: GROUNDED,
  },
  {
    id: Archetype.BILLBOARD, name: 'BILLBOARD', build: buildBillboard, look: Look.BILLBOARD, motion: Motion.NONE, tints: [6, 5, 2],
    bodyL: 0.5, edgeL: 1.7, edgeW: 0.07, yaw: true, grounded: GROUNDED,
  },
  {
    id: Archetype.PYLON, name: 'PYLON', build: buildPylon, look: Look.PYLON, motion: Motion.PYLON, tints: [6, 5, 2],
    bodyL: 0.5, edgeL: 1.4, edgeW: 0.05, yaw: false, grounded: GROUNDED,
  },
  {
    id: Archetype.REFLECTOR, name: 'REFLECTOR', build: buildReflector, look: Look.REFLECTOR, motion: Motion.NONE, tints: [2, 6, 5],
    bodyL: 0.5, edgeL: 1.4, edgeW: 0.03, yaw: false, grounded: GROUNDED,
  },
  {
    id: Archetype.CRYSTAL, name: 'CRYSTAL', build: buildCrystal, look: Look.CRYSTAL, motion: Motion.CRYSTAL, tints: [6, 5, 2],
    bodyL: 0.8, edgeL: 2.0, edgeW: 0.05, yaw: true, grounded: FLOATS,
  },
  {
    id: Archetype.SAUCER, name: 'SAUCER', build: buildSaucer, look: Look.SAUCER, motion: Motion.SAUCER, tints: [6, 2, 5],
    bodyL: 0.8, edgeL: 1.8, edgeW: 0.08, yaw: true, grounded: FLOATS,
    buildBeam: buildSaucerBeam,
    beam: { look: Look.BEAM, motion: Motion.SAUCER_BEAM, tints: [6, 2, 5], bodyL: 0, edgeL: 0.5, edgeW: 0, yaw: false, grounded: FLOATS },
  },
  {
    id: Archetype.SEARCHLIGHT, name: 'SEARCHLIGHT', build: buildSearchlight, look: Look.BEAM, motion: Motion.SEARCHLIGHT, tints: [3, 6, 5],
    bodyL: 0, edgeL: 0.8, edgeW: 0, yaw: false, grounded: GROUNDED,
  },
  {
    id: Archetype.TOTEM, name: 'TOTEM', build: buildTotem, look: Look.TOTEM, motion: Motion.NONE, tints: [5, 6, 2],
    bodyL: 1, edgeL: 1.6, edgeW: 0.05, yaw: true, grounded: GROUNDED,
  },
  {
    id: Archetype.DISH, name: 'DISH', build: buildDish, look: Look.DISH, motion: Motion.NONE, tints: [6, 5, 2],
    bodyL: 0.7, edgeL: 1.5, edgeW: 0.07, yaw: true, grounded: GROUNDED,
  },
  {
    id: Archetype.RING, name: 'RING', build: buildRing, look: Look.RING, motion: Motion.NONE, tints: [6, 2, 5],
    bodyL: 0.8, edgeL: 2.0, edgeW: 0.38, yaw: false, grounded: FLOATS,
  },
  {
    id: Archetype.OBELISK, name: 'OBELISK', build: buildObelisk, look: Look.OBELISK, motion: Motion.NONE, tints: [6, 2, 5],
    bodyL: 0.6, edgeL: 1.7, edgeW: 0.1, yaw: true, grounded: GROUNDED,
  },
  {
    id: Archetype.DOME, name: 'DOME', build: buildDome, look: Look.DOME, motion: Motion.NONE, tints: [6, 5, 2],
    bodyL: 0.6, edgeL: 1.6, edgeW: 0.09, yaw: true, grounded: GROUNDED,
  },
  {
    id: Archetype.TURBINE, name: 'TURBINE', build: buildTurbine, look: Look.TURBINE, motion: Motion.TURBINE, tints: [6, 2, 5],
    bodyL: 1, edgeL: 1.6, edgeW: 0.06, yaw: true, pivot: [0, 24, 1.9], grounded: GROUNDED,
  },
  {
    id: Archetype.CASSETTE, name: 'CASSETTE', build: buildCassette, look: Look.CASSETTE, motion: Motion.NONE, tints: [5, 6, 2],
    bodyL: 0.7, edgeL: 1.8, edgeW: 0.08, yaw: true, grounded: GROUNDED,
  },
  {
    id: Archetype.CACTUS, name: 'CACTUS', build: buildCactus, look: Look.CACTUS, motion: Motion.NONE, tints: [6, 5, 6],
    bodyL: 0.4, edgeL: 1.7, edgeW: 0.05, yaw: true, grounded: GROUNDED,
  },
  {
    id: Archetype.CHEVRON, name: 'CHEVRON', build: buildChevron, look: Look.CHEVRON, motion: Motion.NONE, tints: [6, 3, 2],
    bodyL: 0.5, edgeL: 1.6, edgeW: 0.05, yaw: true, grounded: GROUNDED,
  },
];
