// T13 A7: the cockpit mesh and the wheel's pose. The panels are where src/core/cockpit.ts says, so the UI's readouts land
// on their glass; the wheel and the hands stay inside their reach; and the wheel follows the ship's motion.
import { describe, expect, it } from 'vitest';
import { SimMode, SPEED_CRUISE, type FeelState, type SimState } from '../../../src/contracts/index';
import { createNeutralFeel } from '../../../src/core/alloc';
import {
  COCKPIT_DASH_TOP, COCKPIT_EYE_Y, COCKPIT_HUB, COCKPIT_PANELS, COCKPIT_WHEEL_PULL, COCKPIT_WHEEL_REACH, COCKPIT_WHEEL_TURN, type CockpitRect,
} from '../../../src/core/cockpit';
import type { BuiltMesh } from '../../../src/render/props/builders';
import { CockpitPart, DASH_PROFILE, buildCockpit, createYokePose, wheelPoint, wheelReach, yokePose } from '../../../src/render/props/cockpit';
import { cockpitConstants } from '../../../src/render/props/material';
import { BANK_MAX, PITCH_MAX, createShipPose, shipPose } from '../../../src/render/props/ship';
import vertSource from '../../../src/render/props/glsl/cockpit.vert.glsl?raw';

const mesh = buildCockpit();
const count = mesh.position.length / 3;
const partOf = (i: number): number => mesh.tag[i * 2]!;
const rigOf = (i: number): number => mesh.tag[i * 2 + 1]!;

/** The bounds of the glass on one side of x = 0. */
function glassBounds(m: BuiltMesh, side: -1 | 1): CockpitRect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < m.position.length / 3; i++) {
    if (m.tag[i * 2] !== CockpitPart.GLASS) continue;
    const x = m.position[i * 3]!, y = m.position[i * 3 + 1]!;
    if (Math.sign(x) !== side) continue;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}
const f32 = (r: CockpitRect): CockpitRect => ({ x0: Math.fround(r.x0), y0: Math.fround(r.y0), x1: Math.fround(r.x1), y1: Math.fround(r.y1) });

function sim(over: Partial<SimState> = {}): SimState {
  return {
    tick: 0, travel: { chunk: 1, local: 0 }, stepDist: 0.66, speed: SPEED_CRUISE,
    x: 0, y: 8, prevX: 0, prevY: 8, mode: SimMode.PLAY,
    score: 0, sync: 1, shields: 3, overdrive: 0, ghost: 0, beat: 0, sectorIndex: 0, objectiveProgress: 0,
    autopilot: false, warpSerial: 0,
    ...over,
  };
}
const phases = new Float32Array(8).fill(0.3);
const feel = (over: Partial<FeelState> = {}): FeelState => ({ ...createNeutralFeel(), ...over });
function yokeFor(s: SimState, fl: FeelState = feel()): { turn: number; pull: number } {
  const ship = createShipPose();
  shipPose(s, fl, 1, phases, ship);
  const y = createYokePose();
  yokePose(ship, y);
  return y;
}

