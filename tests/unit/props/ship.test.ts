// A24: the ship's pose, a pure function of sim, feel, alpha and phases.
import { describe, expect, it } from 'vitest';
import { SPEED_CRUISE, SPEED_MAX, SimMode, type FeelState, type SimState } from '../../../src/contracts/index';
import { createNeutralFeel } from '../../../src/core/alloc';
import { createShipPose, shipPose } from '../../../src/render/props/ship';

function sim(over: Partial<SimState> = {}): SimState {
  return {
    tick: 0, travel: { chunk: 1, local: 0 }, stepDist: 0.66, speed: SPEED_CRUISE,
    x: 4, y: 7, prevX: 3, prevY: 6.5, mode: SimMode.PLAY,
    score: 0, sync: 1, shields: 3, overdrive: 0, ghost: 0, beat: 0, sectorIndex: 0, objectiveProgress: 0,
    autopilot: false, warpSerial: 0,
    ...over,
  };
}
const phases = new Float32Array(8).fill(0.3);
const feel = (over: Partial<FeelState> = {}): FeelState => ({ ...createNeutralFeel(), ...over });

describe('shipPose', () => {
  it('is prevX and prevY at alpha 0, x and y at alpha 1', () => {
    const p = createShipPose();
    shipPose(sim(), feel(), 0, phases, p);
    expect([p.x, p.y]).toEqual([3, 6.5]);
    shipPose(sim(), feel(), 1, phases, p);
    expect([p.x, p.y]).toEqual([4, 7]);
    shipPose(sim(), feel(), 0.5, phases, p);
    expect([p.x, p.y]).toEqual([3.5, 6.75]);
  });

  it('banks from x - prevX, and clamps', () => {
    const p = createShipPose();
    shipPose(sim({ x: 0.1, prevX: 0 }), feel(), 0, phases, p);
    const small = p.bank;
    expect(small).toBeLessThan(0);
    shipPose(sim({ x: -0.1, prevX: 0 }), feel(), 0, phases, p);
    expect(p.bank).toBeCloseTo(-small, 6);
    shipPose(sim({ x: 100, prevX: 0 }), feel(), 0, phases, p);
    expect(p.bank).toBeGreaterThanOrEqual(-0.55);
  });

  it('follows speed for engine length, clamped to [0, 1]', () => {
    const p = createShipPose();
    shipPose(sim({ speed: SPEED_CRUISE }), feel(), 0, phases, p);
    expect(p.engine).toBe(0);
    shipPose(sim({ speed: SPEED_MAX }), feel(), 0, phases, p);
    expect(p.engine).toBe(1);
    shipPose(sim({ speed: 45 }), feel(), 0, phases, p);
    expect(p.engine).toBe(0);
    shipPose(sim({ speed: 500 }), feel(), 0, phases, p);
    expect(p.engine).toBe(1);
    shipPose(sim({ speed: (SPEED_CRUISE + SPEED_MAX) / 2 }), feel(), 0, phases, p);
    expect(p.engine).toBeCloseTo(0.5, 6);
  });

  it('blinks while ghost is above 0', () => {
    const p = createShipPose();
    const on = new Float32Array(8);
    on[3] = 0.02;
    const off = new Float32Array(8);
    off[3] = 0.08;
    shipPose(sim({ ghost: 1 }), feel(), 0, on, p);
    expect(p.blink).toBe(1);
    shipPose(sim({ ghost: 1 }), feel(), 0, off, p);
    expect(p.blink).toBeLessThan(0.5);
    shipPose(sim({ ghost: 0 }), feel(), 0, off, p);
    expect(p.blink).toBe(1);
  });

  it('freezes bank and flicker under shipHold, not position', () => {
    const p = createShipPose();
    shipPose(sim({ x: 0.1, prevX: 0 }), feel(), 0, phases, p);
    const bank = p.bank;
    const flicker = p.flicker;
    const other = new Float32Array(8).fill(0.77);
    shipPose(sim({ x: 9, prevX: 8 }), feel({ shipHold: 0.1 }), 1, other, p);
    expect(p.bank).toBe(bank);
    expect(p.flicker).toBe(flicker);
    expect(p.x).toBe(9);
  });

  it('gives the same output from the same input', () => {
    const a = createShipPose();
    const b = createShipPose();
    shipPose(sim(), feel(), 0.3, phases, a);
    shipPose(sim(), feel(), 0.3, phases, b);
    expect(a).toEqual(b);
  });
});
