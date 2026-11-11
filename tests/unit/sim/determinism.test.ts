// A12: same inputs, same bits. No module-level scratch can exist if two interleaved sims match at every step. GOLDEN is
// per engine (section 5.1), uses T02's own gauntlet world so T01 tuning cannot flip it, and changes only with a retune that
// names the constants changed in the plan's Decision log.
import { describe, expect, test } from 'vitest';
import type { ControlFrame, Sim, SimCommand } from '../../../src/contracts/index';
import { make, mulberry32 } from './fixtures/drive';
import { gauntletWorld } from './fixtures/worlds';

const GOLDEN = 1399575935;
const STEPS = 100000;

function fnvMix(h: number, bytes: Uint8Array): number {
  let out = h;
  for (const b of bytes) {
    out ^= b;
    out = Math.imul(out, 0x01000193);
  }
  return out >>> 0;
}

const view = new Float64Array(18);
const viewBytes = new Uint8Array(view.buffer);

function hashState(h: number, sim: Sim): number {
  const s = sim.state;
  view[0] = s.tick; view[1] = s.travel.chunk; view[2] = s.travel.local; view[3] = s.speed; view[4] = s.stepDist;
  view[5] = s.x; view[6] = s.y; view[7] = s.mode; view[8] = s.score; view[9] = s.sync; view[10] = s.shields;
  view[11] = s.overdrive; view[12] = s.ghost; view[13] = s.beat; view[14] = s.sectorIndex; view[15] = s.objectiveProgress;
  view[16] = s.autopilot ? 1 : 0; view[17] = s.warpSerial;
  return fnvMix(h, viewBytes);
}

/** A fixed script: frames from a seeded PRNG, one launch, pauses and resumes. `change` alters one frame. */
function scripted(sim: Sim, n: number, seed: number, change: number, each: (i: number) => void): void {
  const rand = mulberry32(seed);
  const frame: ControlFrame = { moveX: 0, moveY: 0, absolute: false, boost: false, human: true };
  for (let i = 0; i < n; i++) {
    if (i === 500) sim.command('launch');
    if (i % 60 === 0) {
      frame.moveX = 2 * rand() - 1;
      frame.moveY = 2 * rand() - 1;
      frame.absolute = rand() < 0.5;
      frame.boost = rand() < 0.2;
      frame.human = rand() < 0.97;
    }
    if (i > 0 && i % 7000 === 0) sim.command((i % 14000 === 0 ? 'resume' : 'pause') as SimCommand);
    if (i === change) {
      const saved = frame.moveX;
      frame.moveX = saved === 1 ? -1 : 1;
      frame.absolute = !frame.absolute;
      sim.step(frame);
      frame.moveX = saved;
      frame.absolute = !frame.absolute;
    } else {
      sim.step(frame);
    }
    sim.events.count = 0;
    each(i);
  }
}

function goldenRun(change: number): number {
  const sim = make(gauntletWorld({ seed: 1985, density: 0.8 }));
  let h = 0x811c9dc5;
  scripted(sim, STEPS, 42, change, (i) => {
    if (i % 120 === 0) h = hashState(h, sim);
  });
  return h;
}

describe('A12', () => {
  test('two sims interleaved step by step match bit for bit at every step', () => {
    const world = gauntletWorld({ seed: 1985, density: 0.8 });
    const a = make(world);
    const b = make(world);
    const ra = mulberry32(5);
    const rb = mulberry32(5);
    const fa: ControlFrame = { moveX: 0, moveY: 0, absolute: true, boost: false, human: true };
    const fb: ControlFrame = { ...fa };
    a.command('launch');
    b.command('launch');
    for (let i = 0; i < 40000; i++) {
      if (i % 40 === 0) {
        fa.moveX = 2 * ra() - 1;
        fa.moveY = 2 * ra() - 1;
        fa.boost = ra() < 0.3;
        fb.moveX = 2 * rb() - 1;
        fb.moveY = 2 * rb() - 1;
        fb.boost = rb() < 0.3;
      }
      a.step(fa);
      b.step(fb);
      expect(a.events.count).toBe(b.events.count);
      a.events.count = 0;
      b.events.count = 0;
      const sa = a.state;
      const sb = b.state;
      if (!Object.is(sa.x, sb.x) || !Object.is(sa.y, sb.y) || !Object.is(sa.speed, sb.speed) || !Object.is(sa.travel.local, sb.travel.local)
        || sa.score !== sb.score || sa.sync !== sb.sync || sa.shields !== sb.shields || !Object.is(sa.overdrive, sb.overdrive)) {
        throw new Error(`diverged at step ${i}`);
      }
    }
  });

  test('a sim beside a second one flying different inputs is not disturbed by it', () => {
    const world = gauntletWorld({ seed: 7, density: 1 });
    const alone = make(world);
    const paired = make(world);
    const other = make(world);
    other.command('launch');
    const noise = mulberry32(9);
    const quiet: ControlFrame = { moveX: 0, moveY: 0, absolute: false, boost: false, human: false };
    const loud: ControlFrame = { moveX: 0, moveY: 0, absolute: true, boost: true, human: true };
    for (let i = 0; i < 20000; i++) {
      alone.step(quiet);
      other.step(loud);
      paired.step(quiet);
      if (i % 30 === 0) loud.moveX = 2 * noise() - 1;
      alone.events.count = 0;
      paired.events.count = 0;
      other.events.count = 0;
      if (!Object.is(alone.state.x, paired.state.x)) throw new Error(`disturbed at step ${i}`);
    }
  });

  test('GOLDEN matches', () => {
    const h = goldenRun(-1);
    console.log(`GOLDEN ${h}`);
    expect(h).toBe(GOLDEN);
  }, 120000);

  test('the run is repeatable, and one changed frame at step 1000 changes the hash', () => {
    const a = goldenRun(-1);
    const b = goldenRun(-1);
    const c = goldenRun(1000);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  }, 120000);
});
