// The cockpit (T13, plans/T13-views.md): the dashboard, its two instrument panels, the canopy's pillars and roof, the wheel
// and the pilot's hands and forearms, as one mesh, and the wheel's pure pose. No three.
//
// The eye is fixed in the cockpit, so the mesh is flat: every vertex is a point of the stage in cockpit units
// (src/core/cockpit.ts: x from the centre, y from the bottom edge, z 0), and the triangles are in painter's order, back to
// front. The vertex program (glsl/cockpit.vert.glsl) turns the wheel about its hub and scales it about the eye line for a
// pull or a push, which is what a wheel facing the pilot does in perspective. aTag is (part, rig): rig 1 moves with the
// wheel, 0 stays, and a forearm's two ends differ, so it stretches between a fixed elbow and the moving wrist. rig
// COCKPIT_RIG_TOP hangs a vertex from the stage's top edge instead of standing it on the bottom one: the roof is drawn for
// a stage one unit high, and on a taller one it rides up with the top edge and the pillars stretch to it.
import {
  COCKPIT_DASH_TOP, COCKPIT_EYE_Y, COCKPIT_HUB, COCKPIT_PANELS, COCKPIT_SLOTS, COCKPIT_WHEEL_PULL, COCKPIT_WHEEL_TURN,
  type CockpitRect,
} from '../../core/cockpit';
import { MeshBuilder, type BuiltMesh, type FaceOpts, type V3 } from './builders';
import { BANK_MAX, PITCH_MAX, type ShipPose } from './ship';

/** How far outside the frame the cockpit starts as it arrives: at cockpitIn 0 it is 1 + COCKPIT_ZOOM times its size about the eye line. */
export const COCKPIT_ZOOM = 1.6;
/** Line half-width, in cockpit units: about 4 px on a 1080 px stage, and never under a pixel's worth of light on a small one. */
export const COCKPIT_EDGE_W = 0.004;

/** part ids, read by glsl/cockpit.frag.glsl. */
export const CockpitPart = { DASH: 0, GLASS: 1, TRIM: 2, WHEEL: 3, GLOVE: 4, SLEEVE: 5, STRUT: 6, ROOF: 7 } as const;
/** The rig value of a vertex that hangs from the stage's top edge. Read by glsl/cockpit.vert.glsl as anything over 1.5. */
export const COCKPIT_RIG_TOP = 2;

/** The dashboard runs this far to each side, past any stage up to 4.8:1. */
const DASH_HALF = 2.4;
/** Below the stage's bottom edge, so a push, which scales toward the eye line, opens no gap there. */
const BELOW = -0.08;
/** The side sills are lower than the instrument cowl, and the cowl dips over the wheel. */
const SILL_Y = 0.255;
const DIP_Y = 0.282;
/** The dashboard's top edge, left to right. Symmetric about x = 0. */
export const DASH_PROFILE: readonly (readonly [number, number])[] = [
  [-DASH_HALF, SILL_Y], [-0.88, SILL_Y], [-0.82, COCKPIT_DASH_TOP], [-0.25, COCKPIT_DASH_TOP], [-0.19, DIP_Y],
  [0.19, DIP_Y], [0.25, COCKPIT_DASH_TOP], [0.82, COCKPIT_DASH_TOP], [0.88, SILL_Y], [DASH_HALF, SILL_Y],
];
/** The roof's lower edge, left to right, for a stage one unit high. Symmetric about x = 0. It arches a little over the windscreen. */
export const ROOF_PROFILE: readonly (readonly [number, number])[] = [
  [-DASH_HALF, 0.855], [-0.87, 0.855], [-0.81, 0.893], [-0.22, 0.915], [0.22, 0.915], [0.81, 0.893], [0.87, 0.855], [DASH_HALF, 0.855],
];
/** Above the stage's top edge, so the roof has no upper edge in frame. */
const ABOVE = 1.08;
/** The cowl's second line sits this far under the top edge. */
const LIP = 0.016;
/** A bezel stands this far outside its panel's glass. */
const BEZEL = 0.012;
const HUB_X = COCKPIT_HUB.x;
const HUB_Y = COCKPIT_HUB.y;

/**
 * The right hand's own frame, for the gloves: its origin is the middle of the back of the hand, s runs from the wrist to
 * the knuckles, which is inward and a little up, across the grip, and t runs from the thumb's side to the little finger's.
 * (s, t) is right-handed, so a face given counter-clockwise in it stays counter-clockwise. The left hand is the mirror.
 */
