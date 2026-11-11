// A13: a cold load of the production build, no harness, seen through a CDP screencast from before navigation
// (plan M7). Serves dist/ with node:http under /art/ in a browser launched for this test alone, so nothing is warm.
// Needs `npm run build` first. TERRAIN_SEED picks the seed through ?seed= for the opening candidates (A14).
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BIOME_NAMES, DEFAULT_SEED, PALETTE_NAMES, ZONE_CHUNKS } from '../../src/contracts/index';
import { startScreencast } from '../e2e/lib/view';
import type { Page } from 'playwright/test';
import { test, expect } from '../support/pw';
import { checkRasterizer } from '../support/rasterizer';
import { at, frame, goto, openHarness, serveDist } from './support/capture';
import { avoidRing, opening, SAMPLE_LOCAL } from './support/combos';
import { clippedPct, floorBlack, litSaturation, meanChroma, nearWhitePct } from './support/metrics';
import { gateRow, roundDir, roundFile, roundName, writeSpecResults, checkImage, type GateRow } from './support/round';
import { downscale, writeSheet, type Tile } from './support/sheet';
import { LIMITS } from './support/thresholds';

const SEED = Number(process.env['TERRAIN_SEED'] ?? DEFAULT_SEED);
const TAG = SEED === DEFAULT_SEED ? '' : `-seed${SEED}`;
/** A frame counts as lit at a 64 x 36 mean luma of at least this, and black under BLACK [A]. */
const LIT = 6;
const BLACK = 3;

/** Mean luma of each image on a 64 x 36 canvas, decoded by createImageBitmap in a blank page. F2's one function. */
async function lumaOf(page: Page, uris: string[]): Promise<number[]> {
  // In batches: hundreds of 1080p JPEGs in one evaluate argument closed the page [O: r00].
  const out: number[] = [];
  for (let i = 0; i < uris.length; i += 24) out.push(...(await lumaBatch(page, uris.slice(i, i + 24))));
  return out;
}

async function lumaBatch(page: Page, uris: string[]): Promise<number[]> {
  return page.evaluate(async (list) => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 36;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    const out: number[] = [];
    for (const u of list) {
      const bmp = await createImageBitmap(await (await fetch(u)).blob());
      g.drawImage(bmp, 0, 0, 64, 36);
      const d = g.getImageData(0, 0, 64, 36).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
      out.push(s / (64 * 36));
    }
    return out;
  }, uris);
}

