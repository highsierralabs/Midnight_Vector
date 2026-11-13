// A5: followGainX, and the ship's framing at the lane edges at every aspect (DI-81, DI-88). The framing rows project T05's
// real ship body, every vertex of buildShipBody() with the pose's bank and pitch applied as ship.vert.glsl does, through a
// real camera posed as section 6.1 and the T00 camera seam say, at x = +PLAY_HALF_X and -PLAY_HALF_X.
import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CAMERA_FAR, CAMERA_FOV, CAMERA_NEAR, CAMERA_PITCH, CAMERA_Y, PLAY_HALF_X, PLAY_Y_MAX, PLAY_Y_MIN, SHIP_FORWARD } from '../../../src/contracts/index';
import { FIRST_HALF_TAN_MAX, FOLLOW_EDGE, FOLLOW_Y, firstPersonFovCap, followGainX } from '../../../src/app/follow';
import { SHIP_HALF_LENGTH, SHIP_HALF_WIDTH, buildShipBody } from '../../../src/render/props/ship';

const SHIP = buildShipBody().position;
const BANK_MAX = 0.55;
const PITCH_MAX = 0.22;
const WIDE = 16 / 9;
/**
 * Where DI-88's formula reaches .72, from its own terms: (.28 PLAY_HALF_X + SHIP_HALF_WIDTH) / (.85 tan(29 deg) WING_DEPTH)
 * = 2.30227 [arithmetic]. DI-88 rounds it to 2.30, and T03 found the rounded figure reads .72032, so the rows test the
 * formula at either side of the exact crossing, not at 2.30.
 */
const CROSS = (0.28 * PLAY_HALF_X + SHIP_HALF_WIDTH) / (0.85 * Math.tan((CAMERA_FOV / 2) * Math.PI / 180) * (SHIP_FORWARD - SHIP_HALF_LENGTH));

/** Inside the frame with a tenth of the half-width to spare, in every pose the sim allows at the wall. */
const IN_FRAME = 0.9;

/**
 * The outermost NDC x of the ship body, on the side of x, for the ship at (x, y), banked and pitched, with the camera at
 * (gain * x, CAMERA_Y + FOLLOW_Y * (y - 6), 0) and section 6.1's pitch, at the base FOV, which feel only widens.
 */
