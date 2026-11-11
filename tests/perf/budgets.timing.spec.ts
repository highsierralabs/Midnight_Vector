// The sub-budgets of section 9.2, gated as per-frame sums and percentiles, since performance.now resolves .1 ms here. On the
// dev server: a sub-millisecond difference from the built site would not change a decision. Residual also holds input, feel
// and uniforms, so a failure there means look at T07's and T08's own numbers first.
import { expect, test } from '../support/pw';
import { callCountProblems } from '../../src/harness/budget';
import { armedOnly, openHarness } from '../forever/support/open';

const BIOMES = 6;
const SIM_P95 = 0.5;
const LAYERS_P50 = 1;
const RESIDUAL_P95 = 0.5;
const STREAMING_P99 = 2;
const WARP_MAX = 30;
const INSTANCE_BYTES = 0.2 * 1024 * 1024;
const ATLAS_BYTES = 1.6 * 1024 * 1024;
const HEAP_LIMIT = 64 * 1024 * 1024;

test.setTimeout(300_000);

test('sub-budgets on the heaviest biome, streaming, warp and memory (B18)', async ({ page }, info) => {
  armedOnly();
  await openHarness(page, info, { period: 0, tier: 3 });
  const r = await page.evaluate(({ biomes }) => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    mv.manual(true);
    let chunk = -1;
    let most = -1;
    for (let b = 0; b < biomes; b++) {
      const c = lab.findBiomeChunk(b, 0);
      mv.warp(c, 0);
      mv.stepFrames(60, 1 / 60);
      const t = mv.stats().triangles;
      if (t > most) {
        most = t;
        chunk = c;
      }
    }
    mv.warp(chunk, 0);
    mv.stepFrames(120, 1 / 60);
    lab.instrument(true);
    lab.resetBudgets();
    lab.timedFrames(1800, 1 / 60);
    const steady = lab.budgets();
    // dt 1/32 is 2.5 u a frame, the same travel per frame as 150 u/s.
    mv.warp(chunk, 0);
    mv.stepFrames(30, 1 / 60);
    lab.resetBudgets();
    lab.timedFrames(1800, 1 / 32);
    const streaming = lab.budgets();
    lab.instrument(false);
    // Warp plus one frame at distinct aperiodic chunks, dropping the first two.
    const warps: number[] = [];
    for (let i = 0; i < 20; i++) {
      const c = 1000000 + i * 1000;
      const start = performance.now();
      mv.warp(c, 0);
      mv.stepFrames(1, 1 / 60);
      warps.push(performance.now() - start);
    }
    return { chunk, steady, streaming, warpMax: Math.max(...warps.slice(2)), audit: lab.audit(), heap: lab.heapAfterGc() };
  }, { biomes: BIOMES });
  console.log(`BUDGET heaviest chunk ${r.chunk}`);
  console.log(`BUDGET steady ${JSON.stringify(r.steady)}`);
  console.log(`BUDGET streaming ${JSON.stringify(r.streaming)}`);
  console.log(`BUDGET warp max ${r.warpMax} ms, audit ${JSON.stringify(r.audit)}, heap ${r.heap}`);
  expect(r.steady.frames).toBe(1800);
  // The wrappers fired in every instrumented frame. A host that reaches sim, a layer or post through a captured
  // reference, against the seam, bypasses them, and the sim, layers and streaming lines would then read 0 and pass (V1-T09).
  // Streaming counts terrain and props together, so every layer's frame is also held to one call a frame (V2-T09).
  // callCountProblems is unit-tested in tests/unit/harness/budget.test.ts.
  for (const [name, b] of [['steady', r.steady], ['streaming', r.streaming]] as const) {
    console.log(`BUDGET ${name} minCalls ${JSON.stringify(b.minCalls)} layerCount ${b.layerCount}`);
    expect(callCountProblems(b), `${name}: every wrapper fired in every frame`).toEqual([]);
  }
  expect(r.steady.sim.p95).toBeLessThanOrEqual(SIM_P95);
  expect(r.steady.layers.p50).toBeLessThanOrEqual(LAYERS_P50);
  expect(r.steady.residual.p95).toBeLessThanOrEqual(RESIDUAL_P95);
  expect(r.streaming.streaming.p99).toBeLessThanOrEqual(STREAMING_P99);
  expect(r.warpMax).toBeLessThanOrEqual(WARP_MAX);
  expect(r.audit.instanceBytes).toBeLessThanOrEqual(INSTANCE_BYTES);
  expect(r.audit.dataTextureBytes).toBeLessThanOrEqual(ATLAS_BYTES);
  expect(r.heap).toBeLessThanOrEqual(HEAP_LIMIT);
});
