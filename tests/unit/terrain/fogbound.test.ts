// Section 6.4's fog table, from bendV's formula and nothing else, so the render (A9) and this arithmetic are independent checks.
import { describe, expect, it } from 'vitest';
import { CAMERA_FOV, CAMERA_FOV_MAX, CAMERA_HALF_TAN_MAX, CAMERA_Y, FOG_END, PLAY_HALF_X, SHIP_FORWARD } from '../../../src/contracts/index';
import { cameraFov } from '../../../src/core/uniforms';
import { halfWidthOf, spacing } from '../../../src/render/terrain/layout';

const VMAX = 1500;
const ASPECT_21_9 = 21 / 9;
const ASPECT_32_9 = 32 / 9;
const DEG = Math.PI / 180;

/** q of bendV, the amount multiplied by a and by c. */
function q(v: number): number {
  const b = Math.min(v, VMAX);
  return b * b + 2 * VMAX * (v - b);
}

/**
 * Post-bend radial distance at which the edge x = -edgeX enters the frustum's left plane, with bend a > 0, which leans the far
 * field right. Bisection on forward distance: below the root the edge is outside the frustum, above it inside.
 */
function radialEntry(fovDeg: number, aspect: number, camX: number, a: number, edgeX: number): number {
  const half = Math.tan((fovDeg / 2) * DEG) * aspect;
  const inside = (v: number): boolean => (-edgeX + a * q(v) - camX) / v >= -half;
  let lo = 1, hi = 6016;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (inside(mid)) hi = mid; else lo = mid;
  }
  const v = hi;
  const dx = -edgeX + a * q(v) - camX;
  return Math.hypot(dx, CAMERA_Y, v);
}

describe('fog bound', () => {
  const edge = halfWidthOf(5);

  it('reproduces the section 6.4 table', () => {
    expect(radialEntry(CAMERA_FOV, ASPECT_21_9, 0, 8e-5, edge)).toBeCloseTo(4559, -0.3);
    expect(radialEntry(66, ASPECT_21_9, 0, 8e-5, edge)).toBeCloseTo(4423, -0.3);
    expect(radialEntry(CAMERA_FOV_MAX, ASPECT_21_9, 0, 8e-5, edge)).toBeCloseTo(4396, -0.3);
    expect(radialEntry(CAMERA_FOV_MAX, ASPECT_21_9, -28.8, 8e-5, edge)).toBeCloseTo(4366, -0.3);
    // toBeCloseTo(_, -0.3) is a tolerance of 1 u. The plan allows 2.
  });

  it('every row of the table is past FOG_END, and the worst boundary-cell inner edge is too, by half a unit', () => {
    for (const [fov, camX] of [[CAMERA_FOV, 0], [66, 0], [CAMERA_FOV_MAX, 0], [CAMERA_FOV_MAX, -28.8]] as const) {
      expect(radialEntry(fov, ASPECT_21_9, camX, 8e-5, edge)).toBeGreaterThan(FOG_END);
    }
    const inner = radialEntry(CAMERA_FOV_MAX, ASPECT_21_9, -28.8, 8e-5, edge - spacing(5));
    expect(inner).toBeGreaterThanOrEqual(FOG_END);
    expect(inner).toBeLessThan(FOG_END + 1);
  });

  it('negative control: 32:9 at FOV 68, uncapped, is under FOG_END', () => {
    const r = radialEntry(CAMERA_FOV_MAX, ASPECT_32_9, 0, 8e-5, edge);
    expect(r).toBeCloseTo(4211, -0.3);
    expect(r).toBeLessThan(FOG_END);
  });

  it('the cap holds the horizontal half-tangent at 32:9, which restores the bound', () => {
    const fov = cameraFov(CAMERA_FOV_MAX, ASPECT_32_9);
    expect(Math.tan((fov / 2) * DEG) * ASPECT_32_9).toBeCloseTo(CAMERA_HALF_TAN_MAX, 10);
    expect(radialEntry(fov, ASPECT_32_9, 0, 8e-5, edge)).toBeGreaterThan(FOG_END);
    // At 21:9 the cap sits a hair above 68, so it does not bite.
    expect(cameraFov(CAMERA_FOV_MAX, ASPECT_21_9)).toBe(CAMERA_FOV_MAX);
  });
});

/**
 * DI-88's follow gain (section 6.1): max(.72, 1 - (.85 tan(29 deg) aspect (SHIP_FORWARD - SHIP_HALF_LENGTH) - SHIP_HALF_WIDTH) /
 * PLAY_HALF_X). T05's half sizes, 1.6 wide and 2.2 long, are written here because this folder imports neither src/render/props
 * nor src/app; the first test pins the result to DI-88's quoted figures, so a drift in either shows.
 */
function followGain(aspect: number): number {
  const SHIP_HALF_WIDTH = 1.6;
  const SHIP_HALF_LENGTH = 2.2;
  const halfTan = Math.tan((CAMERA_FOV / 2) * DEG) * aspect;
  return Math.max(0.72, 1 - (0.85 * halfTan * (SHIP_FORWARD - SHIP_HALF_LENGTH) - SHIP_HALF_WIDTH) / PLAY_HALF_X);
}

describe('fog bound at the DI-88 follow wall', () => {
  const edge = halfWidthOf(5);
  const inner = edge - spacing(5);
  /** Name, aspect, and a camera x large enough that the boundary cell's inner edge enters under FOG_END (the control). */
  const shapes = [['16:9', 16 / 9, 300], ['16:10', 16 / 10, 400]] as const;

  it('gives DI-88\'s figures: .793 at 16:9, .72 at 21:9 and from about 2.30 up', () => {
    expect(followGain(16 / 9)).toBeCloseTo(0.793, 3);
    expect(followGain(ASPECT_21_9)).toBe(0.72);
    // DI-88's 2.30 is rounded: the formula reaches .72 at aspect 2.3023.
    expect(followGain(2.31)).toBe(0.72);
    expect(followGain(2.29)).toBeGreaterThan(0.72);
    expect(followGain(16 / 10)).toBeGreaterThan(followGain(16 / 9));
  });

  it('at 16:9 and 16:10, FOV 68, full bend and camera x at the wall, the boundary cell\'s inner edge is past FOG_END', () => {
    for (const [name, aspect] of shapes) {
      const fov = cameraFov(CAMERA_FOV_MAX, aspect);
      expect(fov).toBe(CAMERA_FOV_MAX);
      const camX = -followGain(aspect) * PLAY_HALF_X;
      const outerR = radialEntry(fov, aspect, camX, 8e-5, edge);
      const innerR = radialEntry(fov, aspect, camX, 8e-5, inner);
      console.log(`FOGBOUND DI-88 ${name} gain ${followGain(aspect).toFixed(4)} camX ${camX.toFixed(2)} outer ${outerR.toFixed(1)} inner ${innerR.toFixed(1)}`);
      expect(innerR).toBeGreaterThan(FOG_END);
      expect(outerR).toBeGreaterThan(innerR);
    }
  });

  it('negative control: the control camera x brings the inner edge under FOG_END at each shape', () => {
    for (const [name, aspect, control] of shapes) {
      const fov = cameraFov(CAMERA_FOV_MAX, aspect);
      const innerR = radialEntry(fov, aspect, -control, 8e-5, inner);
      console.log(`FOGBOUND DI-88 control ${name} camX -${control} inner ${innerR.toFixed(1)}`);
      expect(innerR).toBeLessThan(FOG_END);
    }
  });
});
