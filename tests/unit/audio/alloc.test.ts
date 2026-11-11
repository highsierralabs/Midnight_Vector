// A7: GC entries over 3e6 calls of the per-frame pure paths. A heap slope cannot see short-lived allocation, a
// PerformanceObserver on gc can (Agents.md). The control proves the observer sees a scavenge.
import { PerformanceObserver } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { createEventBuffer } from '../../../src/core/alloc';
import { anchorClock, createBeatClock, observe, stepAtOrAfter, timeOfStep } from '../../../src/audio/clock';
import { createBarPattern, patternFor, type SectorMusic } from '../../../src/audio/composer';
import { createSfx, type SfxSink } from '../../../src/audio/sfx';

const CALLS = 3e6;
const LIMIT = 2;

function countGc(fn: () => void): Promise<number> {
  return new Promise((resolve) => {
    let n = 0;
    const po = new PerformanceObserver((l) => { n += l.getEntries().length; });
    po.observe({ entryTypes: ['gc'] });
    fn();
    setTimeout(() => { po.disconnect(); resolve(n); }, 50);
  });
}

const sinkOut = new Float64Array(1);

describe('A7 no allocation', () => {
  it('observe', async () => {
    const c = createBeatClock();
    anchorClock(c, 1000, 10);
    // Literal arguments, because a computed double passed to a call that does not inline is boxed by the caller
    // [O: 23 scavenges with computed t and beat]. This row is about what observe itself allocates. In production it
    // runs at most at the 25 ms timer rate, and three boxed arguments there are about 1.4 KB/s.
    const n = await countGc(() => {
      for (let i = 0; i < CALLS; i += 3) {
        observe(c, 1000.4, 10.25, 0.016);
        observe(c, 1000.41, 10.26, 0.0107);
        observe(c, 1000.39, 10.24, 0.0213);
      }
      sinkOut[0] = c.ema;
    });
    console.log(`A7 observe: ${n} GC entries over ${CALLS} calls`);
    expect(n).toBeLessThanOrEqual(LIMIT);
  });

  it('timeOfStep and stepAtOrAfter', async () => {
    const c = createBeatClock();
    anchorClock(c, 1000, 10);
    const n = await countGc(() => {
      for (let i = 0; i < CALLS; i++) sinkOut[0] = stepAtOrAfter(c, 10 + i * 1e-3) + timeOfStep(c, 4000 + i);
    });
    console.log(`A7 clock reads: ${n} GC entries`);
    expect(n).toBeLessThanOrEqual(LIMIT);
  });

  it('a no-event sfx pass', async () => {
    const c = createBeatClock();
    anchorClock(c, 0, 0);
    const none = (): void => undefined;
    const sink: SfxSink = { blip: none, stab: none, miss: none, graze: none, hit: none, lost: none };
    const sfx = createSfx(c, { chordAtStep: () => 0, keyAtStep: () => 0 }, sink);
    const events = createEventBuffer();
    const n = await countGc(() => {
      for (let i = 0; i < CALLS; i++) sfx.handle(events, i * 1e-3);
    });
    console.log(`A7 sfx: ${n} GC entries`);
    expect(n).toBeLessThanOrEqual(LIMIT);
  });

  it('patternFor', async () => {
    const out = createBarPattern();
    // The largest sector the world can reach. A bar that does not fit a small integer is boxed by this loop as an
    // argument, not by patternFor [O: 23 to 47 scavenges with 2 ** 40 + i, 0 to 2 with i], and 2 ** 30 bars is 81 years.
    const sector: SectorMusic = { index: 2.8e12, key: 7, fillNext: false, entered: false };
    const n = await countGc(() => {
      for (let i = 0; i < CALLS; i++) {
        sector.fillNext = i % 32 === 31;
        patternFor(i, sector, 1 + i % 16, out);
      }
    });
    console.log(`A7 patternFor: ${n} GC entries over ${CALLS} calls`);
    expect(n).toBeLessThanOrEqual(LIMIT);
  });
});

describe('A7 negative control', () => {
  it('an allocating function in the same harness gives more than the limit', async () => {
    const keep: { keep?: unknown } = {};
    const n = await countGc(() => {
      for (let i = 0; i < CALLS; i++) keep.keep = { a: i, b: [i, i + 1] };
    });
    console.log(`A7 control: ${n} GC entries`);
    expect(keep.keep).toBeDefined();
    expect(n).toBeGreaterThan(LIMIT);
  });
});
