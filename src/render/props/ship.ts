// The ship: a low delta with a canopy and twin engines, 3.2 u wide and 4.4 u long, and its pure pose function. No three.
// Nose toward -z, the direction of travel. Two draws: an opaque body and an additive engine glow.
import { SPEED_CRUISE, SPEED_MAX, type FeelState, type SimState } from '../../contracts/index';
import { MeshBuilder, type BuiltMesh, type V3 } from './builders';
import { loft, MASK_UPPER } from './shapes';

export const SHIP_HALF_WIDTH = 1.6;
export const SHIP_HALF_LENGTH = 2.2;
const TAU = 2 * Math.PI;
const BANK_PER_U = 1.6;    // radians of bank per u of lateral motion per step
const BANK_MAX = 0.55;
const PITCH_PER_U = 2.4;
const PITCH_MAX = 0.22;

/** One pose, in caller-owned storage. */
export interface ShipPose {
  x: number; y: number;
  /** Radians about z; positive banks left. */
  bank: number;
  /** Radians about x; positive noses up. */
  pitch: number;
  /** Engine length in [0, 1]. */
  engine: number;
  /** Multiplier on engine brightness. */
  flicker: number;
  /** 1 when drawn at full strength, lower during a ghost blink. */
  blink: number;
}

export function createShipPose(): ShipPose {
  return { x: 0, y: 6, bank: 0, pitch: 0, engine: 0, flicker: 1, blink: 1 };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * The pose as a pure function of sim, feel, alpha and the phases. Position is always lerp(prev, current, alpha).
 * feel.shipHold > 0 freezes bank, pitch and flicker at what out already holds, not the position.
 */
export function shipPose(sim: Readonly<SimState>, feel: Readonly<FeelState>, alpha: number, phases: Float32Array, out: ShipPose): void {
  out.x = sim.prevX + (sim.x - sim.prevX) * alpha;
  out.y = sim.prevY + (sim.y - sim.prevY) * alpha;
  out.engine = clamp((sim.speed - SPEED_CRUISE) / (SPEED_MAX - SPEED_CRUISE), 0, 1);
  // Phase 3 is the 1 s phase: an integer harmonic, so the wrap cannot pop.
  out.blink = sim.ghost > 0 ? (phases[3]! * 8 % 1 < 0.5 ? 1 : 0.18) : 1;
  if (feel.shipHold > 0) return;
  out.bank = clamp(-(sim.x - sim.prevX) * BANK_PER_U, -BANK_MAX, BANK_MAX);
  out.pitch = clamp((sim.y - sim.prevY) * PITCH_PER_U, -PITCH_MAX, PITCH_MAX);
  out.flicker = 0.88 + 0.12 * Math.sin(TAU * phases[3]! * 7);
}

/** part: 0 hull, 1 canopy, 2 engine nozzle, 3 wing tip. */
export function buildShipBody(): BuiltMesh {
  const b = new MeshBuilder();
  const hw = SHIP_HALF_WIDTH;
  const hl = SHIP_HALF_LENGTH;
  const nose: V3 = [0, 0.02, -hl];
  const tailY = 0.06;
  // Upper hull: a low ridge from the nose to the tail, with the wings falling away from it.
  const ridgeF: V3 = [0, 0.42, -0.75];
  const ridgeB: V3 = [0, 0.62, 1.95];
  const wingL: V3 = [-hw, -0.42, hl - 0.05];
  const wingR: V3 = [hw, -0.42, hl - 0.05];
  const notchL: V3 = [-0.92, tailY, 1.72];
  const notchR: V3 = [0.92, tailY, 1.72];
  const midL: V3 = [-0.6, 0.06, 0.1];
  const midR: V3 = [0.6, 0.06, 0.1];
  // The delta reads from the lines: the ridge's sides, the wings' leading edges and their trailing edges.
  // DI-118: these upper faces and the canopy's were wound clockwise seen from outside, so the one-sided body material culled
  // them from above and drew the flat underside through the hull: the "floating triangle" and the see-through ship the operator
  // reported. Each call is kept as it was, so every vertex, edge distance and uv is unchanged, and the faces are turned outward
  // by reversing their index order below (flipIndexRange).
  const upperFrom = b.triangleCount;
  b.tri(nose, midR, ridgeF, { edges: 7 });
  b.tri(ridgeF, midL, nose, { edges: 7 });
  b.panel(ridgeF, midR, notchR, ridgeB, { edges: 11 });
  b.panel(midL, ridgeF, ridgeB, notchL, { edges: 13 });
  b.tri(nose, wingR, midR, { edges: 7 });
  b.tri(midR, wingR, notchR, { edges: 6 });
  b.tri(wingL, nose, midL, { edges: 7 });
  b.tri(wingL, midL, notchL, { edges: 5 });
  const upperTo = b.triangleCount;
  // Rear plate, between the engines. Already outward.
  b.tri(notchL, notchR, ridgeB, { edges: 0, part: 0 });
  // Underside, flat, under the same outline as the upper hull (nose, wing tips, the notches between them), and five walls from
  // that outline down to it, so the hull is closed. The old plate was a triangle out to the wing tips straight across, which
  // stood out behind the notches, with open slots along both leading edges. The outline is lined on the underside and on each
  // wall's top and bottom, so the delta reads as an outline from below and behind too: the camera is below the ship whenever it
  // flies above y 7.5 (section 6.1's follow), and before DI-118 the inside-out upper faces were what showed the lines from there.
  const under = (p: V3): V3 => [p[0], -0.46, p[2]];
  b.tri(under(nose), under(notchR), under(notchL), { edges: 2 });
  b.tri(under(nose), under(wingR), under(notchR), { edges: 3 });
  b.tri(under(nose), under(notchL), under(wingL), { edges: 6 });
  const outline: readonly V3[] = [nose, wingR, notchR, notchL, wingL];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!;
    const c = outline[(i + 1) % outline.length]!;
    b.panel(a, c, under(c), under(a), { edges: 5 });
  }
  // Canopy, a raised wedge, closed underneath.
  const c0: V3 = [-0.26, 0.28, -0.55];
  const c1: V3 = [0.26, 0.28, -0.55];
  const c2: V3 = [0.3, 0.42, 0.75];
  const c3: V3 = [-0.3, 0.42, 0.75];
  const ct: V3 = [0, 0.64, 0.4];
  const canopyFrom = b.triangleCount;
  b.tri(c1, c2, ct, { part: 1, edges: 1 });
  b.tri(c3, c0, ct, { part: 1, edges: 1 });
  b.tri(c0, c1, ct, { part: 1, edges: 1 });
  b.tri(c2, c3, ct, { part: 1, edges: 1 });
  const canopyTo = b.triangleCount;
  b.panel(c0, c1, c2, c3, { part: 1, edges: 0 });
  // Twin engines: 6-gon, 2 bands, along z, with a closed face.
  for (const x of [-0.62, 0.62]) {
    const ringsZ = (z: number, r: number): V3[] => {
      const out: V3[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (TAU * i) / 6;
        out.push([x + r * Math.cos(a), 0.14 + r * Math.sin(a), z]);
      }
      return out;
    };
    const rings = [ringsZ(0.7, 0.14), ringsZ(1.7, 0.27), ringsZ(2.15, 0.23)];
    loft(b, rings, { mask: MASK_UPPER, part: 0, arcUv: false });
    const face = rings[2]!;
    const c: V3 = [x, 0.14, 2.17];
    for (let i = 0; i < 6; i++) b.tri(face[i]!, face[(i + 1) % 6]!, c, { part: 2, edges: 1 });
  }
  // Wing fins, near the tips, so a bank reads. A fin is a single plate, so it is drawn from both sides (below).
  const finFrom = b.triangleCount;
  for (const s of [-1, 1]) {
    const f0: V3 = [s * 1.2, -0.2, 2.06];
    const f1: V3 = [s * 1.26, 0.34, 2.2];
    const f2: V3 = [s * 1.0, -0.1, 1.3];
    b.tri(s > 0 ? f0 : f2, f1, s > 0 ? f2 : f0, { part: 3, edges: 7 });
  }
  const finTo = b.triangleCount;
  const built = b.finish();
  flipIndexRange(built.index, upperFrom, upperTo);
  flipIndexRange(built.index, canopyFrom, canopyTo);
  return withBackFaces(built, finFrom, finTo);
}