test('first10: cold load of dist/, strip, flash and first frame', async ({ playwright, browser }, info) => {
  test.setTimeout(240_000);
  const dist = resolve('dist');
  expect(existsSync(join(dist, 'index.html')), 'run npm run build first').toBe(true);
  const srv = await serveDist(dist);
  const launchOptions = (info.project.use as { launchOptions?: Parameters<typeof playwright.chromium.launch>[0] }).launchOptions ?? {};
  const cold = await playwright.chromium.launch(launchOptions);
  const rows: GateRow[] = [];
  try {
    const ctx = await cold.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204 }));
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
    page.on('crash', () => { errors.push('page crashed'); console.log('first10: page crashed'); });
    page.on('close', () => { console.log('first10: page closed'); });
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    // Boot record without granting activation: an init script, read back only after the launch click.
    await page.addInitScript(() => {
      const w = window as unknown as { __artBoot: { t: number; v: string }[] };
      w.__artBoot = [];
      // documentElement may not exist yet when an init script runs, so the observer watches the document.
      new MutationObserver(() => {
        const v = document.documentElement?.dataset['mvBoot'] ?? '';
        const last = w.__artBoot[w.__artBoot.length - 1];
        if (!last || last.v !== v) w.__artBoot.push({ t: performance.now(), v });
      }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-mv-boot'] });
    });
    // The page before navigation is not the site: start from black, so its white about:blank cannot count as a flash.
    await page.setContent('<html style="background:#000"><body style="background:#000"></body></html>');
    let tCommit = Number.NaN;
    page.on('framenavigated', (f) => { if (f === page.mainFrame() && f.url().startsWith(srv.url) && !Number.isFinite(tCommit)) tCommit = Date.now() / 1000; });
    const castDir = roundDir(`first10${TAG}-frames`);
    const cast = await startScreencast(page, castDir);
    const t0 = Date.now() / 1000;
    await page.goto(`${srv.url}${SEED === DEFAULT_SEED ? '' : `?seed=${SEED}`}`);
    await new Promise((r) => setTimeout(r, 10_000 - (Date.now() / 1000 - t0) * 1000));
    const tClick = Date.now() / 1000;
    const box = await page.locator('[data-mv="launch"]').boundingBox();
    const cx = box ? box.x + box.width / 2 : 960, cy = box ? box.y + box.height / 2 : 700;
    await page.mouse.click(cx, cy);
    await new Promise((r) => setTimeout(r, 2200));
    const frames = await cast.stop();
    const after = await page.evaluate(() => ({
      boot: (window as unknown as { __artBoot: { t: number; v: string }[] }).__artBoot,
      mode: document.documentElement.dataset['mvMode'] ?? '',
    }));
    // The rasterizer, from a throwaway page of the same cold browser, so the measured page keeps one context.
    const probe = await ctx.newPage();
    const renderer = await probe.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl?.getExtension('WEBGL_debug_renderer_info'); const s = e ? String(gl!.getParameter(e.UNMASKED_RENDERER_WEBGL)) : ''; gl?.getExtension('WEBGL_lose_context')?.loseContext(); return s; });
    await probe.close();
    const problem = checkRasterizer(info.project.name, true, renderer);
    expect(problem, renderer).toBeNull();

    // Decode every frame onto 64 x 36 in a blank page of the shared browser.
    const blank = await browser.newContext();
    const bp = await blank.newPage();
    await bp.goto('about:blank');
    const uris = frames.map((f) => `data:image/jpeg;base64,${readFileSync(f.file).toString('base64')}`);
    const lum = await lumaOf(bp, uris);
    // A13's own control: a white frame through the same function fails F2.
    const whiteUri = await bp.evaluate(() => { const c = document.createElement('canvas'); c.width = 64; c.height = 36; const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 36); return c.toDataURL('image/png'); });
    const whiteL = (await lumaOf(bp, [whiteUri]))[0]!;
    const rel = frames.map((f) => f.t - t0);
    const commitRel = tCommit - t0;
    const afterCommit = (i: number): boolean => !Number.isFinite(commitRel) || rel[i]! >= commitRel;
    const running = after.boot.find((b) => b.v === 'running');
    const tRunning = running ? running.t / 1000 : Number.NaN;
    let firstLit = -1;
    for (let i = 0; i < frames.length; i++) if (rel[i]! >= tRunning && lum[i]! >= LIT) { firstLit = i; break; }
    const blackAfter = firstLit < 0 ? [] : lum.map((l, i) => ({ l, i })).filter((x) => x.i > firstLit && x.l < BLACK);
    const F1 = firstLit < 0 ? Number.POSITIVE_INFINITY : rel[firstLit]! * 1000;
    const F2 = Math.max(...lum.filter((_, i) => afterCommit(i)));
    console.log(`first10 seed ${SEED}: navigation committed at ${(commitRel * 1000).toFixed(0)} ms; boot record ${JSON.stringify(after.boot.map((b) => [b.v, Math.round(b.t)]))}`);
    console.log(`first10 seed ${SEED}: ${frames.length} frames over ${(rel[rel.length - 1] ?? 0).toFixed(2)} s; boot running at ${(tRunning * 1000).toFixed(0)} ms after navigation start; first lit live frame ${F1.toFixed(0)} ms (frame ${firstLit}); black frames after it: ${blackAfter.length}; max 64x36 luma ${F2.toFixed(1)} (white control ${whiteL.toFixed(1)}); mode after click ${after.mode}`);
    const harnessReq = requests.filter((u) => /harness|testHook/i.test(u));
    const external = requests.filter((u) => !u.startsWith(srv.url) && !u.startsWith('data:') && !u.startsWith('about:') && !u.includes('/favicon.ico'));

    const nearest = (t: number): number => { let b = 0; for (let i = 0; i < rel.length; i++) if (Math.abs(rel[i]! - t) < Math.abs(rel[b]! - t)) b = i; return b; };
    const marks = [0, 0.25, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10];
    // Time only: each frame's luma is in the metrics file, and a reviewer's images carry no measurements (M9 step 3).
    await writeSheet(browser, marks.map((t) => { const i = nearest(t); return { uri: uris[i]!, label: `t ${rel[i]!.toFixed(2)} s` }; }), { cols: 3, tileW: 640, tileH: 360, path: roundFile(`first10${TAG}.png`), title: `first10 ${roundName()} seed ${SEED}: cold load of dist/ under /art/, no harness` });
    const dtc = tClick - t0;
    await writeSheet(browser, [0, 0.4, 0.8, 1.2, 1.6, 2.0].map((d) => { const i = nearest(dtc + d); return { uri: uris[i]!, label: `click + ${(rel[i]! - dtc).toFixed(2)} s` }; }), { cols: 3, tileW: 640, tileH: 360, path: roundFile(`launch${TAG}.png`), title: `launch ${roundName()} seed ${SEED}: the 2 s after a real click on [data-mv=launch]` });
    await blank.close();

    rows.push(gateRow('F1', LIMITS.F1, [{ v: blackAfter.length > 0 ? Number.POSITIVE_INFINITY : F1, at: `seed ${SEED}${blackAfter.length ? `, ${blackAfter.length} black frames after the first lit one` : ''}` }]));
    rows.push(gateRow('F2', LIMITS.F2, lum.map((l, i) => ({ v: l, at: `frame ${i} t ${rel[i]!.toFixed(2)} s` })).filter((_, i) => afterCommit(i)), `frames from navigation commit at ${(commitRel * 1000).toFixed(0)} ms`));
    rows.push(gateRow('F2control', { value: LIMITS.F2.value, dir: 'max', reportOnly: true }, [{ v: whiteL, at: 'synthetic white frame, must exceed the limit' }]));
    writeSpecResults(`first10${TAG}`, { round: roundName(), seed: SEED, opening: opening(SEED, 4), frames: frames.length, tRunningMs: tRunning * 1000, firstLitMs: F1, firstLit, lum, rel, requests, errors, mode: after.mode }, rows);
    expect(frames.length, 'screencast frames, so the check is not vacuous').toBeGreaterThanOrEqual(60);
    expect(harnessReq, 'no harness chunk on a normal visit').toEqual([]);
    expect(external, 'no external fetch').toEqual([]);
    expect(errors, errors.join('\n')).toEqual([]);
    expect(whiteL).toBeGreaterThan(LIMITS.F2.value);
    expect(after.mode).toBe('play');
    for (const f of [`first10${TAG}.png`, `launch${TAG}.png`]) expect.soft(checkImage(roundFile(f)).ok, f).toBe(true);
    for (const r of rows) if (!r.reportOnly) expect.soft(r.pass, `${r.gate} ${r.value} at ${r.worst}`).toBe(true);
  } finally {
    await cold.close();
    await srv.close();
  }
});

