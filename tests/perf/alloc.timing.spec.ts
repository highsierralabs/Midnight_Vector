// Allocation, section 9.2 and section 14 risk 6. Windows of usedJSHeapSize give exact totals for uniform per-frame work, and
// the sampling profiler attributes by function. Heap slope is blind to short-lived allocation, and this suite states that as
// a test. On the dev server, since built chunks would lose the URLs.
import { windowStability, type ProbeShift } from '../../src/harness/metrics';
import { openHarness, target } from '../forever/support/open';
import { expect, test } from '../support/pw';
import { classLimitProblems, openProfiler, printProfile, sampleHeap, WINDOWS_CONTROL, windowsControlCheck } from './support/heap';

const DT = 1 / 60;
const WARM_FRAMES = 3000;
const PROFILE_FRAMES = 4000;
const WINDOWS = 300;
const PER_WINDOW = 10;
/**
 * DI-78: section 9.2's line for project code outside src/world, loosened from 128 B per frame. On the app it reads 296 to
 * 377 B over 6 profiles, spread over post, sky, terrain, speed lines and props, with the T10 loop gated at 64 on its own
 * [O: T10, D-008]. The 128 was assumed, not measured. At 512 a regression above the measured level still fails, and the
 * control below shows the line tripping.
 */
const OTHER_LIMIT = 512;
const WORLD_LIMIT = 20 * 1024;
const LIBS_LIMIT = 32 * 1024;
const LIMITS = { other: OTHER_LIMIT, world: WORLD_LIMIT, libs: LIBS_LIMIT } as const;
const TOTAL_LIMIT = 48 * 1024;
const STABLE_TRIES = 16;
/**
 * DI-77: stability is three consecutive window medians within 5% of their mean. The old 1 B never held on the app, whose
 * medians spread by 234 to 296 B over about 8.8 KB along the route [O: T10, D-005]; on the shell's constant scene they
 * agreed to the byte. A failure on this line alone is still a T09 measurement failure, not a section 9.2 breach (V1).
 */
const STABLE_FRAC = 0.05;
/**
 * The fewest window runs, of 3000 frames each after the first 3000 warm frames, before the line may be met. The 1 B line
 * also kept the page warming: on the shell it stopped after five runs, past the JIT plateaus. 5% alone accepts the plateau
 * [O: 4067.2, 3847.2, 3761.6 is 4.5%], and the slope check after it then read 12.04 B/frame against its 10, where five or
 * more runs read 2.0 to 3.7 [O: T09, repair D and R1 to R3]. Stricter than the ruling, not looser.
 */
const MIN_WINDOW_RUNS = 5;
// B19's windows control by target, its probe size and its line: WINDOWS_CONTROL in ./support/heap.ts, unit-tested there.

test.setTimeout(600_000);

