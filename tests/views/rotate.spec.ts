// T13 A16 (T08's amendment LS), on the integrated build: a phone held upright gets the rotate gate and the game waits
// behind it. The phone is desktop Chromium with touch and a phone's viewport, turned by resizing the viewport, which is
// what flips the orientation media query. No real phone is involved (HC-V3).
import type { Browser, BrowserContext, Page } from 'playwright/test';
import { SimMode } from '../../src/contracts/index';
import { nodeWait, openApp } from '../e2e/lib/app';
import { expect, saveShot, test } from '../support/pw';

test.beforeEach(({}, info) => { test.skip(info.project.name !== 'gpu', 'gpu only'); });

const UPRIGHT = { width: 390, height: 844 } as const;
const SIDEWAYS = { width: 844, height: 390 } as const;

async function phone(browser: Browser, viewport: { width: number; height: number }): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
  return { ctx, page: await ctx.newPage() };
}

const simMode = (page: Page): Promise<number> => page.evaluate(() => window.__mvE2e!.sim.mode);

/** Whether the gate is what a finger meets at each of nine points across the screen. */
async function gateTakesEveryTouch(page: Page): Promise<boolean[]> {
  return page.evaluate(() => {
    const out: boolean[] = [];
    for (const fy of [0.04, 0.5, 0.96]) {
      for (const fx of [0.04, 0.5, 0.96]) {
        out.push(document.elementFromPoint(innerWidth * fx, innerHeight * fy)?.closest('.mv-rotate') != null);
      }
    }
    return out;
  });
}

