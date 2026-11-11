// M3 and M7: looking at the integrated build. Gated by MV_VIEW=1 so test:smoke stays quick. Output under the run's
// --output folder; every image path is printed as SCREENSHOT <path>.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright/test';
import { DEFAULT_SEED, ZONE_CHUNKS } from '../../src/contracts/index';
import { findZoneChunk } from '../../src/world/zones';
import { expect, test } from '../support/pw';
import { loseContext, nodeWait, openApp, restoreContext } from './lib/app';
import { measureDisc, readPng, saveContactSheet, slitScan, startScreencast, writeFlipbook, writeImage, type SheetTile } from './lib/view';

const VIEW = process.env['MV_VIEW'] === '1';
const HIDE_UI = '#mv-ui, .mv-ui { visibility: hidden !important; }';

async function shot(page: Page, path: string): Promise<Buffer> {
  const png = await page.screenshot();
  writeImage(path, png);
  return png;
}

test.describe('first light', () => {
  test.skip(!VIEW, 'MV_VIEW=1 only');

  test('first light: title at 5 s, world at 5 s, world 60 s later; disc and horizon match the poster (A11)', async ({ page, browser }, info) => {
    test.skip(info.project.name !== 'gpu', 'gpu only');
    test.setTimeout(180_000);
    const dir = info.outputPath('first');
    mkdirSync(dir, { recursive: true });

    // The poster, as an unsupported client sees it, at the same size.
    const nojs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1920, height: 1080 } });
    const pp = await nojs.newPage();
    await pp.goto('/');
    const posterPng = await shot(pp, `${dir}/poster.png`);
    const posterRects = await pp.evaluate(() => {
      const sun = document.querySelector('#mv-poster .sun')!.getBoundingClientRect();
      const floor = document.querySelector('#mv-poster .floor')!.getBoundingClientRect();
      return { sunTop: sun.top, sunCentreY: sun.top + sun.height / 2, sunRadius: sun.height / 2, horizon: floor.top };
    });
    await nojs.close();

    await openApp(page);
    await page.waitForTimeout(5000);
    await shot(page, `${dir}/title_5s.png`);
    await page.addStyleTag({ content: HIDE_UI });
    await shot(page, `${dir}/world_5s.png`);
    await page.waitForTimeout(60_000);
    await shot(page, `${dir}/world_65s.png`);

    // A11 on the world: the same frame geometry with one layer at a time, post off, no bend, Sunset Drive's banded sun.
    const at = await page.evaluate(() => {
      const mv = window.__mv!;
      mv.manual(true);
      const s = mv.stats();
      return { chunk: s.chunk, local: s.local, tick: s.tick };
    });
    const render = async (only: 'sky' | 'terrain'): Promise<Buffer> => {
      await page.evaluate(({ only, at }) => {
        const mv = window.__mv!;
        for (const n of ['sky', 'terrain', 'props', 'fx'] as const) mv.setLayerVisible(n, n === only);
        mv.setPost('off');
        mv.forceBend(0, 0);
        mv.forceZone(0, 0, 0);
        mv.renderAt(at.chunk, at.local, at.tick);
        mv.renderAt(at.chunk, at.local, at.tick);
      }, { only, at });
      return page.screenshot();
    };
    const skyPng = await render('sky');
    writeImage(`${dir}/a11_sky_only.png`, skyPng);
    const terrainPng = await render('terrain');
    writeImage(`${dir}/a11_terrain_only.png`, terrainPng);
    await page.evaluate(() => {
      const mv = window.__mv!;
      for (const n of ['sky', 'terrain', 'props', 'fx'] as const) mv.setLayerVisible(n, true);
      mv.forceZone(0, 0, 0);
      mv.forceBend(0, 0);
      mv.setPost('full');
    });

    const poster = readPng(posterPng);
    const sky = readPng(skyPng);
    const terrain = readPng(terrainPng);
    const posterDisc = measureDisc(poster.px, poster.w, poster.h, 589);
    const worldDisc = measureDisc(sky.px, sky.w, sky.h, 589);
    // The poster's horizon: the largest one-row drop in red at x = 100 within 40 px of 54.5vh, where the sky's pink
    // meets the floor. The DOM rect is printed beside it as a cross-check.
    let posterHorizon = -1;
    let drop = 0;
    for (let y = 549; y < 629; y++) {
      const a = poster.px[(y * poster.w + 100) * 4]!;
      const b = poster.px[((y + 1) * poster.w + 100) * 4]!;
      if (a - b > drop) { drop = a - b; posterHorizon = y + 1; }
    }
    // The world's horizon: the first lit row of the terrain alone at the centre column, cleared to black.
    let worldHorizon = -1;
    for (let y = 300; y < 800; y++) {
      const i = (y * terrain.w + Math.floor(terrain.w / 2)) * 4;
      if (terrain.px[i]! + terrain.px[i + 1]! + terrain.px[i + 2]! > 15) { worldHorizon = y; break; }
    }
    const a11 = { posterRects, posterDisc, worldDisc, posterHorizon, worldHorizon };
    console.log(`A11 ${JSON.stringify(a11)}`);
    expect(posterDisc).not.toBeNull();
    expect(worldDisc).not.toBeNull();
    expect(Math.abs(posterDisc!.top - worldDisc!.top)).toBeLessThanOrEqual(4);
    expect(Math.abs(posterDisc!.centreY - worldDisc!.centreY)).toBeLessThanOrEqual(4);
    expect(Math.abs(posterDisc!.radius - worldDisc!.radius)).toBeLessThanOrEqual(4);
    expect(Math.abs(posterDisc!.centreX - worldDisc!.centreX)).toBeLessThanOrEqual(4);
    expect(Math.abs(posterHorizon - posterRects.horizon)).toBeLessThanOrEqual(2);
    expect(Math.abs(posterHorizon - worldHorizon)).toBeLessThanOrEqual(4);
  });
});