/** Reverses the winding of triangles from .. to - 1 in place. Vertices and their attributes are untouched. */
function flipIndexRange(index: Uint16Array, from: number, to: number): void {
  for (let t = from; t < to; t++) {
    const i = t * 3 + 1;
    const keep = index[i]!;
    index[i] = index[i + 1]!;
    index[i + 1] = keep;
  }
}

/** The mesh with a reversed copy of triangles from .. to - 1 appended, on the same vertices, so those faces show from behind too. */
function withBackFaces(m: BuiltMesh, from: number, to: number): BuiltMesh {
  const extra = (to - from) * 3;
  const index = new Uint16Array(m.index.length + extra);
  index.set(m.index);
  let w = m.index.length;
  for (let t = from; t < to; t++) {
    index[w++] = m.index[t * 3]!;
    index[w++] = m.index[t * 3 + 2]!;
    index[w++] = m.index[t * 3 + 1]!;
  }
  return { ...m, index, tris: m.tris + (to - from) };
}

/** Two additive cones behind the engines, 12 tris each. param 0 at the nozzle, 1 at the tip. The vertex program stretches them by uEngine. */
export function buildShipGlow(): BuiltMesh {
  const b = new MeshBuilder();
  for (const x of [-0.62, 0.62]) {
    const at = (z: number, r: number): V3[] => {
      const out: V3[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (TAU * i) / 6;
        out.push([x + r * Math.cos(a), 0.14 + r * Math.sin(a), z]);
      }
      return out;
    };
    loft(b, [at(2.18, 0.21), at(3.2, 0.03)], { mask: 0, part: 0, arcUv: false, param: (_band, _s, corner) => (corner < 2 ? 0 : 1) });
    loft(b, [at(2.18, 0.11), at(2.9, 0.02)], { mask: 0, part: 1, arcUv: false, param: (_band, _s, corner) => (corner < 2 ? 0 : 1) });
  }
  return b.finish();
}
