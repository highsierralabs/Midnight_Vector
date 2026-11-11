// Shimmer, rows just under the horizon, section 11.3. A band, not a frame: near-field change reads as speed, and
// far-field change reads as shimmer (section 6.4). Evaluated under full post, MSAA 2, tier 3, with the tick held.
//
// DI-74 (D-002, D-004): the gated figure is the floor. B10 measures with the props layer hidden, against 8 and the stored
// baseline, and A12's naive-grid control runs the same way. Props moving through the band produce frame differences
// whether they alias or move truly, so one number cannot judge both; their own temporal check is T05's. The all-layers
// figure is printed by B10, not gated, so it stays visible. The shell has no props layer, so there nothing is hidden and
// every shell number is the one measured before DI-74.
import type { LayerName } from '../../src/contracts/index';
import { expect, test } from '../support/pw';
import { baselineKey, NO_BASELINE, readBaselines, writeBaseline, writingBaseline } from './support/baseline';
import { armedOnly, openHarness, target } from './support/open';

const START = { chunk: 5, local: 0, tick: 28800 };
const STEP_U = 1.17;
const FRAMES = 48;
const LIMIT = 8;
const BASELINE_MARGIN = 1.02;
/**
 * A liveness floor, not a quality limit (V1-T09). A zero step reads 0 [O], terrain alone read 6.27 to 7.42 (T03 [O]) and
 * the shell 12.20 [O], so 1 is far from both, and a band with nothing moving in it cannot pass B10's upper limit.
 */
const LIVE_FLOOR = 1;
/**
 * The sim tick every shimmer test steps to before measuring (V2-T09). On the app renderState takes the camera's lateral
 * pose from the sim, and DEMO moves it, so without this each page load measured wherever DEMO had got to by manual(true),
 * and the stored baseline compared two different poses. The sim is deterministic from boot, so a fixed tick is a fixed
 * pose. 10 s of sim is past any boot; stepToTick throws if a page is already beyond it. On the shell, which pins camX
 * unless ?follow=1, the measured value does not move.
 */
const SIM_TICK = 1200;
/**
 * DI-74: the layer hidden for every gated shimmer figure, on the app. On the app all layers read 25.87 and props hidden
 * 7.44, and the naive grid added .87 with all layers and 11.2 with props hidden, because props cover the floor in the band
 * [O: T10, D-002 and D-004]. setLayerVisible throws on an unknown name, so an app without a props layer fails loudly.
 */
const HIDDEN: LayerName = 'props';

test.setTimeout(180_000);

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'gpu', 'needs the 1080p viewport and the real GPU');
});

test('shimmer: repeats, zero step, and a naive grid trips it, props hidden (A12, B10, DI-74)', async ({ page }, info) => {
  await openHarness(page, info, { tier: 3 });
  const hide = target() === 'app';
  const r = await page.evaluate(({ start, simTick, hide, hidden }) => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    mv.manual(true);
    lab.stepToTick(simTick);
    mv.setPost('full');
    mv.setMsaa(2);
    if (hide) mv.setLayerVisible(hidden, false);
    lab.settle(start, 500);
    const first = lab.shimmer(start).mean;
    const second = lab.shimmer(start).mean;
    const zero = lab.shimmer(start, { stepU: 0 }).mean;
    lab.controls.naiveGrid(true);
    const naive = lab.shimmer(start).mean;
    lab.controls.naiveGrid(false);
    const after = lab.shimmer(start).mean;
    if (hide) mv.setLayerVisible(hidden, true);
    return { hidden: hide ? hidden : 'none', first, second, zero, naive, after };
  }, { start: START, simTick: SIM_TICK, hide, hidden: HIDDEN });
  console.log(`SHIMMER ${JSON.stringify(r)}`);
  expect(Math.abs(r.second - r.first) / r.first, 'two runs agree within 2%').toBeLessThanOrEqual(0.02);
  expect(r.zero, 'a zero step shows the metric sees motion, not noise').toBeLessThanOrEqual(0.001);
  expect(r.naive, 'the naive grid trips the gated scope (DI-74)').toBeGreaterThan(Math.max(LIMIT, 1.5 * r.first));
  expect(Math.abs(r.after - r.first) / r.first, 'removing the control returns to clean').toBeLessThanOrEqual(0.02);
});

