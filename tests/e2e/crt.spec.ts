// T14: the CRT screen on the integrated build, by real input. A normal visit, not ?harness, because the harness forces
// the CRT off; so readiness is data-mv-boot and the waits here may grant activation, which nothing in this file depends on.
// At DPR 1 and tier 3 the pitch is 3 drawing-buffer pixels, so the aperture grille shows as a 3-column colour pattern in
// a screenshot of the canvas alone. That pattern is the detector: it does not depend on what the moving world draws.
import type { Page } from 'playwright/test';
import { SETTINGS_KEY } from '../../src/ui/storage';
import { expect, test } from '../support/pw';
import { HIDE_UI_STYLE, linkSpyScript, nodeWait, panelState } from './lib/app';
import { readPng } from './lib/view';

test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
test.beforeEach(({}, info) => { test.skip(info.project.name !== 'gpu', 'gpu only'); });

const MODE = (page: Page) => page.locator('html');
const BOX = (page: Page) => page.locator('[data-mv="crt"]');

/**
 * The grille's 3-column signature: for each channel, the spread of its mean over the three column phases, relative to
 * its mean. The grille at .7 * .3 puts about .17 between phases in linear light, about .09 once encoded to sRGB; the plain frame
 * reads under .01.
 */
function grilleSpread(png: Buffer): number {
  const { w, h, px } = readPng(png);
  const sum = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const p = sum[x % 3]!;
      p[0]! += px[i]!; p[1]! += px[i + 1]!; p[2]! += px[i + 2]!;
    }
  }
  let worst = 0;
  for (let c = 0; c < 3; c++) {
    const m = [sum[0]![c]!, sum[1]![c]!, sum[2]![c]!];
    const mean = (m[0]! + m[1]! + m[2]!) / 3;
    if (mean < 1) continue;
    worst = Math.max(worst, (Math.max(...m) - Math.min(...m)) / mean);
  }
  return worst;
}

async function canvasSpread(page: Page): Promise<number> {
  return grilleSpread(await page.screenshot({ style: HIDE_UI_STYLE }));
}

/** Opens / (or with a query), launches by a real click and opens CRUISE, where the box is. */
async function openCruise(page: Page, query = ''): Promise<void> {
  await page.goto(`/?tier=3${query}`);
  await expect(MODE(page)).toHaveAttribute('data-mv-boot', 'running', { timeout: 30_000 });
  await page.mouse.click(640, 500);
  await expect(MODE(page)).toHaveAttribute('data-mv-mode', 'play');
  await page.keyboard.press('Escape');
  await expect(MODE(page)).toHaveAttribute('data-mv-mode', 'cruise');
  await expect.poll(async () => (await panelState(page, 'cruise')).shown).toBe(true);
}

test('a new player has the CRT on; clearing the box turns it off, links nothing, and is remembered', async ({ page }) => {
  await page.addInitScript(linkSpyScript);
  await openCruise(page);
  await expect(BOX(page)).toBeChecked();
  const on = await canvasSpread(page);
  const links0 = await page.evaluate(() => window.__mvLinks ?? -1);

  await BOX(page).click();
  await expect(BOX(page)).not.toBeChecked();
  await nodeWait(300);
  const off = await canvasSpread(page);
  // Nine more toggles, ending on: each is a uniform in a program already linked.
  for (let i = 0; i < 9; i++) await BOX(page).click();
  await expect(BOX(page)).toBeChecked();
  await nodeWait(300);
  const onAgain = await canvasSpread(page);
  const links1 = await page.evaluate(() => window.__mvLinks ?? -1);
  const stored = await page.evaluate((k) => localStorage.getItem(k), SETTINGS_KEY);
  console.log(`T14 crt ${JSON.stringify({ on, off, onAgain, links0, links1, stored })}`);

  expect(on, 'the grille shows with the CRT on').toBeGreaterThan(0.05);
  expect(off, 'no grille with the CRT off').toBeLessThan(0.02);
  expect(onAgain).toBeGreaterThan(0.05);
  expect(links0).toBeGreaterThan(0);
  expect(links1, 'ten toggles link no program').toBe(links0);

  // Off, then a reload: the box stays clear and the frame stays plain.
  await BOX(page).click();
  await expect(BOX(page)).not.toBeChecked();
  expect(JSON.parse((await page.evaluate((k) => localStorage.getItem(k), SETTINGS_KEY))!).crt).toBe(false);
  await openCruise(page);
  await expect(BOX(page)).not.toBeChecked();
  await nodeWait(300);
  expect(await canvasSpread(page)).toBeLessThan(0.02);
});

test('a store from before T14 loads with the CRT on', async ({ page }) => {
  await page.addInitScript((k) => {
    if (sessionStorage.getItem('t14-seeded') !== null) return;
    sessionStorage.setItem('t14-seeded', '1');
    localStorage.setItem(k, '{"music":0.8,"sfx":0.8,"muted":false,"quality":"auto","reduced":null,"hideHud":false,"cam":"chase"}');
  }, SETTINGS_KEY);
  await openCruise(page);
  await expect(BOX(page)).toBeChecked();
  expect(await canvasSpread(page)).toBeGreaterThan(0.05);
});

test('?crt=1 and ?crt=0 force the CRT over the box, and the box still records the choice', async ({ page }) => {
  await openCruise(page, '&crt=1');
  await BOX(page).click();
  await expect(BOX(page)).not.toBeChecked();
  await nodeWait(300);
  expect(await canvasSpread(page), '?crt=1 holds the CRT on').toBeGreaterThan(0.05);

  await openCruise(page, '&crt=0');
  await expect(BOX(page)).not.toBeChecked();
  await BOX(page).click();
  await expect(BOX(page)).toBeChecked();
  await nodeWait(300);
  expect(await canvasSpread(page), '?crt=0 holds the CRT off').toBeLessThan(0.02);
});