// ---- M7: viewing it in motion and as stills ----

/** A filmstrip in one page task per frame: runFrame(1/60) then drawImage(canvas) into the sheet (section 11.3's same-task rule). */
async function filmstrip(page: Page, o: { skip: number; frames: number; every: number; label: string }): Promise<string> {
  return page.evaluate((q) => {
    const h = window.__mvE2e!;
    const host = h.host;
    const canvas = host.ctx.renderer.domElement;
    host.setManual(true);
    for (let f = 0; f < q.skip; f++) host.runFrame(1 / 60);
    const n = Math.ceil(q.frames / q.every);
    const cols = 4;
    const tw = 480;
    const th = 270;
    const sheet = document.createElement('canvas');
    sheet.width = cols * tw;
    sheet.height = Math.ceil(n / cols) * (th + 18);
    const g = sheet.getContext('2d')!;
    g.fillStyle = '#111';
    g.fillRect(0, 0, sheet.width, sheet.height);
    g.font = '13px monospace';
    let k = 0;
    for (let f = 0; f < q.frames; f++) {
      host.runFrame(1 / 60);
      if (f % q.every !== 0) continue;
      const x = (k % cols) * tw;
      const y = Math.floor(k / cols) * (th + 18);
      g.drawImage(canvas, x, y, tw, th);
      g.fillStyle = '#eee';
      g.fillText(`${q.label} f${q.skip + f} tick ${h.sim.tick} x ${h.sim.x.toFixed(1)} shields ${h.sim.shields} score ${h.sim.score}`, x + 4, y + th + 13);
      k++;
    }
    host.setManual(false);
    return sheet.toDataURL('image/jpeg', 0.9).split(',')[1]!;
  }, o);
}

/**
 * The frame of a hit: one runFrame per frame into a ring of 24 thumbnails, each drawn in the render's task, stopping 12
 * frames after shields drop, then every second frame of the ring as a 12-tile sheet, so the hit sits in the middle.
 */