test('shimmer baseline: missing fails, writing needs the env var, and it can fail, props hidden (A13, B10, DI-74)', async ({ page }, info) => {
  await openHarness(page, info, { tier: 3 });
  const hide = target() === 'app';
  const r = await page.evaluate(({ start, simTick, hide, hidden }) => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    mv.manual(true);
    lab.stepToTick(simTick);
    mv.setPost('full');
    mv.setMsaa(2);
    if (hide) mv.setLayerVisible(hidden, false);
    lab.settle(start, 500);
    const s = mv.stats();
    const [r0, r1] = lab.metrics.shimmerBand(s.height);
    const mean = lab.shimmer(start).mean;
    if (hide) mv.setLayerVisible(hidden, true);
    return { renderer: lab.rendererInfo().renderer, width: s.width, height: s.height, r0, r1, tick: s.tick, mean };
  }, { start: START, simTick: SIM_TICK, hide, hidden: HIDDEN });
  // The app key holds the props-hidden figure from DI-74 on. No app key was stored before DI-74, so none holds the old
  // all-layers scope.
  const key = baselineKey(r.renderer, target(), r.width, r.height, r.r0, r.r1);
  console.log(`SHIMMER mean ${r.mean} at sim tick ${r.tick}, hidden ${hide ? HIDDEN : 'none'}, key ${key}`);
  expect(r.tick, 'measured at the fixed pose').toBe(SIM_TICK);
  if (writingBaseline()) {
    writeBaseline(key, { mean: r.mean, frames: FRAMES, stepU: STEP_U, writtenUtc: new Date().toISOString() });
    console.log(`BASELINE WRITTEN ${key} ${r.mean}`);
    test.info().annotations.push({ type: 'baseline', description: 'BASELINE WRITTEN: this run wrote the value it would compare with, so it is not a pass' });
    return;
  }
  const entry = readBaselines()[key];
  if (!entry) throw new Error(NO_BASELINE);
  console.log(`SHIMMER baseline ${entry.mean}, limit ${entry.mean * BASELINE_MARGIN}`);
  expect(r.mean).toBeLessThanOrEqual(entry.mean * BASELINE_MARGIN);
});

test('shimmer limit: the floor, props hidden, at most 8; all layers and bare printed (B10, DI-74)', async ({ page }, info) => {
  armedOnly();
  await openHarness(page, info, { tier: 3 });
  // The shell has no props layer; there nothing is hidden, and the run only checks the spec.
  const hide = target() === 'app';
  const r = await page.evaluate(({ start, hide, hidden, simTick }) => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    mv.manual(true);
    lab.stepToTick(simTick);
    mv.setPost('full');
    mv.setMsaa(2);
    lab.settle(start, 500);
    const all = lab.shimmer(start).mean;
    if (hide) mv.setLayerVisible(hidden, false);
    const floor = lab.shimmer(start).mean;
    mv.setPost('bare');
    const floorBare = lab.shimmer(start).mean;
    if (hide) mv.setLayerVisible(hidden, true);
    const allBare = lab.shimmer(start).mean;
    mv.setPost('full');
    return { hidden: hide ? hidden : 'none', floor, all, floorBare, allBare };
  }, { start: START, hide, hidden: HIDDEN, simTick: SIM_TICK });
  // DI-74(3): the all-layers figures are printed, not gated, so what props add stays visible; their check is T05's.
  console.log(`SHIMMER armed ${JSON.stringify(r)}; gated: floor (${r.hidden} hidden, full) against ${LIMIT}; printed, not gated: all layers, and bare`);
  // Liveness first: a band where nothing moves, such as a blank or sky-only one, reads 0 and would pass any upper limit.
  expect(r.floor, `a band with nothing moving in it reads under ${LIVE_FLOOR}`).toBeGreaterThan(LIVE_FLOOR);
  // A failure here is a finding for T03 and T11, not a threshold edit.
  expect(r.floor, 'the floor, props hidden (DI-74)').toBeLessThanOrEqual(LIMIT);
});
