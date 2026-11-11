// D-002: shimmer on the full integrated scene. T09's B10 measured 25.87 with all layers against its limit of 8 [A], and
// 7.44 with props hidden. DI-74 rules that B10 gates the floor with props hidden, against 8, and prints the all-layers
// figure without gating it; props get their own aliasing check, T05's A16b (DI-82). This regression repeats B10's
// measurement exactly (tier 3, full post, MSAA 2, sim tick 1200, start (5, 0, 28800), 48 frames of 1.17 u), asserts the
// props-hidden figure against B10's limit, and prints what each layer adds and the per-frame series.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '../../support/pw';
import { openHarness } from '../../forever/support/open';

const START = { chunk: 5, local: 0, tick: 28800 };
const SIM_TICK = 1200;
/** B10's limit, read from T09's spec, so this regression follows any ruled change to it. */
const LIMIT = Number(/const LIMIT = ([\d.]+);/.exec(readFileSync(resolve('tests/forever/shimmer.spec.ts'), 'utf8'))?.[1]);

test('D-002: shimmer with props hidden is within B10s limit; all layers printed (DI-74)', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', 'needs the 1080p viewport and the real GPU');
  test.setTimeout(180_000);
  expect(LIMIT).toBeGreaterThan(0);
  await openHarness(page, info, { tier: 3 });
  const r = await page.evaluate(({ start, simTick }) => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    mv.manual(true);
    lab.stepToTick(simTick);
    mv.setPost('full');
    mv.setMsaa(2);
    lab.settle(start, 500);
    const layers = ['sky', 'terrain', 'props', 'fx'] as const;
    const only = (keep: readonly string[]): { mean: number; perFrame: number[] } => {
      for (const n of layers) mv.setLayerVisible(n, keep.includes(n));
      const s = lab.shimmer(start);
      for (const n of layers) mv.setLayerVisible(n, true);
      return s;
    };
    const all = only(layers);
    const noProps = only(['sky', 'terrain', 'fx']);
    const propsOnly = only(['props']);
    const terrainOnly = only(['terrain']);
    mv.setPost('bare');
    const allBare = only(layers);
    mv.setPost('full');
    // T09's naive-grid control (A12), with and without props: what the control adds over clean on the app.
    lab.controls.naiveGrid(true);
    const naiveAll = only(layers).mean;
    const naiveNoProps = only(['sky', 'terrain', 'fx']).mean;
    const naiveTerrainOnly = only(['terrain']).mean;
    lab.controls.naiveGrid(false);
    const spread = (p: number[]): { min: number; max: number; median: number } => {
      const s = [...p].sort((a, b) => a - b);
      return { min: s[0]!, max: s.at(-1)!, median: s[Math.floor(s.length / 2)]! };
    };
    return {
      naiveAll, naiveNoProps, naiveTerrainOnly,
      all: all.mean, noProps: noProps.mean, propsOnly: propsOnly.mean, terrainOnly: terrainOnly.mean, allBare: allBare.mean,
      allSpread: spread(all.perFrame), propsSpread: spread(propsOnly.perFrame),
      allPerFrame: all.perFrame.map((v) => Number(v.toFixed(2))), propsPerFrame: propsOnly.perFrame.map((v) => Number(v.toFixed(2))),
    };
  }, { start: START, simTick: SIM_TICK });
  console.log(`D-002 ${JSON.stringify({ limit: LIMIT, all: r.all, noProps: r.noProps, propsOnly: r.propsOnly, terrainOnly: r.terrainOnly, allBare: r.allBare })}`);
  console.log(`D-002 naive-grid control (A12): all ${r.naiveAll} vs ${r.all}, props hidden ${r.naiveNoProps} vs ${r.noProps}, terrain only ${r.naiveTerrainOnly} vs ${r.terrainOnly}`);
  console.log(`D-002 spread all ${JSON.stringify(r.allSpread)} props only ${JSON.stringify(r.propsSpread)}`);
  console.log(`D-002 per frame, all: ${r.allPerFrame.join(' ')}`);
  console.log(`D-002 per frame, props only: ${r.propsPerFrame.join(' ')}`);
  console.log(`D-002 gated: props hidden ${r.noProps} against ${LIMIT}; printed, not gated (DI-74(3)): all layers ${r.all}`);
  expect(r.noProps).toBeLessThanOrEqual(LIMIT);
});
