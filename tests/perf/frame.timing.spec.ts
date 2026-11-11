// Frame time from the 1x1 sync in a tight loop, section 11.4, never rAF deltas or page.clock. A failure while siblings use
// the GPU proves nothing: run it through the shared lock, on a quiet machine, and record contaminated numbers as such.
import { spawnSync } from 'node:child_process';
import { percentile } from '../../src/harness/metrics';
import { serveDist } from '../forever/support/distServer';
import { armedOnly, openHarness } from '../forever/support/open';
import { installSpies } from '../forever/support/spies';
import { expect, test } from '../support/pw';
import { checkRasterizer } from '../support/rasterizer';

const DT = 1 / 60;
const P95_LIMIT = 2;
const CALLS_LIMIT = 68;
const TRIANGLES_LIMIT = 1_500_000;
const BIOMES = 6;

test.setTimeout(300_000);

test('the clock tracks load: gpuLoad(1024) raises p50 by at least 3 ms, and removing it restores (A17, B17)', async ({ page }, info) => {
  await openHarness(page, info, { tier: 3 });
  const r = await page.evaluate(({ dt }) => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    mv.manual(true);
    mv.setPost('full');
    mv.setMsaa(2);
    // The JIT keeps tiering for thousands of frames, and a cold clean reading would make "restores" look like a change.
    lab.timedFrames(4000, dt);
    const clean = lab.timedFrames(600, dt);
    lab.controls.gpuLoad(256);
    lab.timedFrames(60, dt);
    const load256 = lab.timedFrames(300, dt);
    lab.controls.gpuLoad(1024);
    lab.timedFrames(60, dt);
    const loaded = lab.timedFrames(300, dt);
    lab.controls.gpuLoad(0);
    lab.timedFrames(60, dt);
    const after = lab.timedFrames(600, dt);
    return { clean, load256, loaded, after };
  }, { dt: DT });
  const p = (v: number[], q: number): number => percentile(v, q);
  const summary = {
    clean: { p50: p(r.clean, 0.5), p95: p(r.clean, 0.95) },
    load256: { p50: p(r.load256, 0.5), p95: p(r.load256, 0.95) },
    loaded: { p50: p(r.loaded, 0.5), p95: p(r.loaded, 0.95) },
    after: { p50: p(r.after, 0.5), p95: p(r.after, 0.95) },
  };
  console.log(`FRAME ${JSON.stringify(summary)}`);
  expect(summary.loaded.p50 - summary.clean.p50, 'a clock that cannot see 5.8 ms of fragment work cannot gate frame time').toBeGreaterThanOrEqual(3);
  expect(Math.abs(summary.after.p50 - summary.clean.p50) / summary.clean.p50).toBeLessThanOrEqual(0.2);
});

test('real build, tier 3: p95 at most 2 ms on the heaviest biome, draws and triangles on all six (B17)', async ({ page }, info) => {
  armedOnly();
  const built = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  expect(built.status, `${built.stdout}${built.stderr}`).toBe(0);
  const server = await serveDist('dist');
  try {
    await installSpies(page);
    await page.goto(`${server.url}?harness&period=0&tier=3`);
    await page.waitForFunction(() => window.__mv?.ready === true, undefined, { timeout: 60_000 });
    const rendererInfo = await page.evaluate(() => window.__mvLab!.rendererInfo());
    expect(checkRasterizer(info.project.name, rendererInfo.webgl2, rendererInfo.renderer), rendererInfo.renderer).toBeNull();
    const biomes = await page.evaluate(({ count, dt }) => {
      const mv = window.__mv!;
      const lab = window.__mvLab!;
      mv.manual(true);
      const out = [];
      for (let b = 0; b < count; b++) {
        const chunk = lab.findBiomeChunk(b, 0);
        mv.warp(chunk, 0);
        mv.stepFrames(200, dt);
        const s = mv.stats();
        out.push({ biome: b, chunk, calls: s.calls, triangles: s.triangles, tier: s.tier });
      }
      return out;
    }, { count: BIOMES, dt: DT });
    for (const b of biomes) {
      console.log(`FRAME biome ${JSON.stringify(b)}`);
      expect(b.chunk, `biome ${b.biome} has no zone in reach`).toBeGreaterThan(0);
      expect(b.tier).toBe(3);
      expect(b.calls, `biome ${b.biome}`).toBeLessThanOrEqual(CALLS_LIMIT);
      expect(b.triangles, `biome ${b.biome}`).toBeLessThanOrEqual(TRIANGLES_LIMIT);
    }
    const heaviest = biomes.reduce((a, b) => (b.triangles > a.triangles ? b : a));
    // 2100 frames at 1/60 is 35 s of sim: about 2.8 km at cruise (80 u/s) and 3.2 km at DEMO's mean of 90.4 u/s; T02's
    // real DEMO went 3.13 to 3.16 km from each biome's chunk [O: R3 probe]. All of it is inside the 4.48 km, 70 chunks,
    // from chunk 5 of the zone to its fade at chunk 75.
    const ms = await page.evaluate(({ chunk, dt }) => {
      const mv = window.__mv!;
      const lab = window.__mvLab!;
      mv.warp(chunk, 0);
      lab.timedFrames(300, dt);
      return lab.timedFrames(1800, dt);
    }, { chunk: heaviest.chunk, dt: DT });
    const p50 = percentile(ms, 0.5);
    const p95 = percentile(ms, 0.95);
    const p99 = percentile(ms, 0.99);
    console.log(`FRAME real build, biome ${heaviest.biome}: p50 ${p50.toFixed(2)}, p95 ${p95.toFixed(2)}, p99 ${p99.toFixed(2)} ms`);
    expect(p95).toBeLessThanOrEqual(P95_LIMIT);
  } finally {
    await server.close();
  }
});