const HERO = ['banded sun', 'eclipse', 'ringed planet', 'wire moon'] as const;

// A14's candidate sheet (plan M7): what the first four zones of this seed look like, on the harness page at tier 3.
// Fixed by rule before any frame was seen: zone 0 at into 8, 23 and 38, zones 1 to 3 at into 38, each after the plan's
// RING rule, local 20, tick by cruise timing. 3 x 2 at 640 x 360, the validated format (DI-101). W1, W2, W4 and C1 gated,
// as on every real sample; W5 printed, as it is report-only.
test('opening: the first four zones of this seed', async ({ page, browser }, info) => {
  test.setTimeout(300_000);
  await openHarness(page, info, { seed: SEED, tier: 3, period: 0 });
  const op = opening(SEED, 4);
  const plan: { zone: number; into: number }[] = [{ zone: 0, into: 8 }, { zone: 0, into: 23 }, { zone: 0, into: 38 }, { zone: 1, into: 38 }, { zone: 2, into: 38 }, { zone: 3, into: 38 }];
  const tiles: Tile[] = [];
  const w1: { v: number; at: string }[] = [], w2: { v: number; at: string }[] = [], w4: { v: number; at: string }[] = [], w5: { v: number; at: string }[] = [], c1: { v: number; at: string }[] = [];
  const per: Record<string, unknown>[] = [];
  for (const p of plan) {
    const z = op[p.zone]!;
    const into = avoidRing(p.zone * ZONE_CHUNKS, p.into);
    const s = at(p.zone * ZONE_CHUNKS + into, SAMPLE_LOCAL);
    await goto(page, s);
    const f = await frame(page, s, { post: 'full' });
    const where = `seed ${SEED} zone ${p.zone} into ${into}: ${PALETTE_NAMES[z.palette]} / ${BIOME_NAMES[z.biome]} / ${HERO[z.hero]}`;
    const m = { nearWhite: nearWhitePct(f.w, f.h, f.rgba), chroma: meanChroma(f.w, f.h, f.rgba), floorBlack: floorBlack(f.w, f.h, f.rgba), litSat: litSaturation(f.w, f.h, f.rgba), clipped: clippedPct(f.w, f.h, f.rgba) };
    w1.push({ v: m.nearWhite, at: where }); w2.push({ v: m.chroma, at: where }); w4.push({ v: m.floorBlack, at: where }); w5.push({ v: m.litSat, at: where }); c1.push({ v: m.clipped, at: where });
    per.push({ ...p, into, chunk: s.chunk, palette: z.palette, biome: z.biome, hero: z.hero, dayPhase: z.dayPhase, ...m });
    console.log(`opening ${where}, dayPhase ${z.dayPhase.toFixed(3)}: W1 ${m.nearWhite.toFixed(4)}% W2 ${m.chroma.toFixed(2)} W4 ${m.floorBlack.toFixed(2)} W5 ${m.litSat.toFixed(3)} C1 ${m.clipped.toFixed(3)}%`);
    tiles.push({ img: downscale(f, 3), label: `zone ${p.zone} into ${into}: ${PALETTE_NAMES[z.palette]} / ${BIOME_NAMES[z.biome]} / ${HERO[z.hero]}, day ${z.dayPhase.toFixed(2)}` });
  }
  const path = roundFile(`opening-seed${SEED}.png`);
  await writeSheet(browser, tiles, { cols: 3, tileW: 640, tileH: 360, path, title: `opening ${roundName()} seed ${SEED}: zone 0 at into 8, 23, 38; zones 1 to 3 at into 38 (harness, tier 3, full post)` });
  const rows = [
    gateRow('W1open', LIMITS.W1, w1), gateRow('W2open', LIMITS.W2, w2), gateRow('W4open', LIMITS.W4, w4),
    gateRow('W5open', LIMITS.W5, w5), gateRow('C1open', LIMITS.C1, c1),
  ];
  writeSpecResults(`opening-seed${SEED}`, { round: roundName(), seed: SEED, opening: op, tiles: per }, rows);
  expect(checkImage(path).ok).toBe(true);
  for (const r of rows) if (!r.reportOnly) expect.soft(r.pass, `${r.gate} ${r.value} at ${r.worst}`).toBe(true);
});
