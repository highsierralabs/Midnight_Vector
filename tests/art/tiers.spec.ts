// A18: degraded tiers still look intended (plan M8). One page load per ?tier=N, as T10's URL table gives no boot timing
// then. W1, W2 (gated) and W5 (report-only) on every pair tile at tiers 4 to 1, each tier with its own post variant
// (architecture.md 6.10). tiers-b<n>.png: one biome's tile across tiers 4, 3, 2, 1, from page screenshots with the UI
// hidden, so every tile is the same CSS size whatever the drawing buffer. aspect.png: 21:9, 16:9, 4:3 and 9:16 in PLAY
// with the HUD. reduced.png: one tile per palette under reduced motion.
import { BIOME_NAMES, PALETTE_NAMES, type PostVariant, type Tier } from '../../src/contracts/index';
import type { Browser, Page } from 'playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { HIDE_UI_STYLE } from '../e2e/lib/app';
import { test, expect } from '../support/pw';
import { buildCombos } from './support/combos';
import { ART_SEED, frame, goto, openHarness } from './support/capture';
import { decodePng, encodePng } from './support/png';
import { litSaturation, meanChroma, nearWhitePct } from './support/metrics';
import { gateRow, roundFile, roundName, writeSpecResults, checkImage, type GateRow } from './support/round';
import { downscale, writeSheet, type Rgba, type Tile } from './support/sheet';
import { LIMITS } from './support/thresholds';

const SEED = Number(process.env['TERRAIN_SEED'] ?? ART_SEED);
const TAG = SEED === ART_SEED ? '' : `-seed${SEED}`;
/** architecture.md 6.10: the post variant each tier uses. */
const POST: Record<number, PostVariant> = { 4: 'full', 3: 'full', 2: 'noCa', 1: 'min' };
/** The three biomes on tiers.png: Boulevard, Cyber Canyon, Orbital Night. Fixed before any frame was seen. */
const SHEET_BIOMES = [0, 3, 4] as const;

test.describe.configure({ mode: 'serial' });

async function shotNoUi(page: Page): Promise<Rgba> {
  const png = decodePng(await page.screenshot({ style: HIDE_UI_STYLE }));
  return { w: png.w, h: png.h, rgba: png.rgba };
}

const perTier: Record<number, Record<number, Tile>> = {};
const rows: GateRow[] = [];
const sizes: Record<string, unknown> = {};

for (const tier of [4, 3, 2, 1] as const) {
  test(`tier ${tier}: W1, W2, W5 on every pair tile, and the three-biome tiles`, async ({ page }, info) => {
    test.setTimeout(600_000);
    const combos = buildCombos(SEED);
    const open = await openHarness(page, info, { seed: SEED, tier: tier as Tier, period: 0 });
    expect(open.tier, 'stats().tier matches ?tier').toBe(tier);
    const w1: { v: number; at: string }[] = [], w2: { v: number; at: string }[] = [], w5: { v: number; at: string }[] = [];
    perTier[tier] = {};
    for (const pair of combos.pairs) {
      const s = pair.tile;
      await goto(page, s);
      const f = await frame(page, s, { post: POST[tier]! });
      const where = `tier ${tier} ${PALETTE_NAMES[pair.palette]} / ${BIOME_NAMES[pair.biome]} ${s.id}`;
      w1.push({ v: nearWhitePct(f.w, f.h, f.rgba), at: where });
      w2.push({ v: meanChroma(f.w, f.h, f.rgba), at: where });
      w5.push({ v: litSaturation(f.w, f.h, f.rgba), at: where });
      sizes[`tier${tier}`] = `${f.w}x${f.h}`;
      if (pair.palette === 0 && (SHEET_BIOMES as readonly number[]).includes(pair.biome)) {
        const img = await shotNoUi(page);
        perTier[tier]![pair.biome] = { img: downscale(img, 3), label: `tier ${tier} (${POST[tier]}, buffer ${f.w}x${f.h}): ${PALETTE_NAMES[pair.palette]} / ${BIOME_NAMES[pair.biome]}` };
      }
    }
    const tierAfter = await page.evaluate(() => window.__mv!.stats().tier);
    expect(tierAfter, 'stats().tier held through the run').toBe(tier);
    rows.push(gateRow(`W1t${tier}`, LIMITS.W1, w1), gateRow(`W2t${tier}`, LIMITS.W2, w2), gateRow(`W5t${tier}`, LIMITS.W5, w5));
    console.log(`tiers: tier ${tier} buffer ${String(sizes[`tier${tier}`])}`);
  });
}

test('tiers sheets: one biome across tiers 4 to 1', async ({ browser }) => {
  writeSpecResults(`tiers${TAG}`, { seed: SEED, sizes }, rows);
  for (const b of SHEET_BIOMES) {
    const tiles = [4, 3, 2, 1].map((t) => perTier[t]?.[b]).filter((t): t is Tile => t !== undefined);
    const path = roundFile(`tiers-b${b}${TAG}.png`);
    await writeSheet(browser, tiles, { cols: 2, tileW: 640, tileH: 360, path, title: `tiers-b${b} ${roundName()}: ${BIOME_NAMES[b]}, Sunset Drive tile, tiers 4, 3 / 2, 1 (page screenshots, UI hidden)` });
    expect(checkImage(path).ok, path).toBe(true);
  }
  for (const r of rows) if (!r.reportOnly) expect.soft(r.pass, `${r.gate} ${r.value} at ${r.worst}`).toBe(true);
});