test('allocation: limits by class, with controls that trip (A15, B19)', async ({ page }, info) => {
  await openHarness(page, info, { tier: 3 });
  const cdp = await openProfiler(page);

  const start = await page.evaluate(({ warm, dt }) => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    const hasGc = typeof (window as unknown as { gc?: unknown }).gc === 'function';
    const calibration = lab.heapCalibration();
    mv.manual(true);
    mv.setPost('full');
    mv.setMsaa(2);
    mv.stepFrames(warm, dt);
    return { hasGc, calibration };
  }, { warm: WARM_FRAMES, dt: DT });
  console.log(`ALLOC calibration ${start.calibration}`);
  expect(start.hasGc, 'gc() is missing: this belongs under gpu-timing').toBe(true);
  expect(start.calibration, 'bucketed memory info would read 0 for everything').toBeGreaterThanOrEqual(1000);

  const windows = (): Promise<{ median: number; dropped: number; windows: number }> => page.evaluate(({ n, per, dt }) => window.__mvLab!.allocWindows(n, per, dt), { n: WINDOWS, per: PER_WINDOW, dt: DT });
  const steps = (n: number): Promise<number> => page.evaluate(({ n, dt }) => {
    window.__mv!.stepFrames(n, dt);
    return n;
  }, { n, dt: DT });
  const slope = (n: number): Promise<number> => page.evaluate(({ n, dt }) => {
    const lab = window.__mvLab!;
    const before = lab.heapAfterGc();
    window.__mv!.stepFrames(n, dt);
    return (lab.heapAfterGc() - before) / n;
  }, { n, dt: DT });

  // The JIT keeps tiering well past the first 3000 frames, and it pauses on plateaus [O: 4067, 3848, 3848, then 3761.6 on
  // the shell], and on the app the medians move with the route. So this warms until three runs of clean windows lie
  // within 5% of their mean (DI-77), and fails if they never do.
  const first = await windows();
  console.log(`ALLOC clean windows ${JSON.stringify(first)}`);
  let recent = [first.median];
  let runs = 1;
  for (let i = 0; i < STABLE_TRIES && (runs < MIN_WINDOW_RUNS || !windowStability(recent, STABLE_FRAC).stable); i++) {
    await steps(WARM_FRAMES);
    const w = await windows();
    console.log(`ALLOC clean windows ${JSON.stringify(w)}`);
    recent = [...recent.slice(-2), w.median];
    runs++;
  }
  const stability = windowStability(recent, STABLE_FRAC);
  console.log(`ALLOC stability ${JSON.stringify({ runs, last: recent, mean: stability.mean, worstPct: 100 * stability.worst })}`);
  expect(runs, `at least ${MIN_WINDOW_RUNS} window runs of warm-up`).toBeGreaterThanOrEqual(MIN_WINDOW_RUNS);
  // B19's row does not ask for this line (V1-T09 ruling): a failure on it alone goes to T09 as a measurement problem, and
  // is not a section 9.2 breach. Soft, so the test still fails, but the class lines, controls and top 12 still run and
  // print: D-005 was that a failure here hid all of them.
  expect.soft(
    stability.stable,
    `three runs of clean windows within ${100 * STABLE_FRAC}% of their mean (DI-77): ${recent.join(', ')}, worst ${(100 * stability.worst).toFixed(2)}%. Alone, this is a T09 measurement failure, not a section 9.2 breach`,
  ).toBe(true);
  const cleanMedian = recent[2]!;
  console.log(`ALLOC clean median ${cleanMedian}`);
  expect(cleanMedian).toBeLessThanOrEqual(TOTAL_LIMIT);

  // Control, windows: a true control.bytes per frame moves them by that, in the form DI-84 sets for this target. Before any
  // profile: read straight after profiles and only 1000 warm frames it was 261 B too high [O: 4279, cause not separated].
  const on = target();
  const control = WINDOWS_CONTROL[on];
  let shift: ProbeShift;
  if (control.form === 'sequential') {
    await page.evaluate((bytes) => { window.__mvLab!.controls.allocProbe(bytes); }, control.bytes);
    await steps(WARM_FRAMES);
    const withProbe = await windows();
    await page.evaluate(() => { window.__mvLab!.controls.allocProbe(0); });
    await steps(WARM_FRAMES);
    const cleanAgain = await windows();
    shift = windowsControlCheck(on, withProbe.median, cleanMedian);
    console.log(`ALLOC windows control (DI-84, ${on}, sequential): allocProbe(${control.bytes}) windows ${JSON.stringify(withProbe)}, moved ${shift.moved.toFixed(1)}; clean again ${cleanAgain.median}`);
  } else {
    const pairs = await page.evaluate(({ n, per, dt, bytes }) => window.__mvLab!.allocPairs(n, per, dt, bytes), { n: WINDOWS, per: PER_WINDOW, dt: DT, bytes: control.bytes });
    shift = windowsControlCheck(on, pairs.on.median, pairs.off.median);
    console.log(`ALLOC windows control (DI-84, ${on}, interleaved): ${WINDOWS} pairs, allocProbe(${control.bytes}) on ${JSON.stringify(pairs.on)}, off ${JSON.stringify(pairs.off)}, moved ${shift.moved.toFixed(1)}`);
  }
  // Soft, as the stability line, and accepted with it in DI-84: a failure still fails the test, and hides nothing after it.
  expect.soft(
    shift.ok,
    `windows control (DI-84, ${on}, ${control.form}): moved ${shift.moved.toFixed(1)} for a true ${control.bytes}, off by ${shift.error.toFixed(1)}, allowed ${control.tol}`,
  ).toBe(true);

  // The first profile after warm-up runs high [O: 3972 vs 3770; T08 saw the same], so it is discarded.
  await sampleHeap(cdp, () => steps(PROFILE_FRAMES), { collected: true });
  const clean = await sampleHeap(cdp, () => steps(PROFILE_FRAMES), { collected: true });
  printProfile('clean', clean);
  expect(clean.classes.probe, 'no probe is on').toBeLessThan(10);
  // other is project code outside src/world, at most 512 B per frame (DI-78); world and libs as section 9.2 (DI-16).
  expect(classLimitProblems(clean.classes, LIMITS), `section 9.2 class lines, limits ${JSON.stringify(LIMITS)}`).toEqual([]);

  // Control, profile: the same 256 bytes shows at the probe's URL, so a real allocation of that size in our code would show.
  await page.evaluate(({ warm, dt }) => {
    window.__mvLab!.controls.allocProbe(256);
    window.__mv!.stepFrames(warm, dt);
  }, { warm: 1000, dt: DT });
  const sampled256 = await sampleHeap(cdp, () => steps(PROFILE_FRAMES), { collected: true });
  printProfile('allocProbe(256)', sampled256);
  expect(sampled256.classes.probe).toBeGreaterThanOrEqual(180);

  await page.evaluate(({ warm, dt }) => {
    window.__mvLab!.controls.allocProbe(1024);
    window.__mv!.stepFrames(warm, dt);
  }, { warm: 1000, dt: DT });
  const sampled1024 = await sampleHeap(cdp, () => steps(PROFILE_FRAMES), { collected: true });
  printProfile('allocProbe(1024)', sampled1024);
  expect(sampled1024.classes.probe).toBeGreaterThanOrEqual(700);

  // Control, the other line (DI-78): the probe's bytes are counted at their own URL, so the same allocation in project
  // code would be counted as other. Counted that way, the line must fail at 1024 B, through the same check as the gate.
  // The 256 B case is printed: over the app's measured level it should also fail, and on the shell, whose other reads
  // about 14, it cannot.
  const asOther = (p: typeof clean): typeof clean.classes => ({ ...p.classes, other: p.classes.other + p.classes.probe, probe: 0 });
  const control1024 = classLimitProblems(asOther(sampled1024), LIMITS);
  const control256 = classLimitProblems(asOther(sampled256), LIMITS);
  console.log(`ALLOC other-line control (DI-78): allocProbe(1024) as project code ${JSON.stringify(control1024)}; allocProbe(256), printed ${JSON.stringify(control256)}`);
  expect(control1024.some((m) => m.startsWith('other ')), 'a 1024 B per frame allocation in project code fails the other line').toBe(true);

  // Slope blindness, written down: if this ever reads high, the slope gate has changed behaviour.
  const blind = await slope(PROFILE_FRAMES);
  console.log(`ALLOC slope with allocProbe(1024) ${blind} B/frame`);
  expect(blind, 'slope is blind to short-lived allocation; if not, re-read section 9.2').toBeLessThan(10);
  await page.evaluate(() => { window.__mvLab!.controls.allocProbe(0); });

  // Retained-only: what the profile shows with the collected flags off. Clean first, then a leak.
  const liveClean = await sampleHeap(cdp, () => steps(PROFILE_FRAMES), { collected: false });
  printProfile('retained, clean', liveClean);
  expect(liveClean.classes.probe).toBeLessThan(10);

  await page.evaluate(() => { window.__mvLab!.controls.leakProbe(256); });
  const leak = await slope(PROFILE_FRAMES);
  const liveLeak = await sampleHeap(cdp, () => steps(PROFILE_FRAMES), { collected: false });
  printProfile('retained, leakProbe(256)', liveLeak);
  console.log(`ALLOC slope with leakProbe(256) ${leak} B/frame`);
  await page.evaluate(() => { window.__mvLab!.controls.leakProbe(0); });
  expect(leak).toBeGreaterThanOrEqual(200);
  expect(liveLeak.classes.probe).toBeGreaterThanOrEqual(150);
});
