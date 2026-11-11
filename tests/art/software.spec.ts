// A19: tier 0 on SwiftShader (plan M8; DI-85). Runs only under the `software` project, where the governor pins tier 0
// from the renderer string. P2: timed frames of the real loop at most 50 ms p95 (architecture.md 9.2). software.png: each
// biome's lowest zone tile, rendered at tier 0's 640 x 360, at native size. W1 and W2 gated: the palette never degrades.
import { BIOME_NAMES, PALETTE_NAMES } from '../../src/contracts/index';
import { percentile } from '../../src/harness/metrics';
import { test, expect } from '../support/pw';
import { buildCombos } from './support/combos';
import { ART_SEED, frame, goto, openHarness } from './support/capture';
import { meanChroma, nearWhitePct } from './support/metrics';
import { gateRow, roundFile, roundName, writeSpecResults, checkImage } from './support/round';
import { writeSheet, type Tile } from './support/sheet';
import { LIMITS } from './support/thresholds';

const SEED = Number(process.env['TERRAIN_SEED'] ?? ART_SEED);
const TAG = SEED === ART_SEED ? '' : `-seed${SEED}`;

test('tier 0 on SwiftShader: P2, and the tier-0 look on six biomes (A19)', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'software', 'SwiftShader only: tier 0 is judged on the software project (A19)');
  test.setTimeout(600_000);
  const combos = buildCombos(SEED);
  const open = await openHarness(page, info, { seed: SEED, period: 0 }, `/?harness&period=0&seed=${SEED}`);
  expect(open.renderer.toLowerCase()).toContain('swiftshader');
  expect(open.tier, 'the governor pins tier 0 on software').toBe(0);
  const tiles: Tile[] = [];
  const w1: { v: number; at: string }[] = [], w2: { v: number; at: string }[] = [];
  for (let b = 0; b < 6; b++) {
    const pair = combos.pairs.filter((x) => x.biome === b).sort((a, c) => a.z0 - c.z0)[0]!;
    await goto(page, pair.tile);
    const f = await frame(page, pair.tile, { post: 'bare' });
    const where = `tier 0 ${PALETTE_NAMES[pair.palette]} / ${BIOME_NAMES[b]} ${pair.tile.id}, ${f.w}x${f.h}`;
    w1.push({ v: nearWhitePct(f.w, f.h, f.rgba), at: where });
    w2.push({ v: meanChroma(f.w, f.h, f.rgba), at: where });
    tiles.push({ img: f, label: where });
  }
  const path = roundFile(`software${TAG}.png`);
  await writeSheet(browser, tiles, { cols: 3, tileW: 640, tileH: 360, path, title: `software ${roundName()} seed ${SEED}: tier 0 on SwiftShader, bare post, each biome's lowest zone tile, native size` });
  // P2: the real loop at tier 0, as T09's B20 times it, from the first biome's tile zone.
  const first = combos.pairs.filter((x) => x.biome === 0).sort((a, c) => a.z0 - c.z0)[0]!;
  const r = await page.evaluate((c) => {
    const mv = window.__mv!;
    mv.warp(c, 20);
    window.__mvLab!.timedFrames(30, 1 / 60);
    const ms = window.__mvLab!.timedFrames(120, 1 / 60);
    const s = mv.stats();
    return { ms, tier: s.tier, calls: s.calls, triangles: s.triangles, w: s.width, h: s.height };
  }, first.tile.chunk);
  const p50 = percentile(r.ms, 0.5), p95 = percentile(r.ms, 0.95);
  console.log(`software: tier ${r.tier}, ${r.w}x${r.h}, p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, ${r.calls} calls, ${r.triangles} triangles`);
  const rows = [
    gateRow('P2', LIMITS.P2, [{ v: p95, at: `tier ${r.tier}, ${r.w}x${r.h}, 120 frames, ${r.calls} calls, ${r.triangles} triangles` }]),
    gateRow('W1t0', LIMITS.W1, w1),
    gateRow('W2t0', LIMITS.W2, w2),
  ];
  writeSpecResults(`software${TAG}`, { seed: SEED, p50, p95, ms: r.ms, calls: r.calls, triangles: r.triangles }, rows);
  expect(checkImage(path).ok, path).toBe(true);
  expect(r.tier).toBe(0);
  for (const x of rows) expect.soft(x.pass, `${x.gate} ${x.value} at ${x.worst}`).toBe(true);
});
