// A21: a phone, by CDP touch. A drag launches on release, a later drag steers by its sign, a second finger boosts, the
// page never scrolls, and reduced motion from the OS applies from the first frame with no roll.
import type { CDPSession, Page } from 'playwright/test';
import { expect, saveShot, test } from '../support/pw';
import { nodeWait, openApp } from './lib/app';

test.beforeEach(({}, info) => { test.skip(info.project.name !== 'gpu', 'gpu only'); });

// Amendment LS: a phone held upright shows the rotate gate (tests/views/rotate.spec.ts), so this phone is held sideways.
const PHONE = { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true } as const;

type Pt = { x: number; y: number; id: number };
async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', pts: Pt[]): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
}

/** One finger down at from, then steps moves over dx. beforeRelease runs with the finger still down, after the last move. */
async function drag(cdp: CDPSession, from: { x: number; y: number }, dx: number, steps = 10, beforeRelease?: () => Promise<void>): Promise<void> {
  await touch(cdp, 'touchStart', [{ ...from, id: 1 }]);
  for (let i = 1; i <= steps; i++) {
    await touch(cdp, 'touchMove', [{ x: from.x + (dx * i) / steps, y: from.y, id: 1 }]);
    await nodeWait(16);
  }
  if (beforeRelease) await beforeRelease();
  await touch(cdp, 'touchEnd', []);
}

async function sim(page: Page): Promise<{ x: number; mode: number; overdrive: number; speed: number; scrollY: number }> {
  return page.evaluate(() => {
    const s = window.__mvE2e!.sim;
    return { x: s.x, mode: s.mode, overdrive: s.overdrive, speed: s.speed, scrollY: window.scrollY };
  });
}

/** The sim's mode, which has no lag, and T08's data-mv-mode, which trails it by up to 6 ticks (section 10). */
async function modes(page: Page): Promise<{ sim: number; attr: string | null }> {
  return page.evaluate(() => ({ sim: window.__mvE2e!.sim.mode, attr: document.documentElement.getAttribute('data-mv-mode') }));
}

test('drag launches on release, steers by sign, a second finger boosts, no scroll (A21)', async ({ browser }, info) => {
  test.setTimeout(60_000);
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  await openApp(page);
  await saveShot(page, info, 'touch-title-844x390');
  const cdp = await ctx.newCDPSession(page);
  // B17 (VI-gates): the launch comes on the release, not the press. With the finger still down after the press and all
  // ten moves, and 100 ms more, so T08's attribute has caught up with any launch, both reads must still be DEMO.
  let held: { sim: number; attr: string | null } | null = null;
  await drag(cdp, { x: 195, y: 200 }, 40, 10, async () => {
    await nodeWait(100);
    held = await modes(page);
  });
  await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'play');
  const released = await modes(page);
  console.log(`A21 launch: finger down ${JSON.stringify(held)}, after the release ${JSON.stringify(released)}`);
  expect(held, 'DEMO while the finger is still down (sim mode 0, data-mv-mode demo)').toEqual({ sim: 0, attr: 'demo' });
  expect(released).toEqual({ sim: 1, attr: 'play' });
  await nodeWait(1500);
  const a = await sim(page);
  await drag(cdp, { x: 120, y: 200 }, 160, 16);
  await nodeWait(800);
  const b = await sim(page);
  await drag(cdp, { x: 300, y: 200 }, -220, 16);
  await nodeWait(900);
  const c = await sim(page);
  // Two fingers: the second press boosts while both are down.
  await touch(cdp, 'touchStart', [{ x: 150, y: 220, id: 1 }]);
  await touch(cdp, 'touchStart', [{ x: 150, y: 220, id: 1 }, { x: 260, y: 220, id: 2 }]);
  const od0 = (await sim(page)).overdrive;
  await nodeWait(1200);
  const d = await sim(page);
  await saveShot(page, info, 'touch-play-boost-844x390');
  await touch(cdp, 'touchEnd', []);
  console.log(`A21 ${JSON.stringify({ a, b, c, od0, d })}`);
  expect(b.x).toBeGreaterThan(a.x + 2);
  expect(c.x).toBeLessThan(b.x - 2);
  expect(d.overdrive).toBeLessThan(od0);
  expect(d.speed).toBeGreaterThan(90);
  for (const s of [a, b, c, d]) expect(s.scrollY).toBe(0);
  await ctx.close();
});

test('OS reduced motion at load: 0.6x speed from the first frame, reducedMotion at boot, no roll while steering (A21)', async ({ browser }, info) => {
  test.setTimeout(60_000);
  const ctx = await browser.newContext({ ...PHONE, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await openApp(page);
  const boot = await page.evaluate(() => ({ speed: window.__mvE2e!.sim.speed, reduced: document.querySelector('.mv-ui')!.getAttribute('data-reduced') }));
  const cdp = await ctx.newCDPSession(page);
  await drag(cdp, { x: 195, y: 200 }, 30);
  await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'play');
  const rolls = await page.evaluate(async () => {
    const cam = window.__mvE2e!.host.ctx.camera;
    const out: number[] = [];
    const t0 = performance.now();
    await new Promise<void>((res) => {
      const tick = (): void => { out.push(cam.rotation.z); if (performance.now() - t0 > 3000) res(); else requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    return { maxAbs: Math.max(...out.map(Math.abs)), n: out.length };
  });
  // Steer during the roll window too, from Node, so feel has reason to roll.
  await drag(cdp, { x: 100, y: 200 }, 200, 20);
  const after = await sim(page);
  await saveShot(page, info, 'touch-reduced-play-844x390');
  console.log(`A21 reduced ${JSON.stringify({ boot, rolls, after })}`);
  expect(boot.speed).toBeLessThanOrEqual(0.6 * 80 + 0.5);
  expect(boot.reduced).toBe('1');
  expect(rolls.maxAbs).toBe(0);
  expect(after.speed).toBeLessThanOrEqual(0.6 * 150 + 0.5);
  await ctx.close();
});
