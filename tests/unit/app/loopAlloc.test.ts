// A8: T10's own frame body allocates at most 64 B per frame, by median heap delta, with allocation-free fakes and a
// real camera. section 9.2's budget is judged by T09's profiler on the real build; this gate catches T10's own code.
import { describe, expect, it } from 'vitest';
import { createRig, type Rig } from './fixtures/fakes';

const WARMUP = 50_000;
const WINDOWS = 400;
const PER = 2_000;
const LIMIT = 64;

function medianBytesPerFrame(rig: Rig): number {
  let t = 0;
  rig.loop.start();
  for (let i = 0; i < WARMUP; i++) { t += 16.6; rig.frame(t); }
  const deltas: number[] = [];
  for (let w = 0; w < WINDOWS; w++) {
    const h0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < PER; i++) { t += 16.6; rig.frame(t); }
    const h1 = process.memoryUsage().heapUsed;
    deltas.push((h1 - h0) / PER);
  }
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)]!;
}

describe('frame body allocation', () => {
  it(`median heap delta is at most ${LIMIT} B per frame`, () => {
    const rig = createRig({ record: false });
    const bytes = medianBytesPerFrame(rig);
    console.log(`loopAlloc clean: ${bytes.toFixed(2)} B/frame`);
    expect(rig.fatal).toEqual([]);
    expect(bytes).toBeLessThanOrEqual(LIMIT);
  });

  it(`negative control: a fake retaining { i } per sim step exceeds ${LIMIT} B per frame`, () => {
    const rig = createRig({ record: false });
    rig.sim.leak = true;
    const bytes = medianBytesPerFrame(rig);
    console.log(`loopAlloc leaking control: ${bytes.toFixed(2)} B/frame`);
    expect(bytes).toBeGreaterThan(LIMIT);
  });
});