/** A sheet of images of different sizes, each at 1:1 under a label, rows as given. Width at most 1920. */
async function writeMixedSheet(browser: Browser, rowsOf: { img: Rgba; label: string }[][], path: string, title: string): Promise<void> {
  const width = Math.max(...rowsOf.map((r) => r.reduce((s, t) => s + t.img.w, 0)));
  if (width > 1920) throw new Error(`writeMixedSheet: ${width} wide`);
  const cell = (t: { img: Rgba; label: string }): string => `<div style="display:inline-block;vertical-align:top"><div style="height:16px;font:12px/16px monospace;color:#eee;background:#111;padding-left:3px;width:${t.img.w - 3}px;overflow:hidden;white-space:nowrap">${t.label}</div><img src="data:image/png;base64,${encodePng(t.img.w, t.img.h, t.img.rgba, 3).toString('base64')}" width="${t.img.w}" height="${t.img.h}" style="display:block"></div>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000;width:${width}px}</style></head><body><div style="height:20px;font:13px/20px monospace;color:#ddd;padding-left:4px">${title}</div>${rowsOf.map((r) => `<div style="white-space:nowrap;font-size:0">${r.map(cell).join('')}</div>`).join('')}</body></html>`;
  const height = 20 + rowsOf.reduce((s, r) => s + 16 + Math.max(...r.map((t) => t.img.h)), 0);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path.replace(/\.png$/, '.html'), html);
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  try {
    const p = await ctx.newPage();
    await p.setContent(html, { waitUntil: 'load' });
    await p.screenshot({ path, clip: { x: 0, y: 0, width, height } });
  } finally {
    await ctx.close();
  }
  console.log(`SCREENSHOT ${path}`);
}

test('aspect: 21:9, 16:9, 4:3 and 9:16 in PLAY with the HUD, Sunset Drive first zone', async ({ browser }, info) => {
  test.setTimeout(600_000);
  const combos = buildCombos(SEED);
  const z = combos.pairs.filter((x) => x.palette === 0).sort((a, b) => a.z0 - b.z0)[0]!;
  const shapes = [[1680, 720, '21:9'], [1280, 720, '16:9'], [960, 720, '4:3'], [404, 720, '9:16']] as const;
  const got: { img: Rgba; label: string }[] = [];
  for (const [w, h, name] of shapes) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    try {
      await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204 }));
      await openHarness(page, info, { seed: SEED, tier: 3, period: 0 });
      await page.evaluate((c) => { window.__mv!.warp(c, 20); window.__mv!.stepFrames(30, 1 / 60); }, z.tile.chunk);
      const box = await page.locator('[data-mv="launch"]').boundingBox();
      await page.mouse.click(box ? box.x + box.width / 2 : w / 2, box ? box.y + box.height / 2 : h * 0.7);
      const st = await page.evaluate(() => { window.__mv!.stepFrames(120, 1 / 60); return { mode: document.documentElement.dataset['mvMode'] ?? '', cam: window.__mvE2e!.camera() }; });
      const png = decodePng(await page.screenshot());
      const img = { w: png.w, h: png.h, rgba: png.rgba };
      const half = downscale(img, 2);
      got.push({ img: half, label: `${name} ${w}x${h} at 1/2, ${st.mode}, fov ${st.cam.fov.toFixed(1)}, gain ${st.cam.gainX.toFixed(3)}` });
      console.log(`aspect ${name}: mode ${st.mode}, camera ${JSON.stringify(st.cam)}`);
    } finally {
      await ctx.close();
    }
  }
  const path = roundFile(`aspect${TAG}.png`);
  await writeMixedSheet(browser, [[got[0]!, got[1]!], [got[2]!, got[3]!]], path, `aspect ${roundName()} seed ${SEED}: PLAY with the HUD, ${PALETTE_NAMES[0]} / ${BIOME_NAMES[z.biome]} chunk ${z.tile.chunk}`);
  expect(checkImage(path).ok, path).toBe(true);
});

test('reduced: one tile per palette under reduced motion', async ({ page, browser }, info) => {
  test.setTimeout(600_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const combos = buildCombos(SEED);
  await openHarness(page, info, { seed: SEED, tier: 3, period: 0 });
  const reduced = await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  expect(reduced).toBe(true);
  const tiles: Tile[] = [];
  const w1: { v: number; at: string }[] = [], w2: { v: number; at: string }[] = [];
  for (let p = 0; p < 6; p++) {
    const pair = combos.pairs.filter((x) => x.palette === p).sort((a, b) => a.z0 - b.z0)[0]!;
    await goto(page, pair.tile);
    const f = await frame(page, pair.tile, { post: 'full' });
    const where = `reduced ${PALETTE_NAMES[p]} / ${BIOME_NAMES[pair.biome]} ${pair.tile.id}`;
    w1.push({ v: nearWhitePct(f.w, f.h, f.rgba), at: where });
    w2.push({ v: meanChroma(f.w, f.h, f.rgba), at: where });
    tiles.push({ img: downscale(f, 3), label: where });
  }
  const path = roundFile(`reduced${TAG}.png`);
  await writeSheet(browser, tiles, { cols: 3, tileW: 640, tileH: 360, path, title: `reduced ${roundName()} seed ${SEED}: prefers-reduced-motion, each palette's first zone tile, full post` });
  const r = [gateRow('W1reduced', LIMITS.W1, w1), gateRow('W2reduced', LIMITS.W2, w2)];
  writeSpecResults(`reduced${TAG}`, { seed: SEED }, r);
  expect(checkImage(path).ok, path).toBe(true);
  for (const x of r) expect.soft(x.pass, `${x.gate} ${x.value} at ${x.worst}`).toBe(true);
});