const HAND_O: readonly [number, number] = [0.166, HUB_Y + 0.026];
const HAND_S: readonly [number, number] = [-0.92, 0.39];
const HAND_T: readonly [number, number] = [-0.39, -0.92];
/** The knuckles' line, half the hand's width there, and how far each finger's first joint shows beyond it, forefinger first. */
const KNUCKLE_S = 0.022;
const HAND_HALF = 0.036;
const FINGER_LEN: readonly number[] = [0.019, 0.022, 0.02, 0.016];
const hp = (s: number, t: number): readonly [number, number] => [
  HAND_O[0] + s * HAND_S[0] + t * HAND_T[0], HAND_O[1] + s * HAND_S[1] + t * HAND_T[1],
];

const p = (x: number, y: number): V3 => [x, y, 0];

/** A quad from four points given counter-clockwise, as (x, y) pairs. */
function quad(b: MeshBuilder, pts: readonly (readonly [number, number])[], o: FaceOpts): void {
  b.panel(p(pts[0]![0], pts[0]![1]), p(pts[1]![0], pts[1]![1]), p(pts[2]![0], pts[2]![1]), p(pts[3]![0], pts[3]![1]), o);
}

/** The same quad reflected in x = 0, with its order reversed so it stays counter-clockwise. Edge bits move with the order. */
function mirrored(pts: readonly (readonly [number, number])[]): (readonly [number, number])[] {
  return [[-pts[1]![0], pts[1]![1]], [-pts[0]![0], pts[0]![1]], [-pts[3]![0], pts[3]![1]], [-pts[2]![0], pts[2]![1]]];
}

/** Both sides: pts on the right (x > 0), and its mirror. sideEdges names edges of the right-hand quad: bc and da swap in the mirror. */
function pair(b: MeshBuilder, pts: readonly (readonly [number, number])[], o: FaceOpts): void {
  quad(b, pts, o);
  const e = o.edges ?? 15;
  // ab stays ab (reversed), bc becomes da, cd stays cd, da becomes bc.
  const swapped = (e & 1) | ((e & 2) << 2) | (e & 4) | ((e & 8) >> 2);
  const param = o.param;
  const mirroredParam = typeof param === 'number' || param === undefined ? param : [param[1]!, param[0]!, param[3]!, param[2]!];
  quad(b, mirrored(pts), { ...o, edges: swapped, ...(mirroredParam === undefined ? {} : { param: mirroredParam }) });
}

function rect(b: MeshBuilder, r: CockpitRect, grow: number, o: FaceOpts): void {
  quad(b, [[r.x0 - grow, r.y0 - grow], [r.x1 + grow, r.y0 - grow], [r.x1 + grow, r.y1 + grow], [r.x0 - grow, r.y1 + grow]], o);
}

/**
 * The cockpit mesh. Edge bits: 1 ab, 2 bc, 4 cd, 8 da. Order is back to front: pillars, roof, dashboard, cowl, vents,
 * panels, console and column, wheel, forearms, gloves.
 */
