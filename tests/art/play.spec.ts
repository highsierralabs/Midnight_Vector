// A12: the UI over the real scene, the ship at the lane walls, and boost with hits (plan M7, "UI over the scene";
// DI-96; DI-66's flash notes). Each test opens its own harness page at tier 3, aperiodic, and launches with a real
// page.mouse click on [data-mv=launch]. Frames advance with stepFrames, so they are the real loop: sim, feel, UI and
// post. Screenshots (page.screenshot) carry the DOM UI over the canvas; metrics read pixels(), the canvas alone.
import { BIOME_NAMES, PALETTE_NAMES } from '../../src/contracts/index';
import type { Page } from 'playwright/test';
import { test, expect } from '../support/pw';
import { buildCombos, type Combos } from './support/combos';
import { ART_SEED, frame, goto, openHarness } from './support/capture';
import { decodePng } from './support/png';
import { clippedPct, flashFloorAllowance, litSaturation, meanChroma, nearWhitePct } from './support/metrics';
import { gateRow, roundFile, roundName, writeSpecResults, checkImage, type GateRow } from './support/round';
import { crop, downscale, writePng, writeSheet, type Rgba, type Tile } from './support/sheet';
import { LIMITS } from './support/thresholds';

const SEED = Number(process.env['TERRAIN_SEED'] ?? ART_SEED);
const TAG = SEED === ART_SEED ? '' : `-seed${SEED}`;

test.describe.configure({ mode: 'serial' });

/** Each palette's first zone (its lowest z0 over the six biomes), at that pair's tile chunk, local 20. */
function firstZones(c: Combos): { palette: number; biome: number; chunk: number }[] {
  const out: { palette: number; biome: number; chunk: number }[] = [];
  for (let p = 0; p < 6; p++) {
    const pair = c.pairs.filter((x) => x.palette === p).sort((a, b) => a.z0 - b.z0)[0]!;
    out.push({ palette: p, biome: pair.biome, chunk: pair.tile.chunk });
  }
  return out;
}

async function mode(page: Page): Promise<string> {
  return page.evaluate(() => document.documentElement.dataset['mvMode'] ?? '');
}

async function step(page: Page, n: number): Promise<{ mode: number; x: number; shields: number; speed: number; view: string }> {
  return page.evaluate((k) => {
    window.__mv!.stepFrames(k, 1 / 60);
    const s = window.__mvE2e!.sim;
    return { mode: s.mode, x: s.x, shields: s.shields, speed: s.speed, view: document.getElementById('mv-ui')?.getAttribute('data-view') ?? '' };
  }, n);
}

async function warpTo(page: Page, chunk: number): Promise<void> {
  const ok = await page.evaluate((c) => window.__mv!.warp(c, 20), chunk);
  if (!ok) throw new Error(`warp ${chunk} refused`);
}

async function shot(page: Page): Promise<Rgba> {
  const png = decodePng(await page.screenshot());
  return { w: png.w, h: png.h, rgba: png.rgba };
}

/** Mouse x for a lane target in u, by T10's mapping (tests/e2e/view.spec.ts V2 and V4). */
function mouseX(x: number, width: number): number {
  return (((x / 40) * 0.8 + 1) / 2) * width;
}

async function launch(page: Page): Promise<{ before: string; after: string }> {
  const before = await mode(page);
  const box = await page.locator('[data-mv="launch"]').boundingBox();
  await page.mouse.click(box ? box.x + box.width / 2 : 960, box ? box.y + box.height / 2 : 700);
  await step(page, 30);
  return { before, after: await mode(page) };
}

