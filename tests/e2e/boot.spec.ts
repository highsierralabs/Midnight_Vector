// A2, A3, A10: the poster without JavaScript, the poster without float buffers, and a real boot on the GPU. A10b: the
// boot measurement reaches the final governor.
import { DOWN_P95_MS } from '../../src/render/fx/governor';
import { expect, saveShot, test } from '../support/pw';
import { checkRasterizer } from '../support/rasterizer';
import { contextCountScript, openApp } from './lib/app';

const ENGINE = /\/src\/app\/|\/three|postprocessing|\/src\/render\/|\/src\/world\/|\/src\/sim\//;

test.describe('poster', () => {
  for (const size of [{ width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
    test(`poster no-js at ${size.width}x${size.height} (A2)`, async ({ browser }, info) => {
      test.skip(info.project.name !== 'gpu', 'one rasterizer is enough');
      const context = await browser.newContext({ javaScriptEnabled: false, viewport: size });
      const page = await context.newPage();
      const requests: string[] = [];
      page.on('request', (r) => { requests.push(r.url()); });
      await page.goto('/');
      await expect(page.locator('#mv-poster')).toBeVisible();
      await expect(page.locator('#mv-poster-title')).toHaveText('MIDNIGHT VECTOR');
      await expect(page.locator('#mv-poster-msg')).toContainText('WebGL2 with floating-point render targets');
      await expect(page.locator('#mv-poster .copy')).toBeVisible();
      console.log(`REQUESTS ${JSON.stringify(requests)}`);
      expect(requests.map((u) => new URL(u).pathname)).toEqual(['/']);
      await saveShot(page, info, `poster-nojs-${size.width}x${size.height}`);
      await context.close();
    });
  }

  test('poster no-float: WebGL2 without colour-buffer extensions keeps the poster and fetches no engine (A3)', async ({ page }, info) => {
    test.skip(info.project.name !== 'gpu', 'one rasterizer is enough');
    await page.addInitScript(() => {
      const proto = WebGL2RenderingContext.prototype;
      const get = proto.getExtension;
      proto.getExtension = function getExtension(this: WebGL2RenderingContext, name: string) {
        if (name === 'EXT_color_buffer_float' || name === 'EXT_color_buffer_half_float') return null;
        return (get as (this: WebGL2RenderingContext, n: string) => unknown).call(this, name);
      } as typeof get;
    });
    const requests: string[] = [];
    page.on('request', (r) => { requests.push(r.url()); });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-mv-boot', 'unsupported');
    await expect(page.locator('#mv-poster-title')).toHaveText('NO SIGNAL');
    await expect(page.locator('#mv-poster-msg')).toContainText('WebGL2');
    await expect(page.locator('#mv-poster-msg')).toContainText('floating-point');
    await expect(page.locator('[data-mv="fatal"]')).toHaveCount(0);
    await page.waitForTimeout(1000);
    const engine = requests.filter((u) => ENGINE.test(new URL(u).pathname));
    console.log(`REQUESTS ${requests.length}, engine ${JSON.stringify(engine)}`);
    expect(engine).toEqual([]);
    expect(requests.some((u) => new URL(u).pathname === '/src/main.ts')).toBe(true);
    await saveShot(page, info, 'poster-nofloat-1920x1080');
  });
});

test('boot on the GPU: one context, its attributes, the rasterizer, the poster hidden, the buffer, the timing (A10)', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', 'needs the real GPU');
  await page.addInitScript(contextCountScript);
  const requests: string[] = [];
  page.on('request', (r) => { requests.push(new URL(r.url()).pathname); });
  await openApp(page);
  const r = await page.evaluate(() => {
    const hook = window.__mvE2e!;
    const gl = hook.host.ctx.renderer.getContext();
    const canvas = hook.host.ctx.renderer.domElement;
    return {
      contexts: (window as unknown as { __mvContexts: number }).__mvContexts,
      attrs: gl.getContextAttributes(),
      depthBits: gl.getParameter(gl.DEPTH_BITS) as number,
      boot: hook.boot,
      buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight, canvas.width, canvas.height],
      css: [canvas.clientWidth, canvas.clientHeight],
      dpr: window.devicePixelRatio,
      profile: hook.host.governor.profile,
      tier: window.__mv!.stats().tier,
      poster: getComputedStyle(document.getElementById('mv-poster')!).display,
      boot_attr: document.documentElement.dataset['mvBoot'],
    };
  });
  console.log(`BOOT ${JSON.stringify(r)}`);
  expect(r.contexts).toBe(1);
  expect(r.attrs?.depth).toBe(false);
  expect(r.attrs?.stencil).toBe(false);
  expect(r.attrs?.antialias).toBe(false);
  expect(r.depthBits).toBe(0);
  expect(r.boot.depthBits).toBe(0);
  expect(checkRasterizer('gpu', true, r.boot.rendererString)).toBeNull();
  expect(r.boot.software).toBe(false);
  expect(r.poster).toBe('none');
  expect(r.boot_attr).toBe('running');
  const ratio = Math.min(r.dpr, r.profile.dprCap, Math.sqrt(r.profile.maxPixels / (r.css[0]! * r.css[1]!)));
  expect(r.buffer[0]).toBe(Math.floor(r.css[0]! * ratio));
  expect(r.buffer[1]).toBe(Math.floor(r.css[1]! * ratio));
  expect(r.boot.firstFrameMs).toBeLessThan(10_000);
  expect(r.boot.measuredP95Ms).toBeGreaterThan(0);
  expect([3, 4]).toContain(r.tier);
  expect(requests.filter((p) => /\/src\/harness\//.test(p)).length).toBeGreaterThan(0);
});

/**
 * A10b (VI-gates mutation B1): the boot measurement reaches the final governor. Section 6.10's display-limit hold keeps
 * the tier when frames are steady and well above what boot measured (T06's governor.ts: spread at most
 * STEADY_SPREAD_MS and boot < p95 / 2), and a governor built with bootP95Ms 0 has no measurement, so it sheds instead.
 * The loop is held, so only these series reach the final governor. A jittery series of the same mean must still shed a
 * tier, which proves the governor is live and unpinned, so the steady hold cannot pass by a governor that never moves.
 */
test('the boot measurement reaches the final governor: a steady slow display holds the tier, a jittery one sheds (A10b)', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', 'needs a timed boot on the real GPU');
  await openApp(page);
  const r = await page.evaluate(({ downP95 }) => {
    const hook = window.__mvE2e!;
    hook.host.setManual(true);
    const g = hook.host.governor;
    const boot = hook.boot.measuredP95Ms;
    const tier0 = g.profile.tier;
    // At least 2.5 times the boot p95 and above the shed threshold, on a 0.25 ms histogram bin edge.
    const steady = Math.max(downP95 + 13, Math.ceil(boot * 2.5 * 4) / 4);
    const steadyChanges: number[] = [];
    for (let i = 0; i < 600; i++) {
      const t = g.sample(steady);
      if (t !== null) steadyChanges.push(t);
    }
    const tierAfterSteady = g.profile.tier;
    const jitter = [steady - 8, steady + 8];
    let jitterChange: number | null = null;
    let jitterSamples = 0;
    for (let i = 0; i < 600 && jitterChange === null; i++) {
      jitterChange = g.sample(jitter[i % 2]!);
      jitterSamples++;
    }
    return { boot, tier0, steady, steadyChanges, tierAfterSteady, jitter, jitterChange, jitterSamples, tierAfterJitter: g.profile.tier };
  }, { downP95: DOWN_P95_MS });
  console.log(`A10b ${JSON.stringify(r)}`);
  expect(r.boot, 'a timed boot measured something').toBeGreaterThan(0);
  expect(r.steady, 'the series stays inside the governor histogram').toBeLessThan(120);
  expect(r.steady / 2, 'the hold needs boot < p95 / 2').toBeGreaterThan(r.boot);
  expect(r.tier0, 'a tier that can shed').toBeGreaterThanOrEqual(2);
  expect(r.steadyChanges, `a steady ${r.steady} ms display held by the boot p95 of ${r.boot} ms: no tier change`).toEqual([]);
  expect(r.tierAfterSteady).toBe(r.tier0);
  expect(r.jitterChange, 'the same governor sheds a tier on a jittery series of the same mean').toBe(r.tier0 - 1);
  expect(r.tierAfterJitter).toBe(r.tier0 - 1);
});

test('a normal visit requests no harness module and defines no __mv or __mvE2e', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', 'needs the real GPU');
  const requests: string[] = [];
  page.on('request', (r) => { requests.push(new URL(r.url()).pathname); });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-mv-boot', 'running', { timeout: 30_000 });
  await page.waitForTimeout(1500);
  expect(requests.filter((p) => /\/src\/harness\/|testHook/.test(p))).toEqual([]);
  expect(await page.evaluate(() => [typeof window.__mv, typeof window.__mvE2e])).toEqual(['undefined', 'undefined']);
});