export function buildCockpit(): BuiltMesh {
  const b = new MeshBuilder();
  const P = CockpitPart;

  // The canopy's pillars, behind the dashboard and the roof: a windscreen pillar a side, leaning outward from the cowl's
  // shoulder to the roof, and a second one behind it that only a stage wider than 21:9 shows. Each foot stands on the
  // bottom edge's units and each head hangs from the top edge's, so a pillar always joins the two.
  const TOP = COCKPIT_RIG_TOP;
  pair(b, [[0.652, COCKPIT_DASH_TOP - 0.02], [0.678, COCKPIT_DASH_TOP - 0.02], [0.806, 0.905], [0.78, 0.905]], { part: P.STRUT, edges: 10, param: [0, 0, TOP, TOP] });
  pair(b, [[1.3, SILL_Y - 0.02], [1.33, SILL_Y - 0.02], [1.41, 0.87], [1.38, 0.87]], { part: P.STRUT, edges: 10, param: [0, 0, TOP, TOP] });

  // The roof: one quad over each stretch of its lower edge, lined along that edge only, then a second line over the edge,
  // as the cowl has, and a small overhead console with two slats at the centre.
  for (let i = 0; i + 1 < ROOF_PROFILE.length; i++) {
    const [x0, y0] = ROOF_PROFILE[i]!;
    const [x1, y1] = ROOF_PROFILE[i + 1]!;
    quad(b, [[x0, y0], [x1, y1], [x1, ABOVE], [x0, ABOVE]], { part: P.ROOF, edges: 1, param: TOP });
  }
  for (let i = 0; i + 1 < ROOF_PROFILE.length; i++) {
    const [x0, y0] = ROOF_PROFILE[i]!;
    const [x1, y1] = ROOF_PROFILE[i + 1]!;
    quad(b, [[x0, y0], [x1, y1], [x1, y1 + LIP], [x0, y0 + LIP]], { part: P.TRIM, edges: 4, param: TOP });
  }
  quad(b, [[-0.105, 0.872], [0.105, 0.872], [0.15, 0.925], [-0.15, 0.925]], { part: P.TRIM, edges: 11, param: TOP });
  for (const y of [0.884, 0.9]) {
    quad(b, [[-0.07, y], [0.07, y], [0.07, y + 0.008], [-0.07, y + 0.008]], { part: P.TRIM, edges: 15, param: TOP });
  }

  // The dashboard, one quad under each stretch of its top edge, lined along that edge only.
  for (let i = 0; i + 1 < DASH_PROFILE.length; i++) {
    const [x0, y0] = DASH_PROFILE[i]!;
    const [x1, y1] = DASH_PROFILE[i + 1]!;
    quad(b, [[x0, BELOW], [x1, BELOW], [x1, y1], [x0, y0]], { part: P.DASH, edges: 4 });
  }
  // The cowl's lip: a second line under the top edge, so the edge reads as a thickness.
  for (let i = 0; i + 1 < DASH_PROFILE.length; i++) {
    const [x0, y0] = DASH_PROFILE[i]!;
    const [x1, y1] = DASH_PROFILE[i + 1]!;
    quad(b, [[x0, y0 - LIP], [x1, y1 - LIP], [x1, y1], [x0, y0]], { part: P.TRIM, edges: 1 });
  }
  // Vents on the sills, three slats a side. They show on a stage wider than the design.
  for (const y of [0.12, 0.155, 0.19]) {
    pair(b, [[0.93, y], [1.13, y], [1.13, y + 0.014], [0.93, y + 0.014]], { part: P.TRIM, edges: 15 });
  }

  // The two instrument panels: a bezel, then the glass the readouts sit on. The left glass is split between its two slots.
  rect(b, COCKPIT_PANELS.left, BEZEL, { part: P.TRIM, edges: 15 });
  rect(b, COCKPIT_PANELS.right, BEZEL, { part: P.TRIM, edges: 15 });
  const L = COCKPIT_PANELS.left;
  const split = (COCKPIT_SLOTS.status.y1 + COCKPIT_SLOTS.score.y0) / 2;
  quad(b, [[L.x0, L.y0], [L.x1, L.y0], [L.x1, split], [L.x0, split]], { part: P.GLASS, edges: 15 });
  quad(b, [[L.x0, split], [L.x1, split], [L.x1, L.y1], [L.x0, L.y1]], { part: P.GLASS, edges: 14 });
  rect(b, COCKPIT_PANELS.right, 0, { part: P.GLASS, edges: 15 });

  // The centre console the column comes out of, and the column itself. The console stays still. The column's foot stays
  // and its top moves with the wheel, under the boss, so it reaches the hub wherever a pull or a push puts it.
  quad(b, [[-0.3, BELOW], [0.3, BELOW], [0.2, 0.1], [-0.2, 0.1]], { part: P.TRIM, edges: 14 });
  quad(b, [[-0.022, BELOW], [0.022, BELOW], [0.022, HUB_Y], [-0.022, HUB_Y]], { part: P.TRIM, edges: 10, param: [0, 0, 1, 1] });

  // The wheel: a crossbar, two grips canted outward at the top, and a six-sided boss on the hub. rig 1.
  const rig: FaceOpts = { part: P.WHEEL, param: 1 };
  quad(b, [[HUB_X - 0.15, HUB_Y - 0.014], [HUB_X + 0.15, HUB_Y - 0.014], [HUB_X + 0.15, HUB_Y + 0.014], [HUB_X - 0.15, HUB_Y + 0.014]], { ...rig, edges: 5 });
  pair(b, [[0.134, HUB_Y - 0.03], [0.166, HUB_Y - 0.03], [0.182, HUB_Y + 0.09], [0.146, HUB_Y + 0.09]], { ...rig, edges: 15 });
  for (let i = 0; i < 6; i++) {
    const a0 = (Math.PI * 2 * i) / 6;
    const a1 = (Math.PI * 2 * (i + 1)) / 6;
    b.tri(p(HUB_X, HUB_Y), p(HUB_X + 0.036 * Math.cos(a0), HUB_Y + 0.036 * Math.sin(a0)), p(HUB_X + 0.036 * Math.cos(a1), HUB_Y + 0.036 * Math.sin(a1)), { ...rig, edges: 2 });
  }

  // Forearms: the elbow end stays, below and outside the frame, and the wrist end moves with the wheel.
  pair(b, [[0.36, -0.1], [0.5, -0.06], hp(-0.046, -0.029), hp(-0.046, 0.029)], { part: P.SLEEVE, edges: 10, param: [0, 0, 1, 1] });

  // Gloves, seen as the pilot sees them: the back of each hand, laid across its grip, with the fingers going away round the
  // grip's inner side. A cuff at the wrist, the back of the hand with a pad on it, four knuckles and the first joint of each
  // finger beyond them, and the thumb along the top. rig 1. Each face is given in the hand's own frame (hp).
  const glove: FaceOpts = { part: P.GLOVE, param: 1 };
  pair(b, [hp(-0.05, -0.034), hp(-0.034, -0.034), hp(-0.034, 0.034), hp(-0.05, 0.034)], { ...glove, edges: 15 });
  pair(b, [hp(-0.034, -0.03), hp(KNUCKLE_S, -HAND_HALF), hp(KNUCKLE_S, HAND_HALF), hp(-0.034, 0.03)], { ...glove, edges: 10 });
  pair(b, [hp(-0.024, -0.014), hp(0.008, -0.02), hp(0.008, 0.02), hp(-0.024, 0.014)], { ...glove, edges: 15 });
  const fingers = 4;
  const width = (2 * HAND_HALF) / fingers;
  for (let i = 0; i < fingers; i++) {
    const t0 = -HAND_HALF + i * width;
    const t1 = t0 + width;
    const tip = KNUCKLE_S + FINGER_LEN[i]!;
    pair(b, [hp(KNUCKLE_S, t0), hp(tip, t0 + 0.002), hp(tip, t1 - 0.002), hp(KNUCKLE_S, t1)], { ...glove, edges: 15 });
  }
  pair(b, [hp(-0.03, -0.029), hp(-0.016, -0.05), hp(0.03, -0.052), hp(0.02, -0.035)], { ...glove, edges: 15 });

  return b.finish();
}