test('ui: title, PLAY with the HUD and CRUISE over each palette, after a real click', async ({ page, browser }, info) => {
  test.setTimeout(600_000);
  const combos = buildCombos(SEED);
  const zones = firstZones(combos);
  await openHarness(page, info, { seed: SEED, tier: 3, period: 0 });
  const label = (z: { palette: number; biome: number; chunk: number }, m: string, x: { view: string; x: number }): string => `${m}: ${PALETTE_NAMES[z.palette]} / ${BIOME_NAMES[z.biome]}, chunk ${z.chunk}, view ${x.view}, ship x ${x.x.toFixed(1)}`;
  const sheets: Record<string, Tile[]> = { title: [], play: [], cruise: [] };
  const crops: Tile[] = [];
  for (const z of zones) {
    await warpTo(page, z.chunk);
    const st = await step(page, 90);
    const img = await shot(page);
    sheets['title']!.push({ img: downscale(img, 3), label: label(z, 'DEMO', st) });
  }
  const l = await launch(page);
  console.log(`play: data-mv-mode ${l.before} -> ${l.after} on a real click`);
  expect(l.before).toBe('demo');
  expect(l.after).toBe('play');
  const modes: string[] = [];
  for (const z of zones) {
    await page.mouse.move(mouseX(0, 1920), 650);
    await warpTo(page, z.chunk);
    const st = await step(page, 90);
    const m = await mode(page);
    modes.push(m);
    const img = await shot(page);
    sheets['play']!.push({ img: downscale(img, 3), label: label(z, `PLAY (${m})`, st) });
    if (process.env['TERRAIN_DIAG_UI'] === '1') {
      // A24, DI-107's check: where the camera really is at each PLAY shot, and, on Toxic Arcade, which layer draws the slab at the
      // right: the same frame redrawn at dt 1e-6 (no sim step) with all layers, props hidden and fx hidden. Diagnostic only.
      const where = await page.evaluate(() => { const s = window.__mvE2e!.sim; return { chunk: s.travel.chunk, local: s.travel.local, tick: s.tick, x: s.x, y: s.y, speed: s.speed, cam: window.__mvE2e!.camera() }; });
      console.log(`diag-ui ${PALETTE_NAMES[z.palette]}: ${JSON.stringify(where)}`);
      if (z.palette === 3) {
        writePng(roundFile('diag-ui-p3-shot.png'), img);
        for (const [name, hide] of [['all', null], ['noprops', 'props'], ['nofx', 'fx'], ['noterrain', 'terrain']] as const) {
          await page.evaluate((l) => { if (l) window.__mv!.setLayerVisible(l, false); window.__mv!.stepFrames(1, 1e-6); }, hide);
          writePng(roundFile(`diag-ui-p3-${name}.png`), await shot(page));
          await page.evaluate((l) => { if (l) window.__mv!.setLayerVisible(l, true); }, hide);
        }
      }
    }
    // 1:1 crops for legibility: the HUD's top band and bottom band.
    crops.push({ img: crop(img, { x0: 0, y0: 0, x1: 1920, y1: 120 }), label: `${PALETTE_NAMES[z.palette]} top band 1:1` });
    crops.push({ img: crop(img, { x0: 0, y0: 960, x1: 1920, y1: 1080 }), label: `${PALETTE_NAMES[z.palette]} bottom band 1:1` });
  }
  await page.keyboard.press('Escape');
  for (const z of zones) {
    await warpTo(page, z.chunk);
    const st = await step(page, 60);
    const img = await shot(page);
    sheets['cruise']!.push({ img: downscale(img, 3), label: label(z, `CRUISE (${await mode(page)})`, st) });
  }
  await page.keyboard.press('Escape');
  for (const k of ['title', 'play', 'cruise']) {
    const path = roundFile(`ui-${k}${TAG}.png`);
    await writeSheet(browser, sheets[k]!, { cols: 3, tileW: 640, tileH: 360, path, title: `ui-${k} ${roundName()} seed ${SEED}: each palette's first zone, page.screenshot with the UI` });
    expect(checkImage(path).ok, path).toBe(true);
  }
  const cpath = roundFile(`ui-hud-crops${TAG}.png`);
  await writeSheet(browser, crops, { cols: 1, tileW: 1920, tileH: 120, path: cpath, title: `ui-hud-crops ${roundName()}: PLAY, top and bottom 120 rows at 1:1, six palettes` });
  console.log(`play: modes at the PLAY shots ${modes.join(', ')}`);
});