function outerNdc(aspect: number, x: number, bank: number, pitch: number, gain = followGainX(aspect), y = 6): number {
  const cam = new PerspectiveCamera(CAMERA_FOV, aspect, CAMERA_NEAR, CAMERA_FAR);
  cam.position.set(gain * x, CAMERA_Y + FOLLOW_Y * (y - 6), 0);
  cam.rotation.set(CAMERA_PITCH, 0, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  const v = new Vector3();
  const cb = Math.cos(bank), sb = Math.sin(bank), cp = Math.cos(pitch), sp = Math.sin(pitch);
  let outer = -Infinity;
  for (let i = 0; i < SHIP.length; i += 3) {
    const lx0 = SHIP[i]!, ly0 = SHIP[i + 1]!, lz0 = SHIP[i + 2]!;
    const lx = cb * lx0 - sb * ly0;
    const ly1 = sb * lx0 + cb * ly0;
    const ly = cp * ly1 + sp * lz0;
    const lz = -sp * ly1 + cp * lz0;
    v.set(x + lx, y + ly, -SHIP_FORWARD + lz).project(cam);
    outer = Math.max(outer, Math.sign(x) * v.x);
  }
  return outer;
}

/** Every aspect the app can meet, phone portrait to super-ultrawide (DI-88: the rule holds at every aspect). */
const ASPECTS: [string, number][] = [
  ['360x800', 360 / 800], ['390x844', 390 / 844], ['430x932', 430 / 932], ['2:3', 2 / 3], ['3:4', 3 / 4], ['1:1', 1],
  ['4:3', 4 / 3], ['3:2', 3 / 2], ['16:10', 16 / 10], ['16:9', WIDE], ['1920x1080', 1920 / 1080], ['1.9', 1.9], ['2:1', 2],
  ['844x390', 844 / 390], ['just under the .72 crossing', CROSS - 1e-6], ['21:9', 21 / 9], ['2520x1080', 2520 / 1080],
  ['32:9', 32 / 9],
];

describe('followGainX', () => {
  it('is .72 from the crossing at about 2.3023 up, above it below, and never below .72 (DI-88)', () => {
    console.log(`FOLLOW crossing at aspect ${CROSS.toFixed(5)}: gain ${followGainX(CROSS - 1e-4).toFixed(6)} just under, ${followGainX(CROSS + 1e-4)} just over, ${followGainX(2.3).toFixed(5)} at 2.30`);
    expect(CROSS).toBeGreaterThan(2.302);
    expect(CROSS).toBeLessThan(2.303);
    for (const a of [CROSS + 1e-4, 2.31, 21 / 9, 2520 / 1080, 32 / 9, 10]) expect(followGainX(a)).toBe(0.72);
    for (const a of [CROSS - 1e-4, 2.3, 2.29, 844 / 390, 2, WIDE]) expect(followGainX(a)).toBeGreaterThan(0.72);
    for (let a = 0.2; a < 12; a += 0.01) expect(followGainX(a)).toBeGreaterThanOrEqual(0.72);
  });

  it('rises monotonically as the view narrows', () => {
    let prev = followGainX(3);
    for (let a = 3; a > 0.3; a -= 0.01) {
      const g = followGainX(a);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
  });

  it('values at the listed aspects, to 3 places', () => {
    const at = (a: number): string => followGainX(a).toFixed(3);
    console.log(`FOLLOW gain 390x844 ${at(390 / 844)}, 1:1 ${at(1)}, 4:3 ${at(4 / 3)}, 16:10 ${at(1.6)}, 16:9 ${at(WIDE)}, 2:1 ${at(2)}, 844x390 ${at(844 / 390)}, 21:9 ${at(21 / 9)}`);
    expect(at(21 / 9)).toBe('0.720');
    expect(at(844 / 390)).toBe('0.739');
    expect(at(2)).toBe('0.762');
    expect(at(WIDE)).toBe('0.793');
    expect(at(1.6)).toBe('0.818');
    expect(at(4 / 3)).toBe('0.855');
    expect(at(1)).toBe('0.901');
    expect(at(390 / 844)).toBe('0.976');
  });

  it('camera x at the wall is the one T03 checked fog, edge paint and cracks at (DI-88): 16:9 31.72, 16:10 32.70, 21:9 28.80', () => {
    const wall = (a: number): string => (followGainX(a) * PLAY_HALF_X).toFixed(2);
    console.log(`FOLLOW camera x at x = ${PLAY_HALF_X}: 16:9 ${wall(WIDE)}, 16:10 ${wall(1.6)}, 21:9 ${wall(21 / 9)}`);
    expect(wall(WIDE)).toBe('31.72');
    expect(wall(1.6)).toBe('32.70');
    expect(wall(21 / 9)).toBe('28.80');
  });

  it('FOLLOW_Y is section 6.1s .15 (DI-118, from .35)', () => {
    expect(FOLLOW_Y).toBe(0.15);
  });
});

describe('the ship stays in frame at both lane edges at every aspect (DI-81, DI-88)', () => {
  for (const [name, aspect] of ASPECTS) {
    const clamped = followGainX(aspect) === 0.72;
    it(`${name}: the whole body inside ${IN_FRAME} of the half-width at x = +-${PLAY_HALF_X}, at every height, banked and pitched; level ${clamped ? 'inside' : 'at'} ${FOLLOW_EDGE}`, () => {
      let worst = -Infinity;
      for (const x of [PLAY_HALF_X, -PLAY_HALF_X]) {
        for (const y of [PLAY_Y_MIN, 6, PLAY_Y_MAX]) {
          for (const bank of [0, BANK_MAX, -BANK_MAX]) {
            for (const pitch of [0, PITCH_MAX, -PITCH_MAX]) worst = Math.max(worst, outerNdc(aspect, x, bank, pitch, undefined, y));
          }
        }
      }
      const level = [outerNdc(aspect, PLAY_HALF_X, 0, 0), outerNdc(aspect, -PLAY_HALF_X, 0, 0)];
      console.log(`FOLLOW ${name} gain ${followGainX(aspect).toFixed(4)}: worst pose ${worst.toFixed(4)}, level at +-${PLAY_HALF_X} ${level.map((v) => v.toFixed(4)).join(' ')}`);
      expect(worst).toBeLessThanOrEqual(IN_FRAME);
      // Where the formula sets the gain, the level ship at the wall sits at the margin on both sides: framed, and the
      // camera does not over-follow. Where .72 holds (aspect above the crossing) it sits further inside.
      for (const v of level) {
        if (clamped) expect(v).toBeLessThanOrEqual(FOLLOW_EDGE + 0.01);
        else expect(Math.abs(v - FOLLOW_EDGE)).toBeLessThanOrEqual(0.01);
      }
    });
  }

  it('control: the centre-only gain of round 1 leaves the wing out of frame at 390x844, at both edges', () => {
    const halfTan = Math.tan((CAMERA_FOV / 2) * Math.PI / 180) * (390 / 844);
    const old = Math.max(0.72, 1 - 0.85 * halfTan * SHIP_FORWARD / PLAY_HALF_X);
    expect(old.toFixed(3)).toBe('0.924');
    expect(outerNdc(390 / 844, PLAY_HALF_X, 0, 0, old)).toBeGreaterThan(1);
    expect(outerNdc(390 / 844, -PLAY_HALF_X, 0, 0, old)).toBeGreaterThan(1);
  });

  it('control, D-011: round 2 held .72 from 16:9 up, and that gain leaves the wing out of frame at 16:9, at both edges', () => {
    const rows: string[] = [];
    for (const [name, a] of [['16:9', WIDE], ['1.9', 1.9], ['2:1', 2], ['844x390', 844 / 390], ['21:9', 21 / 9]] as [string, number][]) {
      rows.push(`${name} ${outerNdc(a, PLAY_HALF_X, 0, 0, 0.72).toFixed(3)} (now ${outerNdc(a, PLAY_HALF_X, 0, 0).toFixed(3)})`);
    }
    console.log(`FOLLOW outer wing NDC at x = ${PLAY_HALF_X}, gain .72: ${rows.join(', ')}`);
    expect(outerNdc(WIDE, PLAY_HALF_X, 0, 0, 0.72)).toBeGreaterThan(1);
    expect(outerNdc(WIDE, -PLAY_HALF_X, 0, 0, 0.72)).toBeGreaterThan(1);
  });
});

describe('firstPersonFovCap (T13)', () => {
  it('is 66 degrees at 21:9, under section 6.4’s 68 there, and falls as the stage widens', () => {
    expect(firstPersonFovCap(2520 / 1080)).toBeCloseTo(66, 1);
    expect(firstPersonFovCap(2520 / 1080)).toBeLessThan(67);
    expect(firstPersonFovCap(3440 / 1440)).toBeLessThan(firstPersonFovCap(2520 / 1080));
    expect(firstPersonFovCap(32 / 9)).toBeCloseTo((2 * Math.atan(FIRST_HALF_TAN_MAX / (32 / 9)) * 180) / Math.PI, 12);
  });

  it('does not bite at 16:9, 4:3 or on a phone, where feel’s own 68 is the most there is', () => {
    for (const aspect of [16 / 9, 4 / 3, 844 / 390, 390 / 844]) expect(firstPersonFovCap(aspect), String(aspect)).toBeGreaterThan(68);
  });

  it('is tighter than section 6.4’s cap at every aspect', () => {
    expect(FIRST_HALF_TAN_MAX).toBeLessThan(1.574);
  });
});