/** The wheel's pose, in caller-owned storage. */
export interface YokePose {
  /** -1 full left, 1 full right. The vertex program turns the wheel by turn * COCKPIT_WHEEL_TURN, clockwise for right. */
  turn: number;
  /** 1 pulled fully back, toward the pilot, as the ship climbs; -1 pushed fully away, as it dives. */
  pull: number;
}

export function createYokePose(): YokePose {
  return { turn: 0, pull: 0 };
}

/**
 * The wheel follows the ship's motion (T13 R-2), read from the pose the ship itself is drawn with: its bank is its sideways
 * speed and its pitch its vertical speed, each already clamped, and both held during hit-stop. So the wheel is as pure as
 * the ship, and one path serves keys, mouse, touch and the autopilot. Positive bank is a bank to the left.
 */
export function yokePose(ship: Readonly<ShipPose>, out: YokePose): void {
  const t = -ship.bank / BANK_MAX;
  const u = ship.pitch / PITCH_MAX;
  out.turn = t < -1 ? -1 : t > 1 ? 1 : t;
  out.pull = u < -1 ? -1 : u > 1 ? 1 : u;
}

/**
 * Where the vertex program puts a point that moves with the wheel: turned about the hub, then scaled about the eye line.
 * The twin of glsl/cockpit.vert.glsl's rig path, for tests.
 */
export function wheelPoint(x: number, y: number, pose: Readonly<YokePose>, out: { x: number; y: number }): void {
  const a = -pose.turn * COCKPIT_WHEEL_TURN;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const rx = x - HUB_X;
  const ry = y - HUB_Y;
  const qx = HUB_X + c * rx - s * ry;
  const qy = HUB_Y + s * rx + c * ry;
  const k = 1 + COCKPIT_WHEEL_PULL * pose.pull;
  out.x = qx * k;
  out.y = COCKPIT_EYE_Y + (qy - COCKPIT_EYE_Y) * k;
}

/** The farthest any vertex that moves wholly with the wheel lies from the hub at rest, which must stay inside COCKPIT_WHEEL_REACH. For tests. */
export function wheelReach(m: BuiltMesh): number {
  let far = 0;
  for (let i = 0; i < m.tag.length / 2; i++) {
    if (m.tag[i * 2 + 1] !== 1) continue;
    const d = Math.hypot(m.position[i * 3]! - HUB_X, m.position[i * 3 + 1]! - HUB_Y);
    if (d > far) far = d;
  }
  return far;
}
