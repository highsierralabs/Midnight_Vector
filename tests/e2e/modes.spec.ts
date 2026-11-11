// A19: every command path by real input, on the integrated build.
import type { Page } from 'playwright/test';
import { expect, test } from '../support/pw';
import { floorClip, nodeWait, openApp, panelState } from './lib/app';

test.beforeEach(({}, info) => { test.skip(info.project.name !== 'gpu', 'gpu only'); });

const MODE = (page: Page) => page.locator('html');

/** D-012, DI-89: the CRUISE card is drawn, inert, during DEMO, so toBeVisible() is true in every mode; read T08's signals. */
async function expectCruiseShown(page: Page): Promise<void> {
  await expect.poll(async () => (await panelState(page, 'cruise')).shown, { message: 'the CRUISE card shown to a player' }).toBe(true);
}

async function travel(page: Page): Promise<number> {
  return page.evaluate(() => { const t = window.__mvE2e!.sim.travel; return t.chunk * 64 + t.local; });
}

test('launch by click, then Esc and P toggle CRUISE, and the world keeps moving behind the menu (A19)', async ({ page }) => {
  await openApp(page);
  await expect(MODE(page)).toHaveAttribute('data-mv-mode', 'demo');
  await page.mouse.click(960, 700);
  await expect(MODE(page)).toHaveAttribute('data-mv-mode', 'play');
  await page.keyboard.press('Escape');
  await expect(MODE(page)).toHaveAttribute('data-mv-mode', 'cruise');
  await expectCruiseShown(page);
  const t0 = await travel(page);
  const a = await floorClip(page);
  await nodeWait(1000);
  const b = await floorClip(page);
  const t1 = await travel(page);
  console.log(`A19 behind the menu: travel ${t0.toFixed(1)} -> ${t1.toFixed(1)}, floor differs ${!a.equals(b)}`);
  expect(t1 - t0).toBeGreaterThan(40);
  expect(a.equals(b)).toBe(false);
  await page.keyboard.press('Escape');
  await expect(MODE(page)).toHaveAttribute('data-mv-mode', 'play');
  await page.keyboard.press('KeyP');
  await expect(MODE(page)).toHaveAttribute('data-mv-mode', 'cruise');
  await page.keyboard.press('KeyP');
  await expect(MODE(page)).toHaveAttribute('data-mv-mode', 'play');
});

/**
 * DI-99: under a fine pointer II takes no mouse press in PLAY (T08), so a mouse click there reaches the canvas as boost,
 * and a keyboard reaches II with Tab, then Enter. Tab is pressed until II has focus, at most 4 times, and the count is
 * printed. The touch row below taps II.
 */
test('launch by key a; Tab then Enter on the menu button opens CRUISE; Resume returns; M mutes (A19)', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('KeyA');
  await expect(MODE(page)).toHaveAttribute('data-mv-mode', 'play');
  await nodeWait(500);
  const ii = page.locator('[data-mv="menu-button"]');
  let tabs = 0;
  while (tabs < 4 && !(await ii.evaluate((el) => el === document.activeElement))) {
    await page.keyboard.press('Tab');
    tabs++;
  }
  await expect(ii).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(MODE(page)).toHaveAttribute('data-mv-mode', 'cruise');
  await expectCruiseShown(page);
  await page.locator('[data-mv="resume"]').click();
  await expect(MODE(page)).toHaveAttribute('data-mv-mode', 'play');
  const root = page.locator('.mv-ui');
  const before = await root.getAttribute('data-muted');
  await page.keyboard.press('KeyM');
  await expect(root).toHaveAttribute('data-muted', '1');
  await page.keyboard.press('KeyM');
  await expect(root).toHaveAttribute('data-muted', '0');
  console.log(`A19 II by keyboard after ${tabs} Tab; mute ${before} -> 1 -> 0`);
});

/** The centre of a laid-out element, for a touch tap at that point. */
async function centreOf(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} has no box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** DI-99: a touch screen keeps II in PLAY. A real tap on it opens CRUISE, and a tap on Resume returns. */
test('touch: a tap launches, a tap on the menu button opens CRUISE, a tap on Resume returns (A19, DI-99)', async ({ browser }) => {
  test.setTimeout(60_000);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  try {
    await openApp(page);
    await page.touchscreen.tap(195, 600);
    await expect(MODE(page)).toHaveAttribute('data-mv-mode', 'play');
    await nodeWait(500);
    const ii = await centreOf(page, '[data-mv="menu-button"]');
    const media = await page.evaluate((p) => ({
      coarse: matchMedia('(pointer: coarse)').matches,
      fine: matchMedia('(pointer: fine)').matches,
      hit: document.elementFromPoint(p.x, p.y)?.closest('[data-mv]')?.getAttribute('data-mv') ?? null,
    }), ii);
    await page.touchscreen.tap(ii.x, ii.y);
    await expect(MODE(page)).toHaveAttribute('data-mv-mode', 'cruise');
    await expectCruiseShown(page);
    const resume = await centreOf(page, '[data-mv="resume"]');
    await page.touchscreen.tap(resume.x, resume.y);
    await expect(MODE(page)).toHaveAttribute('data-mv-mode', 'play');
    console.log(`A19 touch II at ${ii.x.toFixed(0)},${ii.y.toFixed(0)} ${JSON.stringify(media)}; Resume at ${resume.x.toFixed(0)},${resume.y.toFixed(0)}`);
    expect(media).toEqual({ coarse: true, fine: false, hit: 'menu-button' });
  } finally {
    await ctx.close();
  }
});

