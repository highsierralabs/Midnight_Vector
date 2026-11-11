// A13: the step allocates next to nothing. Median heap delta over short windows: a slope over long windows reads noise,
// because a scavenge lands in most of them (T02 section 10). A module gate on Node's V8; only T09's run on the real build
// establishes section 9.2's budget.
import { describe, expect, test } from 'vitest';
import type { ControlFrame } from '../../../src/contracts/index';
import { HOLD, make, NOBODY } from './fixtures/drive';
import { frozenWorld, gauntletWorld } from './fixtures/worlds';

const LIMIT = 4;
const WARM = 300000;

function medianBytes(fn: (i: number) => void, windowSteps: number, windows: number): number {
  const out = new Float64Array(windows);
  for (let w = 0; w < windows; w++) {
    const a = process.memoryUsage().heapUsed;
    for (let i = 0; i < windowSteps; i++) fn(i);
    out[w] = (process.memoryUsage().heapUsed - a) / windowSteps;
  }
  out.sort();
  return out[windows >> 1]!;
}

function warmed(c: Readonly<ControlFrame>, launch: boolean): (i: number) => void {
  const sim = make(frozenWorld(gauntletWorld({ seed: 1985, density: 0.6 })));
  if (launch) sim.command('launch');
  const step = (): void => {
    sim.step(c);
    sim.events.count = 0;
  };
  for (let i = 0; i < WARM; i++) step();
  return step;
}

describe('A13', () => {
  test('DEMO, PLAY and the retained-object control', () => {
    const empty = medianBytes(() => { /* the loop alone */ }, 2000, 300);
    const demo = medianBytes(warmed(NOBODY, false), 2000, 300);
    const play = medianBytes(warmed(HOLD, true), 2000, 300);

    const keep: { i: number }[] = new Array(2000);
    const inner = warmed(NOBODY, false);
    const leak = medianBytes((i) => {
      inner(i);
      keep[i] = { i };
    }, 2000, 300);

    console.log(`ALLOC bytes per step: empty ${empty.toFixed(3)}, DEMO ${demo.toFixed(3)}, PLAY ${play.toFixed(3)}, retained control ${leak.toFixed(3)}, limit ${LIMIT}`);
    expect(demo).toBeLessThanOrEqual(LIMIT);
    expect(play).toBeLessThanOrEqual(LIMIT);
    expect(leak).toBeGreaterThan(LIMIT);
  }, 300000);
});
