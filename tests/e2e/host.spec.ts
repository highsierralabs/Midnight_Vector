// A22: each row of the HarnessHost table, on the integrated build, through T10's own hook and not window.__mv, so a
// failure here cannot be confused with T09's code. Same-state compares use DI-58's bound at MSAA 0 (DI-67).
import { expect, test } from '../support/pw';
import { sameStateTolerance } from '../forever/support/open';
import { nodeWait, openApp } from './lib/app';

test.beforeEach(({}, info) => { test.skip(info.project.name !== 'gpu', 'gpu only'); });

test('__mv is ready when MV_READY arrives; setManual stops and restarts travel (A22)', async ({ page }) => {
  await openApp(page);
  expect(await page.evaluate(() => window.__mv!.ready)).toBe(true);
  const travel = () => page.evaluate(() => { const t = window.__mvE2e!.sim.travel; return t.chunk * 64 + t.local; });
  await page.evaluate(() => { window.__mvE2e!.host.setManual(true); });
  const a = await travel();
  await nodeWait(500);
  const b = await travel();
  await page.evaluate(() => { window.__mvE2e!.host.setManual(false); });
  await nodeWait(500);
  const c = await travel();
  console.log(`A22 setManual: ${a} ${b} ${c}`);
  expect(b).toBe(a);
  expect(c - b).toBeGreaterThan(20);
});

test('runFrame steps 2 or 3 ticks at 2.5/120 s with the matching travel, and a forced tier applies at step 15 (A22)', async ({ page }) => {
  await openApp(page, '&tier=3');
  const r = await page.evaluate(() => {
    const h = window.__mvE2e!;
    const host = h.host;
    host.setManual(true);
    const out: { dTick: number; dTravel: number; speed: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const t0 = h.sim.tick;
      const p0 = h.sim.travel.chunk * 64 + h.sim.travel.local;
      host.runFrame(2.5 / 120);
      out.push({ dTick: h.sim.tick - t0, dTravel: h.sim.travel.chunk * 64 + h.sim.travel.local - p0, speed: h.sim.speed });
    }
    host.governor.force(2);
    host.runFrame(1 / 60);
    const gl = host.ctx.renderer.getContext();
    const after1 = [gl.drawingBufferWidth, gl.drawingBufferHeight];
    host.runFrame(1 / 60);
    const after2 = [gl.drawingBufferWidth, gl.drawingBufferHeight];
    return { out, tier: window.__mv!.stats().tier, after1, after2 };
  });
  console.log(`A22 runFrame ${JSON.stringify(r)}`);
  for (const f of r.out) {
    expect([2, 3]).toContain(f.dTick);
    expect(f.dTravel).toBeCloseTo((f.dTick * f.speed) / 120, 1);
  }
  expect(r.tier).toBe(2);
  // Tier 2 at 1920x1080: min(1, 1, sqrt(1440000 / 2073600)) = .8333, applied by post at the next frame.
  expect(r.after2).toEqual([1600, 900]);
});

