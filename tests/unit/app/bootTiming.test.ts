// A5: boot timing's warm-up, percentile, budget and empty cases, on a fake clock.
import { describe, expect, it } from 'vitest';
import { BUDGET_MS, TIMED, WARMUP, measureBootP95, nearestRankP95 } from '../../../src/app/bootTiming';

/** A clock that advances by ms[i] during frame i. */
function run(ms: (i: number) => number): { p95: number; frames: number; synced: number } {
  let t = 0;
  let i = 0;
  let synced = 0;
  const p95 = measureBootP95(
    () => { t += ms(i); i++; },
    () => { synced++; },
    () => t,
  );
  return { p95, frames: i, synced };
}

describe('measureBootP95', () => {
  it('runs 5 warm-up frames that are not sampled', () => {
    // Warm-up frames take 100 ms each; the timed ones 1 to 30 ms. Only the timed ones decide the result.
    const r = run((i) => (i < WARMUP ? 100 : i - WARMUP + 1));
    expect(WARMUP).toBe(5);
    expect(r.frames).toBe(WARMUP + TIMED);
    expect(r.synced).toBe(r.frames);
    expect(r.p95).toBe(29);
  });

  it('p95 of 1 to 30 is 29, in any order', () => {
    const order = [17, 3, 30, 1, 22, 9, 14, 28, 5, 11, 26, 2, 19, 8, 24, 13, 29, 6, 21, 4, 16, 27, 10, 23, 7, 18, 12, 25, 15, 20];
    expect(run((i) => (i < WARMUP ? 0 : order[i - WARMUP]!)).p95).toBe(29);
  });

  it(`stops early once the run exceeds ${BUDGET_MS} ms, with at least 5 samples`, () => {
    const r = run(() => 400);
    expect(r.frames).toBe(WARMUP + 5);
    expect(r.p95).toBe(400);
    const s = run(() => 60);
    // 1500 / 60 = 25 frames in all, so the 26th ends past the budget: 21 timed samples.
    expect(s.frames).toBe(26);
  });

  it('frames returning 0 ms give 0, which the governor reads as no measurement', () => {
    expect(run(() => 0).p95).toBe(0);
  });

  it('no samples give 0', () => {
    expect(nearestRankP95([])).toBe(0);
    expect(nearestRankP95([7])).toBe(7);
    expect(nearestRankP95([3, 1, 2])).toBe(3);
  });
});
