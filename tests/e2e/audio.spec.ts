// A20 and A20n: audio waits for a real gesture. Nothing before the gesture evaluates, locates or waits on the page; the
// recorder reports through console.log, read on the Node side (plan M5, the activation trap).
import type { Browser, Page } from 'playwright/test';
import { expect, test } from '../support/pw';
import { audioRecorderScript, nodeWait, openAppUntouched, type ConsoleLog } from './lib/app';

test.beforeEach(({}, info) => { test.skip(info.project.name !== 'gpu', 'gpu only'); });

/** What the Node-side log says about audio before a gesture at index `at`. */
function beforeGesture(log: ConsoleLog, at: number): { audio: string[]; lastUa: string | undefined } {
  const pre = log.lines.slice(0, at);
  return {
    audio: pre.filter((l) => l.includes('AUDIOREC')),
    lastUa: pre.filter((l) => / UA /.test(` ${l.slice(4)} `) || l.startsWith('log UA ')).at(-1),
  };
}

/** Throws when the log shows any audio before the gesture or an activation granted by the test itself. */
function assertCleanBeforeGesture(log: ConsoleLog, at: number): void {
  const b = beforeGesture(log, at);
  if (b.audio.length > 0) throw new Error(`audio before the gesture: ${b.audio.join(' | ')}`);
  if (b.lastUa !== 'log UA false false') throw new Error(`activation before the gesture: ${b.lastUa}`);
}

async function afterGesture(log: ConsoleLog, at: number, ms = 1500): Promise<string[]> {
  await nodeWait(ms);
  return log.lines.slice(at).filter((l) => l.includes('AUDIOREC'));
}

async function untouched(page: Page): Promise<ConsoleLog> {
  await page.addInitScript(audioRecorderScript);
  const log = await openAppUntouched(page);
  await nodeWait(2000);
  return log;
}

test('mouse: nothing before the gesture, Escape does not count, a real click starts a running context and sources (A20)', async ({ page }) => {
  const log = await untouched(page);
  await page.keyboard.press('Escape');
  await nodeWait(500);
  const at = log.lines.length;
  assertCleanBeforeGesture(log, at);
  await page.mouse.click(960, 700);
  const after = await afterGesture(log, at);
  const mode = await page.locator('html').getAttribute('data-mv-mode');
  console.log(`A20 mouse: before ${JSON.stringify(beforeGesture(log, at))}, after ${JSON.stringify(after.slice(0, 4))} (${after.length}), mode ${mode}`);
  expect(after[0]).toBe('log AUDIOREC new AudioContext running');
  expect(after.some((l) => /AUDIOREC start (source|buffer)/.test(l))).toBe(true);
  expect(mode).toBe('play');
});

test('key a launches with a running context (A20)', async ({ page }) => {
  const log = await untouched(page);
  const at = log.lines.length;
  assertCleanBeforeGesture(log, at);
  await page.keyboard.press('KeyA');
  const after = await afterGesture(log, at);
  console.log(`A20 key: ${JSON.stringify(after.slice(0, 3))}`);
  expect(after[0]).toBe('log AUDIOREC new AudioContext running');
});

// Amendment LS: a phone held upright shows the rotate gate (tests/views/rotate.spec.ts), so this phone is held sideways.
async function touchPage(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  return { page, close: () => ctx.close() };
}

test('touch tap launches with a running context (A20)', async ({ browser }) => {
  const { page, close } = await touchPage(browser);
  const log = await untouched(page);
  const at = log.lines.length;
  assertCleanBeforeGesture(log, at);
  await page.touchscreen.tap(422, 120);
  const after = await afterGesture(log, at);
  console.log(`A20 tap: ${JSON.stringify(after.slice(0, 3))}`);
  expect(after[0]).toBe('log AUDIOREC new AudioContext running');
  await close();
});

test('touch drag with no click launches with a running context (A20)', async ({ browser }) => {
  const { page, close } = await touchPage(browser);
  const log = await untouched(page);
  const at = log.lines.length;
  assertCleanBeforeGesture(log, at);
  const cdp = await page.context().newCDPSession(page);
  const pt = (x: number, y: number) => [{ x, y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(150, 200) });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(150 + i * 10, 200) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const after = await afterGesture(log, at);
  console.log(`A20 drag: ${JSON.stringify(after.slice(0, 3))}`);
  expect(after[0]).toBe('log AUDIOREC new AudioContext running');
  await close();
});

test.describe('controls (A20n)', () => {
  test('an evaluate before the wait grants activation, which the clean-wait check catches', async ({ page }) => {
    await page.addInitScript(audioRecorderScript);
    const log = await openAppUntouched(page);
    await page.evaluate(() => 1);
    await nodeWait(500);
    const at = log.lines.length;
    const b = beforeGesture(log, at);
    console.log(`A20n evaluate trap: last UA ${b.lastUa}`);
    expect(b.lastUa).toBe('log UA true true');
    expect(() => { assertCleanBeforeGesture(log, at); }).toThrow('activation before the gesture');
  });

  // The control asserts its own reason. A bare test.fail() would pass for any failure of the body, an MV_READY timeout
  // or a broken fixture included (VI-gates), so it could not show that the helper sees a context built before a gesture.
  test('a page that builds an AudioContext at load is reported by the helper', async ({ page }) => {
    await page.addInitScript(audioRecorderScript);
    await page.addInitScript(() => { window.addEventListener('DOMContentLoaded', () => { new AudioContext(); }); });
    const log = await openAppUntouched(page);
    await nodeWait(1000);
    const at = log.lines.length;
    const b = beforeGesture(log, at);
    console.log(`A20n load context: ${JSON.stringify(b.audio.slice(0, 2))}, last UA ${b.lastUa}`);
    expect(b.audio[0], 'the planted context is what the recorder saw first').toBe('log AUDIOREC new AudioContext suspended');
    expect(b.lastUa, 'no activation, so only the planted context can fail the check').toBe('log UA false false');
    expect(() => { assertCleanBeforeGesture(log, at); }).toThrow(/^audio before the gesture: log AUDIOREC new AudioContext suspended/);
  });
});
