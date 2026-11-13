// T13 A13: frame time in each camera, on the gpu-timing project, by T09's own timed frames. One machine, one scene and one
// run, so it can show a camera that costs much more than chase, and nothing finer. The comparison is reported; the test
// fails only on a first-person camera slower than chase by more than a millisecond at p95, which no tuning should allow.
import { armedOnly, openHarness } from '../forever/support/open';
import { expect, test } from '../support/pw';

test.beforeEach(({}, info) => { test.skip(info.project.name !== 'gpu-timing', 'gpu-timing only'); });

const CAMS = ['chase', 'cockpit', 'nose'] as const;
const FRAMES = 600;

function pct(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

test('A13: frame time in the cockpit and on the nose against chase, tier 3, 600 frames each, twice round', async ({ page }, info) => {
  test.setTimeout(300_000);
  armedOnly();
  await openHarness(page, info, { tier: 3 });
  const runs = await page.evaluate(({ frames }) => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    const e = window.__mvE2e!;
    mv.manual(true);
    mv.warp(40, 0);
    const out: { cam: number; ms: number[] }[] = [];
    // Twice round, so a camera is not judged on a cold first pass alone.
    for (let round = 0; round < 2; round++) {
      for (let cam = 0; cam < 3; cam++) {
        e.host.overrideCam?.(cam as 0 | 1 | 2);
        lab.timedFrames(60, 1 / 60);
        out.push({ cam, ms: lab.timedFrames(frames, 1 / 60) });
      }
    }
    e.host.overrideCam?.(null);
    return out;
  }, { frames: FRAMES });
  const best: number[] = [Infinity, Infinity, Infinity];
  for (const r of runs) {
    const s = [...r.ms].sort((a, b) => a - b);
    const p50 = pct(s, 0.5), p95 = pct(s, 0.95);
    console.log(`A13 ${CAMS[r.cam]}: p50 ${p50.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms over ${s.length} frames`);
    if (p95 < best[r.cam]!) best[r.cam] = p95;
  }
  console.log(`A13 best p95: chase ${best[0]!.toFixed(2)}, cockpit ${best[1]!.toFixed(2)} (${(best[1]! - best[0]!).toFixed(2)}), nose ${best[2]!.toFixed(2)} (${(best[2]! - best[0]!).toFixed(2)}) ms`);
  expect(best[1]! - best[0]!, 'cockpit p95 over chase p95, ms').toBeLessThan(1);
  expect(best[2]! - best[0]!, 'nose p95 over chase p95, ms').toBeLessThan(1);
});