test('ship: x = -40, 0 and +40 at 16:9 on each palette (DI-96)', async ({ page, browser }, info) => {
  test.setTimeout(600_000);
  const zones = firstZones(buildCombos(SEED));
  await openHarness(page, info, { seed: SEED, tier: 3, period: 0 });
  const l = await launch(page);
  expect(l.after).toBe('play');
  const tiles: Tile[] = [];
  const near: Tile[] = [];
  const at: Record<string, unknown>[] = [];
  for (const z of zones) {
    await warpTo(page, z.chunk);
    for (const x of [-40, 0, 40]) {
      await page.mouse.move(mouseX(x, 1920), 650);
      let st = await step(page, 150);
      // A shot must show the ship at rest at its target, in PLAY, with no hit flash: after a hit or a SIGNAL_LOST, step
      // 20 frames at a time until 20 frames pass in PLAY with no shield change and the ship within 2 u of the target.
      for (let k = 0, quiet = false; k < 15 && !(quiet && st.mode === 1 && Math.abs(st.x - x) < 2); k++) {
        const before = st.shields;
        st = await step(page, 20);
        quiet = st.shields === before;
      }
      const img = await shot(page);
      at.push({ palette: z.palette, target: x, x: st.x, shields: st.shields, mode: st.mode });
      tiles.push({ img: downscale(img, 3), label: `${PALETTE_NAMES[z.palette]} / ${BIOME_NAMES[z.biome]}: target ${x}, ship x ${st.x.toFixed(1)}` });
      if (z.palette === 0 || z.palette === 2) {
        // 1:1 around where the ship should sit: the lower middle band, 640 x 360, centred on the follow's screen offset.
        const cx = Math.round(960 + (x / 40) * 0.62 * 960);
        const x0 = Math.max(0, Math.min(1920 - 640, cx - 320));
        near.push({ img: crop(img, { x0, y0: 420, x1: x0 + 640, y1: 780 }), label: `${PALETTE_NAMES[z.palette]} 1:1 crop x ${x0}..${x0 + 640}, rows 420..780, ship x ${st.x.toFixed(1)}` });
      }
    }
  }
  for (const [k, slice] of [['1', tiles.slice(0, 9)], ['2', tiles.slice(9)]] as const) {
    const path = roundFile(`ship-${k}${TAG}.png`);
    await writeSheet(browser, slice, { cols: 3, tileW: 640, tileH: 360, path, title: `ship-${k} ${roundName()} seed ${SEED}: rows palette, columns target x -40, 0, +40, PLAY, 16:9` });
    expect(checkImage(path).ok, path).toBe(true);
  }
  await writeSheet(browser, near, { cols: 3, tileW: 640, tileH: 360, path: roundFile(`ship-near${TAG}.png`), title: `ship-near ${roundName()}: 1:1 crops, Sunset Drive and Ultraviolet` });
  console.log(`ship: ${JSON.stringify(at)}`);
});

