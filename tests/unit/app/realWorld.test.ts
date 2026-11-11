// A26: checks only the composition root can run, because tests/unit/sim may not import src/world or src/feel (T02).
import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED, SimMode, type ControlFrame, type EventBuffer, type Feel, type SimState } from '../../../src/contracts/index';
import { createFeel } from '../../../src/feel/index';
import { createSim } from '../../../src/sim/index';
import { createWorld } from '../../../src/world/index';
import { measureAutopilot } from '../sim/fixtures/metrics';

describe('the real world', () => {
  it('the autopilot threads at least 80% of gates on createWorld, and never holds still over 1 s', () => {
    const m = measureAutopilot(createWorld({ seed: DEFAULT_SEED, periodChunks: 0 }), 600);
    console.log(`REALWORLD autopilot ${JSON.stringify(m)}`);
    expect(m.gates).toBeGreaterThan(0);
    expect(m.threadPct).toBeGreaterThanOrEqual(80);
    expect(m.maxStillS).toBeLessThanOrEqual(1);
  }, 120_000);
});

type FeelHook = (dt: number, s: Readonly<SimState>, e: EventBuffer, f: Feel | null, step: number) => void;

/** 10,000 steps of the real sim on the real world: DEMO, launch, then a deterministic weave with boost. */
function trace(hook: FeelHook | null, feel: Feel | null): number[] {
  const sim = createSim(createWorld({ seed: DEFAULT_SEED, periodChunks: 0 }));
  const c: ControlFrame = { moveX: 0, moveY: 0, absolute: false, boost: false, human: false };
  const out: number[] = [];
  const s = sim.state;
  for (let i = 0; i < 10_000; i++) {
    if (i === 1500) sim.command('launch');
    if (i >= 1500) {
      c.human = true;
      c.moveX = Math.sin(i / 90);
      c.moveY = Math.cos(i / 210) * 0.5;
      c.boost = i % 1200 < 300;
    }
    sim.step(c);
    hook?.(1 / 120, s, sim.events, feel, i);
    sim.events.count = 0;
    out.push(s.tick, s.travel.chunk, s.travel.local, s.x, s.y, s.speed, s.score, s.shields, s.mode, s.sync, s.overdrive, s.ghost);
  }
  return out;
}

describe('feel cannot change the rules (T02 seam)', () => {
  // The app's own call: the step's real events, before they are cleared.
  const update: FeelHook = (dt, s, e, f) => { f!.update(dt, s, e, false); };

  it('the SimState trace is identical with and without feel.update, over 10,000 steps', () => {
    const without = trace(null, null);
    const withFeel = trace(update, createFeel());
    expect(withFeel.length).toBe(without.length);
    let firstDiff = -1;
    for (let i = 0; i < without.length; i++) if (!Object.is(without[i], withFeel[i])) { firstDiff = i; break; }
    expect(firstDiff).toBe(-1);
    // The run reached play, so the rules were exercised.
    expect(without.slice(-12)[8]).not.toBe(SimMode.DEMO);
  }, 120_000);

  it('negative control: a feel that writes through a mutable state reference changes the trace', () => {
    const without = trace(null, null);
    const meddling: FeelHook = (_dt, s, _e, _f, step) => { if (step === 3000) (s as SimState).x += 0.5; };
    const meddled = trace(meddling, null);
    let firstDiff = -1;
    for (let i = 0; i < without.length; i++) if (!Object.is(without[i], meddled[i])) { firstDiff = i; break; }
    expect(firstDiff).toBeGreaterThan(0);
  }, 120_000);
});