test('renderState is exact and repeatable, the period identity holds, the next chunk differs (A22)', async ({ page }, info) => {
  await openApp(page);
  const tol = sameStateTolerance(info.project.name);
  const r = await page.evaluate(() => {
    const h = window.__mvE2e!;
    const host = h.host;
    host.setManual(true);
    host.post.forceVariant('off');
    host.post.forceMsaa(0);
    const gl = host.ctx.renderer.getContext();
    const read = (c: number, l: number, t: number): Uint8Array => {
      host.renderState(c, l, t);
      host.renderState(c, l, t);
      host.ctx.renderer.setRenderTarget(null);
      const px = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    };
    const diff = (a: Uint8Array, b: Uint8Array): { bytes: number; max: number } => {
      let bytes = 0;
      let max = 0;
      for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i]! - b[i]!); if (d) { bytes++; if (d > max) max = d; } }
      return { bytes, max };
    };
    const tick0 = h.sim.tick;
    const travel0 = { ...h.sim.travel };
    const a = read(5, 3, 120);
    const a2 = read(5, 3, 120);
    const far = read(5 + 1024 * 2 ** 20, 3, 120);
    const back = read(5, 3, 120);
    const next = read(6, 3, 120);
    const cam = h.host.ctx.camera;
    const out = {
      again: diff(a, a2), far: diff(a, far), back: diff(a, back), next: diff(a, next),
      tickSame: h.sim.tick === tick0, travelSame: h.sim.travel.chunk === travel0.chunk && h.sim.travel.local === travel0.local,
      camZ: cam.position.z,
    };
    host.post.forceVariant(null);
    host.post.forceMsaa(null);
    return out;
  });
  console.log(`A22 renderState ${JSON.stringify(r)} tolerance ${JSON.stringify(tol)}`);
  for (const k of ['again', 'far', 'back'] as const) {
    expect(r[k].max, k).toBeLessThanOrEqual(tol.max);
    expect(r[k].bytes, k).toBeLessThanOrEqual(tol.bytes);
  }
  expect(r.next.bytes).toBeGreaterThan(1000);
  expect(r.tickSame).toBe(true);
  expect(r.travelSame).toBe(true);
  expect(r.camZ).toBe(0);
});

test('overrideZone changes the palette and null restores; overrideFov(68) at 21:9; zero pitch puts the horizon near row 540 (A22)', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 2520, height: 1080 } });
  const page = await ctx.newPage();
  await openApp(page, '&tier=4');
  const r = await page.evaluate(() => {
    const h = window.__mvE2e!;
    const host = h.host;
    host.setManual(true);
    const pal = () => Array.from(host.ctx.shared.uPal.value.slice(0, 6)).map((v) => Number(v.toFixed(4)));
    host.renderState(5, 0, 0);
    const base = pal();
    host.overrideZone({ palette: 5, biome: 3, hero: 2 });
    host.renderState(5, 0, 0);
    const forced = pal();
    const hero = Array.from(host.ctx.shared.uHero.value);
    host.overrideZone(null);
    host.renderState(5, 0, 0);
    const restored = pal();
    host.overrideFov(68);
    host.renderState(5, 0, 0);
    const fov = h.camera().fov;
    host.overrideFov(null);
    // Zero pitch: terrain alone, post off, black clear, no bend; the first lit row at the centre column.
    host.post.forceVariant('off');
    for (const l of host.layers) l.setVisible(l.name === 'terrain');
    host.overrideBend({ a: 0, c: 0 });
    const gl = host.ctx.renderer.getContext();
    const horizon = (): number => {
      host.renderState(5, 0, 0);
      host.renderState(5, 0, 0);
      host.ctx.renderer.setRenderTarget(null);
      const W = gl.drawingBufferWidth;
      const H = gl.drawingBufferHeight;
      const col = new Uint8Array(H * 4);
      gl.readPixels(Math.floor(W / 2), 0, 1, H, gl.RGBA, gl.UNSIGNED_BYTE, col);
      for (let row = 0; row < H; row++) {
        const i = (H - 1 - row) * 4;
        if (col[i]! + col[i + 1]! + col[i + 2]! > 15) return (row * 1080) / H;
      }
      return -1;
    };
    const pitched = horizon();
    host.overrideFeel({ shakeY: -0.05 });
    const level = horizon();
    host.overrideFeel(null);
    host.overrideBend(null);
    for (const l of host.layers) l.setVisible(true);
    host.post.forceVariant(null);
    return { base, forced, hero, restored, fov, pitched, level };
  });
  console.log(`A22 overrides ${JSON.stringify(r)}`);
  expect(r.forced).not.toEqual(r.base);
  expect(r.restored).toEqual(r.base);
  expect(r.hero).toEqual([2, 2, 0]);
  expect(r.fov).toBe(68);
  expect(Math.abs(r.pitched - 589)).toBeLessThanOrEqual(4);
  expect(Math.abs(r.level - 540)).toBeLessThanOrEqual(4);
  await ctx.close();
});