test('flash: the peak hit frame, flash .6 with glitch 1, on every pair tile', async ({ page, browser }, info) => {
  test.setTimeout(600_000);
  const combos = buildCombos(SEED);
  await openHarness(page, info, { seed: SEED, tier: 3, period: 0 });
  const w1: { v: number; at: string }[] = [], w1g: { v: number; at: string }[] = [], w2: { v: number; at: string }[] = [], w5: { v: number; at: string }[] = [], c1: { v: number; at: string }[] = [];
  const tiles: Tile[] = [];
  for (const pair of combos.pairs) {
    const s = pair.tile;
    await goto(page, s);
    const where = `${PALETTE_NAMES[pair.palette]} / ${BIOME_NAMES[pair.biome]} ${s.id}`;
    const f = await frame(page, s, { post: 'full', feel: { flash: 0.6 } });
    const g = await frame(page, s, { post: 'full', feel: { flash: 0.6, glitch: 1 } });
    w1.push({ v: nearWhitePct(f.w, f.h, f.rgba), at: where });
    w1g.push({ v: nearWhitePct(g.w, g.h, g.rgba), at: where });
    w2.push({ v: meanChroma(f.w, f.h, f.rgba), at: where });
    w5.push({ v: litSaturation(f.w, f.h, f.rgba), at: where });
    c1.push({ v: clippedPct(f.w, f.h, f.rgba), at: where });
    if (pair.biome === 0 || pair.biome === 4) tiles.push({ img: downscale(pair.biome === 0 ? f : g, 3), label: `${where} flash .6${pair.biome === 4 ? ' + glitch 1' : ''}` });
  }
  const rows: GateRow[] = [
    gateRow('W1flash', LIMITS.hitNearWhite, w1, 'flash .6, the peak hit frame; transient limit (plan M7)'),
    gateRow('W1flashGl', LIMITS.hitNearWhite, w1g, 'flash .6 and glitch 1'),
    gateRow('W2flash', { ...LIMITS.W2, reportOnly: true }, w2, 'report-only while flash is above 0 (plan M7)'),
    gateRow('W5flash', LIMITS.W5, w5),
    gateRow('C1flash', { ...LIMITS.C1, reportOnly: true }, c1, 'printed'),
  ];
  writeSpecResults(`flash${TAG}`, { seed: SEED }, rows);
  for (const [k, slice] of [['1', tiles.slice(0, 6)], ['2', tiles.slice(6)]] as const) {
    const path = roundFile(`flash-${k}${TAG}.png`);
    await writeSheet(browser, slice, { cols: 3, tileW: 640, tileH: 360, path, title: `flash-${k} ${roundName()}: forceFeel flash .6 (Boulevard tiles) and flash .6 + glitch 1 (Orbital Night tiles)` });
  }
  for (const r of rows) if (!r.reportOnly) expect.soft(r.pass, `${r.gate} ${r.value} at ${r.worst}`).toBe(true);
});

interface BoostSample { f: number; sinceHit: number; flash: number; flashColor: [number, number, number]; glitch: number; mode: number; speed: number; x: number; shields: number; nearWhite: number; chroma: number; litSat: number; floorBlack: number }

