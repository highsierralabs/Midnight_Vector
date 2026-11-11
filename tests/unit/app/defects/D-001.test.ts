// D-001 (seam, T02 and T10): reduced motion set before the sim's first step. T08 calls setReducedMotion at mount,
// before any step (T08 and T02 seams), and T10's A21 expects at most 0.6x cruise from the first frame. T02 starts every
// sim at SPEED_CRUISE and eases toward the scaled cruise at SPEED_DECEL, so the first 0.71 s of a reduced-motion boot
// run faster than 48 u/s. Proposed meaning, for the T00 owner: reduced motion set before the first step applies from
// the first step. This test is red until the meaning is decided and the owner's fix lands.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED, SIM_HZ, SPEED_CRUISE, type ControlFrame } from '../../../../src/contracts/index';
import { createSim } from '../../../../src/sim/index';
import { createWorld } from '../../../../src/world/index';

const REDUCED_CRUISE = SPEED_CRUISE * 0.6;

describe('D-001: reduced motion before the first step', () => {
  it('the first step of a sim created with reduced motion on runs at no more than 0.6x cruise', () => {
    const sim = createSim(createWorld({ seed: DEFAULT_SEED, periodChunks: 0 }));
    sim.setReducedMotion(true);
    const c: ControlFrame = { moveX: 0, moveY: 0, absolute: false, boost: false, human: false };
    const speeds: number[] = [];
    for (let i = 0; i < SIM_HZ; i++) {
      sim.step(c);
      speeds.push(sim.state.speed);
    }
    console.log(`D-001 speeds at steps 1, 30, 60, 120: ${[speeds[0], speeds[29], speeds[59], speeds[119]].join(', ')}`);
    expect(speeds[0]).toBeLessThanOrEqual(REDUCED_CRUISE);
    expect(Math.max(...speeds)).toBeLessThanOrEqual(REDUCED_CRUISE);
  });
});