test('A16: held upright, a phone shows the rotate gate and nothing launches; turned, the title is back and a tap launches', async ({ browser }, info) => {
  test.setTimeout(90_000);
  const { ctx, page } = await phone(browser, UPRIGHT);
  try {
    const log = await openApp(page);
    const ui = page.locator('#mv-ui');
    const html = page.locator('html');
    await expect(ui).toHaveAttribute('data-rotate', '1');
    await expect(page.locator('[data-mv="rotate"]')).toBeVisible();
    await expect(page.locator('[data-mv="rotate-head"]')).toHaveText('ROTATE YOUR PHONE');
    // The gate fills the screen and is what every touch meets; the title under it is out of sight and out of reach.
    const box = await page.locator('[data-mv="rotate"]').boundingBox();
    expect(box).toEqual({ x: 0, y: 0, width: UPRIGHT.width, height: UPRIGHT.height });
    expect(await gateTakesEveryTouch(page)).toEqual(new Array(9).fill(true));
    await expect(page.locator('[data-mv="launch"]')).toBeHidden();
    await expect(page.locator('[data-mv="wordmark"]')).toBeHidden();
    // The phone in the icon turns: one running animation, on the gate.
    const turning = await page.evaluate(() => document.getAnimations().map((a) => (a as CSSAnimation).animationName));
    expect(turning).toContain('mv-rotate-turn');
    await saveShot(page, info, 'rotate-gate-390x844');

    // Neither a tap nor a key starts a run.
    await page.touchscreen.tap(195, 600);
    await page.touchscreen.tap(195, 300);
    await page.keyboard.press('Enter');
    await nodeWait(400);
    await expect(html).toHaveAttribute('data-mv-mode', 'demo');
    expect(await simMode(page)).toBe(SimMode.DEMO);

    // Turned onto its side: the gate goes, the title is back, and a tap launches.
    await page.setViewportSize(SIDEWAYS);
    await expect(ui).toHaveAttribute('data-rotate', '0');
    await expect(page.locator('[data-mv="rotate"]')).toBeHidden();
    await expect(page.locator('[data-mv="launch"]')).toBeVisible();
    await saveShot(page, info, 'rotate-turned-844x390');
    await page.touchscreen.tap(422, 120);
    await expect(html).toHaveAttribute('data-mv-mode', 'play');
    expect(log.of('error')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('A16: turned upright in a run, the run parks in CRUISE behind the gate and nothing resumes it; turned back, Resume does', async ({ browser }, info) => {
  test.setTimeout(90_000);
  const { ctx, page } = await phone(browser, SIDEWAYS);
  try {
    const log = await openApp(page);
    const ui = page.locator('#mv-ui');
    const html = page.locator('html');
    await expect(ui).toHaveAttribute('data-rotate', '0');
    await page.touchscreen.tap(422, 120);
    await expect(html).toHaveAttribute('data-mv-mode', 'play');
    await nodeWait(600);
    expect(await simMode(page)).toBe(SimMode.PLAY);

    await page.setViewportSize(UPRIGHT);
    await expect(ui).toHaveAttribute('data-rotate', '1');
    await expect(html).toHaveAttribute('data-mv-mode', 'cruise');
    expect(await simMode(page)).toBe(SimMode.CRUISE);
    await expect(page.locator('[data-mv="rotate"]')).toBeVisible();
    await expect(page.locator('[data-mv="resume"]')).toBeHidden();
    expect(await gateTakesEveryTouch(page)).toEqual(new Array(9).fill(true));
    await saveShot(page, info, 'rotate-gate-in-run-390x844');

    // A tap where the card is, and P, resume nothing while the gate shows.
    await page.touchscreen.tap(195, 420);
    await page.keyboard.press('KeyP');
    await nodeWait(400);
    expect(await simMode(page)).toBe(SimMode.CRUISE);

    // Turned back: the cruise menu is there, and Resume resumes.
    await page.setViewportSize(SIDEWAYS);
    await expect(ui).toHaveAttribute('data-rotate', '0');
    const resume = page.locator('[data-mv="resume"]');
    await expect(resume).toBeVisible();
    const r = (await resume.boundingBox())!;
    await page.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2);
    await expect(html).toHaveAttribute('data-mv-mode', 'play');
    expect(await simMode(page)).toBe(SimMode.PLAY);
    expect(log.of('error')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('A16: the line is a touch-first screen under 600 px wide held upright: a tablet and a narrow desktop window are not gated', async ({ browser }) => {
  test.setTimeout(120_000);
  const cases: { name: string; viewport: { width: number; height: number }; touch: boolean; gated: boolean }[] = [
    { name: 'phone upright', viewport: UPRIGHT, touch: true, gated: true },
    { name: 'phone sideways', viewport: SIDEWAYS, touch: true, gated: false },
    { name: 'touch, 599 wide, upright', viewport: { width: 599, height: 900 }, touch: true, gated: true },
    { name: 'touch, 600 wide, upright', viewport: { width: 600, height: 900 }, touch: true, gated: false },
    { name: 'tablet upright', viewport: { width: 820, height: 1180 }, touch: true, gated: false },
    { name: 'narrow desktop window', viewport: UPRIGHT, touch: false, gated: false },
  ];
  for (const c of cases) {
    const ctx = await browser.newContext(c.touch ? { viewport: c.viewport, hasTouch: true, isMobile: true } : { viewport: c.viewport });
    try {
      const page = await ctx.newPage();
      await openApp(page);
      await expect(page.locator('#mv-ui'), c.name).toHaveAttribute('data-rotate', c.gated ? '1' : '0');
      expect(await page.locator('[data-mv="rotate"]').isVisible(), c.name).toBe(c.gated);
      expect(await page.locator('[data-mv="launch"]').isVisible(), c.name).toBe(!c.gated);
    } finally {
      await ctx.close();
    }
  }
});

test('A16: under reduced motion the phone in the icon is drawn on its side and nothing moves', async ({ browser }, info) => {
  test.setTimeout(60_000);
  const ctx = await browser.newContext({ viewport: UPRIGHT, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  try {
    const page = await ctx.newPage();
    await openApp(page);
    await expect(page.locator('#mv-ui')).toHaveAttribute('data-rotate', '1');
    const read = await page.evaluate(() => {
      const el = document.querySelector('.mv-rotate-phone')!;
      const r = el.getBoundingClientRect();
      return { animations: document.getAnimations().length, wide: r.width > r.height };
    });
    expect(read).toEqual({ animations: 0, wide: true });
    await saveShot(page, info, 'rotate-gate-reduced-390x844');
  } finally {
    await ctx.close();
  }
});
