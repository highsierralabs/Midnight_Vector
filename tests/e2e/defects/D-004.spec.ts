// D-004 (T09): A12's naive-grid negative control could not be seen on the integrated scene. With all layers it added .87
// over clean (26.73 against 25.87), under A12's `naive > max(8, 1.5 x clean)`, because props cover the floor in the
// shimmer band. DI-74 rules that A12, like B10, runs with props hidden. This regression measures A12's own condition on
// the app that way: props hidden after setMsaa(2) and before settle, as T09's spec does.
import { expect, test } from '../../support/pw';
import { openHarness } from '../../forever/support/open';

const START = { chunk: 5, local: 0, tick: 28800 };
const SIM_TICK = 1200;
const LIMIT = 8;

test('D-004: the naive-grid control trips A12 on the integrated scene, props hidden (DI-74)', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', 'needs the 1080p viewport and the real GPU');
  test.setTimeout(180_000);
  await openHarness(page, info, { tier: 3 });
  const r = await page.evaluate(({ start, simTick }) => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    mv.manual(true);
    lab.stepToTick(simTick);
    mv.setPost('full');
    mv.setMsaa(2);
    mv.setLayerVisible('props', false);
    lab.settle(start, 500);
    const clean = lab.shimmer(start).mean;
    lab.controls.naiveGrid(true);
    const naive = lab.shimmer(start).mean;
    lab.controls.naiveGrid(false);
    mv.setLayerVisible('props', true);
    return { clean, naive };
  }, { start: START, simTick: SIM_TICK });
  console.log(`D-004 ${JSON.stringify(r)}, needs naive > ${Math.max(LIMIT, 1.5 * r.clean)}`);
  expect(r.naive).toBeGreaterThan(Math.max(LIMIT, 1.5 * r.clean));
});