async function hitStrip(page: Page, maxFrames: number): Promise<string> {
  return page.evaluate((max) => {
    const h = window.__mvE2e!;
    const host = h.host;
    const canvas = host.ctx.renderer.domElement;
    const tw = 480;
    const th = 270;
    const ring = Array.from({ length: 24 }, () => { const c = document.createElement('canvas'); c.width = tw; c.height = th; return c; });
    const labels: string[] = new Array<string>(24).fill('');
    host.setManual(true);
    let hitAt = -1;
    let f = 0;
    let shields = h.sim.shields;
    for (; f < max; f++) {
      host.runFrame(1 / 60);
      const slot = f % 24;
      ring[slot]!.getContext('2d')!.drawImage(canvas, 0, 0, tw, th);
      if (hitAt < 0 && h.sim.shields < shields) hitAt = f;
      shields = h.sim.shields;
      labels[slot] = `hit f${f}${f === hitAt ? ' HIT' : ''} x ${h.sim.x.toFixed(1)} shields ${h.sim.shields}`;
      if (hitAt >= 0 && f >= hitAt + 12) break;
    }
    host.setManual(false);
    const sheet = document.createElement('canvas');
    sheet.width = 4 * tw;
    sheet.height = 3 * (th + 18);
    const g = sheet.getContext('2d')!;
    g.fillStyle = '#111';
    g.fillRect(0, 0, sheet.width, sheet.height);
    g.font = '13px monospace';
    for (let k = 0; k < 12; k++) {
      const frame = f - 23 + 2 * k;
      const slot = ((frame % 24) + 24) % 24;
      const x = (k % 4) * tw;
      const y = Math.floor(k / 4) * (th + 18);
      g.drawImage(ring[slot]!, x, y);
      g.fillStyle = '#eee';
      g.fillText(`${labels[slot]}${hitAt < 0 ? ' (no hit)' : ''}`, x + 4, y + th + 13);
    }
    return sheet.toDataURL('image/jpeg', 0.9).split(',')[1]!;
  }, maxFrames);
}

/** The next item of a kind ahead of the ship plane: its absolute z less the plane's, frames to it at 1/60 s, and its fields. */
async function nextItem(page: Page, kind: number, minAhead: number): Promise<{ d: number; frames: number; x: number; radius: number; a: number; b: number } | null> {
  return page.evaluate(({ kind, minAhead }) => {
    const h = window.__mvE2e!;
    const world = h.host.ctx.world;
    const row = { chunk: 0, data: new Float32Array(8 * 32), count: 0 };
    const plane = h.sim.travel.chunk * 64 + h.sim.travel.local + 14;
    let best: { d: number; x: number; radius: number; a: number; b: number } | null = null;
    for (let c = h.sim.travel.chunk - 2; c < h.sim.travel.chunk + 40; c++) {
      world.fillItems(c, row);
      for (let i = 0; i < row.count; i++) {
        const o = i * 8;
        if (row.data[o] !== kind) continue;
        if (kind === 1 && row.data[o + 5] !== 0) continue;
        const d = c * 64 + row.data[o + 3]! - plane;
        if (d >= minAhead && (!best || d < best.d)) best = { d, x: row.data[o + 1]!, radius: row.data[o + 4]!, a: row.data[o + 5]!, b: row.data[o + 6]! };
      }
    }
    return best ? { ...best, frames: best.d / (h.sim.speed / 60) } : null;
  }, { kind, minAhead });
}

/** One image per slit-scan run for viewing: both columns side by side, the row image scaled under them. */
async function compositeSlit(browser: Browser, files: { row: string; colA: string; colB: string }, out: string, label: string): Promise<string> {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await ctx.newPage();
  const b64 = await page.evaluate(async (q) => {
    const load = async (s: string): Promise<ImageBitmap> => createImageBitmap(await (await fetch(`data:image/png;base64,${s}`)).blob());
    const a = await load(q.a);
    const b = await load(q.b);
    const r = await load(q.r);
    const W = a.width + b.width + 20;
    const rowH = Math.round((r.height * W) / r.width);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = a.height + rowH + 50;
    const g = c.getContext('2d')!;
    g.fillStyle = '#222';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(a, 0, 0);
    g.drawImage(b, a.width + 20, 0);
    g.drawImage(r, 0, a.height + 30, W, rowH);
    g.fillStyle = '#fff';
    g.font = '16px monospace';
    g.fillText(`${q.label}: columns 760 | 1160 (time runs right); row 640 below (time runs down)`, 4, a.height + 20);
    return c.toDataURL('image/png').split(',')[1]!;
  }, { a: readFileSync(files.colA).toString('base64'), b: readFileSync(files.colB).toString('base64'), r: readFileSync(files.row).toString('base64'), label });
  await ctx.close();
  return writeImage(out, b64);
}

