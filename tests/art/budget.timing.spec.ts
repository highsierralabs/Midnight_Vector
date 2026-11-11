// A20: the marginal cost table and P1 in all six biomes (plan M8). Runs only under `gpu-timing`, alone on the machine
// through the GPU lock. For each biome's tile zone at tier 3: the same 120-frame cruise sequence through renderAt's
// GPU-synced ms, once per configuration: all on; each layer hidden; post full, noCa, min, bare, off; MSAA 2 and 0. The
// first frame after each warp rebuilds every layer, so it is dropped and printed. P1 reads the `all` row: p95 at most
// 2.0 ms, draw calls at most 68, triangles at most 1.5M, and triangles above 100,000 so the timing was of a real scene.
import { BIOME_NAMES, type LayerName, type PostVariant } from '../../src/contracts/index';
import { percentile } from '../../src/harness/metrics';
import { test, expect } from '../support/pw';
import { buildCombos, tickFor } from './support/combos';
import { ART_SEED, openHarness } from './support/capture';
import { gateRow, roundFile, roundName, writeRoundText, writeSpecResults } from './support/round';
import { CRUISE_DU, LIMITS, TICKS_PER_FRAME } from './support/thresholds';
import { writeFileSync } from 'node:fs';

const SEED = Number(process.env['TERRAIN_SEED'] ?? ART_SEED);
const TAG = SEED === ART_SEED ? '' : `-seed${SEED}`;
const FRAMES = 120;

interface Config { name: string; post: PostVariant | 'off'; msaa: 0 | 2; hide?: LayerName }
const CONFIGS: Config[] = [
  { name: 'all', post: 'full', msaa: 2 },
  { name: 'no sky', post: 'full', msaa: 2, hide: 'sky' },
  { name: 'no terrain', post: 'full', msaa: 2, hide: 'terrain' },
  { name: 'no props', post: 'full', msaa: 2, hide: 'props' },
  { name: 'no fx', post: 'full', msaa: 2, hide: 'fx' },
  { name: 'noCa', post: 'noCa', msaa: 2 },
  { name: 'min', post: 'min', msaa: 2 },
  { name: 'bare', post: 'bare', msaa: 2 },
  { name: 'off', post: 'off', msaa: 2 },
  { name: 'msaa 0', post: 'full', msaa: 0 },
];

interface Row { biome: number; config: string; p50: number; p95: number; p99: number; max: number; first: number; calls: number; triangles: number; tier: number }