/**
 * With no input the ship flies straight, so it can lose its shields before the idle timer runs out. Such a run spent part
 * of the wait in SIGNAL_LOST, not 10.5 s idle in PLAY, so it is taken again on a fresh page, at most 6 times: 3 of 7
 * attempts lost their shields in the wait [O: round 2], so 6 leave about a 1 in 160 chance that every attempt does. A run
 * is used only if the sim stayed in PLAY for the whole wait. (Before DI-94 the end of SIGNAL_LOST also restarted the idle
 * timer; since DI-94 it keeps the last real input's tick, which does not change this rule.)
 */
test('idle 10.5 s shows the autopilot tag, and any key returns (A19)', async ({ browser }) => {
  test.setTimeout(240_000);
  for (let attempt = 1; ; attempt++) {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    try {
      // A page of its own, outside the shared fixture, so console errors are checked here.
      const log = await openApp(page);
      const pageErrors: string[] = [];
      page.on('pageerror', (e) => { pageErrors.push(e.message); });
      await page.mouse.click(960, 700);
      await expect(MODE(page)).toHaveAttribute('data-mv-mode', 'play');
      await page.evaluate(() => {
        const w = window as unknown as { __a19lost: boolean };
        w.__a19lost = false;
        (function poll() { if (window.__mvE2e!.sim.mode !== 1) w.__a19lost = true; requestAnimationFrame(poll); })();
      });
      await nodeWait(10_500);
      const lost = await page.evaluate(() => (window as unknown as { __a19lost: boolean }).__a19lost);
      if (lost && attempt < 6) {
        console.log(`A19 idle attempt ${attempt}: the sim left PLAY during the wait (shields ran out), taking it again`);
        continue;
      }
      expect(lost, 'the sim stayed in PLAY for the whole idle wait').toBe(false);
      await expect(page.locator('[data-mv="autopilot"]')).toBeVisible();
      const auto = await page.evaluate(() => window.__mvE2e!.sim.autopilot);
      await page.keyboard.press('KeyD');
      await expect(page.locator('[data-mv="autopilot"]')).toBeHidden();
      console.log(`A19 idle autopilot ${auto}, attempt ${attempt}`);
      expect(auto).toBe(true);
      expect(log.of('error')).toEqual([]);
      expect(pageErrors).toEqual([]);
      return;
    } finally {
      await ctx.close();
    }
  }
});

test('togglePause during SIGNAL_LOST does nothing (A19)', async ({ page }) => {
  await openApp(page);
  await page.mouse.click(960, 700);
  await expect(MODE(page)).toHaveAttribute('data-mv-mode', 'play');
  await page.evaluate(() => { window.__mvE2e!.forceSignalLost(); });
  await expect(MODE(page)).toHaveAttribute('data-mv-mode', 'lost');
  await page.keyboard.press('Escape');
  await nodeWait(300);
  const m = await page.evaluate(() => window.__mvE2e!.sim.mode);
  expect(m).toBe(3);
  await expect(MODE(page)).toHaveAttribute('data-mv-mode', 'lost');
  await expect(MODE(page)).toHaveAttribute('data-mv-mode', 'play', { timeout: 8000 });
});

test('the menu reduced checkbox reaches the sim, and the quality radio reaches the governor (A19)', async ({ page }) => {
  test.setTimeout(60_000);
  await openApp(page, '&tier=3');
  await page.mouse.click(960, 700);
  await expect(MODE(page)).toHaveAttribute('data-mv-mode', 'play');
  await page.keyboard.press('Escape');
  await expectCruiseShown(page);
  const s0 = await page.evaluate(() => window.__mvE2e!.sim.speed);
  await page.locator('[data-mv="reduced"]').check();
  await nodeWait(2500);
  const t0 = await travel(page);
  await nodeWait(500);
  const t1 = await travel(page);
  const reduced = await page.evaluate(() => ({ speed: window.__mvE2e!.sim.speed, attr: document.querySelector('.mv-ui')!.getAttribute('data-reduced') }));
  await page.locator('[data-mv="reduced"]').uncheck();
  for (const t of ['1', '2', '0', '4']) {
    await page.locator(`[data-mv="quality"] input[value="${t}"]`).check();
    await nodeWait(150);
    expect(await page.evaluate(() => window.__mv!.stats().tier)).toBe(Number(t));
  }
  await page.locator('[data-mv="quality"] input[value="auto"]').check();
  await nodeWait(300);
  const auto = await page.evaluate(() => ({ tier: window.__mv!.stats().tier, label: document.querySelector('[data-mv="quality"]')!.textContent }));
  console.log(`A19 reduced: cruise ${s0} -> ${JSON.stringify(reduced)}, travel +${(t1 - t0).toFixed(1)} in .5 s; auto ${JSON.stringify(auto)}`);
  expect(reduced.speed).toBeLessThanOrEqual(0.6 * s0 + 2);
  expect(reduced.attr).toBe('1');
  expect(t1 - t0).toBeGreaterThan(10);
  expect([0, 1, 2, 3, 4]).toContain(auto.tier);
});