test('boost with hits: 40 s of PLAY holding boost, steering into hazards, metrics every 6 frames', async ({ page, browser }, info) => {
  test.setTimeout(900_000);
  const zones = firstZones(buildCombos(SEED));
  await openHarness(page, info, { seed: SEED, tier: 3, period: 0 });
  await warpTo(page, zones[0]!.chunk);
  await step(page, 30);
  const l = await launch(page);
  expect(l.after).toBe('play');
  await page.keyboard.down('Space');
  // In-page state: metrics, hazard steering, and three stash canvases for the worst frames.
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const stash = (): HTMLCanvasElement => { const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; return c; };
    w['__artBoost'] = { f: 0, lastHit: -1e9, shields: window.__mvE2e!.sim.shields, hits: 0, stash: { flash: stash(), glitch: stash(), boost: stash(), lost: stash(), floor: stash(), shard: stash(), floor0: stash() }, worst: { flash: -1, glitch: 1e9, boost: 1e9, lost: 1e9, floor: -1, shard: -1, floor0: -1 }, worstAt: { flash: -1, glitch: -1, boost: -1, lost: -1, floor: -1, shard: -1, floor0: -1 } };
  });
  const samples: BoostSample[] = [];
  const FRAMES = 2400;
  let launches = 1;
  while (samples.length === 0 || samples[samples.length - 1]!.f < FRAMES) {
    const r = await page.evaluate(() => {
      const mv = window.__mv!;
      const h = window.__mvE2e!;
      const b = (window as unknown as { __artBoost: { f: number; lastHit: number; shields: number; hits: number; stash: Record<string, HTMLCanvasElement>; worst: Record<string, number>; worstAt: Record<string, number> } }).__artBoost;
      // Step until 6 frames have run, or stop on the frame of a hit, so the flash's peak frame is the one measured.
      let n = 0;
      let hit = false;
      while (n < 6) {
        mv.stepFrames(1, 1 / 60);
        n++; b.f++;
        if (h.sim.shields < b.shields) { hit = true; b.hits++; b.lastHit = b.f; }
        b.shields = h.sim.shields;
        if (hit) break;
        if (b.f - b.lastHit <= 12) break;   // every frame of a flash and glitch
      }
      const px = mv.pixels();
      const W = 1920, H = 1080;
      let nw = 0, ch = 0, ls = 0, lsn = 0;
      const hist = new Uint32Array(256);
      for (let i = 0, p = 0; i < px.length; i += 4, p++) {
        const r = px[i]!, g = px[i + 1]!, bl = px[i + 2]!;
        const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
        if (mn > 235) nw++;
        ch += mx - mn;
        if (mx >= 32) { ls += (mx - mn) / mx; lsn++; }
        const row = Math.floor(p / W);   // bottom-up: rows 0..467 are rows 612..1079 top-down
        if (row < H - 612) hist[Math.round(0.2126 * r + 0.7152 * g + 0.0722 * bl)]!++;
      }
      let tot = 0; for (let k = 0; k < 256; k++) tot += hist[k]!;
      let acc = 0, fb = 0; for (let k = 0; k < 256; k++) { acc += hist[k]!; if (acc >= 0.25 * tot) { fb = k; break; } }
      const m = { nearWhite: (100 * nw) / (W * H), chroma: ch / (W * H), litSat: lsn ? ls / lsn : 0, floorBlack: fb };
      const since = b.f - b.lastHit;
      // The frame's own flash and glitch, read from T06's Crt uniforms (post.debug, read-only), so a gate's or a shard's flash
      // counts as flash too: chroma is report-only while flash is above 0 (plan M7).
      const crt = (h.host.post as unknown as { debug?: { crt?: { uniforms?: Map<string, { value: number }> } } }).debug?.crt;
      const flash = crt?.uniforms?.get('uFlash')?.value ?? -1;
      const glitch = crt?.uniforms?.get('uGlitch')?.value ?? -1;
      // A24: the flash colour too, so W4's allowance comes from the frame's own uFlash and uFlashColor through T06's formula.
      const fc = (crt?.uniforms?.get('uFlashColor') as unknown as { value?: { x: number; y: number; z: number } } | undefined)?.value;
      const flashColor: [number, number, number] = fc ? [fc.x, fc.y, fc.z] : [-1, -1, -1];
      const keep = (k: string, v: number, worse: (a: number, c: number) => boolean): void => {
        if (worse(v, b.worst[k]!)) { b.worst[k] = v; b.worstAt[k] = b.f; b.stash[k]!.getContext('2d')!.drawImage(h.host.ctx.renderer.domElement, 0, 0); }
      };
      // Windows fixed before the second run (Decision log, M7): a hit's flash is above 1e-3 for 46 frames (FLASH_TAU .12 s from
      // .6), its glitch for 12; SIGNAL_LOST holds glitch at .35 by design. Everything else is a clean PLAY frame.
      const lost = h.sim.mode === 3;
      const quiet = flash === 0 && glitch === 0;
      // A24: SIGNAL_LOST by mode, whatever the hit window; shard and gate flashes outside a hit window get their own stash.
      if (since <= 1) keep('flash', m.nearWhite + 0.001 * (1 - m.litSat), (a, c) => a > c);
      else if (lost) keep('lost', m.chroma, (a, c) => a < c);
      else if (since <= 12) keep('glitch', m.chroma, (a, c) => a < c);
      else if (since > 46 && quiet) { keep('floor', m.floorBlack, (a, c) => a > c); if (h.sim.speed > 100) keep('boost', m.chroma, (a, c) => a < c); }
      else if (since > 46) { keep('shard', m.floorBlack, (a, c) => a > c); if (flash < 0.002 && glitch === 0) keep('floor0', m.floorBlack, (a, c) => a > c); }
      // Steering: the nearest spike or fence 25 to 160 u ahead; a spike's x, or the solid part of a fence.
      const world = h.host.ctx.world;
      const row = { chunk: 0, data: new Float32Array(8 * 32), count: 0 };
      const plane = h.sim.travel.chunk * 64 + h.sim.travel.local + 14;
      let best: { d: number; x: number } | null = null;
      for (let c = h.sim.travel.chunk; c < h.sim.travel.chunk + 4; c++) {
        world.fillItems(c, row);
        for (let i = 0; i < row.count; i++) {
          const o = i * 8;
          const kind = row.data[o]!;
          if (kind !== 2 && kind !== 3) continue;
          const d = c * 64 + row.data[o + 3]! - plane;
          if (d < 25 || d > 160 || (best && d >= best.d)) continue;
          let x = row.data[o + 1]!;
          if (kind === 3) {
            const rad = row.data[o + 4]!, a = row.data[o + 5]!, gap = row.data[o + 6]!;
            const lo = Math.max(-38, x - rad + 2), hi = Math.min(38, x + rad - 2);
            x = Math.abs(lo - a) > gap + 3 ? lo : Math.abs(hi - a) > gap + 3 ? hi : (lo + hi) / 2;
          }
          best = { d, x };
        }
      }
      return { f: b.f, sinceHit: since, flash, flashColor, glitch, hits: b.hits, mode: h.sim.mode, speed: h.sim.speed, x: h.sim.x, shields: h.sim.shields, target: best ? best.x : 0, view: document.documentElement.dataset['mvMode'] ?? '', ...m };
    });
    if (r.flash < 0 || r.glitch < 0 || r.flashColor[0] < 0) throw new Error('boost: Crt uFlash, uFlashColor or uGlitch not found on host.post.debug.crt');
    samples.push({ f: r.f, sinceHit: r.sinceHit, flash: r.flash, flashColor: r.flashColor, glitch: r.glitch, mode: r.mode, speed: r.speed, x: r.x, shields: r.shields, nearWhite: r.nearWhite, chroma: r.chroma, litSat: r.litSat, floorBlack: r.floorBlack });
    await page.mouse.move(mouseX(Math.max(-40, Math.min(40, r.target)), 1920), 650);
    if (r.view === 'demo') {
      // A SIGNAL_LOST can end in DEMO: launch again with a real click, so the run stays in PLAY.
      await page.keyboard.up('Space');
      await launch(page);
      launches++;
      await page.keyboard.down('Space');
    }
  }
  await page.keyboard.up('Space');
  const out = await page.evaluate(() => {
    const b = (window as unknown as { __artBoost: { hits: number; stash: Record<string, HTMLCanvasElement>; worst: Record<string, number>; worstAt: Record<string, number> } }).__artBoost;
    const uri: Record<string, string> = {};
    for (const k of ['flash', 'glitch', 'boost', 'lost', 'floor', 'shard', 'floor0']) if (b.worstAt[k]! >= 0) uri[k] = b.stash[k]!.toDataURL('image/png');
    return { hits: b.hits, worst: b.worst, worstAt: b.worstAt, uri };
  });
  const hitFrames = samples.filter((s) => s.sinceHit <= 1);
  // Classes, A24 (Decision log; the independent reviewer refused M7's form): SIGNAL_LOST by mode, whatever the hit window. Hit: a
  // hit 46 frames or less behind (FLASH_TAU .12 s from .6), not lost. Shard: a shard's or a gate's flash or glitch outside a hit
  // window. Clean: neither. Fixed before this run's frames were seen.
  const lostFrames = samples.filter((s) => s.mode === 3);
  const hitWindow = samples.filter((s) => s.mode !== 3 && s.sinceHit <= 46);
  const shardFrames = samples.filter((s) => s.mode !== 3 && s.sinceHit > 46 && (s.flash > 0 || s.glitch > 0));
  const rest = samples.filter((s) => s.mode !== 3 && s.sinceHit > 46 && s.flash === 0 && s.glitch === 0);
  // W4 by allowance: on every frame without a glitch band swap, floor black may exceed 13 by no more than T06's flash formula adds
  // at that frame's own uFlash and uFlashColor (flashFloorAllowance; 13 exactly at flash 0). Glitch frames are printed: a band
  // swap's effect on the 25th percentile depends on which rows swap, not on the uniform.
  const noGlitch = samples.filter((s) => s.glitch === 0);
  const glitchFrames = samples.filter((s) => s.glitch > 0);
  const allow = new Map<BoostSample, number>(noGlitch.map((s) => [s, flashFloorAllowance(s.flash, s.flashColor, LIMITS.W4.value)]));
  const cls = (s: BoostSample): string => (s.mode === 3 ? 'lost' : s.sinceHit <= 46 ? `${s.sinceHit} after a hit` : s.flash > 0 || s.glitch > 0 ? 'shard or gate flash' : 'clean');
  console.log(`boost: classes (A24) lost ${lostFrames.length}, hit window ${hitWindow.length}, shard or gate flash ${shardFrames.length}, clean ${rest.length}; glitch-free ${noGlitch.length}, glitch ${glitchFrames.length}`);
  console.log(`boost: ${samples.length} samples over ${FRAMES} frames, ${out.hits} hits, ${launches} launches; worst frames at ${JSON.stringify(out.worstAt)}`);
  // Real-path controls, printed: an image-space lift .08 (floor black .92 v + 20.4) against each glitch-free frame's allowance,
  // and a desaturation .4 (chroma .6 v) against 55 on each W2-gated frame. failing counts the frames where the control is caught.
  const w2Gated = [...rest, ...shardFrames];
  const rows: GateRow[] = [
    gateRow('W1hit', LIMITS.hitNearWhite, hitWindow.map((s) => ({ v: s.nearWhite, at: `frame ${s.f}, ${cls(s)}` })), 'hit transients only (plan M7)'),
    gateRow('W1shard', LIMITS.W1, shardFrames.map((s) => ({ v: s.nearWhite, at: `frame ${s.f}, flash ${s.flash.toFixed(3)}` })), 'shard and gate flashes outside a hit window: the clean limit, not the hit allowance (A24)'),
    gateRow('W1play', LIMITS.W1, rest.map((s) => ({ v: s.nearWhite, at: `frame ${s.f}, speed ${s.speed.toFixed(0)}` }))),
    gateRow('W1lost', LIMITS.W1, lostFrames.map((s) => ({ v: s.nearWhite, at: `frame ${s.f}, SIGNAL_LOST, ${s.sinceHit} after a hit` }))),
    gateRow('W4allow', { value: 0, dir: 'max' }, noGlitch.map((s) => ({ v: s.floorBlack - allow.get(s)!, at: `frame ${s.f}, ${cls(s)}, flash ${s.flash.toFixed(3)}, floor black ${s.floorBlack} against ${allow.get(s)!.toFixed(2)}` })), "floor black minus its allowance through T06's flash formula at the frame's own uFlash; every glitch-free frame (A24)"),
    gateRow('W4play', LIMITS.W4, rest.map((s) => ({ v: s.floorBlack, at: `frame ${s.f}` }))),
    gateRow('W4glitch', { ...LIMITS.W4, reportOnly: true }, glitchFrames.map((s) => ({ v: s.floorBlack, at: `frame ${s.f}, ${cls(s)}, glitch ${s.glitch.toFixed(3)}` })), "printed: a band swap's effect on the percentile depends on which rows swap"),
    gateRow('W2play', LIMITS.W2, rest.map((s) => ({ v: s.chroma, at: `frame ${s.f}, speed ${s.speed.toFixed(0)}` }))),
    gateRow('W2shard', LIMITS.W2, shardFrames.map((s) => ({ v: s.chroma, at: `frame ${s.f}, flash ${s.flash.toFixed(3)}` })), 'shard and gate flashes outside a hit window, at 55 (A24)'),
    // A24, after the first a24 run: every SIGNAL_LOST frame carried a flash (min 1.4e-4), so the permutation argument for gating W2
    // on SIGNAL_LOST frames with flash 0 had no subject (n = 0, NaN). Printed, with the class's frames (Decision log, A24).
    gateRow('W2lost', { ...LIMITS.W2, reportOnly: true }, lostFrames.map((s) => ({ v: s.chroma, at: `frame ${s.f}, SIGNAL_LOST, flash ${s.flash.toFixed(4)}` })), 'printed: every SIGNAL_LOST frame here carries a flash, so no frame qualifies for the glitch-only W2 gate (A24)'),
    gateRow('W2hit', { ...LIMITS.W2, reportOnly: true }, hitWindow.map((s) => ({ v: s.chroma, at: `frame ${s.f}, ${cls(s)}, flash ${s.flash.toFixed(3)}` })), "printed while a hit's flash is above 0 (plan M7)"),
    gateRow('W5hit', LIMITS.W5, hitFrames.map((s) => ({ v: s.litSat, at: `frame ${s.f}, the hit's frame` }))),
    gateRow('W5play', LIMITS.W5, rest.map((s) => ({ v: s.litSat, at: `frame ${s.f}` }))),
    gateRow('ctlLiftW4', { value: 0, dir: 'max', reportOnly: true }, noGlitch.map((s) => ({ v: 0.92 * s.floorBlack + 20.4 - allow.get(s)!, at: `frame ${s.f}, ${cls(s)}, flash ${s.flash.toFixed(3)}` })), 'control: lift .08 against W4allow; failing = frames where it is caught'),
    gateRow('ctlDesatW2', { value: LIMITS.W2.value, dir: 'min', reportOnly: true }, w2Gated.map((s) => ({ v: 0.6 * s.chroma, at: `frame ${s.f}, ${cls(s)}` })), 'control: desat .4 against 55 on W2-gated frames; failing = frames where it is caught'),
  ];
  writeSpecResults(`boost${TAG}`, { seed: SEED, hits: out.hits, launches, worstAt: out.worstAt, samples }, rows);
  const tiles: Tile[] = [];
  for (const k of ['flash', 'glitch', 'boost', 'lost', 'floor', 'shard', 'floor0']) {
    const u = out.uri[k];
    if (!u) continue;
    const png = decodePng(Buffer.from(u.split(',')[1]!, 'base64'));
    const path = roundFile(`worst-${k}${TAG}.png`);
    writePng(path, { w: png.w, h: png.h, rgba: png.rgba });
    tiles.push({ img: downscale({ w: png.w, h: png.h, rgba: png.rgba }, 3), label: `worst ${k}, frame ${out.worstAt[k]}` });
  }
  if (tiles.length) await writeSheet(browser, tiles, { cols: 3, tileW: 640, tileH: 360, path: roundFile(`boost-worst${TAG}.png`), title: `boost-worst ${roundName()}: worst flash (near-white), glitch, boost, SIGNAL_LOST (chroma), clean floor-black, shard-flash floor-black and near-zero-flash (under .002) floor-black frames, canvas only` });
  expect(out.hits, 'the run must contain hits, or the flash rows test nothing').toBeGreaterThan(0);
  for (const r of rows) if (!r.reportOnly) expect.soft(r.pass, `${r.gate} ${r.value} at ${r.worst}`).toBe(true);
});
