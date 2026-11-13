// T13 A3: the ship plane. With the chase camera (camAhead 0) every value the props programs read is what it was before
// T13, to the last bit; in first person the ship plane is at or behind the camera plane and the values follow it.
import { describe, expect, it } from 'vitest';
import { SHIP_FORWARD } from '../../../src/contracts/index';
import { createLayerUniforms } from '../../../src/render/props/material';
import { SHIP_HALF_LENGTH, SHIP_SHOW_DEPTH, createShipPlane, shipPlane } from '../../../src/render/props/ship';
import fragSource from '../../../src/render/props/glsl/props.frag.glsl?raw';
import vertSource from '../../../src/render/props/glsl/props.vert.glsl?raw';

const f = Math.fround;
/** GLSL's smoothstep in float32, as the fragment stage evaluates the fence's fade. */
function smoothstep32(a: number, b: number, x: number): number {
  const t = f(Math.min(1, Math.max(0, f(f(x - a) / f(b - a)))));
  return f(f(t * t) * f(3 - f(2 * t)));
}

describe('shipPlane at the chase camera', () => {
  const p = createShipPlane();
  shipPlane(SHIP_FORWARD, { camAhead: 0 }, p);

  it('gives the depth, the gate depth and the shrink depths the uniforms were created with', () => {
    const u = createLayerUniforms();
    expect(p.depth).toBe(14);
    expect(p.gateOpen).toBe(SHIP_FORWARD - SHIP_HALF_LENGTH);
    expect(p.gateOpen).toBe(u.uGateOpen.value);
    expect([p.nearLo, p.nearHi, p.droneLo, p.droneHi]).toEqual([2, 11, 2, 11]);
    expect(Array.from(u.uNearShrink.value)).toEqual([2, 11, 2, 11]);
    expect(p.visible).toBe(true);
    expect(createShipPlane()).toEqual(p);
  });

  it('the fence fade has the edges 10 and 12.5 exactly, in float32, as its literals had', () => {
    const open = f(p.gateOpen);
    expect(f(open - f(1.8))).toBe(10);
    expect(f(open + f(0.7))).toBe(12.5);
    for (const z of [9, 10, 10.4, 11.25, 12, 12.5, 13]) {
      expect(smoothstep32(f(open - f(1.8)), f(open + f(0.7)), f(z))).toBe(smoothstep32(10, 12.5, f(z)));
    }
  });

  it('control: a gate depth one float32 step off moves an edge, so the row above can fail', () => {
    const off = f(f(p.gateOpen) + 2 ** -19);
    expect(f(off - f(1.8)) === 10 && f(off + f(0.7)) === 12.5).toBe(false);
  });

  it('a sheet tool\'s forward value moves the plane and the gate depth with it, as before', () => {
    const q = createShipPlane();
    shipPlane(30, { camAhead: 0 }, q);
    expect([q.depth, q.gateOpen]).toEqual([30, 30 - SHIP_HALF_LENGTH]);
  });
});

describe('shipPlane in first person', () => {
  it('cockpit: the plane is the camera plane, no gate opens, a pickup shrinks over its last 9 u and a drone stays whole until 3', () => {
    const p = createShipPlane();
    shipPlane(SHIP_FORWARD, { camAhead: SHIP_FORWARD }, p);
    expect(p.depth).toBe(0);
    expect(p.gateOpen).toBe(-SHIP_HALF_LENGTH);
    expect([p.nearLo, p.nearHi, p.droneLo, p.droneHi]).toEqual([2.5, 9, 1, 3]);
    expect(p.visible).toBe(false);
  });

  it('nose: the plane is behind the camera', () => {
    const p = createShipPlane();
    shipPlane(SHIP_FORWARD, { camAhead: SHIP_FORWARD + SHIP_HALF_LENGTH }, p);
    expect(p.depth).toBeCloseTo(-SHIP_HALF_LENGTH, 12);
    expect([p.nearLo, p.nearHi, p.droneLo, p.droneHi]).toEqual([2.5, 9, 1, 3]);
    expect(p.visible).toBe(false);
  });

  it('on the way, the shrink depths move monotonically and stay ordered, and the ship shows down to SHIP_SHOW_DEPTH', () => {
    const p = createShipPlane();
    let hi = 11, droneLo = 2, droneHi = 11;
    for (let a = 0; a <= SHIP_FORWARD + SHIP_HALF_LENGTH; a += 0.1) {
      shipPlane(SHIP_FORWARD, { camAhead: a }, p);
      expect(p.nearHi).toBeLessThanOrEqual(hi);
      expect(p.droneLo).toBeLessThanOrEqual(droneLo);
      expect(p.droneHi).toBeLessThanOrEqual(droneHi);
      expect(p.nearHi - p.nearLo).toBeGreaterThanOrEqual(2);
      expect(p.droneHi - p.droneLo).toBeGreaterThanOrEqual(1.5);
      expect(p.visible).toBe(SHIP_FORWARD - a >= SHIP_SHOW_DEPTH);
      hi = p.nearHi;
      droneLo = p.droneLo;
      droneHi = p.droneHi;
    }
  });
});

describe('the programs read the ship plane, not literals', () => {
  it('the vertex stage shrinks a spent pickup between uNearShrink\'s two depths', () => {
    expect(vertSource).toContain('uniform vec4 uNearShrink;');
    expect(vertSource).toContain('if (uMotion == M_SHARD) shrink *= smoothstep(uNearShrink.x, uNearShrink.y, zf);');
    expect(vertSource).toContain('else if (uMotion == M_DRONE) shrink *= smoothstep(uNearShrink.z, uNearShrink.w, zf);');
    expect(vertSource).not.toContain('smoothstep(2., 11., zf)');
  });

  it('the fragment stage fades a threaded fence about uGateOpen', () => {
    expect(fragSource).toContain('uniform float uGateOpen;');
    expect(fragSource).toContain('float threaded = smoothstep(uGateOpen - 1.8, uGateOpen + .7, -vRel.z);');
    expect(fragSource).not.toContain('smoothstep(10., 12.5, -vRel.z)');
  });
});
