// A15 and A16: hidden tabs (synthetic, plus a throttled window), and resize, DPR and field of view. A16 also holds the
// ship's framing at both lane edges at every aspect (DI-81, DI-88), through the live camera.
import type { Page } from 'playwright/test';
import { expect, saveShot, test } from '../support/pw';
import { CAMERA_HALF_TAN_MAX, PLAY_HALF_X, SHIP_FORWARD } from '../../src/contracts/index';
import { FOLLOW_EDGE, followGainX } from '../../src/app/follow';
import { DPR_POLL_MS } from '../../src/app/sizing';
import { TIERS, pixelRatioFor } from '../../src/render/fx/quality';
import { audioRecorderScript, nodeWait, openApp } from './lib/app';

test.beforeEach(({}, info) => { test.skip(info.project.name !== 'gpu', 'gpu only'); });

async function setVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
  await page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => s === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

test('hidden: suspend on hidden, resume on shown, and the next frame takes rawDt 0 (A15, synthetic)', async ({ page }) => {
  await page.addInitScript(audioRecorderScript);
  const log = await openApp(page);
  await page.mouse.click(960, 540);
  await nodeWait(800);
  const n0 = log.lines.length;
  await setVisibility(page, 'hidden');
  await nodeWait(300);
  const hiddenLines = log.lines.slice(n0).filter((l) => l.includes('AUDIOREC call'));
  // Wait for a non-zero rawDt, then show and read the first frame after.
  await nodeWait(200);
  const r = await page.evaluate(async () => {
    const h = window.__mvE2e!;
    const before = h.lastRawDt();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    const f0 = h.counters.frames;
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise<void>((res) => {
      const tick = (): void => { if (h.counters.frames > f0) res(); else requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    return { before, after: h.lastRawDt() };
  });
  await nodeWait(300);
  const all = log.lines.slice(n0).filter((l) => l.includes('AUDIOREC call'));
  console.log(`A15 synthetic: hidden ${JSON.stringify(hiddenLines)}, all ${JSON.stringify(all)}, rawDt ${JSON.stringify(r)}`);
  expect(hiddenLines).toContain('log AUDIOREC call suspend');
  expect(all.indexOf('log AUDIOREC call resume')).toBeGreaterThan(all.indexOf('log AUDIOREC call suspend'));
  expect(r.before).toBeGreaterThan(0);
  expect(r.after).toBe(0);
});

test('hidden: a minimized window throttles rAF; long frames clamp to 30 steps, the tier holds, no catch-up (A15, throttled)', async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page);
  await page.evaluate(() => {
    const h = window.__mvE2e!;
    const w = window as unknown as { __thr: { t: number; tick: number; rawDt: number }[] };
    w.__thr = [];
    (function rec(t: number) {
      w.__thr.push({ t, tick: h.sim.tick, rawDt: h.lastRawDt() });
      requestAnimationFrame(rec);
    })(performance.now());
  });
  const cdp = await page.context().newCDPSession(page);
  const { windowId } = await cdp.send('Browser.getWindowForTarget') as { windowId: number };
  const tier0 = await page.evaluate(() => window.__mv!.stats().tier);
  await nodeWait(1000);
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
  await nodeWait(3500);
  const tierMin = await page.evaluate(() => window.__mv!.stats().tier);
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
  await nodeWait(1500);
  const r = await page.evaluate(() => (window as unknown as { __thr: { t: number; tick: number; rawDt: number }[] }).__thr);
  const deltas = r.slice(1).map((s, i) => ({ dt: s.t - r[i]!.t, ticks: s.tick - r[i]!.tick, rawDt: s.rawDt }));
  const long = deltas.filter((d) => d.dt > 250);
  const maxTicks = Math.max(...deltas.map((d) => d.ticks));
  const tail = deltas.slice(-30);
  console.log(`A15 throttled: frames ${deltas.length}, long frames ${long.length} ${JSON.stringify(long.slice(0, 6))}, max ticks per frame ${maxTicks}, tier ${tier0} -> ${tierMin}, tail mean dt ${(tail.reduce((a, d) => a + d.dt, 0) / tail.length).toFixed(2)} ms, tail max ticks ${Math.max(...tail.map((d) => d.ticks))}`);
  expect(long.length).toBeGreaterThan(0);
  expect(maxTicks).toBeLessThanOrEqual(31);
  for (const d of long) expect(d.ticks).toBeLessThanOrEqual(31);
  expect(tierMin).toBe(tier0);
  expect(Math.max(...tail.map((d) => d.ticks))).toBeLessThanOrEqual(4);
});

async function frameAfter(page: Page): Promise<{ buffer: number[]; aspect: number; resizes: number; css: number[]; fov: number; gainX: number }> {
  return page.evaluate(async () => {
    const h = window.__mvE2e!;
    const f0 = h.counters.rendered;
    await new Promise<void>((res) => {
      const tick = (): void => { if (h.counters.rendered >= f0 + 2) res(); else requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const gl = h.host.ctx.renderer.getContext();
    const stage = document.getElementById('mv-stage')!;
    const cam = h.camera();
    return { buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], aspect: cam.aspect, resizes: h.counters.resizes, css: [stage.clientWidth, stage.clientHeight], fov: cam.fov, gainX: cam.gainX };
  });
}

test('resize: shrink and grow are right on the next frames, with no stretch (A16)', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openApp(page, '&tier=4');
  const a = await frameAfter(page);
  await page.setViewportSize({ width: 800, height: 600 });
  const b = await frameAfter(page);
  await saveShot(page, info, 'resized-800x600');
  await page.setViewportSize({ width: 1500, height: 900 });
  const c = await frameAfter(page);
  console.log(`A16 resize ${JSON.stringify({ a, b, c })}`);
  expect(a.buffer).toEqual([1280, 720]);
  expect(b.buffer).toEqual([800, 600]);
  expect(b.aspect).toBeCloseTo(800 / 600, 9);
  expect(c.buffer).toEqual([1500, 900]);
  expect(c.aspect).toBeCloseTo(1500 / 900, 9);
  expect(b.resizes).toBeGreaterThan(a.resizes);
  expect(c.resizes).toBeGreaterThan(b.resizes);
  expect(b.gainX).toBeCloseTo(followGainX(800 / 600), 9);
});

test('dpr: deviceScaleFactor 2 at 800x600 and tier 4 gives a 1600x1200 buffer (A16)', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await openApp(page, '&tier=4');
  const r = await frameAfter(page);
  console.log(`A16 dpr ${JSON.stringify(r)}`);
  expect(r.buffer).toEqual([1600, 1200]);
  await ctx.close();
});

/**
 * A16d (VI-r1): a devicePixelRatio change at a fixed CSS size, as when a window moves to a monitor of another density.
 * No resize event and no ResizeObserver callback fires for it under emulation [O: VI-r1], so only a resolution media
 * query or a poll can see it, and under CDP emulation the query does not fire either [O: T10 probe], so this row gates
 * sizing.ts's DPR_POLL_MS poll. CDP changes deviceScaleFactor alone; the buffer must follow within one poll period plus
 * a few frames, by section 6.10's pixelRatioFor at tier 4 (dprCap 2), as T06's renderer.setSize floors it.
 */
test('dpr change: deviceScaleFactor alone, at a fixed 800x600, moves the buffer on the next frames (A16d)', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await openApp(page, '&tier=4');
  const cdp = await page.context().newCDPSession(page);
  const q = TIERS[4]!;
  const rows: string[] = [];
  const first = await frameAfter(page);
  expect(first.buffer).toEqual([800, 600]);
  let resizes = first.resizes;
  for (const d of [2, 1.5, 0.75, 1]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: d, mobile: false });
    const r = pixelRatioFor(q, 800, 600, d);
    const want = [Math.floor(800 * r), Math.floor(600 * r)];
    const got = await page.evaluate(async (w) => {
      const h = window.__mvE2e!;
      const f0 = h.counters.rendered;
      const t0 = performance.now();
      const gl = h.host.ctx.renderer.getContext();
      return new Promise<{ frames: number; ms: number; buffer: number[]; dpr: number; resizes: number; css: number[] }>((res) => {
        const tick = (): void => {
          const b = [gl.drawingBufferWidth, gl.drawingBufferHeight];
          const ms = performance.now() - t0;
          if ((b[0] === w[0] && b[1] === w[1]) || ms > 3000) {
            const stage = document.getElementById('mv-stage')!;
            res({ frames: h.counters.rendered - f0, ms, buffer: b, dpr: window.devicePixelRatio, resizes: h.counters.resizes, css: [stage.clientWidth, stage.clientHeight] });
          } else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    }, want);
    const row = `A16d dpr ${d}: want ${want.join('x')}, buffer ${got.buffer.join('x')} after ${got.frames} frames, ${got.ms.toFixed(0)} ms, devicePixelRatio ${got.dpr}, css ${got.css.join('x')}, resizes ${resizes} -> ${got.resizes}`;
    console.log(row);
    rows.push(row);
    expect(got.dpr, 'the emulation took effect, so the row is not vacuous').toBe(d);
    expect(got.css).toEqual([800, 600]);
    expect(got.buffer, row).toEqual(want);
    expect(got.ms, 'one poll period plus a few frames').toBeLessThanOrEqual(DPR_POLL_MS + 250);
    expect(got.resizes).toBeGreaterThan(resizes);
    resizes = got.resizes;
  }
  expect(rows.length).toBe(4);
});

test('fov: 5120x1440 caps at 2 atan(1.574 / 3.556); 3440x1440 under boost stays at most 68; 390x844 gainX .976 (A16, DI-81)', async ({ browser }, info) => {
  test.setTimeout(90_000);
  const wide = await browser.newContext({ viewport: { width: 5120, height: 1440 } });
  const p1 = await wide.newPage();
  await openApp(p1, '&tier=1');
  const r1 = await frameAfter(p1);
  const cap = (2 * Math.atan(CAMERA_HALF_TAN_MAX / (5120 / 1440)) * 180) / Math.PI;
  console.log(`A16 fov 5120x1440 ${r1.fov} cap ${cap}`);
  expect(r1.fov).toBeCloseTo(cap, 6);
  expect(Math.abs(r1.fov - 47.7)).toBeLessThan(0.1);
  await wide.close();

  const ultra = await browser.newContext({ viewport: { width: 3440, height: 1440 } });
  const p2 = await ultra.newPage();
  await openApp(p2, '&tier=1');
  await p2.mouse.click(1720, 720);
  await p2.keyboard.down('Space');
  const fovs = await p2.evaluate(async () => {
    const h = window.__mvE2e!;
    const out: number[] = [];
    const t0 = performance.now();
    await new Promise<void>((res) => {
      const tick = (): void => { out.push(h.camera().fov); if (performance.now() - t0 > 2500) res(); else requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    return { max: Math.max(...out), min: Math.min(...out), overdrive: h.sim.overdrive, mode: h.sim.mode };
  });
  await p2.keyboard.up('Space');
  console.log(`A16 fov 3440x1440 boost ${JSON.stringify(fovs)}`);
  expect(fovs.max).toBeLessThanOrEqual(68);
  await ultra.close();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p3 = await phone.newPage();
  await openApp(p3, '&tier=1');
  const r3 = await frameAfter(p3);
  console.log(`A16 390x844 ${JSON.stringify(r3)}`);
  expect(r3.gainX).toBeCloseTo(followGainX(390 / 844), 9);
  expect(r3.gainX.toFixed(3)).toBe('0.976');
  await saveShot(p3, info, 'phone-390x844-title');
  await phone.close();
});

/**
 * The buffer it returns to is section 6.10's at the page's tier: 1920x1080 at tiers 3 and 4 on this DPR 1 viewport,
 * 1600x900 at tier 2. So the tier is fixed at 3 (no boot timing, a forced governor) and read back: on the auto tier the
 * row read tier 2's 1600x900 once in a full run, on correct sizing (section 10).
 */
test('a 0x0 stage throws nothing and keeps the loop running (A16)', async ({ page }) => {
  await openApp(page, '&tier=3');
  const r = await page.evaluate(async () => {
    const h = window.__mvE2e!;
    const stage = document.getElementById('mv-stage')!;
    stage.style.inset = 'auto';
    stage.style.width = '0px';
    stage.style.height = '0px';
    window.dispatchEvent(new Event('resize'));
    const f0 = h.counters.frames;
    await new Promise((r2) => { setTimeout(r2, 500); });
    const f1 = h.counters.frames;
    stage.style.removeProperty('inset');
    stage.style.removeProperty('width');
    stage.style.removeProperty('height');
    window.dispatchEvent(new Event('resize'));
    await new Promise((r2) => { setTimeout(r2, 300); });
    const gl = h.host.ctx.renderer.getContext();
    return { advanced: f1 - f0, buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], tier: window.__mv!.stats().tier };
  });
  console.log(`A16 zero stage ${JSON.stringify(r)}`);
  expect(r.advanced).toBeGreaterThan(10);
  expect(r.tier, 'the forced tier').toBe(3);
  expect(r.buffer).toEqual([1920, 1080]);
});

/**
 * DI-81: the ship's framing at both lane edges, through the live camera. A real click launches, the mouse steers to each
 * edge in absolute mode, frames step by runFrame until the sim reads x = +-PLAY_HALF_X, then the ship body's extreme
 * points (T05's ship.ts: wing corners at +-1.6 u, 2.15 u aft; fins 2.2 u aft; nose 2.2 u ahead), with the pose's bank
 * and pitch as ship.vert.glsl applies them, are projected through the frame's own camera. At every shape the outer point
 * must sit inside the frame with a tenth of the half-width to spare (DI-88, which closed D-011 at 16:9). Where the gain
 * formula is above .72 the level ship also sits near FOLLOW_EDGE; at 21:9 (1680x720, above the .72 crossing at about
 * 2.3023) the live gain must be exactly .72, so B7's edge-paint case is unchanged. A screenshot of each edge is saved.
 */
test('framing: the ship stays in frame at both lane edges at every aspect, through the live camera (A16, DI-81, DI-88)', async ({ browser }, info) => {
  test.setTimeout(300_000);
  const shapes: [number, number][] = [[390, 844], [768, 1024], [1280, 800], [1920, 1080], [844, 390], [1680, 720]];
  const rows: string[] = [];
  for (const [w, h] of shapes) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await openApp(page, '&tier=3');
    await nodeWait(800);
    await page.mouse.click(w / 2, h * 0.7);
    await nodeWait(600);
    for (const edge of [1, -1]) {
      await page.mouse.move(edge > 0 ? w - 2 : 1, h * 0.6);
      const r = await page.evaluate(({ edge, half, forward }) => {
        const hook = window.__mvE2e!;
        const host = hook.host;
        host.setManual(true);
        for (let i = 0; i < 600 && edge * hook.sim.x < half - 1e-3; i++) host.runFrame(1 / 60);
        for (let i = 0; i < 30; i++) host.runFrame(1 / 60);
        const cam = host.ctx.camera;
        cam.updateMatrixWorld();
        const s = hook.sim;
        const bank = Math.max(-0.55, Math.min(0.55, -(s.x - s.prevX) * 1.6));
        const pitch = Math.max(-0.22, Math.min(0.22, (s.y - s.prevY) * 2.4));
        const pts = [[-1.6, -0.46, 2.15], [1.6, -0.46, 2.15], [-1.6, -0.42, 2.15], [1.6, -0.42, 2.15], [-1.26, 0.34, 2.2], [1.26, 0.34, 2.2], [0, 0.02, -2.2], [0, 0.62, 1.95]];
        const v = cam.position.clone();
        let outer = -Infinity;
        for (const [lx0, ly0, lz0] of pts) {
          const cb = Math.cos(bank), sb = Math.sin(bank), cp = Math.cos(pitch), sp = Math.sin(pitch);
          const lx = cb * lx0! - sb * ly0!, ly1 = sb * lx0! + cb * ly0!;
          const ly = cp * ly1 + sp * lz0!, lz = -sp * ly1 + cp * lz0!;
          v.set(s.x + lx, s.y + ly, -forward + lz).project(cam);
          outer = Math.max(outer, edge * v.x);
        }
        host.setManual(false);
        return { x: s.x, y: s.y, gainX: hook.camera().gainX, aspect: hook.camera().aspect, camX: cam.position.x, outer, mode: s.mode };
      }, { edge, half: PLAY_HALF_X, forward: SHIP_FORWARD });
      await saveShot(page, info, `framing-${w}x${h}-${edge > 0 ? 'right' : 'left'}`);
      const row = `A16 framing ${w}x${h} edge ${edge > 0 ? '+' : '-'}: x ${r.x.toFixed(2)} y ${r.y.toFixed(2)} gain ${r.gainX.toFixed(4)} camX ${r.camX.toFixed(2)} outer NDC ${r.outer.toFixed(3)}`;
      console.log(row);
      rows.push(row);
      expect(edge * r.x).toBeGreaterThanOrEqual(PLAY_HALF_X - 1e-3);
      expect(r.mode).toBe(1);
      expect(r.gainX).toBeCloseTo(followGainX(w / h), 9);
      expect(r.outer, `${w}x${h}: the outer point of the ship`).toBeLessThanOrEqual(0.9);
      if (followGainX(w / h) > 0.72) expect(r.outer).toBeGreaterThan(FOLLOW_EDGE - 0.05);
      else expect(r.gainX).toBe(0.72);
    }
    await ctx.close();
  }
  expect(rows.length).toBe(shapes.length * 2);
});
