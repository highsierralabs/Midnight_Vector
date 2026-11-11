// D-005 (T09): B19 stopped at its stability line on the app. Three consecutive runs of clean allocation windows had to
// agree within 1 B, and on the integrated build they spread by about 300 B (8812, 8629.2, 8925.2), so the per-class
// limits and the top 12 functions (section 14 risk 6) were never reached. DI-77 rules that stability means three
// consecutive window medians within 5% of their mean, and DI-84 accepts T09's MIN_WINDOW_RUNS of 5. This regression
// repeats B19's warm-up and windows, asserts DI-77's line through T09's own windowStability after at least 5 window runs,
// and prints the clean profile by class.
import { expect, test } from '../../support/pw';
import { openHarness } from '../../forever/support/open';
import { openProfiler, printProfile, sampleHeap } from '../../perf/support/heap';
import { windowStability } from '../../../src/harness/metrics';

const DT = 1 / 60;
const WARM_FRAMES = 3000;
const PROFILE_FRAMES = 4000;
const WINDOWS = 300;
const PER_WINDOW = 10;
const STABLE_TRIES = 16;
/** DI-77's line, and DI-84's accepted minimum of window runs, as B19 holds them. */
const STABLE_FRAC = 0.05;
const MIN_WINDOW_RUNS = 5;

test('D-005: clean allocation windows settle within 5% after at least 5 runs on the app, as B19 requires (DI-77)', async ({ page }, info) => {
  test.setTimeout(600_000);
  await openHarness(page, info, { tier: 3 });
  const cdp = await openProfiler(page);
  await page.evaluate(({ warm, dt }) => {
    const mv = window.__mv!;
    mv.manual(true);
    mv.setPost('full');
    mv.setMsaa(2);
    mv.stepFrames(warm, dt);
  }, { warm: WARM_FRAMES, dt: DT });
  const windows = (): Promise<{ median: number }> => page.evaluate(({ n, per, dt }) => window.__mvLab!.allocWindows(n, per, dt), { n: WINDOWS, per: PER_WINDOW, dt: DT });
  const steps = (n: number): Promise<number> => page.evaluate(({ n, dt }) => { window.__mv!.stepFrames(n, dt); return n; }, { n, dt: DT });
  const all: number[] = [];
  let recent = [(await windows()).median];
  all.push(recent[0]!);
  let runs = 1;
  for (let i = 0; i < STABLE_TRIES && (runs < MIN_WINDOW_RUNS || !windowStability(recent, STABLE_FRAC).stable); i++) {
    await steps(WARM_FRAMES);
    const m = (await windows()).median;
    all.push(m);
    recent = [...recent.slice(-2), m];
    runs++;
  }
  const stability = windowStability(recent, STABLE_FRAC);
  console.log(`D-005 window medians ${JSON.stringify(all)}; runs ${runs}; last three ${JSON.stringify(recent)}, mean ${stability.mean}, worst ${(100 * stability.worst).toFixed(2)}% against ${100 * STABLE_FRAC}%`);
  await sampleHeap(cdp, () => steps(PROFILE_FRAMES), { collected: true });
  const clean = await sampleHeap(cdp, () => steps(PROFILE_FRAMES), { collected: true });
  printProfile('D-005 clean', clean);
  expect(runs).toBeGreaterThanOrEqual(MIN_WINDOW_RUNS);
  expect(stability.stable).toBe(true);
});