test('budget: the marginal cost table and P1 in six biomes, tier 3 (A20)', async ({ page }, info) => {
  test.setTimeout(900_000);
  const combos = buildCombos(SEED);
  await openHarness(page, info, { seed: SEED, tier: 3, period: 0 });
  const out: Row[] = [];
  for (let b = 0; b < 6; b++) {
    const pair = combos.pairs.filter((x) => x.biome === b).sort((a, c) => a.z0 - c.z0)[0]!;
    const s = pair.tile;
    // Warm-up: the JIT keeps tiering for thousands of frames (T09's B17), so one pass of 600 cruise frames first.
    for (const [k, c] of [[-1, CONFIGS[0]!] as const, ...CONFIGS.map((c, i) => [i, c] as const)]) {
      const r = await page.evaluate((a) => {
        const mv = window.__mv!;
        mv.setPost(a.post);
        mv.setMsaa(a.msaa);
        for (const n of ['sky', 'terrain', 'props', 'fx'] as const) mv.setLayerVisible(n, n !== a.hide);
        mv.forceFeel(null);
        mv.warp(a.chunk, a.local);
        const n = a.warm ? 600 : a.frames;
        const ms: number[] = [];
        let travel = a.chunk * 64 + a.local;
        let tick = a.tick;
        let first = 0;
        for (let i = 0; i <= n; i++) {
          const chunk = Math.floor(travel / 64);
          const t = mv.renderAt(chunk, travel - chunk * 64, tick);
          if (i === 0) first = t; else ms.push(t);
          travel += a.du;
          tick += a.ticks;
        }
        const st = mv.stats();
        return { ms, first, calls: st.calls, triangles: st.triangles, tier: st.tier };
      }, { chunk: s.chunk, local: s.local, tick: tickFor(s.chunk, s.local), du: CRUISE_DU, ticks: TICKS_PER_FRAME, post: c.post, msaa: c.msaa, hide: c.hide ?? null, warm: k < 0, frames: FRAMES });
      if (k < 0) continue;
      const row: Row = { biome: b, config: c.name, p50: percentile(r.ms, 0.5), p95: percentile(r.ms, 0.95), p99: percentile(r.ms, 0.99), max: Math.max(...r.ms), first: r.first, calls: r.calls, triangles: r.triangles, tier: r.tier };
      out.push(row);
      console.log(`budget ${BIOME_NAMES[b]} (${s.id}) ${c.name.padEnd(10)} p50 ${row.p50.toFixed(3)} p95 ${row.p95.toFixed(3)} p99 ${row.p99.toFixed(3)} max ${row.max.toFixed(3)} first ${row.first.toFixed(1)} ms, calls ${row.calls}, triangles ${row.triangles}, tier ${row.tier}`);
    }
  }
  // Restore the defaults on the page before anything else could use it.
  await page.evaluate(() => { const mv = window.__mv!; mv.setPost('full'); mv.setMsaa(2); for (const n of ['sky', 'terrain', 'props', 'fx'] as const) mv.setLayerVisible(n, true); });
  const all = out.filter((r) => r.config === 'all');
  const lines: string[] = [`T11 ${roundName()} budget, seed ${SEED}, tier 3, ${FRAMES} cruise frames per row through renderAt (GPU-synced ms), first frame after each warp dropped.`, 'Marginal cost = p50 of all minus p50 of the row; a hidden layer or a lighter post shows what it costs.', ''];
  lines.push(`${'biome'.padEnd(16)}${'config'.padEnd(12)}${'p50'.padStart(8)}${'p95'.padStart(8)}${'p99'.padStart(8)}${'marg p50'.padStart(10)}${'calls'.padStart(7)}${'tris'.padStart(10)}`);
  for (const r of out) {
    const base = all.find((a) => a.biome === r.biome)!;
    lines.push(`${BIOME_NAMES[r.biome]!.padEnd(16)}${r.config.padEnd(12)}${r.p50.toFixed(3).padStart(8)}${r.p95.toFixed(3).padStart(8)}${r.p99.toFixed(3).padStart(8)}${(base.p50 - r.p50).toFixed(3).padStart(10)}${String(r.calls).padStart(7)}${String(r.triangles).padStart(10)}`);
  }
  writeRoundText(`budget${TAG}.txt`, `${lines.join('\n')}\n`);
  writeFileSync(roundFile(`budget${TAG}.json`), JSON.stringify({ seed: SEED, frames: FRAMES, rows: out }, null, 1));
  const rows = [
    gateRow('P1ms', LIMITS.P1ms, all.map((r) => ({ v: r.p95, at: `${BIOME_NAMES[r.biome]} p50 ${r.p50.toFixed(3)} p99 ${r.p99.toFixed(3)}` }))),
    gateRow('P1calls', LIMITS.P1calls, all.map((r) => ({ v: r.calls, at: BIOME_NAMES[r.biome]! }))),
    gateRow('P1tris', LIMITS.P1tris, all.map((r) => ({ v: r.triangles, at: BIOME_NAMES[r.biome]! }))),
    gateRow('P1real', { value: 100_000, dir: 'min' }, all.map((r) => ({ v: r.triangles, at: `${BIOME_NAMES[r.biome]}: triangles above 100,000, so a real scene was timed` }))),
  ];
  writeSpecResults(`budget${TAG}`, { seed: SEED, rows: out }, rows);
  for (const r of all) expect(r.tier, `biome ${r.biome} at tier 3`).toBe(3);
  for (const r of rows) expect.soft(r.pass, `${r.gate} ${r.value} at ${r.worst}`).toBe(true);
});
