// D-010, ruled by DI-80: an input edge sampled on a frame that takes no sim step must reach the next step. Section 3.3
// runs input.sample once per rendered frame and section 8.1 has the sim reuse that sample for every step of the frame,
// while T08's sample() reports a press since the last sample once and clears it. app/loop.ts latches control.human from
// a frame that took no step into the next frame's sample (human = sampled or latched), and clears it once a step has
// consumed it. The input fake reports human once, as T08's does; the sim fake records what each step saw.
import { describe, expect, it } from 'vitest';
import type { ControlFrame } from '../../../../src/contracts/index';
import { createRig, type Rig } from '../fixtures/fakes';

/** A rig whose input reports `human` from a queue, true once per press as T08's sample() does, and whose sim records what each step was given. */
function rigWithInput(): { rig: Rig; press(): void; seen: boolean[] } {
  const rig = createRig({ record: false });
  const q = { pending: false };
  rig.deps.input.sample = (out: ControlFrame): void => {
    out.human = q.pending;
    q.pending = false;
  };
  const seen: boolean[] = [];
  const step = rig.sim.step.bind(rig.sim);
  rig.sim.step = (c: Readonly<ControlFrame>): void => {
    seen.push(c.human);
    step(c);
  };
  return { rig, press: () => { q.pending = true; }, seen };
}

describe('D-010: a press sampled on a frame with no sim step', () => {
  it('reaches the first step of the next frame, through onFrame', () => {
    const { rig, press, seen } = rigWithInput();
    rig.loop.start();
    rig.frame(1000);
    // 2.5 steps: two steps and half a step left over, so the frames below cannot straddle a step by rounding.
    const t1 = 1000 + 2500 / 120;
    rig.frame(t1);
    const steps0 = seen.length;
    expect(steps0).toBe(2);
    press();
    // 1 ms more leaves the accumulator below one 1/120 s step.
    rig.frame(t1 + 1);
    expect(seen.length, 'the short frame took no step').toBe(steps0);
    rig.frame(t1 + 1 + 1000 / 60);
    expect(seen.length).toBeGreaterThan(steps0);
    expect(seen[steps0], 'the next frame\'s first step saw the press').toBe(true);
  });

  it('reaches the next step through runFrame, and is cleared once a step has consumed it', () => {
    const { rig, press, seen } = rigWithInput();
    rig.loop.setManual(true);
    rig.loop.runFrame(1 / 60);
    const steps0 = seen.length;
    press();
    rig.loop.runFrame(0.001);
    rig.loop.runFrame(0.001);
    expect(seen.length, 'two short frames took no step').toBe(steps0);
    rig.loop.runFrame(1 / 60);
    const steps1 = seen.length;
    expect(steps1).toBeGreaterThan(steps0 + 1);
    // Every step of the consuming frame shares one control object (section 8.1), so all of them saw the press.
    expect(seen.slice(steps0, steps1).every((h) => h)).toBe(true);
    rig.loop.runFrame(1 / 60);
    expect(seen.length).toBeGreaterThan(steps1);
    expect(seen.slice(steps1).some((h) => h), 'the latch was cleared by the consuming frame').toBe(false);
  });

  it('a press on a frame that steps is not carried into the next frame', () => {
    const { rig, press, seen } = rigWithInput();
    rig.loop.setManual(true);
    press();
    rig.loop.runFrame(1 / 60);
    const steps0 = seen.length;
    expect(seen.every((h) => h)).toBe(true);
    rig.loop.runFrame(1 / 60);
    expect(seen.slice(steps0).some((h) => h)).toBe(false);
  });

  it('renderState takes no sample and leaves the latch alone', () => {
    const { rig, press, seen } = rigWithInput();
    rig.loop.setManual(true);
    rig.loop.runFrame(1 / 60);
    const steps0 = seen.length;
    press();
    rig.loop.runFrame(0.001);
    rig.loop.renderState(5, 3, 120);
    rig.loop.runFrame(1 / 60);
    expect(seen[steps0]).toBe(true);
  });
});
