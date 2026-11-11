// Which target this run is on, stated plainly, so an unarmed run cannot be mistaken for an armed one (A7, B1).
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, saveShot, test } from '../support/pw';
import { armedOnly, openHarness, target } from './support/open';

test('the target is what the disk says', ({}, info) => {
  test.skip(info.project.name !== 'gpu', 'one rasterizer is enough');
  const t = target();
  console.log(t === 'shell' ? 'TARGET shell: armed suites skipped' : 'TARGET app');
  if (t === 'shell' && process.env['TERRAIN_HARNESS_TARGET'] !== 'shell') expect(existsSync(resolve('index.html'))).toBe(false);
  if (t === 'app') expect(existsSync(resolve('index.html'))).toBe(true);
});

test('the harness page opens on the real GPU, and shows sky, sun and floor (A7)', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', 'needs the 1080p viewport and the real GPU');
  await openHarness(page, info);
  const r = await page.evaluate(() => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    mv.manual(true);
    mv.setPost('full');
    mv.setMsaa(2);
    mv.renderAt(5, 12.5, 28800);
    mv.renderAt(5, 12.5, 28800);
    const px = mv.pixels();
    const s = mv.stats();
    return { info: lab.rendererInfo(), stats: s, wash: lab.metrics.washout(px, s.width, s.height), links: lab.links() };
  });
  console.log(`RENDERER ${r.info.renderer}`);
  console.log(`SHELL ${JSON.stringify(r.stats)} ${JSON.stringify(r.wash)} links ${r.links}`);
  expect(r.info.webgl2).toBe(true);
  expect(r.stats.width).toBe(1920);
  expect(r.stats.height).toBe(1080);
  expect(r.stats.calls).toBeGreaterThan(3);
  expect(r.wash.meanLuma).toBeGreaterThan(1);
  expect(r.links).toBeGreaterThan(0);
  await saveShot(page, info, 'harness-shell');
});

test('/?harness reaches ready, and a normal visit has no __mv (armed)', async ({ page }, info) => {
  armedOnly();
  test.skip(info.project.name !== 'gpu', 'one rasterizer is enough');
  await page.goto('/');
  await page.waitForLoadState('load');
  // No evaluate-based wait grants anything here: the page has no harness to wait for.
  expect(await page.evaluate(() => window.__mv)).toBeUndefined();
  await openHarness(page, info);
  expect(await page.evaluate(() => window.__mv!.ready)).toBe(true);
});