describe('buildCockpit', () => {
  it('is one small flat mesh', () => {
    expect(mesh.tris).toBeLessThanOrEqual(400);
    expect(mesh.tris).toBeGreaterThan(60);
    for (let i = 0; i < count; i++) expect(mesh.position[i * 3 + 2]).toBe(0);
    for (let i = 0; i < mesh.position.length; i++) expect(Number.isFinite(mesh.position[i]!)).toBe(true);
  });

  it('the glass of each panel is exactly the panel of src/core/cockpit.ts', () => {
    expect(glassBounds(mesh, -1)).toEqual(f32(COCKPIT_PANELS.left));
    expect(glassBounds(mesh, 1)).toEqual(f32(COCKPIT_PANELS.right));
  });

  it('control: a panel moved in the layout without the mesh no longer matches', () => {
    const moved = { ...COCKPIT_PANELS.left, x0: COCKPIT_PANELS.left.x0 + 0.01, x1: COCKPIT_PANELS.left.x1 + 0.01 };
    expect(glassBounds(mesh, -1)).not.toEqual(f32(moved));
  });

  it('the dashboard tops out at COCKPIT_DASH_TOP, symmetrically, and nothing but the struts rises above it', () => {
    expect(Math.max(...DASH_PROFILE.map((q) => q[1]))).toBe(COCKPIT_DASH_TOP);
    for (let i = 0; i < DASH_PROFILE.length; i++) {
      const a = DASH_PROFILE[i]!, b = DASH_PROFILE[DASH_PROFILE.length - 1 - i]!;
      expect([a[0], a[1]]).toEqual([-b[0], b[1]]);
    }
    for (let i = 0; i < count; i++) {
      if (partOf(i) === CockpitPart.STRUT) continue;
      expect(mesh.position[i * 3 + 1]!).toBeLessThanOrEqual(Math.fround(COCKPIT_DASH_TOP));
    }
  });

  it('is mirror-symmetric: every vertex but the glass has a twin across x = 0 with the same part and rig', () => {
    const key = (x: number, y: number, part: number, rig: number): string => `${x.toFixed(5)},${y.toFixed(5)},${part},${rig}`;
    const seen = new Set<string>();
    for (let i = 0; i < count; i++) seen.add(key(mesh.position[i * 3]!, mesh.position[i * 3 + 1]!, partOf(i), rigOf(i)));
    for (let i = 0; i < count; i++) {
      // The left glass is split between its two slots and the right is one piece, so the glass is compared by its bounds above.
      if (partOf(i) === CockpitPart.GLASS) continue;
      expect(seen.has(key(-mesh.position[i * 3]! + 0, mesh.position[i * 3 + 1]!, partOf(i), rigOf(i))), `vertex ${i}`).toBe(true);
    }
  });

  it('is in painter\'s order: struts, then dashboard and panels, then the wheel, then sleeves, then gloves', () => {
    const first = (part: number): number => { for (let t = 0; t < mesh.index.length; t++) if (partOf(mesh.index[t]!) === part) return t; return -1; };
    const last = (part: number): number => { for (let t = mesh.index.length - 1; t >= 0; t--) if (partOf(mesh.index[t]!) === part) return t; return -1; };
    const P = CockpitPart;
    expect(last(P.STRUT)).toBeLessThan(first(P.DASH));
    expect(last(P.DASH)).toBeLessThan(first(P.GLASS));
    expect(last(P.GLASS)).toBeLessThan(first(P.WHEEL));
    expect(last(P.TRIM)).toBeLessThan(first(P.WHEEL));
    expect(last(P.WHEEL)).toBeLessThan(first(P.SLEEVE));
    expect(last(P.SLEEVE)).toBeLessThan(first(P.GLOVE));
  });

  it('what moves with the wheel stays inside its reach, and only the wheel, the gloves, the wrists and the column\'s top move', () => {
    expect(wheelReach(mesh)).toBeLessThanOrEqual(COCKPIT_WHEEL_REACH);
    expect(wheelReach(mesh)).toBeGreaterThan(0.15);
    for (let i = 0; i < count; i++) {
      const part = partOf(i), rig = rigOf(i);
      expect(rig === 0 || rig === 1).toBe(true);
      if (part === CockpitPart.WHEEL || part === CockpitPart.GLOVE) expect(rig).toBe(1);
      if (part === CockpitPart.DASH || part === CockpitPart.GLASS || part === CockpitPart.STRUT) expect(rig).toBe(0);
    }
  });
});