test.describe('M7', () => {
  test.skip(!VIEW, 'MV_VIEW=1 only');
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'gpu', 'gpu only'); });

  test('V1 session: about 60 s real time, screencast, flipbook, contact sheet, rAF delta trace', async ({ page, browser }, info) => {
    test.setTimeout(300_000);
    const dir = info.outputPath('session');
    const cast = join(dir, 'cast');
    mkdirSync(cast, { recursive: true });
    await openApp(page, '&period=0');
    await page.evaluate(() => {
      const w = window as unknown as { __deltas: number[]; __t0: number };
      w.__deltas = [];
      w.__t0 = performance.now();
      let last = -1;
      (function rec(t: number) {
        if (last >= 0) w.__deltas.push(t - last, t - w.__t0);
        last = t;
        requestAnimationFrame(rec);
      })(performance.now());
    });
    const sc = await startScreencast(page, cast);
    const t0 = Date.now();
    const at = async (s: number): Promise<void> => { const wait = t0 + s * 1000 - Date.now(); if (wait > 0) await nodeWait(wait); };
    const events: string[] = [];
    const mark = (e: string): void => { events.push(`${((Date.now() - t0) / 1000).toFixed(1)} s ${e}`); };
    mark('DEMO, untouched');
    await at(10);
    await page.mouse.click(960, 700);
    mark('click: launch');
    for (let k = 0; k < 13; k++) {
      const key = k % 2 === 0 ? 'KeyA' : 'KeyD';
      if (k === 2 || k === 8) { await page.keyboard.down('Space'); mark('boost on'); }
      await page.keyboard.down(key);
      await nodeWait(700);
      await page.keyboard.up(key);
      await nodeWait(300);
      if (k === 4 || k === 10) { await page.keyboard.up('Space'); mark('boost off'); }
    }
    await at(30);
    await page.keyboard.press('Escape');
    mark('Esc: CRUISE');
    await at(33);
    await page.keyboard.press('Escape');
    mark('Esc: PLAY');
    await at(35);
    await page.evaluate(() => { window.__mvE2e!.forceSignalLost(); });
    mark('forceSignalLost');
    for (let k = 0; k < 8; k++) { await page.keyboard.down(k % 2 ? 'KeyW' : 'KeyS'); await nodeWait(500); await page.keyboard.up(k % 2 ? 'KeyW' : 'KeyS'); await nodeWait(300); }
    await at(45);
    const z = 10 * ZONE_CHUNKS - 2;
    await page.evaluate((c) => window.__mv!.warp(c, 0), z);
    mark(`warp to chunk ${z}, 2 chunks before a zone boundary`);
    await at(60);
    const frames = await sc.stop();
    mark('end');
    const deltas = await page.evaluate(() => (window as unknown as { __deltas: number[] }).__deltas);
    const d: number[] = [];
    const long: string[] = [];
    for (let i = 0; i < deltas.length; i += 2) {
      d.push(deltas[i]!);
      if (deltas[i]! > 33) long.push(`${(deltas[i + 1]! / 1000).toFixed(2)} s: ${deltas[i]!.toFixed(1)} ms`);
    }
    const sorted = [...d].sort((a, b) => a - b);
    const q = (p: number): number => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
    const span = frames.length > 1 ? frames.at(-1)!.t - frames[0]!.t : 0;
    console.log(`V1 events ${JSON.stringify(events)}`);
    console.log(`V1 cast ${frames.length} frames over ${span.toFixed(1)} s, ${(frames.length / Math.max(span, 1e-9)).toFixed(1)} fps`);
    console.log(`V1 rAF deltas n ${d.length}, p50 ${q(0.5).toFixed(2)} ms, p95 ${q(0.95).toFixed(2)} ms, max ${sorted.at(-1)!.toFixed(1)} ms; over 33 ms: ${long.length} ${JSON.stringify(long)}`);
    writeFlipbook(join(dir, 'flipbook.html'), frames, 'cast');
    const fps = frames.length / Math.max(span, 1e-9);
    const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', fps.toFixed(3), '-i', join(cast, '%05d.jpg'), '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', join(dir, 'session.mp4')], { encoding: 'utf8' });
    console.log(`V1 ffmpeg exit ${ff.status} ${ff.error ? String(ff.error) : ''}${ff.stderr ?? ''}`);
    if (ff.status === 0) console.log(`VIDEO ${join(dir, 'session.mp4')}`);
    // Contact sheet: the frame nearest each 2 s mark, 30 tiles at 480x270.
    const tiles: SheetTile[] = [];
    const f0 = frames[0]?.t ?? 0;
    for (let s = 0; s < 60; s += 2) {
      let best = frames[0]!;
      for (const f of frames) if (Math.abs(f.t - f0 - s) < Math.abs(best.t - f0 - s)) best = f;
      tiles.push({ image: readFileSync(best.file), label: `${s} s` });
    }
    await saveContactSheet(browser, tiles, { cols: 4, tileW: 480, tileH: 270, path: join(dir, 'session_sheet.jpg') });
    expect(frames.length / Math.max(span, 1e-9)).toBeGreaterThanOrEqual(6);
  });

  test('V2 filmstrips: cruise, boost, a gate pass, the zone fade midpoint, a hit', async ({ page }, info) => {
    test.setTimeout(240_000);
    const dir = info.outputPath('filmstrips');
    mkdirSync(dir, { recursive: true });
    await openApp(page, '&period=0');
    await page.evaluate(() => window.__mv!.warp(200, 0));
    await nodeWait(800);
    writeImage(join(dir, 'strip_cruise.jpg'), await filmstrip(page, { skip: 0, frames: 24, every: 2, label: 'cruise' }));

    await page.mouse.click(960, 700);
    await nodeWait(1800);
    await page.keyboard.down('Space');
    await nodeWait(600);
    writeImage(join(dir, 'strip_boost.jpg'), await filmstrip(page, { skip: 0, frames: 24, every: 2, label: 'boost' }));
    await page.keyboard.up('Space');
    await nodeWait(800);

    const gate = await nextItem(page, 1, 30);
    console.log(`V2 next gate ${JSON.stringify(gate)}`);
    if (gate) writeImage(join(dir, 'strip_gate.jpg'), await filmstrip(page, { skip: Math.max(0, Math.floor(gate.frames) - 12), frames: 24, every: 2, label: 'gate' }));

    await page.evaluate((c) => window.__mv!.warp(c, 0), 20 * ZONE_CHUNKS - 13);
    await nodeWait(500);
    const zone = await page.evaluate(() => { const z = window.__mvE2e!.host.ctx.shared.uHero.value; return Array.from(z); });
    console.log(`V2 fade midpoint uHero ${JSON.stringify(zone)}`);
    writeImage(join(dir, 'strip_fade.jpg'), await filmstrip(page, { skip: 0, frames: 24, every: 2, label: 'fade' }));

    // A hit: steer into the solid part of the next laser fence, by the mouse's absolute target.
    const fence = await nextItem(page, 3, 100);
    let hitTarget = 0;
    if (fence) {
      const lo = Math.max(-38, fence.x - fence.radius + 2);
      const hi = Math.min(38, fence.x + fence.radius - 2);
      for (const x of [lo, hi, (lo + hi) / 2]) if (Math.abs(x - fence.a) > fence.b + 3) { hitTarget = x; break; }
    }
    const vp = page.viewportSize()!;
    await page.mouse.move(((hitTarget / 40) * 0.8 + 1) / 2 * vp.width, vp.height * 0.6);
    const sh0 = await page.evaluate(() => window.__mvE2e!.sim.shields);
    console.log(`V2 next fence ${JSON.stringify(fence)}, steering to x ${hitTarget.toFixed(1)}, shields ${sh0}`);
    if (fence) writeImage(join(dir, 'strip_hit.jpg'), await hitStrip(page, Math.ceil(fence.frames) + 120));
    const sh1 = await page.evaluate(() => window.__mvE2e!.sim.shields);
    console.log(`V2 shields after the hit strip ${sh1}`);
  });

  test('V3 slit-scans: cruise, a zone boundary, a tier change, 1e15, and the one-frame positive control', async ({ page, browser }, info) => {
    test.setTimeout(300_000);
    const dir = info.outputPath('slits');
    mkdirSync(dir, { recursive: true });
    await openApp(page, '&period=0&tier=3');
    const runs: { name: string; warp: number; hideAt?: number; hideLayer?: number; tierAt?: { frame: number; tier: 0 | 1 | 2 | 3 | 4 }[] }[] = [
      { name: 'cruise', warp: 200 },
      { name: 'zone', warp: 10 * ZONE_CHUNKS - 8 },
      { name: 'tier', warp: 300, tierAt: [{ frame: 0, tier: 3 }, { frame: 300, tier: 2 }] },
      { name: 'far', warp: 15625000000000 },
      { name: 'control', warp: 200, hideAt: 300 },
      // Props cover few pixels in these columns, so their one-frame gap reads only by number; terrain's is plain to see.
      { name: 'control_terrain', warp: 200, hideAt: 300, hideLayer: 1 },
    ];
    for (const r of runs) {
      await page.evaluate((c) => window.__mv!.warp(c, 0), r.warp);
      await nodeWait(400);
      const files = { row: join(dir, `${r.name}_slit_row.png`), colA: join(dir, `${r.name}_slit_col_a.png`), colB: join(dir, `${r.name}_slit_col_b.png`) };
      const res = await slitScan(page, { frames: 600, dt: 1 / 60, row: 640, colA: 760, colB: 1160, ...(r.hideAt !== undefined ? { hideAt: r.hideAt } : {}), ...(r.hideLayer !== undefined ? { hideLayer: r.hideLayer } : {}), ...(r.tierAt ? { tierAt: r.tierAt } : {}) }, files);
      console.log(`V3 ${r.name}: ${res.frames} frames in ${res.ms.toFixed(0)} ms`);
      await compositeSlit(browser, files, join(dir, `${r.name}_composite.png`), r.name);
      await page.evaluate(() => { window.__mvE2e!.host.governor.force(3); });
    }
  });

  test.describe('modes', () => {
    // The sheet ends on a deliberate runtime fatal, whose FATAL line is the expected console error.
    test.use({ allowConsoleErrors: true });
  test('V4 stills: modes', async ({ page, browser }, info) => {
    test.setTimeout(180_000);
    const dir = info.outputPath('stills');
    mkdirSync(dir, { recursive: true });
    const tiles: SheetTile[] = [];
    const add = async (p: Page, label: string): Promise<void> => {
      const png = await p.screenshot();
      writeImage(join(dir, `mode_${label.replace(/\W+/g, '_')}.png`), png);
      tiles.push({ image: png, label });
    };
    const nojs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1920, height: 1080 } });
    const pp = await nojs.newPage();
    await pp.goto('/');
    await add(pp, 'poster');
    await nojs.close();
    await openApp(page, '&period=0');
    await nodeWait(2000);
    await add(page, 'title');
    await page.mouse.click(960, 700);
    await nodeWait(2000);
    await add(page, 'PLAY');
    await page.keyboard.down('Space');
    await nodeWait(1200);
    await add(page, 'boost');
    await page.keyboard.up('Space');
    await page.keyboard.press('Escape');
    await nodeWait(600);
    await add(page, 'CRUISE');
    await page.keyboard.press('Escape');
    await nodeWait(1500);
    await page.evaluate(() => { window.__mvE2e!.forceSignalLost(); });
    await nodeWait(400);
    await add(page, 'SIGNAL_LOST');
    await nodeWait(3500);
    await loseContext(page);
    await nodeWait(500);
    await add(page, 'context lost');
    await restoreContext(page);
    await nodeWait(800);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await nodeWait(1500);
    await add(page, 'reduced motion');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => { window.__mvE2e!.host.layers[0]!.frame = () => { throw new Error('deliberate, for the still'); }; });
    await expect(page.locator('[data-mv="fatal"]')).toBeVisible();
    await add(page, 'fatal runtime');
    await saveContactSheet(browser, tiles, { cols: 3, tileW: 640, tileH: 360, path: join(dir, 'sheet_modes.jpg') });
  });
  });

  test('V4 stills: shapes, with the ship at x = 40 and -40 on phones', async ({ browser }, info) => {
    test.setTimeout(240_000);
    const dir = info.outputPath('stills');
    mkdirSync(dir, { recursive: true });
    const shapes = [[390, 844], [844, 390], [1280, 720], [3440, 1440], [5120, 1440]] as const;
    for (const [w, h] of shapes) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      const page = await ctx.newPage();
      await openApp(page);
      await nodeWait(1500);
      const tiles: SheetTile[] = [{ image: await page.screenshot(), label: `${w}x${h} title` }];
      await page.mouse.click(w / 2, h * 0.7);
      await nodeWait(1500);
      tiles.push({ image: await page.screenshot(), label: `${w}x${h} PLAY` });
      if (h > w || w < 900) {
        for (const x of [40, -40]) {
          await page.mouse.move(((x / 40) * 0.8 + 1) / 2 * w, h * 0.6);
          await nodeWait(1800);
          const sx = await page.evaluate(() => window.__mvE2e!.sim.x);
          tiles.push({ image: await page.screenshot(), label: `${w}x${h} ship x ${sx.toFixed(1)}` });
        }
      }
      for (const t of tiles) writeImage(join(dir, `shape_${t.label!.replace(/\W+/g, '_')}.png`), t.image);
      const scale = Math.min(1, 960 / w, 640 / h);
      const cols = w > 1500 ? 1 : 2;
      await saveContactSheet(browser, tiles, { cols, tileW: Math.round(w * scale), tileH: Math.round(h * scale), path: join(dir, `sheet_shape_${w}x${h}.jpg`) });
      await ctx.close();
    }
  });

  test('V4 stills: tiers 4 to 0 at one state, zones, distance', async ({ browser }, info) => {
    test.setTimeout(240_000);
    const dir = info.outputPath('stills');
    mkdirSync(dir, { recursive: true });
    const tierTiles: SheetTile[] = [];
    for (const t of [4, 3, 2, 1, 0]) {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      const page = await ctx.newPage();
      await openApp(page, `&tier=${t}`);
      await page.evaluate(() => { const mv = window.__mv!; mv.manual(true); mv.renderAt(205, 10, 28800); mv.renderAt(205, 10, 28800); mv.renderAt(205, 10, 28800); });
      const png = await page.screenshot();
      writeImage(join(dir, `tier_${t}.png`), png);
      tierTiles.push({ image: png, label: `tier ${t}` });
      await ctx.close();
    }
    await saveContactSheet(browser, tierTiles, { cols: 3, tileW: 640, tileH: 360, path: join(dir, 'sheet_tiers.jpg') });

    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    await openApp(page, '&period=0');
    await page.addStyleTag({ content: HIDE_UI });
    const zoneTiles: SheetTile[] = [];
    const names = ['Sunset Drive', 'Miami Dusk', 'Ultraviolet', 'Toxic Arcade', 'Ember', 'Arctic Laser'];
    const biomes = ['Boulevard', 'Neon City', 'Crystal Desert', 'Cyber Canyon', 'Orbital Night', 'Olympus'];
    let lastZone = -1;
    for (let i = 0; i < 6; i++) {
      let b = i;
      let z = findZoneChunk(DEFAULT_SEED, i, b);
      for (let k = 1; z < 0 && k < 6; k++) { b = (i + k) % 6; z = findZoneChunk(DEFAULT_SEED, i, b); }
      if (z < 0) continue;
      lastZone = z;
      await page.evaluate((c) => window.__mv!.warp(c, 0), z + 5);
      await nodeWait(900);
      zoneTiles.push({ image: await page.screenshot(), label: `${names[i]} + ${biomes[b]} (chunk ${z})` });
    }
    if (lastZone >= 0) {
      await page.evaluate((c) => window.__mv!.warp(c, 0), lastZone + 87);
      await nodeWait(900);
      zoneTiles.push({ image: await page.screenshot(), label: `mid-fade, chunk ${lastZone + 87}` });
    }
    for (const t of zoneTiles) writeImage(join(dir, `zone_${t.label!.replace(/\W+/g, '_')}.png`), t.image);
    await saveContactSheet(browser, zoneTiles, { cols: 3, tileW: 640, tileH: 360, path: join(dir, 'sheet_zones.jpg') });

    const distTiles: SheetTile[] = [];
    for (const d of [1e9, 1e12, 1e15]) {
      const chunk = Math.round(d / 64);
      await page.evaluate((c) => { const mv = window.__mv!; mv.manual(true); mv.forceZone(0, 0, 0); mv.renderAt(c, 20, 28800); mv.renderAt(c, 20, 28800); }, chunk);
      distTiles.push({ image: await page.screenshot(), label: `${d.toExponential(0)} u, chunk ${chunk}` });
    }
    for (const t of distTiles) writeImage(join(dir, `distance_${t.label!.replace(/\W+/g, '_')}.png`), t.image);
    await saveContactSheet(browser, distTiles, { cols: 3, tileW: 640, tileH: 360, path: join(dir, 'sheet_distance.jpg') });
    await ctx.close();
  });
});