describe('yokePose', () => {
  it('turns right when the ship moves right, left when it moves left, and is centred when it holds its line', () => {
    expect(yokeFor(sim({ x: 0.1, prevX: 0 })).turn).toBeGreaterThan(0);
    expect(yokeFor(sim({ x: -0.1, prevX: 0 })).turn).toBeLessThan(0);
    expect(yokeFor(sim()).turn).toBe(0);
  });

  it('pulls back when the ship climbs and pushes forward when it dives', () => {
    expect(yokeFor(sim({ y: 8.05, prevY: 8 })).pull).toBeGreaterThan(0);
    expect(yokeFor(sim({ y: 7.95, prevY: 8 })).pull).toBeLessThan(0);
    expect(yokeFor(sim()).pull).toBe(0);
  });

  it('is bounded at 1 each way, however fast the ship moves', () => {
    const y = yokeFor(sim({ x: 5, prevX: 0, y: 14, prevY: 2 }));
    expect([y.turn, y.pull]).toEqual([1, 1]);
    const z = yokeFor(sim({ x: -5, prevX: 0, y: 2, prevY: 14 }));
    expect([z.turn, z.pull]).toEqual([-1, -1]);
  });

  it('is the ship\'s own bank and pitch, scaled, so it holds during hit-stop as the ship does', () => {
    const ship = createShipPose();
    shipPose(sim({ x: 0.1, prevX: 0, y: 8.03, prevY: 8 }), feel(), 1, phases, ship);
    const before = createYokePose();
    yokePose(ship, before);
    expect(before.turn).toBeCloseTo(-ship.bank / BANK_MAX, 12);
    expect(before.pull).toBeCloseTo(ship.pitch / PITCH_MAX, 12);
    shipPose(sim({ x: -0.2, prevX: 0, y: 7.9, prevY: 8 }), feel({ shipHold: 1 }), 1, phases, ship);
    const held = createYokePose();
    yokePose(ship, held);
    expect(held).toEqual(before);
  });
});

describe('wheelPoint, the twin of the vertex program', () => {
  const out = { x: 0, y: 0 };
  const hx = COCKPIT_HUB.x, hy = COCKPIT_HUB.y;

  it('leaves a point alone with the wheel centred', () => {
    wheelPoint(0.15, 0.2, { turn: 0, pull: 0 }, out);
    expect([out.x, out.y]).toEqual([0.15, 0.2]);
  });

  it('turns clockwise for right: the right grip goes down and the left one up, each staying at its radius', () => {
    wheelPoint(hx + 0.15, hy, { turn: 1, pull: 0 }, out);
    expect(out.y).toBeLessThan(hy);
    expect(Math.hypot(out.x - hx, out.y - hy)).toBeCloseTo(0.15, 12);
    expect(Math.atan2(hy - out.y, out.x - hx)).toBeCloseTo(COCKPIT_WHEEL_TURN, 12);
    wheelPoint(hx - 0.15, hy, { turn: 1, pull: 0 }, out);
    expect(out.y).toBeGreaterThan(hy);
  });

  it('a pull grows the wheel about the eye line and lowers its hub; a push does the reverse', () => {
    wheelPoint(hx, hy, { turn: 0, pull: 1 }, out);
    expect(out.y).toBeCloseTo(COCKPIT_EYE_Y + (hy - COCKPIT_EYE_Y) * (1 + COCKPIT_WHEEL_PULL), 12);
    expect(out.y).toBeLessThan(hy);
    wheelPoint(hx + 0.1, hy, { turn: 0, pull: 1 }, out);
    expect(out.x).toBeCloseTo(0.1 * (1 + COCKPIT_WHEEL_PULL), 12);
    wheelPoint(hx, hy, { turn: 0, pull: -1 }, out);
    expect(out.y).toBeGreaterThan(hy);
  });
});

describe('the vertex program reads the layout\'s numbers', () => {
  it('the generated constants carry the hub, the eye line, the turn and the pull of src/core/cockpit.ts', () => {
    const c = cockpitConstants();
    expect(c).toContain(`#define COCKPIT_HUB vec2(${COCKPIT_HUB.x.toFixed(5)}, ${COCKPIT_HUB.y.toFixed(5)})`);
    expect(c).toContain(`#define COCKPIT_EYE vec2(0., ${COCKPIT_EYE_Y.toFixed(5)})`);
    expect(c).toContain(`#define COCKPIT_TURN ${COCKPIT_WHEEL_TURN.toFixed(5)}`);
    expect(c).toContain(`#define COCKPIT_PULL ${COCKPIT_WHEEL_PULL.toFixed(5)}`);
  });

  it('and uses each of them, with the turn clockwise for right', () => {
    for (const name of ['COCKPIT_HUB', 'COCKPIT_EYE', 'COCKPIT_TURN', 'COCKPIT_PULL', 'COCKPIT_ZOOM']) expect(vertSource).toContain(name);
    expect(vertSource).toContain('float a = -uYoke.x * COCKPIT_TURN;');
  });
});
