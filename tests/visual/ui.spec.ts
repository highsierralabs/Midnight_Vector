// Every browser test of T08, grouped by describe prefix (plan section 7). The page is three-free: a CSS backdrop stands
// in for the canvas, and the UI is driven by scripted frames, so no test here depends on a GPU or on rAF timing unless
// it says so.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type CDPSession, type Page, type TestInfo } from 'playwright/test';
import { Ev, SimMode, type HarnessApi } from '../../src/contracts/index';
import { AUTOPILOT_TAG } from '../../src/ui/copy';
import type { DevCall, StateName } from '../../src/ui/devPage';
import { expect, saveShot, test } from '../support/pw';

const PAGE = '/dev/ui.html';

function url(query: Record<string, string | number> = {}): string {
  const q = new URLSearchParams(Object.entries(query).map(([k, v]): [string, string] => [k, String(v)])).toString();
  return q === '' ? PAGE : `${PAGE}?${q}`;
}

/** Reading results is only safe after the gesture: evaluate grants activation. */
async function callsOf(page: Page): Promise<DevCall[]> {
  return page.evaluate(() => window.__ui!.calls.map((c) => ({ ...c })));
}
async function callNames(page: Page, name: string): Promise<DevCall[]> {
  return (await callsOf(page)).filter((c) => c.name === name);
}

async function sample(page: Page) {
  return page.evaluate(() => window.__ui!.sample());
}

/** Chromium delivers pointermove aligned to frames, so the last move of a drag may still be queued. */
async function afterFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((done) => { requestAnimationFrame(() => { requestAnimationFrame(done); }); }));
}

async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', points: readonly { x: number; y: number; id: number }[]): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id })) });
}

async function rectOf(page: Page, selector: string): Promise<{ x: number; y: number; w: number; h: number }> {
  return page.evaluate((s) => {
    const r = document.querySelector(s)!.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }, selector);
}

const nodeWait = (ms: number): Promise<void> => new Promise((done) => { setTimeout(done, ms); });

// ---- A27, DI-90: test:software runs tests/visual under the software project, at 640x360 on SwiftShader. Every row in
// this file is a DOM row on a three-free page, or the app at the gpu project's 1920x1080, so none is meant for software:
// the input chord, the gesture click and the firstshow panels assume the gpu viewport and fail there. Each row is
// skipped, and the reason is printed once. ----

const SOFTWARE_SKIP = 'T08 ui.spec: DOM rows written for the gpu project (1920x1080, hardware Chromium); none is meant for SwiftShader (DI-90)';
let softwareSaid = false;
test.beforeEach(({}, info) => {
  if (info.project.name !== 'software') return;
  if (!softwareSaid) {
    softwareSaid = true;
    console.log(`SKIP software project: ${SOFTWARE_SKIP}`);
  }
  test.skip(true, SOFTWARE_SKIP);
});

// ---- input: A3, A15 ----

test.describe('input:', () => {
  test('real keyboard sets moveX and moveY, and release clears', async ({ page }) => {
    await page.goto(url({ state: 'play' }));
    await page.keyboard.down('KeyD');
    let f = await sample(page);
    expect(f).toMatchObject({ moveX: 1, moveY: 0, absolute: false, human: true });
    await page.keyboard.up('KeyD');
    await page.keyboard.down('ArrowUp');
    f = await sample(page);
    expect(f).toMatchObject({ moveX: 0, moveY: 1, absolute: false });
    await page.keyboard.up('ArrowUp');
    await sample(page);
    f = await sample(page);
    expect(f).toMatchObject({ moveX: 0, moveY: 0, absolute: false, human: false });
  });

  test('real mouse sets an absolute target at measured element positions, and the left button boosts', async ({ page }) => {
    await page.goto(url({ state: 'play' }));
    const { w, h } = await rectOf(page, '#stage');
    await page.mouse.move(w / 2, h / 2);
    let f = await sample(page);
    expect(f.absolute).toBe(true);
    expect(Math.abs(f.moveX)).toBeLessThan(0.01);
    expect(Math.abs(f.moveY)).toBeLessThan(0.01);
    await page.mouse.move(w * 0.9, h * 0.1);
    f = await sample(page);
    expect(f.moveX).toBeCloseTo(1, 2);
    expect(f.moveY).toBeCloseTo(1, 2);
    await page.mouse.move(w * 0.3, h * 0.75);
    f = await sample(page);
    expect(f.moveX).toBeCloseTo(-0.5, 2);
    expect(f.moveY).toBeCloseTo(-0.625, 2);
    await page.mouse.down();
    expect((await sample(page)).boost).toBe(true);
    await page.mouse.up();
    expect((await sample(page)).boost).toBe(false);
    await page.mouse.down({ button: 'right' });
    const right = await sample(page);
    expect(right.boost).toBe(false);
    expect(right.human).toBe(true);
    await page.mouse.up({ button: 'right' });
  });

  test('a chord that adds the left button to a right press boosts, and releasing it stops', async ({ page }) => {
    await page.goto(url({ state: 'play' }));
    await page.mouse.move(500, 500);
    await page.mouse.down({ button: 'right' });
    await page.mouse.down({ button: 'left' });
    expect((await sample(page)).boost).toBe(true);
    await page.mouse.up({ button: 'left' });
    expect((await sample(page)).boost).toBe(false);
    await page.mouse.up({ button: 'right' });
  });

  test('Space on body has defaultPrevented, and boosts', async ({ page }) => {
    await page.goto(url({ state: 'play' }));
    await page.evaluate(() => {
      window.addEventListener('keydown', (e) => {
        document.documentElement.dataset['spacePrevented'] = String(e.defaultPrevented);
      });
    });
    await page.keyboard.down('Space');
    expect(await page.evaluate(() => document.documentElement.dataset['spacePrevented'])).toBe('true');
    expect((await sample(page)).boost).toBe(true);
    await page.keyboard.up('Space');
    expect((await sample(page)).boost).toBe(false);
  });

  test('with focus on a slider, arrows move the slider and leave moveX at 0', async ({ page }) => {
    await page.goto(url({ state: 'cruise' }));
    const music = page.locator('[data-mv="music"]');
    await music.focus();
    const before = await music.inputValue();
    await page.keyboard.press('ArrowRight');
    expect(await music.inputValue()).not.toBe(before);
    await page.keyboard.down('ArrowRight');
    const f = await sample(page);
    expect(f.moveX).toBe(0);
    expect(f.absolute).toBe(false);
    await page.keyboard.up('ArrowRight');
  });

  test('touchAction is none after attach and restored after detach, and after detach events change nothing', async ({ page }) => {
    await page.goto(url({ state: 'play' }));
    const action = (): Promise<string> => page.evaluate(() => getComputedStyle(window.__ui!.stage).touchAction);
    expect(await action()).toBe('none');
    await page.evaluate(() => { window.__ui!.input.detach(); });
    expect(await action()).toBe('auto');
    await sample(page);
    await page.keyboard.down('KeyD');
    await page.mouse.move(100, 100);
    await page.mouse.down();
    const f = await sample(page);
    expect(f).toEqual({ moveX: 0, moveY: 0, absolute: false, boost: false, human: false });
    await page.mouse.up();
    await page.keyboard.up('KeyD');
    await page.evaluate(() => { window.__ui!.input.detach(); window.__ui!.input.attach(window.__ui!.stage); });
    expect(await action()).toBe('none');
    await page.keyboard.down('KeyA');
    expect((await sample(page)).moveX).toBe(-1);
  });

  test('attach twice and detach twice are safe', async ({ page }) => {
    await page.goto(url({ state: 'play' }));
    await page.evaluate(() => {
      const { input, stage } = window.__ui!;
      input.attach(stage);
      input.attach(stage);
      input.detach();
      input.detach();
    });
    expect(await page.evaluate(() => window.__ui!.stage.style.touchAction)).toBe('');
  });

  test('after window blur, held keys clear', async ({ page }) => {
    await page.goto(url({ state: 'play' }));
    await page.keyboard.down('KeyD');
    await page.keyboard.down('Space');
    expect((await sample(page)).moveX).toBe(1);
    await page.evaluate(() => { window.dispatchEvent(new Event('blur')); });
    const f = await sample(page);
    expect(f).toMatchObject({ moveX: 0, boost: false, human: false });
    await page.keyboard.up('KeyD');
    await page.keyboard.up('Space');
  });

  test('a synthetic hidden state clears held keys', async ({ page }) => {
    await page.goto(url({ state: 'play' }));
    await page.keyboard.down('KeyD');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect((await sample(page)).moveX).toBe(0);
    await page.keyboard.up('KeyD');
  });

  test('A15: the page loads no engine', async ({ page }) => {
    const urls: string[] = [];
    page.on('request', (r) => urls.push(r.url()));
    await page.goto(url({ state: 'play' }));
    await page.waitForLoadState('networkidle');
    expect(urls.length).toBeGreaterThan(3);
    expect(urls.filter((u) => /three|postprocessing/.test(u))).toEqual([]);
    expect(urls.filter((u) => u.includes('/src/ui/index.ts')).length).toBe(1);
  });
});

test.describe('input: touch', () => {
  test.use({ viewport: { width: 800, height: 400 }, hasTouch: true });

  test('a CDP drag moves the target by the expected amount, and a second touch boosts', async ({ page, context }) => {
    await page.goto(url({ state: 'play' }));
    const cdp = await context.newCDPSession(page);
    await touch(cdp, 'touchStart', [{ x: 200, y: 200, id: 1 }]);
    let f = await sample(page);
    expect(f).toMatchObject({ moveX: 0, moveY: 0, absolute: false, human: true });
    // minDim is 400, so 60 px is 2 * 60 / 240 = .5 of the window.
    for (let i = 1; i <= 6; i++) await touch(cdp, 'touchMove', [{ x: 200 + i * 10, y: 200 - i * 5, id: 1 }]);
    await afterFrames(page);
    f = await sample(page);
    expect(f.absolute).toBe(true);
    expect(f.moveX).toBeCloseTo(0.5, 5);
    expect(f.moveY).toBeCloseTo(0.25, 5);
    expect(f.boost).toBe(false);
    await touch(cdp, 'touchStart', [{ x: 260, y: 170, id: 1 }, { x: 600, y: 300, id: 2 }]);
    f = await sample(page);
    expect(f.boost).toBe(true);
    expect(f.moveX).toBeCloseTo(0.5, 5);
    await touch(cdp, 'touchEnd', [{ x: 600, y: 300, id: 2 }]);
    f = await sample(page);
    expect(f.boost).toBe(false);
    expect(f.moveX).toBeCloseTo(0.5, 5);
    await touch(cdp, 'touchEnd', []);
    await sample(page);
    f = await sample(page);
    expect(f.human).toBe(false);
    expect(f.moveX).toBeCloseTo(0.5, 5);
    await cdp.detach();
  });
});

test.describe('input: boost button', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });

  test('pressing [data-mv-boost] in the real UI sets boost and clears on release, and is not a steer finger', async ({ page, context }) => {
    await page.goto(url({ state: 'play' }));
    const b = await rectOf(page, '[data-mv-boost]');
    expect(b.w).toBeGreaterThanOrEqual(44);
    const cdp = await context.newCDPSession(page);
    const at = { x: b.x + b.w / 2, y: b.y + b.h / 2, id: 1 };
    await touch(cdp, 'touchStart', [at]);
    let f = await sample(page);
    expect(f.boost).toBe(true);
    await touch(cdp, 'touchMove', [{ ...at, x: at.x - 4, y: at.y + 3 }]);
    f = await sample(page);
    expect(f.boost).toBe(true);
    expect(f.absolute).toBe(false);
    expect(f.moveX).toBe(0);
    await touch(cdp, 'touchEnd', []);
    f = await sample(page);
    expect(f.boost).toBe(false);
    await cdp.detach();
  });
});

// ---- input: focus, A21 (VI-game). A focused button or box keeps only Space and Enter, a radio its arrows as well, and
// every other steering key still steers. In PLAY a steering key or Space on a focused II hands the keyboard back. ----

const activeHookOf = (page: Page): Promise<string | null> => page.evaluate(() => {
  const a = document.activeElement;
  return a === document.body ? 'body' : a?.getAttribute('data-mv') ?? a?.tagName ?? null;
});

/** Where focus is, and whether it shows the ring. */
const focusRing = (page: Page): Promise<{ at: string | null; visible: boolean; style: string }> => page.evaluate(() => {
  const a = document.activeElement!;
  return { at: a === document.body ? 'body' : a.getAttribute('data-mv'), visible: a.matches(':focus-visible'), style: getComputedStyle(a).outlineStyle };
});

test.describe('input: focus', () => {
  /** In PLAY a Tab reaches II, the one control there a keyboard can reach. */
  async function tabToMenuButton(page: Page): Promise<void> {
    await page.goto(url({ state: 'play' }));
    await page.keyboard.press('Tab');
    expect(await activeHookOf(page)).toBe('menu-button');
  }

  test('Tab in PLAY, then ArrowLeft steers and hands focus back, and Space then boosts', async ({ page }) => {
    await tabToMenuButton(page);
    await page.keyboard.down('ArrowLeft');
    expect(await sample(page)).toMatchObject({ moveX: -1, moveY: 0, absolute: false });
    await page.keyboard.up('ArrowLeft');
    expect(await activeHookOf(page)).toBe('body');
    await page.keyboard.down('Space');
    expect((await sample(page)).boost).toBe(true);
    await page.keyboard.up('Space');
    await page.evaluate(() => { window.__ui!.step(2); });
    expect(await callNames(page, 'togglePause')).toEqual([]);
    await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'play');
  });

  test('Tab in PLAY, then Space boosts on its first press and does not press II', async ({ page }) => {
    await tabToMenuButton(page);
    await page.keyboard.down('Space');
    expect((await sample(page)).boost).toBe(true);
    expect(await activeHookOf(page)).toBe('body');
    await page.keyboard.up('Space');
    await page.evaluate(() => { window.__ui!.step(2); });
    expect(await callNames(page, 'togglePause')).toEqual([]);
    await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'play');
  });

  test('WASD steers from a focused II, and Enter on it still opens CRUISE', async ({ page }) => {
    await tabToMenuButton(page);
    await page.keyboard.down('KeyD');
    expect((await sample(page)).moveX).toBe(1);
    await page.keyboard.up('KeyD');
    expect(await activeHookOf(page)).toBe('body');
    // Printed, not judged: the next Tab starts from II's place, and II is the last control in PLAY (section 10).
    await page.keyboard.press('Tab');
    const once = await activeHookOf(page);
    await page.keyboard.press('Tab');
    console.log(`A21 after the hand-back: Tab once ${once}, twice ${await activeHookOf(page)}`);
    await tabToMenuButton(page);
    await page.keyboard.press('Enter');
    expect((await callNames(page, 'togglePause')).length).toBe(1);
  });

  test('on RESUME and a checkbox WASD and arrows steer while Space still presses or ticks; on a radio arrows still choose and WASD steers', async ({ page }) => {
    await page.goto(url({ state: 'cruise' }));
    // A button the hand-back does not cover: RESUME, focused as the card opens.
    expect(await activeHookOf(page)).toBe('resume');
    await page.keyboard.down('KeyD');
    expect((await sample(page)).moveX).toBe(1);
    await page.keyboard.up('KeyD');
    await page.keyboard.down('ArrowLeft');
    expect((await sample(page)).moveX).toBe(-1);
    await page.keyboard.up('ArrowLeft');
    expect(await activeHookOf(page)).toBe('resume');
    expect(await callNames(page, 'togglePause')).toEqual([]);
    const mute = page.locator('[data-mv="mute-toggle"]');
    await mute.focus();
    await page.keyboard.down('KeyA');
    expect((await sample(page)).moveX).toBe(-1);
    await page.keyboard.up('KeyA');
    await page.keyboard.down('ArrowRight');
    expect((await sample(page)).moveX).toBe(1);
    await page.keyboard.up('ArrowRight');
    const was = await mute.isChecked();
    await page.keyboard.down('Space');
    expect((await sample(page)).boost).toBe(false);
    await page.keyboard.up('Space');
    expect(await mute.isChecked()).toBe(!was);

    const radios = page.getByRole('radio');
    await radios.first().focus();
    await page.keyboard.down('ArrowDown');
    expect(await sample(page)).toMatchObject({ moveX: 0, moveY: 0 });
    await page.keyboard.up('ArrowDown');
    await expect(radios.nth(1)).toBeChecked();
    await page.keyboard.down('KeyD');
    expect((await sample(page)).moveX).toBe(1);
    await page.keyboard.up('KeyD');
  });
});

// ---- input: mouse corner, A22 (VI-game). The mouse's saturated corner, where the cursor is hidden in play, is where II
// sits, so under a fine pointer II takes no mouse press in PLAY; Esc, P and the keyboard open CRUISE. Touch keeps it. ----

async function hitAt(page: Page, x: number, y: number): Promise<string | null> {
  return page.evaluate(({ px, py }) => {
    const el = document.elementFromPoint(px, py);
    return el === null ? null : el.id || el.getAttribute('data-mv') || el.tagName;
  }, { px: x, py: y });
}

test.describe('input: mouse corner', () => {
  test('on a fine pointer in PLAY a press on II reaches the stage and boosts, opens nothing, and Esc still opens CRUISE', async ({ page }) => {
    await page.goto(url({ state: 'play' }));
    const m = await rectOf(page, '[data-mv="menu-button"]');
    const at = { x: m.x + m.w / 2, y: m.y + m.h / 2 };
    expect(await hitAt(page, at.x, at.y)).toBe('stage');
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    expect((await sample(page)).boost).toBe(true);
    await page.mouse.up();
    await page.evaluate(() => { window.__ui!.step(2); });
    expect(await callNames(page, 'togglePause')).toEqual([]);
    await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'play');
    await expect(page.locator('.mv-legend.mv-if-fine')).toContainText('ESC / P CRUISE');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.__ui!.step(2); });
    expect((await callNames(page, 'togglePause')).length).toBe(1);
    await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'cruise');
  });
});

test.describe('input: mouse corner, touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });

  test('on a touch screen II still takes the tap in PLAY', async ({ page }) => {
    await page.goto(url({ state: 'play' }));
    const m = await rectOf(page, '[data-mv="menu-button"]');
    const at = { x: m.x + m.w / 2, y: m.y + m.h / 2 };
    expect(await hitAt(page, at.x, at.y)).toBe('menu-button');
    await page.touchscreen.tap(at.x, at.y);
    await page.waitForTimeout(100);
    expect((await callNames(page, 'togglePause')).length).toBe(1);
  });
});

// ---- gesture: A4. Nothing below may evaluate, use a locator, or wait on anything but time before its gesture. ----

test.describe('gesture:', () => {
  test('a mouse click launches inside pointerup and click, with audio running', async ({ page }) => {
    await page.goto(url({ audioprobe: 1 }));
    await page.mouse.click(640, 360);
    const launches = await callNames(page, 'launch');
    expect(launches.map((c) => c.event)).toEqual(['pointerup', 'click']);
    for (const c of launches) expect(c.audio).toBe('running');
  });

  test('key a launches with audio running', async ({ page }) => {
    await page.goto(url({ audioprobe: 1 }));
    await page.keyboard.press('a');
    const launches = await callNames(page, 'launch');
    expect(launches.length).toBe(1);
    expect(launches[0]!.event).toBe('keydown');
    expect(launches[0]!.audio).toBe('running');
  });

  test('a page left alone for 2 s has not launched', async ({ page }) => {
    await page.goto(url({ audioprobe: 1 }));
    await page.waitForTimeout(2000);
    expect(await callNames(page, 'launch')).toEqual([]);
  });

  test('control: Escape gives no launch, and its own context reads suspended', async ({ page }) => {
    await page.goto(url({ audioprobe: 1 }));
    await page.keyboard.press('Escape');
    expect(await callNames(page, 'launch')).toEqual([]);
    const probes = await callNames(page, 'probe-Escape');
    expect(probes.length).toBe(1);
    expect(probes[0]!.audio).toBe('suspended');
  });

  test('control: Tab gives no launch although Tab does grant activation', async ({ page }) => {
    await page.goto(url({ audioprobe: 1 }));
    await page.keyboard.press('Tab');
    expect(await callNames(page, 'launch')).toEqual([]);
    const probes = await callNames(page, 'probe-Tab');
    expect(probes.length).toBe(1);
    expect(probes[0]!.audio).toBe('running');
  });

  test('control: audioprobe=early reads suspended at load', async ({ page }) => {
    await page.goto(url({ audioprobe: 'early' }));
    await page.waitForTimeout(100);
    const early = await callNames(page, 'early');
    expect(early.length).toBe(1);
    expect(early[0]!.audio).toBe('suspended');
    expect(await callNames(page, 'launch')).toEqual([]);
  });

  test('a right click, M, P and Shift do not launch', async ({ page }) => {
    await page.goto(url({ audioprobe: 1 }));
    await page.mouse.click(640, 360, { button: 'right' });
    await page.keyboard.press('KeyM');
    await page.keyboard.press('KeyP');
    await page.keyboard.press('Shift');
    expect(await callNames(page, 'launch')).toEqual([]);
  });

  test('no launch once the mode has left DEMO', async ({ page }) => {
    await page.goto(url({ state: 'play' }));
    await page.keyboard.press('a');
    await page.mouse.click(640, 360);
    expect(await callNames(page, 'launch')).toEqual([]);
  });

  test('after launch the title goes, focus leaves it, and Space is boost', async ({ page }) => {
    await page.goto(url());
    await page.keyboard.press('Enter');
    expect((await callNames(page, 'launch')).length).toBeGreaterThanOrEqual(1);
    await page.evaluate(() => { window.__ui!.step(2); });
    await expect(page.locator('[data-mv="title"]')).toBeHidden();
    await expect(page.locator('[data-mv="hud"]')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'play');
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    await page.keyboard.down('Space');
    expect((await sample(page)).boost).toBe(true);
    await page.keyboard.up('Space');
  });

  // Chromium drops focus from a button that becomes display:none by itself, so the test above cannot see the blur in
  // src/ui/index.ts. Here the focused element stays visible, as a page control outside the UI would.
  test('leaving DEMO blurs a focused element that stays visible, so Space is boost', async ({ page }) => {
    await page.goto(url());
    await page.evaluate(() => {
      const b = document.createElement('button');
      b.id = 'outside';
      b.textContent = 'outside';
      b.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483647';
      document.body.append(b);
      b.focus();
    });
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('outside');
    await page.keyboard.press('a');
    expect((await callNames(page, 'launch')).length).toBeGreaterThanOrEqual(1);
    await page.evaluate(() => { window.__ui!.step(2); });
    await expect(page.locator('#outside')).toBeVisible();
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    await page.keyboard.down('Space');
    expect((await sample(page)).boost).toBe(true);
    await page.keyboard.up('Space');
  });
});

test.describe('gesture: touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });

  test('a touch tap launches with audio running', async ({ page }) => {
    await page.goto(url({ audioprobe: 1 }));
    await page.touchscreen.tap(200, 500);
    const launches = await callNames(page, 'launch');
    expect(launches.length).toBeGreaterThanOrEqual(1);
    expect(launches[0]!.event).toBe('pointerup');
    for (const c of launches) expect(c.audio).toBe('running');
  });

  test('a touch drag launches on pointerup, with no click, and audio running', async ({ page, context }) => {
    await page.goto(url({ audioprobe: 1 }));
    const cdp = await context.newCDPSession(page);
    await touch(cdp, 'touchStart', [{ x: 100, y: 500, id: 1 }]);
    for (let i = 1; i <= 8; i++) await touch(cdp, 'touchMove', [{ x: 100 + i * 15, y: 500 - i * 6, id: 1 }]);
    await touch(cdp, 'touchEnd', []);
    const launches = await callNames(page, 'launch');
    expect(launches.map((c) => c.event)).toEqual(['pointerup']);
    expect(launches[0]!.audio).toBe('running');
    await cdp.detach();
  });

  test('touch pointerdown alone does not launch', async ({ page, context }) => {
    await page.goto(url({ audioprobe: 1 }));
    const cdp = await context.newCDPSession(page);
    await touch(cdp, 'touchStart', [{ x: 100, y: 500, id: 1 }]);
    await page.waitForTimeout(100);
    expect(await callNames(page, 'launch')).toEqual([]);
    await touch(cdp, 'touchEnd', []);
    expect((await callNames(page, 'launch')).length).toBeGreaterThanOrEqual(1);
    await cdp.detach();
  });

  test('a tap that launches does not also open the menu under the finger, and the button works a moment later', async ({ page }) => {
    await page.goto(url({ state: 'play' }));
    const m = await rectOf(page, '[data-mv="menu-button"]');
    expect(m.w).toBeGreaterThanOrEqual(44);
    await page.goto(url());
    // The race made certain: the HUD replaces the title between pointerup and the click that follows it. Not a gesture
    // test, so this evaluate does no harm. Without the guard in src/ui/index.ts this records a togglePause.
    await page.evaluate(() => {
      document.querySelector('[data-mv="title"]')!.addEventListener('pointerup', () => { window.__ui!.step(2); });
    });
    await page.touchscreen.tap(m.x + m.w / 2, m.y + m.h / 2);
    await page.waitForTimeout(100);
    await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'play');
    expect((await callNames(page, 'launch')).length).toBeGreaterThanOrEqual(1);
    expect(await callNames(page, 'togglePause')).toEqual([]);

    await page.evaluate(() => { window.__ui!.step(6); });
    await page.touchscreen.tap(m.x + m.w / 2, m.y + m.h / 2);
    await page.waitForTimeout(100);
    expect((await callNames(page, 'togglePause')).length).toBe(1);
  });
});

// ---- gesture: boot, A26 (DI-95). Until html[data-mv-boot] reads running the prompt says LOADING and nothing launches.
// The dev page has no boot to wait for, so ?boot=loading sets the attribute before mount and ?bootms flips it to running
// on a timer, which touches the page no more than time does. ----

test.describe('gesture: boot', () => {
  test('while the host reports loading the prompt reads LOADING and a key or click launches nothing; once running a key launches', async ({ page }, info) => {
    await page.goto(url({ boot: 'loading', bootms: 1500 }));
    await page.keyboard.press('a');
    await page.mouse.click(640, 360);
    await page.keyboard.press('Enter');
    expect(await callNames(page, 'launch')).toEqual([]);
    await expect(page.locator('html')).toHaveAttribute('data-mv-boot', 'loading');
    await expect(page.getByRole('button', { name: 'LOADING' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'LAUNCH', exact: true })).toHaveCount(0);
    await saveShot(page, info, 'title-loading');
    await expect(page.locator('html')).toHaveAttribute('data-mv-boot', 'running', { timeout: 5000 });
    await expect(page.getByRole('button', { name: 'LAUNCH', exact: true })).toBeVisible();
    await page.keyboard.press('a');
    expect((await callNames(page, 'launch')).length).toBe(1);
  });
});

test.describe('gesture: boot, touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });

  test('while loading the prompt reads LOADING in place of LAUNCH, and a tap launches nothing', async ({ page }, info) => {
    await page.goto(url({ boot: 'loading' }));
    await page.touchscreen.tap(200, 500);
    await page.waitForTimeout(100);
    expect(await callNames(page, 'launch')).toEqual([]);
    await expect(page.getByRole('button', { name: 'LOADING' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'LAUNCH', exact: true })).toHaveCount(0);
    await saveShot(page, info, 'title-loading-phone');
  });
});

/**
 * The app on a cold load: an init script logs, to the console only, when the title appears, when data-mv-boot changes,
 * each keydown with the boot state and the prompt then shown, and every AudioContext built or started. So nothing before
 * the first press grants activation, and the press can land in the loading window.
 */
function coldLoadProbe(): void {
  const t0 = performance.now();
  const ms = (): number => Math.round(performance.now() - t0);
  const boot = (): string => document.documentElement.getAttribute('data-mv-boot') ?? 'none';
  const prompt = (): string => {
    const b = document.querySelector('[data-mv="launch"]');
    if (!b) return 'none';
    for (const s of Array.from(b.children)) if (getComputedStyle(s).display !== 'none') return (s.textContent ?? '').trim();
    return '';
  };
  let titled = false;
  let lastBoot = '';
  new MutationObserver(() => {
    if (!titled && document.querySelector('[data-mv="title"]')) {
      titled = true;
      console.log(`MVB title ${ms()} boot=${boot()} prompt=${prompt()}`);
    }
    if (boot() !== lastBoot) {
      lastBoot = boot();
      console.log(`MVB boot ${lastBoot} ${ms()}`);
    }
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-mv-boot'] });
  window.addEventListener('keydown', (e) => {
    console.log(`MVB press ${e.code} ${ms()} boot=${boot()} prompt=${prompt()} mode=${document.documentElement.getAttribute('data-mv-mode')}`);
  }, true);
  const C = window.AudioContext;
  window.AudioContext = class extends C {
    constructor(...a: ConstructorParameters<typeof AudioContext>) {
      super(...a);
      console.log(`MVB audio new ${this.state} ${ms()}`);
    }
  };
}

test.describe('gesture: cold load', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'gpu', 'the app needs the gpu project'); });

  test('a press at about 200 ms on a cold load, while data-mv-boot reads loading, launches nothing and builds no audio; once running a press launches (DI-95)', async ({ page }) => {
    test.setTimeout(60_000);
    await page.addInitScript(coldLoadProbe);
    const lines: string[] = [];
    page.on('console', (m) => { if (m.text().startsWith('MVB ')) lines.push(m.text()); });
    const titled = page.waitForEvent('console', { predicate: (m) => m.text().startsWith('MVB title'), timeout: 30_000 });
    const running = page.waitForEvent('console', { predicate: (m) => m.text().startsWith('MVB boot running'), timeout: 30_000 });
    const t0 = Date.now();
    await page.goto('/', { waitUntil: 'commit' });
    await titled;
    const wait = 200 - (Date.now() - t0);
    if (wait > 0) await nodeWait(wait);
    const pressAt = Date.now() - t0;
    await page.keyboard.press('Space');
    await running;
    await nodeWait(500);
    const early = [...lines];
    const after = await page.evaluate(() => {
      const b = document.querySelector('[data-mv="launch"]')!;
      let shown = '';
      for (const s of Array.from(b.children)) if (getComputedStyle(s).display !== 'none') shown = (s.textContent ?? '').trim();
      return { mode: document.documentElement.getAttribute('data-mv-mode'), prompt: shown };
    });
    console.log(`COLDLOAD press at ${pressAt} ms after commit: ${early.join(' | ')}; once running: mode ${after.mode}, prompt ${after.prompt}`);
    const press = early.find((l) => l.startsWith('MVB press Space'));
    expect(press, 'the press reached the page').toBeDefined();
    expect(press).toContain('boot=loading');
    expect(after.mode, 'the early press launched nothing').toBe('demo');
    expect(early.filter((l) => l.startsWith('MVB audio')), 'the early press built no AudioContext').toEqual([]);
    expect(press).toContain('prompt=LOADING');
    // E5 (amendment LH): the start button's label, where the prompt was.
    expect(after.prompt).toBe('LAUNCH');

    await page.keyboard.press('Space');
    await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'play');
    const audio = lines.filter((l) => l.startsWith('MVB audio'));
    console.log(`COLDLOAD second press: ${audio.join(' | ')}`);
    expect(audio.length).toBeGreaterThan(0);
    expect(audio[0]).toContain('new running');
  });
});

// ---- writes: A5, A5n ----

interface WriteCount { records: number; setProperty: number; writes: number; perSimulatedSecond: number }

/** The setProperty wrapper must be in place before the page's own code runs. */
async function openCounting(page: Page, query: Record<string, string | number>): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __sp: number };
    w.__sp = 0;
    const real = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function setProperty(this: CSSStyleDeclaration, ...args: Parameters<typeof real>) {
      w.__sp++;
      return real.apply(this, args);
    };
  });
  await page.goto(url(query));
}

type Scenario = 'idle-play' | 'cruise' | 'boost' | 'adversarial';

/** A synchronous loop at 60 simulated fps. An observer's style records are dropped, because the wrapper counts those writes. */
async function countWrites(page: Page, scenario: Scenario, cockpit = false): Promise<WriteCount> {
  return page.evaluate(({ scenario, cockpit, PLAY, SHARD, GATE, GRAZE, HIT, GATE_MISS, GRADE }) => {
    const dev = window.__ui!;
    dev.state('play');
    const w = window as unknown as { __sp: number };
    const t0 = dev.clock() + 1;
    // The zone the play state is in, so these frames set off no sector banner.
    const ZONE = { chunk: 777, local: 32 };
    const ev = (kind: number, value: number, index = 0) => ({ kind: kind as never, x: 0, y: 6, value, chunk: 0, index });
    const held = {
      mode: PLAY as never, autopilot: false, score: 1000, sync: 3, shields: 2, overdrive: 0.5, ghost: 0, beat: 5.2,
      objectiveProgress: 3, travel: { chunk: 800, local: 0 }, warpSerial: 0,
    };
    let score = 1000;
    let sync = 3;
    let progress = 0;
    const FRAMES = 600;

    // Amendment VW (T13 A11): the same frames drawn with the cockpit camera, its dashboard fully in.
    const options = (i: number) => (cockpit ? { ...scene(i), cam: { mode: 1 as never, ahead: 14, cockpitIn: 1 } } : scene(i));
    const scene = (i: number) => {
      const t = i / 60;
      const tick = Math.floor(t * 120);
      if (scenario === 'idle-play') return { at: ZONE, sim: held };
      const prev = (i - 1) / 60;
      if (scenario === 'cruise') {
        const events = [];
        const beat = tick / 72;
        if (Math.floor(t / 0.15) !== Math.floor(prev / 0.15)) { score += 100 * sync; events.push(ev(SHARD, 100 * sync)); }
        if (Math.floor(t / 2.4) !== Math.floor(prev / 2.4)) {
          score += 500 * sync;
          events.push(ev(GATE, 500 * sync));
          sync = Math.min(16, sync + 1);
          progress++;
        }
        // Overdrive wraps instead of filling and stopping, so the bar keeps costing writes: the worse case.
        const overdrive = (Math.floor(t / 0.15) * 0.08) % 1;
        const d = 80 * t;
        return { at: ZONE, events, sim: { ...held, score, sync, overdrive, beat, objectiveProgress: progress, travel: { chunk: 800 + Math.floor(d / 64), local: d % 64 } } };
      }
      if (scenario === 'boost') {
        const events = [];
        const beat = tick / 72;
        if (Math.floor(t / 0.08) !== Math.floor(prev / 0.08)) { score += 200 * sync; events.push(ev(SHARD, 200 * sync)); }
        const overdrive = 1 - ((t / 6) % 1);
        const d = 150 * t;
        return { at: ZONE, events, sim: { ...held, score, overdrive, beat, travel: { chunk: 800 + Math.floor(d / 64), local: d % 64 } } };
      }
      // Adversarial: every field the HUD shows changes every frame, palette and sector included.
      const kinds = [GATE, GRAZE, HIT, GATE_MISS, GRADE];
      return {
        at: { chunk: 100 * (i + 8), local: 0 },
        events: [ev(kinds[i % kinds.length]!, 500 + i, i % 4)],
        objectiveTarget: 1000 + i,
        sim: {
          ...held,
          score: 1000 + i * 137, sync: 1 + (i % 16), shields: i % 4, overdrive: (i * 0.37) % 1, ghost: i % 2,
          beat: i, objectiveProgress: i, travel: { chunk: 800 + i * 7, local: 0 },
        },
      };
    };

    // Settle on the scenario's first frame, which may change anything, and start counting after it.
    dev.frame(t0, options(0));
    const obs = new MutationObserver(() => { /* read by takeRecords */ });
    obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    obs.takeRecords();
    w.__sp = 0;
    let records = 0;
    for (let i = 1; i <= FRAMES; i++) {
      dev.frame(t0 + i / 60, options(i));
      for (const r of obs.takeRecords()) {
        if (!(r.type === 'attributes' && r.attributeName === 'style')) records++;
      }
    }
    obs.disconnect();
    const writes = records + w.__sp;
    return { records, setProperty: w.__sp, writes, perSimulatedSecond: writes / (FRAMES / 60) };
  }, { scenario, cockpit, PLAY: SimMode.PLAY, SHARD: Ev.SHARD, GATE: Ev.GATE, GRAZE: Ev.GRAZE, HIT: Ev.HIT, GATE_MISS: Ev.GATE_MISS, GRADE: Ev.GRADE });
}

test.describe('writes:', () => {
  test('idle-play writes exactly nothing after the first frame', async ({ page }) => {
    await openCounting(page, { state: 'play' });
    const c = await countWrites(page, 'idle-play');
    console.log(`writes idle-play: ${JSON.stringify(c)}`);
    expect(c.records).toBe(0);
    expect(c.setProperty).toBe(0);
  });

  test('cruise stays at or under 24 per simulated second', async ({ page }) => {
    await openCounting(page, { state: 'play' });
    const c = await countWrites(page, 'cruise');
    console.log(`writes cruise: ${JSON.stringify(c)}`);
    expect(c.writes).toBeGreaterThan(0);
    expect(c.perSimulatedSecond).toBeLessThanOrEqual(24);
  });

  test('boost stays at or under 60 per simulated second', async ({ page }) => {
    await openCounting(page, { state: 'play' });
    const c = await countWrites(page, 'boost');
    console.log(`writes boost: ${JSON.stringify(c)}`);
    expect(c.writes).toBeGreaterThan(0);
    expect(c.perSimulatedSecond).toBeLessThanOrEqual(60);
  });

  test('adversarial stays at or under 300 per simulated second', async ({ page }) => {
    await openCounting(page, { state: 'play' });
    const c = await countWrites(page, 'adversarial');
    console.log(`writes adversarial: ${JSON.stringify(c)}`);
    expect(c.writes).toBeGreaterThan(0);
    expect(c.perSimulatedSecond).toBeLessThanOrEqual(300);
  });

  // Amendment VW (T13 A11): the readouts on the dashboard cost what they cost at the screen's edges, since only the styles move them.
  test('T13: in the cockpit view idle writes nothing, cruise stays at or under 24 and boost at or under 60', async ({ page }) => {
    await openCounting(page, { state: 'play' });
    const idle = await countWrites(page, 'idle-play', true);
    await expect(page.locator('.mv-ui')).toHaveAttribute('data-dash', '1');
    const cruise = await countWrites(page, 'cruise', true);
    const boost = await countWrites(page, 'boost', true);
    console.log(`writes in the cockpit: idle ${JSON.stringify(idle)}, cruise ${JSON.stringify(cruise)}, boost ${JSON.stringify(boost)}`);
    expect([idle.records, idle.setProperty]).toEqual([0, 0]);
    expect(cruise.writes).toBeGreaterThan(0);
    expect(cruise.perSimulatedSecond).toBeLessThanOrEqual(24);
    expect(boost.writes).toBeGreaterThan(0);
    expect(boost.perSimulatedSecond).toBeLessThanOrEqual(60);
  });

  test('control: same-value text writes are recorded, same-value style writes only by the wrapper', async ({ page }) => {
    await openCounting(page, { state: 'play' });
    const r = await page.evaluate(() => {
      const w = window as unknown as { __sp: number };
      const obs = new MutationObserver(() => { /* read by takeRecords */ });
      obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      obs.takeRecords();
      const text = document.querySelector('[data-mv="score"]')!.firstChild as Text;
      const value = text.data;
      for (let i = 0; i < 600; i++) text.data = value;
      const textRecords = obs.takeRecords().length;
      const fill = document.querySelector<HTMLElement>('.mv-od-fill')!;
      const style = fill.style.getPropertyValue('transform');
      // One priming write: the first can record a re-serialisation of the attribute even at the same value.
      fill.style.setProperty('transform', style);
      obs.takeRecords();
      w.__sp = 0;
      for (let i = 0; i < 600; i++) fill.style.setProperty('transform', style);
      const styleRecords = obs.takeRecords().length;
      obs.disconnect();
      return { textRecords, styleRecords, wrapper: w.__sp };
    });
    console.log(`writes control: ${JSON.stringify(r)}`);
    expect(r.textRecords).toBeGreaterThanOrEqual(600);
    expect(r.styleRecords).toBe(0);
    expect(r.wrapper).toBe(600);
  });
});

// ---- layoutcost: A6, time: A8 ----

interface RafRun { frames: number; layoutCount: number; recalcCount: number; layoutMs: number; recalcMs: number; perFrameMs: number }

async function metrics(cdp: CDPSession): Promise<Record<string, number>> {
  const { metrics: list } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(list.map((m): [string, number] => [m.name, m.value]));
}

/** 2 s of real rAF frames on the scripted clock of 1/60 s per rAF frame. Only the named field changes. */
async function rafRun(page: Page, cdp: CDPSession, field: 'overdrive' | 'score'): Promise<RafRun> {
  await page.evaluate(({ PLAY }) => {
    const dev = window.__ui!;
    dev.state('play');
    // Let the state's own layout land before the first reading.
    dev.frame(dev.clock() + 1, { at: { chunk: 777, local: 32 }, sim: { mode: PLAY as never, autopilot: false, score: 1000, sync: 3, shields: 2, overdrive: 0, ghost: 0, beat: 5.2, objectiveProgress: 3, travel: { chunk: 800, local: 0 } } });
    return new Promise((done) => { requestAnimationFrame(() => { requestAnimationFrame(done); }); });
  }, { PLAY: SimMode.PLAY });
  // A page does one layout of its own some 300 to 600 ms after load, with no UI frame running (section 10). So wait for
  // a quiet spell, or that one layout is charged to the bar.
  let quietFrom = (await metrics(cdp))['LayoutCount'] ?? 0;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(250);
    const now = (await metrics(cdp))['LayoutCount'] ?? 0;
    if (now === quietFrom && i >= 3) break;
    quietFrom = now;
  }
  const before = await metrics(cdp);
  const frames = await page.evaluate(({ field, PLAY }) => {
    const dev = window.__ui!;
    const sim = { mode: PLAY as never, autopilot: false, score: 1000, sync: 3, shields: 2, overdrive: 0, ghost: 0, beat: 5.2, objectiveProgress: 3, travel: { chunk: 800, local: 0 } };
    let t = dev.clock() + 1;
    let frames = 0;
    return new Promise<number>((done) => {
      const start = performance.now();
      const loop = (): void => {
        t += 1 / 60;
        frames++;
        if (field === 'overdrive') sim.overdrive = (frames % 129) / 128;
        else sim.score = 1000 + frames;
        dev.frame(t, { at: { chunk: 777, local: 32 }, sim });
        if (performance.now() - start < 2000) requestAnimationFrame(loop);
        else done(frames);
      };
      requestAnimationFrame(loop);
    });
  }, { field, PLAY: SimMode.PLAY });
  const after = await metrics(cdp);
  const layoutMs = ((after['LayoutDuration'] ?? 0) - (before['LayoutDuration'] ?? 0)) * 1000;
  const recalcMs = ((after['RecalcStyleDuration'] ?? 0) - (before['RecalcStyleDuration'] ?? 0)) * 1000;
  return {
    frames,
    layoutCount: (after['LayoutCount'] ?? 0) - (before['LayoutCount'] ?? 0),
    recalcCount: (after['RecalcStyleCount'] ?? 0) - (before['RecalcStyleCount'] ?? 0),
    layoutMs,
    recalcMs,
    perFrameMs: (layoutMs + recalcMs) / frames,
  };
}

test.describe('layoutcost:', () => {
  test('bar movement causes no layout', async ({ page, context }) => {
    await page.goto(url({ state: 'play' }));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const r = await rafRun(page, cdp, 'overdrive');
    console.log(`layoutcost overdrive: ${JSON.stringify(r)}`);
    expect(r.frames).toBeGreaterThan(30);
    expect(r.layoutCount).toBe(0);
    await cdp.detach();
  });

  test('control: a score changing every frame does cause layout', async ({ page, context }) => {
    await page.goto(url({ state: 'play' }));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const r = await rafRun(page, cdp, 'score');
    console.log(`layoutcost score: ${JSON.stringify(r)}`);
    expect(r.frames).toBeGreaterThan(30);
    expect(r.layoutCount).toBeGreaterThanOrEqual(0.25 * r.frames);
    await cdp.detach();
  });
});

test.describe('time:', () => {
  test('ui.frame means, and style plus layout per frame, on this CPU only', async ({ page, context }) => {
    await page.goto(url({ state: 'play' }));
    const r = await page.evaluate(({ PLAY }) => {
      const dev = window.__ui!;
      dev.state('play');
      dev.frame(dev.clock() + 1, { at: { chunk: 777, local: 32 }, sim: { mode: PLAY as never, autopilot: false, score: 1000, sync: 3, shields: 2, overdrive: 0.5, ghost: 0, beat: 5.2, objectiveProgress: 3, travel: { chunk: 800, local: 0 } } });
      const { ui } = dev;
      const v = dev.view!;
      const sim = v.sim as unknown as { score: number; sync: number; shields: number; overdrive: number; ghost: number; beat: number; objectiveProgress: number };
      const travel = v.sim.travel as unknown as { chunk: number };
      const zone = v.zone as unknown as { index: number; paletteA: number };
      const view = v as unknown as { tick: number };

      for (let i = 0; i < 20000; i++) ui.frame(v);
      let t0 = performance.now();
      for (let i = 0; i < 100000; i++) ui.frame(v);
      const unchanged = (performance.now() - t0) / 100000;

      for (let i = 0; i < 2000; i++) {
        view.tick += 2;
        sim.score += 137;
        ui.frame(v);
      }
      t0 = performance.now();
      const N = 10000;
      for (let i = 0; i < N; i++) {
        view.tick += 2;
        sim.score += 137;
        sim.sync = 1 + (i % 16);
        sim.shields = i % 4;
        sim.overdrive = (i * 0.37) % 1;
        sim.ghost = i % 2;
        sim.beat = i;
        sim.objectiveProgress = i;
        travel.chunk += 7;
        zone.index += 1;
        zone.paletteA = i % 6;
        ui.frame(v);
      }
      const adversarial = (performance.now() - t0) / N;
      return { unchanged, adversarial };
    }, { PLAY: SimMode.PLAY });
    console.log(`time ui.frame ms: ${JSON.stringify(r)}`);
    expect(r.unchanged).toBeLessThanOrEqual(0.005);
    expect(r.adversarial).toBeLessThanOrEqual(0.05);

    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const bar = await rafRun(page, cdp, 'overdrive');
    const text = await rafRun(page, cdp, 'score');
    console.log(`time style plus layout per frame ms: overdrive ${bar.perFrameMs.toFixed(4)}, score ${text.perFrameMs.toFixed(4)}`);
    expect(bar.perFrameMs).toBeLessThanOrEqual(0.25);
    expect(text.perFrameMs).toBeLessThanOrEqual(0.25);
    await cdp.detach();
  });
});

// ---- alloc: A7 ----

interface HeapNode { selfSize: number; children: HeapNode[] }

function totalSelf(n: HeapNode): number {
  let sum = n.selfSize;
  for (const c of n.children) sum += totalSelf(c);
  return sum;
}

async function sampled(cdp: CDPSession, run: () => Promise<unknown>): Promise<number> {
  await cdp.send('HeapProfiler.startSampling', {
    samplingInterval: 512, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true,
  });
  await run();
  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  return totalSelf(profile.head as unknown as HeapNode);
}

const KB = 1024;

test.describe('alloc:', () => {
  test('ui.frame and input.sample allocate at most 64 KB over 100k pairs, unchanged and sweeping, and a real allocator shows', async ({ page, context }) => {
    await page.goto(url({ state: 'play' }));
    const cdp = await context.newCDPSession(page);
    await cdp.send('HeapProfiler.enable');

    await page.evaluate(({ PLAY }) => {
      const dev = window.__ui!;
      dev.state('play');
      dev.frame(dev.clock() + 1, { at: { chunk: 777, local: 32 }, sim: { mode: PLAY as never, autopilot: false, score: 1000, sync: 3, shields: 2, overdrive: 0.5, ghost: 0, beat: 5.2, objectiveProgress: 3, travel: { chunk: 800, local: 0 } } });
      const { ui, input } = dev;
      const v = dev.view!;
      const out = { moveX: 0, moveY: 0, absolute: false, boost: false, human: false };
      for (let i = 0; i < 20000; i++) { ui.frame(v); input.sample(out); }
    }, { PLAY: SimMode.PLAY });

    const unchanged = await sampled(cdp, () => page.evaluate(() => {
      const { ui, input, view } = window.__ui!;
      const out = { moveX: 0, moveY: 0, absolute: false, boost: false, human: false };
      for (let i = 0; i < 100000; i++) { ui.frame(view!); input.sample(out); }
    }));

    // Warm up the sweep, which writes on every call: the throttle opens because the tick steps by 6.
    await page.evaluate(() => {
      const { ui, input, view } = window.__ui!;
      const v = view as unknown as { tick: number; sim: { overdrive: number } };
      const out = { moveX: 0, moveY: 0, absolute: false, boost: false, human: false };
      for (let i = 0; i < 20000; i++) {
        v.tick += 6;
        v.sim.overdrive = (i % 129) / 128;
        ui.frame(view!);
        input.sample(out);
      }
    });
    const sweeping = await sampled(cdp, () => page.evaluate(() => {
      const { ui, input, view } = window.__ui!;
      const v = view as unknown as { tick: number; sim: { overdrive: number } };
      const out = { moveX: 0, moveY: 0, absolute: false, boost: false, human: false };
      for (let i = 0; i < 100000; i++) {
        v.tick += 6;
        v.sim.overdrive = (i % 129) / 128;
        ui.frame(view!);
        input.sample(out);
      }
    }));

    await page.evaluate(() => window.__ui!.allocProbe(20000));
    const probe = await sampled(cdp, () => page.evaluate(() => window.__ui!.allocProbe(100000)));

    console.log(`alloc sampled bytes: unchanged ${unchanged}, sweeping ${sweeping}, allocProbe ${probe}`);
    expect(unchanged).toBeLessThanOrEqual(64 * KB);
    expect(sweeping).toBeLessThanOrEqual(64 * KB);
    expect(probe).toBeGreaterThanOrEqual(1024 * KB);
    await cdp.detach();
  });
});

// ---- firstshow: D-012, DI-89. The HUD and the menu are drawn, invisible, during DEMO, so a first launch changes only
// what is already drawn. ----

/** DI-83's limit (2), applied to the dev page: every frame in the 2 s after the click, other than the click frame. */
const FIRST_SHOW = { frameMs: 33, windowMs: 2000, escWindowMs: 1000, click: { x: 960, y: 700 } } as const;
/** The old path: the HUD and the menu not drawn at all in DEMO, and no layer of their own. */
const OLD_PATH_CSS = '.mv-ui[data-view~="title"] > .mv-hud, .mv-ui[data-view~="title"] > .mv-cruise { display: none !important; } .mv-hud, .mv-cruise { will-change: auto !important; }';

interface FirstShow {
  /** How the HUD stood in DEMO, read before the click: display and opacity. */
  demo: { display: string; opacity: string };
  clickFrameMs: number; otherMs: number; long: string[]; mode: string | null;
  escOtherMs: number; escLong: string[]; escMode: string | null;
}

/**
 * One fresh browser, so its GPU process has drawn nothing yet: dev/ui.html?live=1, a mouse release on the title after
 * 1.5 s, then Escape 2.2 s later. Frames are rAF entry intervals, as T10's launch gate reads them (DI-87).
 */
async function firstShow(info: TestInfo, baseURL: string, css: string): Promise<FirstShow> {
  const browser = await chromium.launch({ ...(info.project.use.launchOptions ?? {}), headless: true });
  try {
    const context = await browser.newContext({ baseURL, viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();
    await page.addInitScript((override: string) => {
      const h = { t0: -1, esc: -1, e: [] as number[] };
      (window as unknown as { __fs: typeof h }).__fs = h;
      window.addEventListener('pointerup', () => { if (h.t0 < 0) h.t0 = performance.now(); }, true);
      window.addEventListener('keydown', (ev) => { if (ev.code === 'Escape' && h.esc < 0) h.esc = performance.now(); }, true);
      const rec = (): void => { h.e.push(performance.now()); requestAnimationFrame(rec); };
      requestAnimationFrame(rec);
      // Adopted before any element exists, so not one frame is drawn the new way when the old path is asked for.
      if (override !== '') {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(override);
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      }
    }, css);
    await page.goto(url({ live: 1 }));
    const demo = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('[data-mv="hud"]')!);
      return { display: cs.display, opacity: cs.opacity };
    });
    await nodeWait(1500);
    await page.mouse.click(FIRST_SHOW.click.x, FIRST_SHOW.click.y);
    await nodeWait(FIRST_SHOW.windowMs + 200);
    const mode = await page.evaluate(() => document.documentElement.getAttribute('data-mv-mode'));
    await page.keyboard.press('Escape');
    await nodeWait(FIRST_SHOW.escWindowMs + 200);
    const r = await page.evaluate(({ windowMs, escWindowMs }) => {
      const h = (window as unknown as { __fs: { t0: number; esc: number; e: number[] } }).__fs;
      const read = (at: number, span: number): { clickFrameMs: number; otherMs: number; long: string[] } => {
        let clickFrameMs = NaN;
        let otherMs = 0;
        const long: string[] = [];
        for (let i = 1; i < h.e.length; i++) {
          const e0 = h.e[i - 1]!, e1 = h.e[i]!;
          if (e1 < at || e1 > at + span) continue;
          const d = e1 - e0;
          const isClick = e0 <= at && e1 >= at;
          if (isClick) clickFrameMs = d;
          else otherMs = Math.max(otherMs, d);
          if (isClick || d > 20) long.push(`+${(e0 - at).toFixed(0)}: ${d.toFixed(1)}${isClick ? ' (input frame)' : ''}`);
        }
        return { clickFrameMs, otherMs, long };
      };
      const launch = read(h.t0, windowMs);
      const esc = read(h.esc, escWindowMs);
      return { ...launch, escOtherMs: esc.otherMs, escLong: esc.long, escMode: document.documentElement.getAttribute('data-mv-mode') };
    }, { windowMs: FIRST_SHOW.windowMs, escWindowMs: FIRST_SHOW.escWindowMs });
    return { demo, mode, ...r };
  } finally {
    await browser.close();
  }
}

const fmtFirstShow = (r: FirstShow): string =>
  `HUD in DEMO ${r.demo.display} at opacity ${r.demo.opacity}; launch: click frame ${r.clickFrameMs.toFixed(1)} ms, other frames at most ${r.otherMs.toFixed(1)} ms [${r.long.join(', ')}], mode ${r.mode}; ` +
  `first Esc, print only: other frames at most ${r.escOtherMs.toFixed(1)} ms [${r.escLong.join(', ')}], mode ${r.escMode}`;

test.describe('firstshow: fresh browser', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'gpu', 'gpu only, as T10\'s launch gate'); });

  test('first launch: every frame in the 2 s after the click, other than the click frame, at most 33 ms (D-012, DI-83 (2))', async ({ baseURL }, info) => {
    test.setTimeout(60_000);
    const r = await firstShow(info, baseURL!, '');
    console.log(`FIRSTSHOW new path, fresh browser: ${fmtFirstShow(r)}`);
    expect(r.mode).toBe('play');
    expect(r.escMode).toBe('cruise');
    expect(Number.isFinite(r.clickFrameMs)).toBe(true);
    expect(r.otherMs).toBeLessThanOrEqual(FIRST_SHOW.frameMs);
  });

  test('control: the old path, with the HUD and the menu not drawn in DEMO, fails that limit', async ({ baseURL }, info) => {
    test.setTimeout(60_000);
    const r = await firstShow(info, baseURL!, OLD_PATH_CSS);
    console.log(`FIRSTSHOW control, old path, fresh browser: ${fmtFirstShow(r)}`);
    expect(r.demo.display).toBe('none');
    expect(r.mode).toBe('play');
    expect(r.otherMs).toBeGreaterThan(FIRST_SHOW.frameMs);
  });
});

interface PanelRead { display: string; opacity: string; inert: boolean; ariaHidden: string | null }
interface WarmRead {
  view: string; hud: PanelRead; cruise: PanelRead; ctx: PanelRead;
  /** What a pointer at the centre of the HUD's menu button and of the menu's Resume button would hit: the nearest data-mv, and the hidden panel it is in, if any. */
  hitMenuButton: { at: string; inside: string | null }; hitResume: { at: string; inside: string | null };
}

async function readWarm(page: Page): Promise<WarmRead> {
  return page.evaluate(() => {
    const panel = (sel: string) => {
      const el = document.querySelector<HTMLElement>(sel)!;
      const cs = getComputedStyle(el);
      return { display: cs.display, opacity: cs.opacity, inert: el.inert, ariaHidden: el.getAttribute('aria-hidden') };
    };
    const hit = (sel: string): { at: string; inside: string | null } => {
      const r = document.querySelector(sel)!.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        at: el?.closest('[data-mv]')?.getAttribute('data-mv') ?? 'none',
        inside: el?.closest('[data-mv="hud"], [data-mv="cruise"]')?.getAttribute('data-mv') ?? null,
      };
    };
    return {
      view: document.querySelector('.mv-ui')!.getAttribute('data-view') ?? '',
      hud: panel('[data-mv="hud"]'), cruise: panel('[data-mv="cruise"]'), ctx: panel('[data-mv="context-lost"]'),
      hitMenuButton: hit('[data-mv="menu-button"]'), hitResume: hit('[data-mv="resume"]'),
    };
  });
}

/** In DEMO, the warm panels are laid out, below sight, and out of reach of a pointer, the keyboard and assistive technology. */
async function warmProblems(page: Page): Promise<string[]> {
  const w = await readWarm(page);
  const p: string[] = [];
  for (const [name, r] of [['hud', w.hud], ['cruise', w.cruise]] as const) {
    if (r.display === 'none') p.push(`${name} not laid out in DEMO`);
    const o = Number(r.opacity);
    if (!(o > 0 && o <= 0.001)) p.push(`${name} opacity ${r.opacity} in DEMO, not above 0 and at most .001`);
    if (!r.inert) p.push(`${name} not inert in DEMO`);
    if (r.ariaHidden !== 'true') p.push(`${name} aria-hidden ${r.ariaHidden} in DEMO`);
  }
  if (w.hitMenuButton.inside !== null) p.push(`a pointer on the hidden menu button hits ${w.hitMenuButton.at} in ${w.hitMenuButton.inside}`);
  if (w.hitResume.inside !== null) p.push(`a pointer on the hidden Resume hits ${w.hitResume.at} in ${w.hitResume.inside}`);
  if (await page.getByRole('button', { name: 'Open cruise menu' }).count() !== 0) p.push('the hidden menu button is in the accessibility tree');
  if (await page.getByRole('button', { name: 'RESUME' }).count() !== 0) p.push('the hidden Resume is in the accessibility tree');
  // E6 (amendment LH): Tab from the title's last start button, as it ran from the one launch button before LH.
  await page.evaluate(() => { document.querySelector<HTMLElement>('[data-mv="launch-nohud"]')!.focus(); });
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement?.closest('[data-mv="hud"], [data-mv="cruise"]')?.getAttribute('data-mv') ?? null);
  if (focused !== null) p.push(`Tab reaches the hidden ${focused}`);
  return p;
}

test.describe('firstshow: panels', () => {
  test('in DEMO the HUD and the menu are laid out, at opacity .001, inert, aria-hidden and not hit-testable', async ({ page }) => {
    await page.goto(url());
    const p = await warmProblems(page);
    console.log(`FIRSTSHOW warm panels in DEMO: ${p.join('; ') || 'no problem'}`);
    expect(p).toEqual([]);
  });

  test('control: with inert and aria-hidden removed and the pointer rule overridden, the same checks fail', async ({ page }) => {
    await page.goto(url());
    await page.addStyleTag({ content: '.mv-ui .mv-hud, .mv-ui .mv-hud *, .mv-ui .mv-cruise, .mv-ui .mv-cruise * { pointer-events: auto !important; }' });
    await page.evaluate(() => {
      for (const el of document.querySelectorAll<HTMLElement>('[data-mv="hud"], [data-mv="cruise"]')) {
        el.inert = false;
        el.removeAttribute('aria-hidden');
      }
    });
    const p = await warmProblems(page);
    console.log(`FIRSTSHOW control, warm panels exposed: ${p.join('; ')}`);
    expect(p.some((s) => s.startsWith('a pointer on the hidden menu button'))).toBe(true);
    expect(p.some((s) => s.startsWith('a pointer on the hidden Resume'))).toBe(true);
    expect(p).toContain('the hidden menu button is in the accessibility tree');
    expect(p).toContain('the hidden Resume is in the accessibility tree');
    expect(p.some((s) => s.startsWith('Tab reaches the hidden'))).toBe(true);
  });

  test('aria-hidden and inert change in the same frame as the panel view, through launch, CRUISE and back, and the context-lost layer hides by display', async ({ page }) => {
    await page.goto(url());
    // The real gesture first: evaluate before it would grant activation, which this test does not need, but keep the order.
    await page.mouse.click(FIRST_SHOW.click.x, FIRST_SHOW.click.y);
    // One frame per step, 12 ticks on, so the panel gate is open; the mode is whatever the commands have reached.
    let t = 1;
    const step = async (): Promise<WarmRead> => {
      t += 0.1;
      await page.evaluate((at) => { window.__ui!.frame(at, { sim: { autopilot: false } }); }, t);
      return readWarm(page);
    };
    const live = (r: PanelRead): boolean => r.opacity === '1' && r.display !== 'none' && !r.inert && r.ariaHidden === null;
    const hidden = (r: PanelRead): boolean => r.inert && r.ariaHidden === 'true';

    const play = await step();
    expect(play.view).toBe('hud');
    expect(live(play.hud)).toBe(true);
    expect(play.cruise.display).toBe('none');
    expect(hidden(play.cruise)).toBe(true);

    await page.keyboard.press('Escape');
    const cruise = await step();
    expect(cruise.view).toBe('hud menu');
    expect(live(cruise.cruise)).toBe(true);
    // As before D-012: shown behind the card, and inert while the menu is open.
    expect(cruise.hud.opacity).toBe('1');
    expect(cruise.hud.inert).toBe(true);
    expect(cruise.hud.ariaHidden).toBe(null);
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-mv'))).toBe('resume');

    await page.keyboard.press('Escape');
    const back = await step();
    expect(back.view).toBe('hud');
    expect(live(back.hud)).toBe(true);
    expect(back.cruise.display).toBe('none');
    expect(hidden(back.cruise)).toBe(true);

    // T09's B12 assumption: the overlay hides by display, not by opacity, on the first frame after showContextLost(false).
    await page.evaluate(() => { window.__ui!.ui.showContextLost(true); });
    const lost = await step();
    expect(lost.view).toBe('hud ctx');
    expect(lost.ctx.display).not.toBe('none');
    expect(lost.ctx.opacity).toBe('1');
    await page.evaluate(() => { window.__ui!.ui.showContextLost(false); });
    const restored = await step();
    expect(restored.view).toBe('hud');
    expect(restored.ctx.display).toBe('none');
  });
});

// ---- viewports and states, for geometry: A9 and review: A16 ----

interface Viewport { name: string; width: number; height: number; dpr: number; touch: boolean; kind: 'phone' | 'tablet' | 'desktop' }

const VIEWPORTS: readonly Viewport[] = [
  { name: 'phone-small', width: 320, height: 568, dpr: 2, touch: true, kind: 'phone' },
  { name: 'phone-portrait', width: 390, height: 844, dpr: 3, touch: true, kind: 'phone' },
  { name: 'phone-landscape', width: 844, height: 390, dpr: 3, touch: true, kind: 'phone' },
  { name: 'tablet-portrait', width: 820, height: 1180, dpr: 2, touch: true, kind: 'tablet' },
  { name: 'tablet-landscape', width: 1180, height: 820, dpr: 2, touch: true, kind: 'tablet' },
  { name: 'laptop', width: 1366, height: 768, dpr: 1, touch: false, kind: 'desktop' },
  { name: 'desktop', width: 1920, height: 1080, dpr: 1, touch: false, kind: 'desktop' },
  { name: 'ultrawide', width: 3440, height: 1440, dpr: 1, touch: false, kind: 'desktop' },
  { name: 'superwide', width: 5120, height: 1440, dpr: 1, touch: false, kind: 'desktop' },
];

const STATE_NAMES: readonly StateName[] = [
  'title', 'play', 'play-max', 'play-low', 'autopilot', 'cruise', 'cruise-max', 'signal-lost', 'context-lost', 'banner-sector', 'fatal-no-webgl2',
];

function useViewport(v: Viewport): void {
  test.use({
    viewport: { width: v.width, height: v.height },
    deviceScaleFactor: v.dpr,
    hasTouch: v.touch,
    isMobile: v.touch,
  });
}

interface Box { x: number; y: number; w: number; h: number }
interface Dump {
  innerW: number; innerH: number; docW: number; docH: number; rootOverflowX: number; rootOverflowY: number;
  visible: { name: string; box: Box }[];
  play: Record<string, Box>;
  clip: { name: string; overflow: boolean; box: Box; panel: Box | null }[];
  targets: { name: string; box: Box }[];
  labelFonts: { name: string; px: number }[];
  valueFonts: { name: string; px: number }[];
  wordmark: Box | null;
  card: { scrollH: number; clientH: number } | null;
  lastControlReachable: boolean | null;
  /** The card's content box, inside border and padding, and the extent of the text in it, read by Range so ink that overflows its own box still counts. */
  cardContent: Box | null;
  cardText: { name: string; box: Box }[];
  cardControls: { name: string; box: Box }[];
  radios: { name: string; box: Box }[];
  /**
   * FH-28: each shown label of the toggle row, its box, and its text by Range over its span (a Range over the whole label
   * starts 1.6 px left of it, under the skewed checkbox), with the text's line count.
   */
  toggles: { name: string; label: Box; text: Box; lines: number }[];
}

/** Reads the page. All judgement is in geometryProblems, so a negative control exercises the same code. */
async function dumpGeometry(page: Page): Promise<Dump> {
  return page.evaluate(() => {
    const boxOf = (el: Element): { x: number; y: number; w: number; h: number } => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    };
    const shown = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const name = (el: Element): string => el.getAttribute('data-mv') ?? el.className.toString();
    const root = document.querySelector<HTMLElement>('.mv-ui');
    const out: Dump = {
      innerW: innerWidth,
      innerH: innerHeight,
      docW: document.documentElement.scrollWidth,
      docH: document.documentElement.scrollHeight,
      rootOverflowX: root ? root.scrollWidth - root.clientWidth : 0,
      rootOverflowY: root ? root.scrollHeight - root.clientHeight : 0,
      visible: [], play: {}, clip: [], targets: [], labelFonts: [], valueFonts: [], wordmark: null, card: null, lastControlReachable: null,
      cardContent: null, cardText: [], cardControls: [], radios: [], toggles: [],
    };
    const textBox = (el: Element): { x: number; y: number; w: number; h: number } => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    };
    const card = document.querySelector('.mv-card');
    const scrolled = (el: Element): boolean => card !== null && card.contains(el);
    for (const el of document.querySelectorAll('[data-mv]')) {
      if (!shown(el) || scrolled(el)) continue;
      out.visible.push({ name: name(el), box: boxOf(el) });
    }
    for (const [key, sel] of [['score', '.mv-box-score'], ['distance', '.mv-box-dist'], ['vitals', '.mv-vitals'], ['menu', '.mv-box-menu'], ['boost', '.mv-boost']] as const) {
      const el = document.querySelector(sel);
      if (el && shown(el)) out.play[key] = boxOf(el);
    }
    const readouts = '[data-mv="score"], [data-mv="sync"], [data-mv="km"], [data-mv="sector"], [data-mv="objective"], .mv-label';
    for (const el of document.querySelectorAll<HTMLElement>(readouts)) {
      if (!shown(el) || scrolled(el)) continue;
      const panel = el.closest('.mv-panel');
      out.clip.push({ name: name(el), overflow: el.scrollWidth > el.clientWidth, box: boxOf(el), panel: panel ? boxOf(panel) : null });
    }
    for (const el of document.querySelectorAll('button, input')) {
      if (!shown(el)) continue;
      out.targets.push({ name: name(el) || el.getAttribute('type') || el.tagName, box: boxOf(el.closest('label') ?? el) });
    }
    for (const el of document.querySelectorAll('.mv-label')) {
      if (shown(el) && !scrolled(el)) out.labelFonts.push({ name: el.textContent ?? '', px: parseFloat(getComputedStyle(el).fontSize) });
    }
    for (const el of document.querySelectorAll('[data-mv="score"], [data-mv="sync"], [data-mv="km"], [data-mv="sector"], [data-mv="objective"]')) {
      if (shown(el)) out.valueFonts.push({ name: name(el), px: parseFloat(getComputedStyle(el).fontSize) });
    }
    const wm = document.querySelector('[data-mv="wordmark"]');
    if (wm && shown(wm)) out.wordmark = boxOf(wm);
    if (card && shown(card)) {
      out.card = { scrollH: card.scrollHeight, clientH: card.clientHeight };
      const cs = getComputedStyle(card);
      const cr = card.getBoundingClientRect();
      const left = parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
      const right = parseFloat(cs.borderRightWidth) + parseFloat(cs.paddingRight);
      out.cardContent = { x: cr.left + left, y: cr.top, w: cr.width - left - right, h: cr.height };
      for (const el of card.querySelectorAll('.mv-card-head > h2, .mv-card-head > p, .mv-stats > dt, .mv-stats > dd')) {
        if (shown(el)) out.cardText.push({ name: `${el.tagName.toLowerCase()} "${(el.textContent ?? '').slice(0, 28)}"`, box: textBox(el) });
      }
      for (const el of card.querySelectorAll('.mv-card-controls > *')) {
        if (shown(el)) out.cardControls.push({ name: el.getAttribute('data-mv') ?? el.className.toString(), box: boxOf(el) });
      }
      for (const el of card.querySelectorAll('.mv-radio')) {
        if (shown(el)) out.radios.push({ name: el.textContent ?? '', box: textBox(el) });
      }
      for (const el of card.querySelectorAll('.mv-toggles > label')) {
        const span = el.querySelector('span');
        if (!shown(el) || !span) continue;
        const range = document.createRange();
        range.selectNodeContents(span);
        const lines = new Set(Array.from(range.getClientRects(), (r) => Math.round(r.top))).size;
        out.toggles.push({ name: (el.textContent ?? '').trim(), label: boxOf(el), text: textBox(span), lines });
      }
      // The last control is its whole label, the touch target, so the label is what is scrolled into view. Scrolling the
      // 15 px box with block nearest left the 44 px label's lower half past the card once FH's row made it 50 px over,
      // though a player can scroll the label fully into view (plan section 11, FH-32).
      const last = document.querySelector('[data-mv="reduced"]')!;
      const target = last.closest('label') ?? last;
      target.scrollIntoView({ block: 'nearest' });
      const r = target.getBoundingClientRect();
      out.lastControlReachable = r.top >= 0 && r.bottom <= innerHeight + 0.5;
      card.scrollTop = 0;
    }
    return out;
  });
}

function overlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function geometryProblems(d: Dump, v: Viewport, state: StateName): string[] {
  const p: string[] = [];
  const EPS = 0.5;
  if (d.docW > d.innerW || d.docH > d.innerH) p.push(`page scroll: document ${d.docW}x${d.docH} in ${d.innerW}x${d.innerH}`);
  if (d.rootOverflowX > 0 || d.rootOverflowY > 0) p.push(`root overflow ${d.rootOverflowX},${d.rootOverflowY}`);
  for (const { name, box } of d.visible) {
    if (box.x < -EPS || box.y < -EPS || box.x + box.w > d.innerW + EPS || box.y + box.h > d.innerH + EPS) {
      p.push(`outside viewport: ${name} ${JSON.stringify(box)}`);
    }
  }
  for (const c of d.clip) {
    if (c.overflow) p.push(`clip: ${c.name} scrollWidth over clientWidth`);
    if (c.panel && (c.box.x < c.panel.x - EPS || c.box.x + c.box.w > c.panel.x + c.panel.w + EPS)) {
      p.push(`clip: ${c.name} ${JSON.stringify(c.box)} leaves its panel ${JSON.stringify(c.panel)}`);
    }
  }
  const min = v.touch ? 44 : 24;
  for (const t of d.targets) {
    if (t.box.w < min - EPS || t.box.h < min - EPS) p.push(`target ${t.name} ${t.box.w.toFixed(1)}x${t.box.h.toFixed(1)} under ${min}`);
  }
  for (const f of d.labelFonts) if (f.px < 10 - 0.01) p.push(`label font ${f.name} ${f.px}`);
  for (const f of d.valueFonts) if (f.px < 11 - 0.01) p.push(`value font ${f.name} ${f.px}`);

  const isPlay = state === 'play' || state === 'play-max' || state === 'play-low';
  const boxes = Object.entries(d.play);
  if (isPlay) {
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [an, a] = boxes[i]!;
        const [bn, b] = boxes[j]!;
        if (overlap(a, b)) p.push(`overlap: ${an} ${JSON.stringify(a)} and ${bn} ${JSON.stringify(b)}`);
      }
    }
    const clear: Box = { x: 0.25 * d.innerW, y: 0.3 * d.innerH, w: 0.5 * d.innerW, h: 0.32 * d.innerH };
    let area = 0;
    for (const [n, b] of boxes) {
      if (overlap(b, clear)) p.push(`in the sun and road: ${n} ${JSON.stringify(b)}`);
      area += b.w * b.h;
    }
    const share = area / (d.innerW * d.innerH);
    const limit = v.kind === 'desktop' ? 0.12 : 0.22;
    if (share > limit) p.push(`HUD covers ${(share * 100).toFixed(1)}% over ${limit * 100}%`);
    if (v.name === 'ultrawide' || v.name === 'superwide') {
      const left = (d.innerW - (16 / 9) * d.innerH) / 2;
      for (const [n, b] of boxes) {
        if (b.x < left - EPS || b.x + b.w > d.innerW - left + EPS) p.push(`outside the central 16:9: ${n} ${JSON.stringify(b)}`);
      }
    }
  }
  if (d.wordmark) {
    const share = d.wordmark.w / d.innerW;
    if (v.kind === 'phone' && (share < 0.55 || share > 0.94)) p.push(`wordmark ${(share * 100).toFixed(1)}% of a phone`);
    if (v.name === 'superwide' && share > 0.7) p.push(`wordmark ${(share * 100).toFixed(1)}% of superwide`);
  }
  if (d.card) {
    if (v.name === 'phone-small') {
      if (d.lastControlReachable !== true) p.push('last menu control cannot be scrolled into view');
    } else if (d.card.scrollH > d.card.clientH + 1) {
      p.push(`card scrolls: ${d.card.scrollH} in ${d.card.clientH}`);
    }
  }
  // The card's own contents, which the checks above skip: no text past the card's padding, none on a control, no two
  // radio labels on each other.
  if (d.cardContent) {
    const c = d.cardContent;
    for (const t of d.cardText) {
      if (t.box.x < c.x - EPS || t.box.x + t.box.w > c.x + c.w + EPS) p.push(`card clip: ${t.name} ${JSON.stringify(t.box)} leaves the card ${JSON.stringify(c)}`);
      for (const k of d.cardControls) if (overlap(t.box, k.box)) p.push(`card overlap: ${t.name} ${JSON.stringify(t.box)} on ${k.name} ${JSON.stringify(k.box)}`);
    }
    for (let i = 0; i < d.radios.length; i++) {
      for (let j = i + 1; j < d.radios.length; j++) {
        if (overlap(d.radios[i]!.box, d.radios[j]!.box)) p.push(`card overlap: radio ${d.radios[i]!.name} on radio ${d.radios[j]!.name}`);
      }
    }
  }
  // FH-28: the toggle row is one box among the card's controls above, so its labels get their own checks. On a card
  // with no toggle row this finds nothing.
  for (const t of d.toggles) {
    if (t.text.x < t.label.x - EPS || t.text.x + t.text.w > t.label.x + t.label.w + EPS) {
      p.push(`toggle clip: ${t.name} text ${t.text.x.toFixed(1)}..${(t.text.x + t.text.w).toFixed(1)} leaves its label ${t.label.x.toFixed(1)}..${(t.label.x + t.label.w).toFixed(1)}`);
    }
    if (t.lines !== 1) p.push(`toggle wrap: ${t.name} on ${t.lines} lines`);
  }
  for (let i = 0; i < d.toggles.length; i++) {
    for (let j = i + 1; j < d.toggles.length; j++) {
      const a = d.toggles[i]!;
      const b = d.toggles[j]!;
      if (overlap(a.text, b.label)) p.push(`toggle overlap: ${a.name} text on ${b.name} label`);
      if (overlap(b.text, a.label)) p.push(`toggle overlap: ${b.name} text on ${a.name} label`);
      if (overlap(a.label, b.label)) p.push(`toggle overlap: ${a.name} label on ${b.name} label`);
    }
  }
  return p;
}

for (const v of VIEWPORTS) {
  test.describe(`geometry: ${v.name}`, () => {
    useViewport(v);
    for (const state of STATE_NAMES) {
      test(state, async ({ page }) => {
        await page.goto(url({ state }));
        const d = await dumpGeometry(page);
        const problems = geometryProblems(d, v, state);
        expect(problems, problems.join('\n')).toEqual([]);
      });
    }
  });
}

/** The short landscape phones where the two-column card is tightest, from V1-T08's probe. */
const SHORT_LANDSCAPE: readonly Viewport[] = [
  { name: 'landscape-740x360', width: 740, height: 360, dpr: 3, touch: true, kind: 'phone' },
  { name: 'landscape-667x375', width: 667, height: 375, dpr: 2, touch: true, kind: 'phone' },
  { name: 'landscape-915x412', width: 915, height: 412, dpr: 3, touch: true, kind: 'phone' },
  { name: 'landscape-932x430', width: 932, height: 430, dpr: 3, touch: true, kind: 'phone' },
];

for (const v of SHORT_LANDSCAPE) {
  test.describe(`geometry: ${v.name}`, () => {
    useViewport(v);
    for (const state of ['cruise', 'cruise-max'] as const) {
      test(state, async ({ page }, info) => {
        await page.goto(url({ state }));
        const d = await dumpGeometry(page);
        const problems = geometryProblems(d, v, state);
        expect(problems, problems.join('\n')).toEqual([]);
        await saveShot(page, info, state);
      });
    }
  });
}

test.describe('geometry: card control', () => {
  const v: Viewport = VIEWPORTS.find((x) => x.name === 'phone-landscape')!;
  useViewport(v);

  test('the old side-by-side stats fail the card checks', async ({ page }) => {
    await page.goto(url({ state: 'cruise-max' }));
    expect(geometryProblems(await dumpGeometry(page), v, 'cruise-max')).toEqual([]);
    await page.addStyleTag({ content: '.mv-ui .mv-stats { grid-template-columns: auto auto !important; gap: .1em .9em !important; white-space: nowrap !important; }' });
    const problems = geometryProblems(await dumpGeometry(page), v, 'cruise-max');
    console.log(`card control: ${problems.length} problems, first ${problems[0] ?? 'none'}`);
    expect(problems.some((s) => s.startsWith('card overlap:') || s.startsWith('card clip:'))).toBe(true);
  });
});

test.describe('geometry: resize', () => {
  test.use({ viewport: { width: 400, height: 700 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });

  test('the sector drops its palette name when the page narrows past 360 px, and gets it back', async ({ page }, info) => {
    const v: Viewport = { name: 'resize', width: 320, height: 700, dpr: 2, touch: true, kind: 'phone' };
    await page.goto(url({ state: 'play-max' }));
    const sector = page.locator('[data-mv="sector"]');
    await expect(sector).toHaveText(/^S\d+ \S/);
    await page.setViewportSize({ width: 320, height: 700 });
    // The media query reports its change in the next rendering step, which a real loop always reaches before ui.frame.
    await afterFrames(page);
    await page.evaluate(() => { window.__ui!.step(4); });
    await expect(sector).toHaveText(/^S\d+$/);
    const clips = geometryProblems(await dumpGeometry(page), v, 'play-max').filter((s) => s.includes('sector'));
    expect(clips, clips.join('\n')).toEqual([]);
    await saveShot(page, info, 'resized-to-320');
    await page.setViewportSize({ width: 400, height: 700 });
    await afterFrames(page);
    await page.evaluate(() => { window.__ui!.step(4); });
    await expect(sector).toHaveText(/^S\d+ \S/);
  });
});

test.describe('geometry: controls', () => {
  const v: Viewport = VIEWPORTS.find((x) => x.name === 'desktop')!;
  useViewport(v);

  test('moving the menu button onto the bar fails the overlap check', async ({ page }) => {
    await page.goto(url({ state: 'play' }));
    expect(geometryProblems(await dumpGeometry(page), v, 'play')).toEqual([]);
    await page.addStyleTag({ content: '.mv-box-menu { grid-area: vitals !important; justify-self: center !important; align-self: center !important; }' });
    const problems = geometryProblems(await dumpGeometry(page), v, 'play');
    expect(problems.some((s) => s.startsWith('overlap: vitals') || s.includes('and menu'))).toBe(true);
  });

  test('a narrow panel fails the clip check', async ({ page }) => {
    await page.goto(url({ state: 'play' }));
    await page.addStyleTag({ content: '.mv-box-dist { width: 40px !important; max-width: 40px !important; }' });
    const problems = geometryProblems(await dumpGeometry(page), v, 'play');
    expect(problems.some((s) => s.startsWith('clip:'))).toBe(true);
  });
});

// ---- a11y: A10 ----

test.describe('a11y:', () => {
  test('roles and names', async ({ page }) => {
    await page.goto(url());
    await expect(page.getByRole('heading', { name: 'Midnight Vector' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'LAUNCH', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.goto(url({ state: 'play' }));
    await expect(page.getByRole('button', { name: 'Open cruise menu' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('meter', { name: 'Overdrive' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Shields 2 of 3' })).toBeVisible();

    await page.goto(url({ state: 'cruise' }));
    const dialog = page.getByRole('dialog', { name: 'Cruise' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'RESUME' })).toBeVisible();
    await expect(page.getByLabel('MUSIC')).toBeVisible();
    await expect(page.getByLabel('SFX')).toBeVisible();
    await expect(page.getByLabel('MUTE', { exact: true })).toBeVisible();
    await expect(page.getByLabel('REDUCED MOTION')).toBeVisible();
    // Amendment FH: the two new boxes, by their labels.
    await expect(page.getByLabel('FULLSCREEN')).toBeVisible();
    await expect(page.getByLabel('HIDE HUD')).toBeVisible();
    await expect(page.getByRole('radio')).toHaveCount(6);

    await page.goto(url({ state: 'fatal-no-webgl2' }));
    await expect(page.getByRole('button', { name: 'RELOAD' })).toBeVisible();
  });

  test('the HUD and the menu match aria snapshots written by hand', async ({ page }) => {
    await page.goto(url({ state: 'play' }));
    await expect(page.locator('[data-mv="hud"]')).toMatchAriaSnapshot(`
      - text: SCORE 01284500 SYNC ×8 12.3 KM S07 MIAMI DUSK GRAZES 6/10 SHIELD
      - img "Shields 2 of 3"
      - text: OVERDRIVE
      - meter "Overdrive"
      - button "Open cruise menu": II
    `);
    await page.goto(url({ state: 'cruise' }));
    await expect(page.locator('[data-mv="cruise"]')).toMatchAriaSnapshot(`
      - dialog "CRUISE":
        - heading "CRUISE" [level=2]
        - paragraph: THE ROAD NEVER STOPS
        - button "RESUME"
        - term: THIS RUN
        - definition: 01284500 / 12.3 KM
        - term: BEST
        - definition: 01284500 / 12.3 KM
        - paragraph: There is no true pause. Rules are frozen and hazards ghosted, and the world keeps moving behind this menu.
        - text: MUSIC
        - slider "MUSIC"
        - text: SFX
        - slider "SFX"
        - checkbox "MUTE"
        - text: MUTE
        - radiogroup "QUALITY":
          - radio "AUTO (STANDARD)" [checked]
          - text: AUTO (STANDARD)
          - radio "HIGH"
          - text: HIGH
          - radio "STANDARD"
          - text: STANDARD
          - radio "LOW"
          - text: LOW
          - radio "MINIMUM"
          - text: MINIMUM
          - radio "SOFTWARE"
          - text: SOFTWARE
        - checkbox "FULLSCREEN"
        - text: FULLSCREEN
        - checkbox "HIDE HUD"
        - text: HIDE HUD
        - checkbox "REDUCED MOTION"
        - text: REDUCED MOTION
    `);
  });

  test('the keyboard alone can do all of it', async ({ page }) => {
    await page.goto(url());
    const active = (): Promise<string | null> => page.evaluate(() => {
      const a = document.activeElement;
      return a === document.body ? 'body' : a?.getAttribute('data-mv') ?? a?.tagName ?? null;
    });
    expect(await active()).toBe('launch');
    await page.keyboard.press('Enter');
    expect((await callNames(page, 'launch')).length).toBeGreaterThanOrEqual(1);
    await page.evaluate(() => { window.__ui!.step(2); });
    expect(await active()).toBe('body');

    await page.keyboard.press('Escape');
    expect((await callNames(page, 'togglePause')).length).toBe(1);
    await page.evaluate(() => { window.__ui!.step(2); });
    const dialog = page.getByRole('dialog', { name: 'Cruise' });
    await expect(dialog).toBeVisible();
    expect(await active()).toBe('resume');
    await expect(page.locator('[data-mv="hud"]')).toHaveAttribute('inert', '');

    // Tab through everything and wrap, never leaving the dialog.
    const seen: (string | null)[] = [];
    // E2 (amendment FH): FULLSCREEN and HIDE HUD come between the radios and REDUCED MOTION, which is still last.
    // Amendment VW (T13): the camera button follows MUTE, on its row.
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.querySelector('[data-mv="cruise"]')!.contains(document.activeElement))).toBe(true);
      seen.push(await active());
    }
    expect(seen[0]).toBe('music');
    expect(seen[1]).toBe('sfx');
    expect(seen[2]).toBe('mute-toggle');
    expect(seen[3]).toBe('camera');
    expect(seen[4]).toBe('INPUT');
    expect(seen[5]).toBe('fullscreen');
    expect(seen[6]).toBe('hide-hud');
    expect(seen[7]).toBe('reduced');
    expect(seen[8]).toBe('resume');
    await page.keyboard.press('Shift+Tab');
    expect(await active()).toBe('reduced');
    await page.keyboard.press('Tab');
    expect(await active()).toBe('resume');

    // A slider by arrows.
    await page.keyboard.press('Tab');
    const before = (await callNames(page, 'setVolume')).length;
    const music = page.locator('[data-mv="music"]');
    const was = await music.inputValue();
    await page.keyboard.press('ArrowLeft');
    expect(await music.inputValue()).not.toBe(was);
    expect((await callNames(page, 'setVolume')).length).toBe(before + 1);

    // Amendment VW (T13): the camera button by Enter, two stops on from the slider.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    expect(await active()).toBe('camera');
    await page.keyboard.press('Enter');
    const cams = await callNames(page, 'setCamMode');
    expect(cams[cams.length - 1]!.args).toEqual([1]);
    await expect(page.locator('[data-mv="camera"]')).toContainText('COCKPIT');

    // A radio by arrows.
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowDown');
    const quality = await callNames(page, 'setQuality');
    expect(quality.length).toBe(1);
    expect(quality[0]!.args).toEqual([4]);

    // Out with Esc: focus on body, HUD live again, Space boosts.
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.__ui!.step(2); });
    await expect(dialog).toHaveCount(0);
    expect(await active()).toBe('body');
    await expect(page.locator('[data-mv="hud"]')).not.toHaveAttribute('inert', '');
    await page.keyboard.down('Space');
    expect((await sample(page)).boost).toBe(true);
    await page.keyboard.up('Space');
  });

  test('P, the menu button and Resume all toggle, and only in PLAY or CRUISE', async ({ page }) => {
    await page.goto(url());
    await page.keyboard.press('KeyP');
    expect(await callNames(page, 'togglePause')).toEqual([]);
    await page.evaluate(() => { window.__ui!.state('play'); window.__ui!.step(6); });
    await page.keyboard.press('KeyP');
    expect((await callNames(page, 'togglePause')).length).toBe(1);
    await page.evaluate(() => { window.__ui!.step(2); });
    await page.getByRole('button', { name: 'RESUME' }).click();
    expect((await callNames(page, 'togglePause')).length).toBe(2);
    await page.evaluate(() => { window.__ui!.step(2); });
    // A fine pointer cannot press II in PLAY (A22), so the keyboard does: Tab reaches it and Enter presses it. The touch
    // rows in gesture: touch and input: mouse corner, touch press it by a tap.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    expect((await callNames(page, 'togglePause')).length).toBe(3);

    await page.evaluate(() => { window.__ui!.state('signal-lost'); });
    await page.keyboard.press('Escape');
    expect((await callNames(page, 'togglePause')).length).toBe(3);
  });

  test('M mutes and restores, with the chip showing it', async ({ page }) => {
    await page.goto(url({ state: 'play' }));
    const chip = page.locator('[data-mv="mute"]');
    await expect(chip).toBeHidden();
    await page.keyboard.press('KeyM');
    await expect(chip).toBeVisible();
    await page.keyboard.press('KeyM');
    await expect(chip).toBeHidden();
    const vols = (await callNames(page, 'setVolume')).map((c) => c.args);
    expect(vols).toEqual([[0.8, 0.8], [0, 0], [0.8, 0.8]]);
  });

  test('a shown :focus-visible control has an outline', async ({ page }) => {
    await page.goto(url({ state: 'cruise' }));
    await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => {
      const a = document.activeElement!;
      return { visible: a.matches(':focus-visible'), style: getComputedStyle(a).outlineStyle, width: parseFloat(getComputedStyle(a).outlineWidth) };
    });
    expect(outline.visible).toBe(true);
    expect(outline.style).not.toBe('none');
    expect(outline.width).toBeGreaterThan(0);
  });

  test('at load on a fine pointer, the focused launch button shows its ring', async ({ page }) => {
    await page.goto(url());
    const f = await page.evaluate(() => {
      const a = document.activeElement!;
      return { launch: a.getAttribute('data-mv'), visible: a.matches(':focus-visible'), style: getComputedStyle(a).outlineStyle };
    });
    expect(f).toEqual({ launch: 'launch', visible: true, style: 'solid' });
  });

  test('A24: CRUISE opened by Esc focuses RESUME with its ring, since a keyboard moved focus', async ({ page }) => {
    await page.goto(url({ state: 'play' }));
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.__ui!.step(2); });
    expect(await focusRing(page)).toEqual({ at: 'resume', visible: true, style: 'solid' });
  });

  test('A25: II says it opens a dialog and whether it is open, and the six quality radios are one radio group drawn unlike the checkboxes', async ({ page }) => {
    await page.goto(url({ state: 'play' }));
    const ii = page.locator('[data-mv="menu-button"]');
    await expect(ii).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(ii).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.__ui!.step(2); });
    await expect(ii).toHaveAttribute('aria-expanded', 'true');
    const group = page.getByRole('radiogroup', { name: 'QUALITY' });
    await expect(group).toBeVisible();
    await expect(group.getByRole('radio')).toHaveCount(6);
    const shape = await page.evaluate(() => {
      const read = (el: Element): { radius: string; transform: string } => {
        const cs = getComputedStyle(el);
        return { radius: cs.borderTopLeftRadius, transform: cs.transform };
      };
      return {
        radios: Array.from(document.querySelectorAll('.mv-radio input')).map(read),
        boxes: Array.from(document.querySelectorAll('.mv-check input')).map(read),
      };
    });
    console.log(`A25 shapes: radio ${JSON.stringify(shape.radios[0])}, checkbox ${JSON.stringify(shape.boxes[0])}`);
    for (const r of shape.radios) expect(r.radius).toBe('50%');
    for (const b of shape.boxes) {
      expect(b.radius).toBe('0px');
      expect(b.transform).not.toBe('none');
    }
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.__ui!.step(2); });
    await expect(ii).toHaveAttribute('aria-expanded', 'false');
  });

  test('the live region changes on sector, signal lost and context lost, and not on score', async ({ page }) => {
    await page.goto(url({ state: 'play' }));
    const live = page.locator('[data-mv="live"]');
    await expect(live).toHaveAttribute('role', 'status');
    await expect(live).toHaveAttribute('aria-live', 'polite');
    const text = (): Promise<string | null> => live.textContent();
    const start = await text();

    await page.evaluate(({ PLAY }) => {
      const dev = window.__ui!;
      const sim = { mode: PLAY as never, autopilot: false, score: 1000, sync: 3, shields: 2, overdrive: 0.5, beat: 1, travel: { chunk: 800, local: 0 } };
      let t = dev.clock() + 10;
      for (let i = 0; i < 100; i++) dev.frame(t += 8 / 120, { at: { chunk: 777, local: 0 }, sim: { ...sim, score: 1000 + i * 100 } });
    }, { PLAY: SimMode.PLAY });
    expect(await text()).toBe(start);

    await page.evaluate(({ PLAY }) => {
      const dev = window.__ui!;
      const sim = { mode: PLAY as never, autopilot: false, travel: { chunk: 800, local: 0 } };
      let t = dev.clock() + 20;
      for (let i = 0; i < 12; i++) dev.frame(t += 8 / 120, { at: { chunk: 800, local: 0 }, sim });
    }, { PLAY: SimMode.PLAY });
    expect(await text()).toBe('SECTOR 08 - ULTRAVIOLET - CRYSTAL DESERT');

    await page.evaluate(({ LOST }) => {
      const dev = window.__ui!;
      let t = dev.clock() + 30;
      for (let i = 0; i < 12; i++) dev.frame(t += 8 / 120, { at: { chunk: 800, local: 0 }, sim: { mode: LOST as never, autopilot: true, travel: { chunk: 800, local: 0 } } });
    }, { LOST: SimMode.SIGNAL_LOST });
    expect(await text()).toContain('SIGNAL LOST');

    await page.evaluate(({ PLAY }) => {
      const dev = window.__ui!;
      dev.ui.showContextLost(true);
      let t = dev.clock() + 40;
      for (let i = 0; i < 12; i++) dev.frame(t += 8 / 120, { at: { chunk: 800, local: 0 }, sim: { mode: PLAY as never, autopilot: false, travel: { chunk: 800, local: 0 } } });
    }, { PLAY: SimMode.PLAY });
    expect(await text()).toContain('VIDEO SIGNAL INTERRUPTED');
  });

  // With nothing else focusable in the document, headless Chromium wraps by itself, and that check could not fail (section 10).
  // One button goes before the UI and one after it, named apart, so the control can tell which way focus left.
  async function withOutsideButtons(page: Page): Promise<void> {
    await page.evaluate(() => {
      for (const [where, name] of [['afterbegin', 'outside-start'], ['beforeend', 'outside-end']] as const) {
        document.body.insertAdjacentHTML(where, `<button class="${name}" style="position:fixed;left:0;top:0">outside</button>`);
      }
    });
  }
  const activeHook = (page: Page): Promise<string | null | undefined> => page.evaluate(() => document.activeElement?.getAttribute('data-mv') ?? document.activeElement?.className);

  const WRAP = 'Tab from the last control in the dialog lands on the first';
  /** The forward wrap, one check shared by the row and its control, so the control fails exactly what the row asserts. */
  async function expectTabWraps(page: Page): Promise<void> {
    await page.locator('[data-mv="reduced"]').focus();
    expect(await activeHook(page), 'focus is on the last control before the Tab').toBe('reduced');
    await page.keyboard.press('Tab');
    expect(await activeHook(page), WRAP).toBe('resume');
  }

  test('Tab wraps at both ends, with focusable elements outside the dialog', async ({ page }) => {
    await page.goto(url({ state: 'cruise' }));
    await withOutsideButtons(page);
    await expectTabWraps(page);
    await page.keyboard.press('Shift+Tab');
    expect(await activeHook(page)).toBe('reduced');
  });

  // A bare test.fail passed on any failure: a page that never reached the cruise state, a fixture that threw, a bounded
  // wait that timed out (section 9, FC repair). So the fixture is asserted first, each part failing as itself, and the
  // wrap check's own failure is caught and must be the one this control names: the Tab stopped before the UI's trap, then
  // the browser's default move out of the dialog, past its last control, to the button after the UI.
  test('control: with Tab blocked from the UI, the wrap check fails because focus leaves the dialog', async ({ page }) => {
    await page.goto(url({ state: 'cruise' }));
    expect(await page.evaluate(() => ({
      installed: window.__ui !== undefined,
      mode: document.documentElement.getAttribute('data-mv-mode'),
    })), 'the dev page is ready, in the cruise state').toEqual({ installed: true, mode: 'cruise' });
    await expect(page.getByRole('dialog', { name: 'Cruise' })).toBeVisible();
    await withOutsideButtons(page);
    expect(await page.evaluate(() => Array.from(document.body.children, (e) => e.id || e.className).filter((n) => n === 'ui' || n.startsWith('outside-'))),
      'one button before the UI and one after it').toEqual(['outside-start', 'ui', 'outside-end']);
    await page.evaluate(() => {
      const w = window as Window & { __tabsStopped?: number };
      w.__tabsStopped = 0;
      window.addEventListener('keydown', (e) => {
        if (e.code === 'Tab') {
          w.__tabsStopped = (w.__tabsStopped ?? 0) + 1;
          e.stopImmediatePropagation();
        }
      }, { capture: true });
    });

    const failure: unknown = await expectTabWraps(page).then(() => null, (e: unknown) => e);
    const stopped = await page.evaluate(() => (window as Window & { __tabsStopped?: number }).__tabsStopped);
    const m = (failure as { matcherResult?: { name?: unknown; expected?: unknown; actual?: unknown } } | null)?.matcherResult;
    const got = {
      stopped,
      check: failure instanceof Error ? failure.message.split('\n')[0] : String(failure),
      matcher: m?.name, expected: m?.expected, received: m?.actual,
    };
    console.log(`A10 control: ${JSON.stringify(got)}`);
    expect(failure, 'with Tab blocked, the wrap check must fail').not.toBeNull();
    expect(got).toEqual({ stopped: 1, check: WRAP, matcher: 'toBe', expected: 'resume', received: 'outside-end' });
  });
});

test.describe('a11y: touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });

  test('at load on a coarse pointer, the launch button has focus without the ring, and Tab still shows it', async ({ page }) => {
    await page.goto(url());
    const read = () => page.evaluate(() => {
      const a = document.activeElement!;
      return { launch: a.getAttribute('data-mv'), visible: a.matches(':focus-visible'), style: getComputedStyle(a).outlineStyle };
    });
    expect(await read()).toEqual({ launch: 'launch', visible: false, style: 'none' });
    // A keyboard on a tablet: once Tab moves focus, the ring shows again.
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const after = await read();
    expect(after.visible).toBe(true);
    expect(after.style).toBe('solid');
  });

  test('A24: CRUISE opened by a tap on II focuses RESUME without the ring, even after a keyboard opened it, and a keyboard brings it back', async ({ page }, info) => {
    await page.goto(url({ state: 'play' }));
    // A keyboard first, so the tap below has to clear what the keyboard set.
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.__ui!.step(2); });
    expect(await focusRing(page)).toEqual({ at: 'resume', visible: true, style: 'solid' });
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.__ui!.step(2); });
    expect(await focusRing(page)).toMatchObject({ at: 'body' });
    const m = await rectOf(page, '[data-mv="menu-button"]');
    await page.touchscreen.tap(m.x + m.w / 2, m.y + m.h / 2);
    await page.waitForTimeout(100);
    expect((await callNames(page, 'togglePause')).length).toBe(3);
    await page.evaluate(() => { window.__ui!.step(2); });
    expect(await focusRing(page)).toEqual({ at: 'resume', visible: false, style: 'none' });
    await saveShot(page, info, 'cruise-after-tap');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    expect(await focusRing(page)).toEqual({ at: 'resume', visible: true, style: 'solid' });
  });

  test('A24: CRUISE opened by Esc on a touch screen shows the ring, since a keyboard moved focus', async ({ page }) => {
    await page.goto(url({ state: 'play' }));
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.__ui!.step(2); });
    expect(await focusRing(page)).toEqual({ at: 'resume', visible: true, style: 'solid' });
  });
});

// ---- contrast: A11 ----

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function luminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbToLinear(r / 255) + 0.7152 * srgbToLinear(g / 255) + 0.0722 * srgbToLinear(b / 255);
}
function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Decodes in the page. Evaluate is fine here, because no gesture depends on it. */
async function decode(page: Page, png: Buffer): Promise<{ w: number; h: number; data: number[] }> {
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(bmp, 0, 0);
    const data = g.getImageData(0, 0, bmp.width, bmp.height).data;
    return { w: bmp.width, h: bmp.height, data: Array.from(data) };
  }, png.toString('base64'));
}

const READOUTS = [
  '[data-mv="score"]', '[data-mv="sync"]', '[data-mv="km"]', '[data-mv="sector"]', '[data-mv="objective"]',
  '.mv-box-score > .mv-label', '.mv-syncrow > .mv-label', '.mv-kmrow .mv-label', '.mv-shieldrow .mv-label', '.mv-odrow .mv-label',
  '[data-mv="mute"]',
];

/** The play state with the MUTED chip showing, so every HUD readout is on screen. M is a key press, not an evaluate. */
async function openReadouts(page: Page, query: Record<string, string | number>): Promise<void> {
  await page.goto(url(query));
  await page.keyboard.press('KeyM');
  await expect(page.locator('[data-mv="mute"]')).toBeVisible();
}

interface ContrastRow { selector: string; ratio: number; need: number }

async function measureContrast(page: Page, selectors: readonly string[]): Promise<ContrastRow[]> {
  // The content box, inside border and padding, because that is what the text sits on. For a readout with neither it is
  // the whole box; the MUTED chip's own 2 px edge would otherwise be the 95th percentile.
  const specs = await page.evaluate((sel) => sel.map((s) => {
    const el = document.querySelector(s)!;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const l = parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
    const t = parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
    const w = r.width - l - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
    const h = r.height - t - parseFloat(cs.borderBottomWidth) - parseFloat(cs.paddingBottom);
    return { selector: s, color: cs.color, px: parseFloat(cs.fontSize), weight: parseInt(cs.fontWeight, 10), x: r.left + l, y: r.top + t, w, h, inset: l + t > 0 };
  }), selectors);
  const inset = specs.filter((s) => s.inset).map((s) => s.selector);
  if (inset.length > 0) console.log(`contrast measured inside border or padding: ${inset.join(', ')}`);
  await page.addStyleTag({ content: `.mv-ui *, .mv-ui *::before, .mv-ui *::after { animation: none !important; } .mv-ui [data-mv], .mv-ui .mv-label, .mv-ui p, .mv-ui li, .mv-ui b, .mv-ui button, .mv-ui button span { color: transparent !important; text-shadow: none !important; }` });
  const rows: ContrastRow[] = [];
  for (const s of specs) {
    const m = /rgba?\((\d+), (\d+), (\d+)/.exec(s.color);
    if (!m) throw new Error(`cannot read ${s.color}`);
    const text = luminance(Number(m[1]), Number(m[2]), Number(m[3]));
    const png = await page.screenshot({ clip: { x: s.x, y: s.y, width: Math.max(1, s.w), height: Math.max(1, s.h) } });
    const img = await decode(page, png);
    const lums: number[] = [];
    for (let i = 0; i < img.data.length; i += 4) lums.push(luminance(img.data[i]!, img.data[i + 1]!, img.data[i + 2]!));
    lums.sort((a, b) => a - b);
    const bg = lums[Math.floor(lums.length * 0.95)] ?? 0;
    const large = s.px >= 18.66 && s.weight >= 700;
    rows.push({ selector: s.selector, ratio: contrast(text, bg), need: large ? 3 : 4.5 });
  }
  return rows;
}

test.describe('contrast:', () => {
  for (const bg of ['white', 'scene'] as const) {
    for (let palette = 0; palette < 6; palette++) {
      test(`HUD readouts over ${bg}, palette ${palette}`, async ({ page }) => {
        await openReadouts(page, bg === 'white' ? { state: 'play', bg, palette } : { state: 'play', palette });
        const rows = await measureContrast(page, READOUTS);
        expect(rows.length).toBe(READOUTS.length);
        const low = Math.min(...rows.map((r) => r.ratio));
        console.log(`contrast ${bg} palette ${palette}: lowest ${low.toFixed(2)}`);
        for (const r of rows) expect(r.ratio, `${r.selector} needs ${r.need}`).toBeGreaterThanOrEqual(r.need);
      });
    }
  }

  test('title text over the scene', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(url({ state: 'title' }));
    const rows = await measureContrast(page, ['.mv-tagline', '[data-mv="best"]', '.mv-legend.mv-if-fine',
      // E6 (amendment LH): both start buttons' labels, where the one prompt span was.
      '.mv-launch-hud > .mv-launch-label', '.mv-launch-nohud > .mv-launch-label']);
    console.log(`contrast title: ${rows.map((r) => `${r.selector} ${r.ratio.toFixed(2)}`).join(', ')}`);
    for (const r of rows) expect(r.ratio, `${r.selector} needs ${r.need}`).toBeGreaterThanOrEqual(r.need);
  });

  test('control: a panel alpha of .2 fails over white', async ({ page }) => {
    await openReadouts(page, { state: 'play', bg: 'white' });
    await page.addStyleTag({ content: '.mv-ui { --mv-panel: rgba(10, 3, 30, .2) !important; }' });
    const rows = await measureContrast(page, READOUTS);
    const failing = rows.filter((r) => r.ratio < r.need);
    console.log(`contrast control failing: ${failing.map((r) => `${r.selector} ${r.ratio.toFixed(2)}`).join(', ')}`);
    expect(failing.length).toBeGreaterThan(0);
  });

  test('control: a dimmed SYNC label and MUTED chip fail, so both are measured', async ({ page }) => {
    const added = ['.mv-syncrow > .mv-label', '[data-mv="mute"]'];
    await openReadouts(page, { state: 'play', bg: 'white' });
    await page.addStyleTag({ content: '.mv-ui .mv-syncrow > .mv-label, .mv-ui [data-mv="mute"] { color: #3a3150 !important; }' });
    const rows = await measureContrast(page, added);
    console.log(`contrast dimmed control: ${rows.map((r) => `${r.selector} ${r.ratio.toFixed(2)}`).join(', ')}`);
    expect(rows.map((r) => r.ratio < r.need)).toEqual([true, true]);
  });
});

// ---- contrast: popups, A23 (VI-game). Each popup's text against what is behind it, by VI-game's s6 method: the frame
// held, each popup's text box read by Range, all UI text and its shadows made transparent, then every pixel in the box
// compared with the text colour. p10 is the 10th percentile of those ratios, so it reads the brightest tenth of the
// backdrop; the halo is not counted. Popups are large text (1.9em or more, bold), so the need is 3. ----

/** One of each kind at rest, as popups.ts writes them: text and data-k, with -r so they hold at opacity 1. */
const POPUP_SHOW: readonly (readonly [string, string])[] = [
  ['gain-r', '+500'], ['graze-r', 'GRAZE +100'], ['miss-r', 'MISS'], ['hit-r', 'HIT'], ['grade-r', 'GRADE A'], ['gain-r', '+1200'],
];
const POPUP_NEED = 3;
const NO_PLATE_CSS = '.mv-ui .mv-popup::before { display: none !important; }';
const HIDE_TEXT_CSS = '.mv-ui, .mv-ui * { color: transparent !important; text-shadow: none !important; -webkit-text-stroke: 0 !important; } .mv-ui .mv-wm { background: none !important; }';

interface PopupRow { kind: string; text: string; px: number; p10: number; median: number; min: number }

async function setPopups(page: Page, on: boolean): Promise<void> {
  await page.evaluate(({ list, show }) => {
    document.querySelectorAll<HTMLElement>('.mv-popup').forEach((s, i) => {
      const [k, t] = list[i]!;
      (s.firstChild as Text).data = show ? t : '';
      s.setAttribute('data-k', show ? k : '');
    });
  }, { list: POPUP_SHOW.map(([k, t]) => [k, t] as [string, string]), show: on });
}

/** Measures the six shown popups on whatever is behind them now. extraCss is applied for the reading only. */
async function popupContrast(page: Page, extraCss = ''): Promise<PopupRow[]> {
  const extra = extraCss === '' ? null : await page.addStyleTag({ content: extraCss });
  const specs = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.mv-popup')).map((el) => {
    const cs = getComputedStyle(el);
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    return { kind: el.getAttribute('data-k') ?? '', text: el.textContent ?? '', color: cs.color, px: parseFloat(cs.fontSize), x: r.left, y: r.top, w: r.width, h: r.height };
  }));
  const hide = await page.addStyleTag({ content: HIDE_TEXT_CSS });
  await afterFrames(page);
  const png = await page.screenshot();
  await hide.evaluate((e) => { (e as Element).remove(); });
  if (extra) await extra.evaluate((e) => { (e as Element).remove(); });
  // Measured in the page, returning only numbers: returning a whole frame took 30 s a test (R2).
  const stats = await page.evaluate(async ({ b64, boxes }) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(bmp, 0, 0);
    const scale = bmp.width / innerWidth;
    const lin = (v: number): number => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    const lum = (r: number, gg: number, b: number): number => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
    return boxes.map((b) => {
      const m = (b.color.match(/[\d.]+/g) ?? []).map(Number);
      const lt = lum(m[0] ?? 0, m[1] ?? 0, m[2] ?? 0);
      const x0 = Math.max(0, Math.floor(b.x * scale));
      const y0 = Math.max(0, Math.floor(b.y * scale));
      const x1 = Math.min(bmp.width, Math.ceil((b.x + b.w) * scale));
      const y1 = Math.min(bmp.height, Math.ceil((b.y + b.h) * scale));
      if (x1 <= x0 || y1 <= y0) return { p10: 0, median: 0, min: 0 };
      const d = g.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      const ratios = new Float64Array(d.length / 4);
      for (let i = 0; i < ratios.length; i++) {
        const lb = lum(d[i * 4]!, d[i * 4 + 1]!, d[i * 4 + 2]!);
        ratios[i] = (Math.max(lt, lb) + 0.05) / (Math.min(lt, lb) + 0.05);
      }
      ratios.sort();
      return { p10: ratios[Math.floor(ratios.length * 0.1)]!, median: ratios[Math.floor(ratios.length / 2)]!, min: ratios[0]! };
    });
  }, { b64: png.toString('base64'), boxes: specs });
  return specs.map((s, i) => ({ kind: s.kind, text: s.text, px: s.px, ...stats[i]! }));
}

const fmtPopups = (rows: readonly PopupRow[]): string => rows.map((r) => `${r.text} p10 ${r.p10.toFixed(2)} med ${r.median.toFixed(2)}`).join(', ');

test.describe('contrast: popups', () => {
  test('over white, the worst backdrop for light text on a dark plate, every popup reads 3:1 or more at p10, and without its plate one does not', async ({ page }, info) => {
    await page.goto(url({ state: 'play', bg: 'white' }));
    await setPopups(page, true);
    await saveShot(page, info, 'popups-white');
    const rows = await popupContrast(page);
    const bare = await popupContrast(page, NO_PLATE_CSS);
    console.log(`POPUPS over white: ${fmtPopups(rows)}`);
    console.log(`POPUPS over white, control without the plate: ${fmtPopups(bare)}`);
    expect(rows.length).toBe(POPUP_SHOW.length);
    for (const r of rows) {
      expect(r.px, `${r.text} is large text`).toBeGreaterThanOrEqual(18.66);
      expect(r.p10, `${r.kind} ${r.text}`).toBeGreaterThanOrEqual(POPUP_NEED);
    }
    expect(bare.some((r) => r.p10 < POPUP_NEED)).toBe(true);
  });
});

test.describe('contrast: popups over the game', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'gpu', 'the app needs the gpu project'); });

  test('every popup reads 3:1 or more at p10 against the scene behind it, over 4 held play frames, and without its plate one does not', async ({ page }, info) => {
    test.setTimeout(120_000);
    const ready = page.waitForEvent('console', { predicate: (m) => m.text() === 'MV_READY', timeout: 60_000 });
    await page.goto('/?harness');
    await ready;
    await nodeWait(1000);
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'play');
    const all: PopupRow[] = [];
    const bare: PopupRow[] = [];
    for (let k = 0; k < 4; k++) {
      // A hand on the keyboard, so idle never starts, and somewhere else on the road each time.
      const key = k % 2 === 1 ? 'KeyA' : 'KeyD';
      await page.keyboard.down(key);
      await nodeWait(1500 + k * 700);
      await page.keyboard.up(key);
      await page.evaluate(() => { (window as unknown as { __mv: HarnessApi }).__mv.manual(true); });
      await nodeWait(300);
      await setPopups(page, true);
      await afterFrames(page);
      await saveShot(page, info, `popups-game-${k}`);
      const rows = await popupContrast(page);
      const without = await popupContrast(page, NO_PLATE_CSS);
      console.log(`POPUPS game frame ${k}: ${fmtPopups(rows)}`);
      console.log(`POPUPS game frame ${k}, control without the plate: ${fmtPopups(without)}`);
      all.push(...rows);
      bare.push(...without);
      await setPopups(page, false);
      await page.evaluate(() => { (window as unknown as { __mv: HarnessApi }).__mv.manual(false); });
    }
    const lowest = (rows: readonly PopupRow[], text: string): number => Math.min(...rows.filter((r) => r.text === text).map((r) => r.p10));
    console.log(`POPUPS game, lowest p10 over 4 frames: ${POPUP_SHOW.map(([, t]) => `${t} ${lowest(all, t).toFixed(2)} (without plate ${lowest(bare, t).toFixed(2)})`).join(', ')}`);
    for (const r of all) expect(r.p10, `${r.kind} ${r.text}`).toBeGreaterThanOrEqual(POPUP_NEED);
    expect(bare.some((r) => r.p10 < POPUP_NEED)).toBe(true);
  });
});

// ---- reduced: A12 ----

async function animationsNow(page: Page): Promise<number> {
  return page.evaluate(() => document.getAnimations().length);
}

const GATE_EVENT = { kind: Ev.GATE, x: 0, y: 6, value: 500, chunk: 0, index: 0 };

async function firePopup(page: Page): Promise<void> {
  await page.evaluate((event) => {
    const dev = window.__ui!;
    dev.frame(dev.clock() + 5, { events: [event as never], at: { chunk: 777, local: 32 }, sim: { travel: { chunk: 971, local: 0 } } });
  }, GATE_EVENT);
}

test.describe('reduced:', () => {
  test('under prefers-reduced-motion nothing animates, and the sim is told at mount', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(url({ state: 'title' }));
    const said = await callNames(page, 'setReducedMotion');
    expect(said[0]!.args).toEqual([true]);
    expect(await animationsNow(page)).toBe(0);

    await page.goto(url({ state: 'play' }));
    await page.evaluate(() => { window.__ui!.step(30); });
    expect(await animationsNow(page)).toBe(0);
    expect(await page.locator('[data-mv="sync"]').getAttribute('data-beat')).toBe('a');

    await firePopup(page);
    await expect(page.locator('.mv-popup[data-k="gain-r"]')).toHaveCount(1);
    expect(await animationsNow(page)).toBe(0);
    const visible = await page.evaluate(() => getComputedStyle(document.querySelector('.mv-popup[data-k="gain-r"]')!).opacity);
    expect(visible).toBe('1');
    // Expiry on the tick, the same style of timer as the banner.
    await page.evaluate(() => { window.__ui!.step(20); });
    await expect(page.locator('.mv-popup[data-k="gain-r"]')).toHaveCount(0);

    await page.goto(url({ state: 'signal-lost' }));
    expect(await animationsNow(page)).toBe(0);
    await page.goto(url({ state: 'autopilot' }));
    expect(await animationsNow(page)).toBe(0);
    await page.goto(url({ state: 'play-low' }));
    expect(await animationsNow(page)).toBe(0);
  });

  test('control: with default media, play, signal-lost and popups do animate', async ({ page }) => {
    await page.goto(url({ state: 'play' }));
    const said = await callNames(page, 'setReducedMotion');
    expect(said[0]!.args).toEqual([false]);
    const beat = await page.evaluate(() => {
      window.__ui!.step(10);
      return document.getAnimations().length;
    });
    expect(beat).toBeGreaterThan(0);

    await firePopup(page);
    expect(await page.evaluate(() => document.getAnimations().filter((a) => (a as CSSAnimation).animationName.startsWith('mv-pop')).length)).toBe(1);

    await page.goto(url({ state: 'signal-lost' }));
    expect(await animationsNow(page)).toBeGreaterThan(0);
  });

  test('the menu checkbox overrides both ways and survives reload', async ({ page }) => {
    await page.goto(url({ state: 'cruise' }));
    const box = page.locator('[data-mv="reduced"]');
    await expect(box).not.toBeChecked();
    await box.check();
    let said = await callNames(page, 'setReducedMotion');
    expect(said[said.length - 1]!.args).toEqual([true]);
    await page.reload();
    said = await callNames(page, 'setReducedMotion');
    expect(said[0]!.args).toEqual([true]);
    await page.evaluate(() => { window.__ui!.state('cruise'); });
    await expect(box).toBeChecked();
    expect(await animationsNow(page)).toBe(0);

    await box.uncheck();
    said = await callNames(page, 'setReducedMotion');
    expect(said[said.length - 1]!.args).toEqual([false]);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    said = await callNames(page, 'setReducedMotion');
    expect(said[0]!.args).toEqual([false]);
  });

  test('an OS change is followed only while there is no override', async ({ page }) => {
    await page.goto(url({ state: 'cruise' }));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(async () => (await callNames(page, 'setReducedMotion')).length).toBe(2);
    let said = await callNames(page, 'setReducedMotion');
    expect(said[1]!.args).toEqual([true]);
    await expect(page.locator('[data-mv="reduced"]')).toBeChecked();

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(async () => (await callNames(page, 'setReducedMotion')).length).toBe(3);

    await page.locator('[data-mv="reduced"]').check();
    said = await callNames(page, 'setReducedMotion');
    expect(said.length).toBe(4);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForTimeout(100);
    expect((await callNames(page, 'setReducedMotion')).length).toBe(4);
  });

  test('every animation has a period of .34 s or more, in the running page and in the stylesheet', async ({ page }) => {
    await page.goto(url({ state: 'play-low' }));
    const seen: { name: string; duration: number }[] = [];
    const read = async (): Promise<void> => {
      seen.push(...await page.evaluate(() => document.getAnimations().map((a) => ({
        name: (a as CSSAnimation).animationName,
        duration: Number(a.effect!.getComputedTiming().duration),
      }))));
    };
    await page.evaluate(() => { window.__ui!.step(10); });
    await read();
    await firePopup(page);
    await read();
    await page.goto(url({ state: 'signal-lost' }));
    await read();
    await page.goto(url({ state: 'autopilot' }));
    await read();
    const names = new Set(seen.map((s) => s.name));
    console.log(`reduced animations: ${JSON.stringify([...names])}`);
    for (const n of ['mv-pop-a', 'mv-flicker', 'mv-tag', 'mv-ghost']) expect(names.has(n) || names.has(n.replace('-a', '-b')), n).toBe(true);
    for (const s of seen) expect(s.duration, s.name).toBeGreaterThanOrEqual(340);

    const css = readFileSync(resolve('src/ui/ui.css'), 'utf8');
    const durations = [...css.matchAll(/animation:\s*[\w-]+\s+([\d.]+)s/g)].map((m) => Number(m[1]));
    expect(durations.length).toBeGreaterThanOrEqual(7);
    for (const d of durations) expect(d).toBeGreaterThanOrEqual(0.34);
  });
});

// ---- fatal: A13 ----

const REASONS = [
  ['no-webgl2', 'NO SIGNAL', 'This browser or device could not start WebGL2 with floating-point render targets'],
  ['context-lost-permanent', 'SIGNAL LOST FOR GOOD', 'The graphics context dropped and did not return within 15 seconds'],
  ['shader-error', 'BAD TAPE', 'A shader failed to compile on this GPU'],
  ['runtime-error', 'THE ROAD BROKE', 'Something failed while running'],
] as const;

/**
 * Counts probe-lime pixels (r < 30, g > 225, b < 30) of a PNG in the page and returns only the count and size.
 * Returning every channel, 8.3M numbers at 1920x1080, through evaluate cost about 30 s per fatal test (V2-T08, R2).
 */
async function countLime(page: Page, png: Buffer): Promise<{ w: number; h: number; lime: number }> {
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
    let lime = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i]! < 30 && d[i + 1]! > 225 && d[i + 2]! < 30) lime++;
    }
    return { w: bmp.width, h: bmp.height, lime };
  }, png.toString('base64'));
}

test.describe('fatal:', () => {
  for (const [reason, heading, body] of REASONS) {
    test(`${reason}: heading, alert, focused Reload, and nothing shows through`, async ({ page }) => {
      await page.goto(url({ state: 'play' }));
      // A probe colour on the stage and a loud readout: neither may reach any pixel of the fatal page.
      await page.evaluate(() => { window.__ui!.stage.setAttribute('data-bg', 'black'); });
      await page.addStyleTag({ content: '#stage { background: #00ff00 !important; }' });
      // Control: the probe colour is on screen, and the counter sees it, before the fatal page covers it.
      const shown = await countLime(page, await page.screenshot({ scale: 'css' }));
      expect(shown.lime).toBeGreaterThan(0);
      await page.evaluate((r) => { window.__ui!.ui.showFatal(r); }, reason);
      const fatal = page.locator('[data-mv="fatal"]');
      await expect(fatal).toBeVisible();
      await expect(fatal).toHaveAttribute('role', 'alert');
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
      await expect(fatal).toContainText(body);
      await expect(page.locator('[data-mv="reload"]')).toBeFocused();
      const img = await countLime(page, await page.screenshot({ scale: 'css' }));
      console.log(`fatal ${reason}: lime pixels ${shown.lime} before showFatal, ${img.lime} after, over ${img.w}x${img.h}`);
      // Every pixel of the viewport was counted.
      expect({ w: img.w, h: img.h }).toEqual({ w: page.viewportSize()!.width, h: page.viewportSize()!.height });
      expect(img.lime).toBe(0);
      expect(await page.evaluate(() => document.querySelector('.mv-fatal')!.getAnimations({ subtree: true }).length)).toBe(0);
      expect(await page.evaluate(() => document.querySelectorAll('canvas').length)).toBe(0);
    });
  }

  test('works with no mount', async ({ page }) => {
    await page.goto(url({ mount: 0 }));
    await expect(page.locator('.mv-ui')).toHaveCount(0);
    await page.evaluate(() => { window.__ui!.ui.showFatal('shader-error'); });
    await expect(page.getByRole('heading', { name: 'BAD TAPE' })).toBeVisible();
    await expect(page.locator('[data-mv="reload"]')).toBeFocused();
  });

  test('uses no 3D transform and no perspective', async ({ page }) => {
    await page.goto(url({ mount: 0 }));
    await page.evaluate(() => { window.__ui!.ui.showFatal('no-webgl2'); });
    const bad = await page.evaluate(() => [...document.querySelectorAll('.mv-fatal, .mv-fatal *')].filter((el) => {
      const cs = getComputedStyle(el);
      return cs.perspective !== 'none' || cs.transform.startsWith('matrix3d') || cs.transformStyle === 'preserve-3d';
    }).length);
    expect(bad).toBe(0);
  });

  // V1-T08: 25 lines meeting at one point drew a solid pink wedge at the horizon. At least two strokes (1.5 px each)
  // between neighbouring line ends keeps sky between them [A].
  for (const size of [{ width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
    test(`the grid fan stops short of the vanishing point at ${size.width}x${size.height}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto(url({ state: 'fatal-no-webgl2' }));
      const ends = await page.evaluate(() => {
        const svg = document.querySelector('.mv-fatal-grid')!;
        const r = svg.getBoundingClientRect();
        const d = svg.querySelector('path')!.getAttribute('d') ?? '';
        const segs = [...d.matchAll(/M(-?[\d.]+) (-?[\d.]+)L(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as const);
        // The far end of each fan line, in CSS px. The viewBox is 100 x 40 with preserveAspectRatio none.
        return segs.filter(([, y0, , y1]) => y0 !== y1).map(([x0, y0, x1, y1]) => (y0 < y1 ? { x: x0, y: y0 } : { x: x1, y: y1 }))
          .map((p) => ({ x: r.left + (p.x / 100) * r.width, y: r.top + (p.y / 40) * r.height }));
      });
      expect(ends.length).toBeGreaterThanOrEqual(20);
      const xs = ends.map((e) => e.x).sort((a, b) => a - b);
      let gap = Infinity;
      for (let i = 1; i < xs.length; i++) gap = Math.min(gap, xs[i]! - xs[i - 1]!);
      console.log(`fatal grid at ${size.width}x${size.height}: ${ends.length} fan lines, narrowest gap at the far end ${gap.toFixed(2)} px`);
      expect(gap).toBeGreaterThanOrEqual(3);
    });
  }

  test('a second showFatal keeps the first reason', async ({ page }) => {
    await page.goto(url({ state: 'play' }));
    await page.evaluate(() => {
      const { ui } = window.__ui!;
      ui.showFatal('runtime-error');
      ui.showFatal('no-webgl2');
    });
    await expect(page.locator('[data-mv="fatal"]')).toHaveCount(1);
    await expect(page.locator('[data-mv="fatal"]')).toHaveAttribute('data-reason', 'runtime-error');
  });

  test('frame after fatal writes nothing, and input launches nothing', async ({ page }) => {
    await page.goto(url());
    const records = await page.evaluate(() => {
      const dev = window.__ui!;
      dev.ui.showFatal('runtime-error');
      const obs = new MutationObserver(() => { /* read by takeRecords */ });
      obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      obs.takeRecords();
      for (let i = 0; i < 60; i++) dev.frame(i, { at: { chunk: 100 * i, local: 0 }, sim: { score: i * 999, sync: 1 + i % 16 } });
      const n = obs.takeRecords().length;
      obs.disconnect();
      return n;
    });
    expect(records).toBe(0);
    await page.keyboard.press('KeyA');
    expect(await callNames(page, 'launch')).toEqual([]);
  });

  test('Reload produces a new load', async ({ page }) => {
    await page.goto(url({ state: 'play' }));
    await page.evaluate(() => {
      (window as unknown as { __marker: number }).__marker = 7;
      window.__ui!.ui.showFatal('runtime-error');
    });
    const load = page.waitForEvent('load');
    await page.locator('[data-mv="reload"]').click();
    await load;
    expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBeUndefined();
    await expect(page.locator('[data-mv="fatal"]')).toHaveCount(0);
  });
});

// ---- storage: A14 ----

interface Stored { settings: unknown; bests: unknown }

async function stored(page: Page): Promise<Stored> {
  return page.evaluate(() => ({
    settings: JSON.parse(localStorage.getItem('mv.settings.v1') ?? 'null') as unknown,
    bests: JSON.parse(localStorage.getItem('mv.bests.v1') ?? 'null') as unknown,
  }));
}

async function risingFrames(page: Page, warpSerial: number, seconds = 2): Promise<void> {
  await page.evaluate(({ warpSerial, seconds, PLAY }) => {
    const dev = window.__ui!;
    const t0 = dev.clock() + 1;
    for (let i = 0; i < seconds * 60; i++) {
      const t = t0 + i / 60;
      dev.frame(t, { at: { chunk: 777, local: 0 }, sim: { mode: PLAY as never, autopilot: false, score: 5000000 + i * 10, travel: { chunk: 900 + i, local: 0 }, warpSerial } });
    }
  }, { warpSerial, seconds, PLAY: SimMode.PLAY });
}

test.describe('storage:', () => {
  test('settings and bests survive reload in one context', async ({ page }) => {
    await page.goto(url({ state: 'cruise' }));
    await page.locator('[data-mv="music"]').fill('25');
    await page.locator('[data-mv="sfx"]').fill('40');
    await page.locator('[data-mv="mute-toggle"]').check();
    await page.locator('input[value="2"]').check();
    await page.locator('[data-mv="reduced"]').check();
    // E3 (amendment FH): HIDE HUD is stored with the others, so this row is also a browser catcher of f12.
    await page.locator('[data-mv="hide-hud"]').check();
    expect((await stored(page)).settings).toEqual({ music: 0.25, sfx: 0.4, muted: true, quality: 2, reduced: true, hideHud: true, cam: 'chase' });
    // Amendment VW (T13): the camera button steps to the next camera, and the camera is stored by name with the others.
    await page.locator('[data-mv="camera"]').click();
    expect((await stored(page)).settings).toEqual({ music: 0.25, sfx: 0.4, muted: true, quality: 2, reduced: true, hideHud: true, cam: 'cockpit' });

    await page.evaluate(() => { window.__ui!.state('play'); });
    await risingFrames(page, 0, 12);
    await page.reload();
    const bests = (await stored(page)).bests as { score: number; km: number };
    expect(bests.score).toBeGreaterThanOrEqual(5000000);
    expect(bests.km).toBeGreaterThan(0);

    const calls = await callsOf(page);
    expect(calls.find((c) => c.name === 'setVolume')!.args).toEqual([0, 0]);
    expect(calls.find((c) => c.name === 'setQuality')!.args).toEqual([2]);
    expect(calls.find((c) => c.name === 'setReducedMotion')!.args).toEqual([true]);
    expect(calls.find((c) => c.name === 'setCamMode')!.args).toEqual([1]);
    await expect(page.locator('[data-mv="best"]')).toContainText(String(bests.score).padStart(8, '0'));

    await page.evaluate(() => { window.__ui!.state('cruise'); });
    await expect(page.locator('[data-mv="music"]')).toHaveValue('25');
    await expect(page.locator('[data-mv="mute-toggle"]')).toBeChecked();
    await expect(page.locator('input[value="2"]')).toBeChecked();
    await expect(page.locator('[data-mv="reduced"]')).toBeChecked();
    await expect(page.locator('[data-mv="hide-hud"]')).toBeChecked();
    await expect(page.locator('[data-mv="camera"]')).toContainText('COCKPIT');
    await expect(page.locator('[data-mv="camera"]')).toHaveAccessibleName('Camera: cockpit. Press for the next camera.');
  });

  test('bests flush on pagehide', async ({ page }) => {
    await page.goto(url({ state: 'play' }));
    await risingFrames(page, 0, 2);
    const first = (await stored(page)).bests as { score: number } | null;
    await risingFrames(page, 0, 3);
    await page.goto(url());
    const after = (await stored(page)).bests as { score: number };
    expect(after.score).toBeGreaterThan(first?.score ?? 0);
  });

  test('a mount with no quality stored does not send setQuality', async ({ page }) => {
    await page.goto(url());
    expect(await callNames(page, 'setQuality')).toEqual([]);
  });

  test('with a throwing localStorage the page mounts, the menu works, and no console error appears', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } });
    });
    await page.goto(url({ state: 'cruise' }));
    await expect(page.getByRole('dialog', { name: 'Cruise' })).toBeVisible();
    const before = (await callNames(page, 'setVolume')).length;
    await page.locator('[data-mv="music"]').fill('10');
    expect((await callNames(page, 'setVolume')).length).toBe(before + 1);
    await page.evaluate(() => { window.__ui!.state('play'); });
    await risingFrames(page, 0, 8);
    await page.goto(url({ state: 'play' }));
    await expect(page.locator('[data-mv="hud"]')).toBeVisible();
  });

  test('warpSerial 1 with a record score leaves stored bests untouched', async ({ page }) => {
    await page.goto(url({ state: 'title' }));
    await page.evaluate(() => { localStorage.setItem('mv.bests.v1', '{"score":100,"km":1}'); });
    await page.reload();
    // No state call: it would run PLAY frames with warpSerial 0 first, and those may rightly record.
    await risingFrames(page, 1, 12);
    await page.goto(url());
    expect((await stored(page)).bests).toEqual({ score: 100, km: 1 });
  });

  // DI-61: furthest distance accrues only while score does, so CRUISE, idle autopilot and SIGNAL_LOST cannot farm it.
  // The HUD and the menu show the same run distance, so the readout and the best never disagree.
  test('run distance and furthest stop in CRUISE, idle autopilot and SIGNAL_LOST, and resume with no jump (DI-61)', async ({ page }) => {
    await page.goto(url({ state: 'title' }));
    const modes = { DEMO: SimMode.DEMO, PLAY: SimMode.PLAY, CRUISE: SimMode.CRUISE, LOST: SimMode.SIGNAL_LOST };
    // Each step is [mode, autopilot, chunk]. Frames are 8 ticks apart, past every throttle. A chunk is 64 u.
    const drive = (steps: readonly (readonly [keyof typeof modes, boolean, number])[]) => page.evaluate(({ steps, modes }) => {
      const dev = window.__ui!;
      const w = window as unknown as { __t?: number };
      for (const [mode, autopilot, chunk] of steps) {
        w.__t = (w.__t ?? dev.clock() + 1) + 8 / 120;
        dev.frame(w.__t, { at: { chunk: 5000, local: 0 }, sim: { mode: modes[mode] as never, autopilot, score: 1000, travel: { chunk, local: 0 } } });
      }
    }, { steps, modes });
    const km = page.locator('[data-mv="km"]');
    await drive([['DEMO', true, 5000], ['PLAY', false, 5000], ['PLAY', false, 5100]]);
    await expect(km).toHaveText('6.4');
    await drive([['CRUISE', true, 5100], ['CRUISE', true, 9000]]);
    await expect(km).toHaveText('6.4');
    await expect(page.locator('[data-mv="cruise"]')).toContainText('/ 6.4 KM');
    await drive([['PLAY', true, 9000], ['PLAY', true, 13000]]);
    await expect(km).toHaveText('6.4');
    await drive([['LOST', true, 13000], ['LOST', true, 14000]]);
    await expect(km).toHaveText('6.4');
    // Scoring again: 10 more chunks from where it stopped, not from the launch.
    await drive([['PLAY', false, 14000], ['PLAY', false, 14010]]);
    await expect(km).toHaveText('7.0');
    await page.goto(url());
    const bests = (await stored(page)).bests as { km: number };
    expect(bests.km).toBeCloseTo((110 * 64) / 1000, 9);
  });

  test('10 s of rising score calls setItem for bests at most 3 times', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __bestWrites: number };
      w.__bestWrites = 0;
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(this: Storage, k: string, v: string) {
        if (k === 'mv.bests.v1') w.__bestWrites++;
        real.call(this, k, v);
      };
    });
    await page.goto(url({ state: 'play' }));
    await page.evaluate(() => { (window as unknown as { __bestWrites: number }).__bestWrites = 0; });
    await risingFrames(page, 0, 10);
    const n = await page.evaluate(() => (window as unknown as { __bestWrites: number }).__bestWrites);
    console.log(`storage bests setItem calls over 10 s: ${n}`);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(3);
  });
});

// ---- overlays and small behaviours that have no row of their own ----

test.describe('overlays:', () => {
  test('the banner shows on a sector change with the grade written the frame before, and expires by tick', async ({ page }) => {
    await page.goto(url({ state: 'banner-sector' }));
    const banner = page.locator('[data-mv="banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('SECTOR 08 - ULTRAVIOLET - CRYSTAL DESERT');
    await expect(banner).toContainText('GRADE A +1200');
    await page.evaluate(() => { window.__ui!.step(50); });
    await expect(banner).toBeHidden();
    expect(await page.locator('.mv-banner-grade').textContent()).toBe('');
  });

  test('a grade with no sector change still shows, by itself', async ({ page }) => {
    await page.goto(url({ state: 'play' }));
    await page.evaluate(({ GRADE }) => {
      const dev = window.__ui!;
      const t = dev.clock() + 1;
      dev.frame(t, { events: [{ kind: GRADE as never, x: 0, y: 6, value: 400, chunk: 0, index: 2 }], at: { chunk: 777, local: 32 } });
      dev.frame(t + 40 / 120, { at: { chunk: 777, local: 32 } });
    }, { GRADE: Ev.GRADE });
    const banner = page.locator('[data-mv="banner"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('GRADE B +400');
    await expect(banner).toContainText('SECTOR 07');
  });

  test('no banner on launch, and none for a sector change seen in DEMO or CRUISE', async ({ page }) => {
    await page.goto(url({ state: 'play' }));
    const banner = page.locator('[data-mv="banner"]');
    await expect(banner).toBeHidden();
    await page.evaluate(({ CRUISE }) => {
      const dev = window.__ui!;
      dev.frame(dev.clock() + 1, { at: { chunk: 900, local: 0 }, sim: { mode: CRUISE as never } });
    }, { CRUISE: SimMode.CRUISE });
    await expect(banner).toBeHidden();
  });

  test('hit-stop holds the readouts and not the panels', async ({ page }) => {
    await page.goto(url({ state: 'play' }));
    const score = page.locator('[data-mv="score"]');
    const before = await score.textContent();
    await page.evaluate(({ LOST }) => {
      const dev = window.__ui!;
      dev.frame(dev.clock() + 1, { feel: { shipHold: 0.05 }, at: { chunk: 777, local: 32 }, sim: { mode: LOST as never, score: 99, autopilot: true, travel: { chunk: 971, local: 0 } } });
    }, { LOST: SimMode.SIGNAL_LOST });
    await expect(score).toHaveText(before!);
    await expect(page.locator('[data-mv="signal-lost"]')).toBeVisible();
    await page.evaluate(({ LOST }) => {
      const dev = window.__ui!;
      dev.frame(dev.clock() + 2, { at: { chunk: 777, local: 32 }, sim: { mode: LOST as never, score: 99, autopilot: true, travel: { chunk: 971, local: 0 } } });
    }, { LOST: SimMode.SIGNAL_LOST });
    await expect(score).toHaveText('00000099');
  });

  test('km starts at the launch, not at chunk 0, and the autopilot tag needs PLAY', async ({ page }) => {
    await page.goto(url({ state: 'title' }));
    const km = page.locator('[data-mv="km"]');
    await page.evaluate(({ DEMO, PLAY }) => {
      const dev = window.__ui!;
      const t = dev.clock() + 1;
      dev.frame(t, { at: { chunk: 5000, local: 0 }, sim: { mode: DEMO as never, travel: { chunk: 5000, local: 0 } } });
      dev.frame(t + 0.1, { at: { chunk: 5000, local: 0 }, sim: { mode: PLAY as never, autopilot: false, travel: { chunk: 5000, local: 0 } } });
      dev.frame(t + 0.2, { at: { chunk: 5000, local: 0 }, sim: { mode: PLAY as never, autopilot: false, travel: { chunk: 5010, local: 0 } } });
    }, { DEMO: SimMode.DEMO, PLAY: SimMode.PLAY });
    await expect(km).toHaveText('0.6');
    const tag = page.locator('[data-mv="autopilot"]');
    await expect(tag).toBeHidden();
    await page.evaluate(({ CRUISE }) => {
      const dev = window.__ui!;
      dev.frame(dev.clock() + 3, { at: { chunk: 5000, local: 0 }, sim: { mode: CRUISE as never, autopilot: true } });
    }, { CRUISE: SimMode.CRUISE });
    await expect(tag).toBeHidden();
    await page.evaluate(() => { window.__ui!.state('autopilot'); });
    await expect(tag).toBeVisible();
  });

  // DI-119, the operator's HC12: the tag leaves the road 480 ticks (4 s) after it appears, and comes back the next time
  // the autopilot takes over. The live region still announces it each time. Frames are dev-page ticks, not wall time.
  test('the autopilot tag leaves after 4 s and returns on the next takeover (DI-119)', async ({ page }) => {
    await page.goto(url({ state: 'title' }));
    const tag = page.locator('[data-mv="autopilot"]');
    await page.evaluate(() => { window.__ui!.state('autopilot'); });
    // state() rises the panel, then holds it 370 ticks: shown, 110 ticks short of the limit.
    await expect(tag).toBeVisible();
    await expect(tag).toHaveAttribute('data-show', '1');
    await page.evaluate(() => { window.__ui!.step(12); });
    await expect(tag, '96 ticks on, 14 short').toHaveAttribute('data-show', '1');
    await page.evaluate(() => { window.__ui!.step(2); });
    await expect(tag, '112 ticks on, past 480').toHaveAttribute('data-show', '0');
    await expect(tag).toBeHidden();
    await expect(page.locator('[data-mv="live"]')).toHaveText(AUTOPILOT_TAG);
    // A human retakes, then the autopilot again: shown again from that frame.
    await page.evaluate(({ PLAY }) => {
      const dev = window.__ui!;
      dev.frame(dev.clock() + 8 / 120, { sim: { mode: PLAY as never, autopilot: false } });
      dev.frame(dev.clock() + 16 / 120, { sim: { mode: PLAY as never, autopilot: true } });
    }, { PLAY: SimMode.PLAY });
    await expect(tag).toHaveAttribute('data-show', '1');
    await expect(tag).toBeVisible();
  });

  test('with REDUCED MOTION the tag still leaves, at once (DI-119)', async ({ page }) => {
    await page.goto(url({ state: 'title' }));
    await page.evaluate(() => { document.querySelector('.mv-ui')!.setAttribute('data-reduced', '1'); window.__ui!.state('autopilot'); window.__ui!.step(14); });
    const tag = page.locator('[data-mv="autopilot"]');
    await expect(tag).toHaveAttribute('data-show', '0');
    expect(await tag.evaluate((e) => getComputedStyle(e).visibility)).toBe('hidden');
  });

  test('the title drops into attract after 3600 quiet ticks, and activity restores it', async ({ page }) => {
    await page.goto(url({ state: 'title' }));
    const title = page.locator('[data-mv="title"]');
    await expect(title).toHaveAttribute('data-attract', '0');
    await page.evaluate(() => {
      const dev = window.__ui!;
      dev.frame(dev.clock() + 31, { at: { chunk: 1, local: 0 } });
    });
    await expect(title).toHaveAttribute('data-attract', '1');
    await page.mouse.move(200, 200);
    await page.evaluate(() => {
      const dev = window.__ui!;
      dev.frame(dev.clock() + 31.5, { at: { chunk: 1, local: 0 } });
    });
    await expect(title).toHaveAttribute('data-attract', '0');
  });

  test('mode attribute follows the sim', async ({ page }) => {
    await page.goto(url());
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-mv-mode', 'demo');
    for (const [state, mode] of [['play', 'play'], ['cruise', 'cruise'], ['signal-lost', 'lost']] as const) {
      await page.evaluate((s) => { window.__ui!.state(s); }, state);
      await expect(html).toHaveAttribute('data-mv-mode', mode);
    }
  });
});

// ---- review: A16. Images for a person or an agent to open. Nothing here judges them. ----

type Shots = Map<string, { label: string; path: string; width: number; height: number }[]>;
const shots: Shots = new Map();

function remember(key: string, label: string, path: string, width: number, height: number): void {
  const list = shots.get(key) ?? [];
  list.push({ label, path, width, height });
  shots.set(key, list);
}

/** Pauses every CSS animation partway, so a kick or a popup is shot mid-flight and the shot is repeatable. */
async function freeze(page: Page): Promise<void> {
  await page.addStyleTag({ content: '*, *::before, *::after { animation-play-state: paused !important; animation-delay: -.12s !important; }' });
}

/** Lays images out on a blank page with page.setContent and saves that page. Keeps the sheet within 1920 wide. */
async function sheet(page: Page, info: TestInfo, name: string, cells: readonly { label: string; path: string }[], columns: number, zoom = false): Promise<void> {
  const parts = cells.map((c) => {
    const b64 = readFileSync(c.path).toString('base64');
    return `<figure><figcaption>${c.label}</figcaption><img src="data:image/png;base64,${b64}"></figure>`;
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.setContent(`<!doctype html><style>
    html,body{margin:0;background:#222;color:#fff;font:14px sans-serif}
    main{display:grid;grid-template-columns:repeat(${columns},minmax(0,1fr));gap:6px;padding:6px;align-items:start}
    figure{margin:0}figcaption{padding:2px 0}img{display:block;${zoom ? 'width:100%;image-rendering:pixelated' : `max-width:100%;max-height:${columns === 1 ? 1040 : Math.floor(1040 / Math.ceil(cells.length / columns)) - 26}px`};margin:0 auto}
    </style><main>${parts.join('')}</main>`);
  await page.waitForLoadState('load');
  await saveShot(page, info, name);
}

for (const v of VIEWPORTS) {
  test.describe(`review: ${v.name}`, () => {
    useViewport(v);
    test('every state', async ({ page }, info) => {
      test.setTimeout(180_000);
      // One context visits every state, so a record from play-max would otherwise show in the menu's bests.
      await page.addInitScript(() => { localStorage.clear(); });
      for (const state of STATE_NAMES) {
        await page.goto(url({ state }));
        await freeze(page);
        const path = await saveShot(page, info, state);
        remember(state, `${v.name} ${v.width}x${v.height}`, path, v.width, v.height);
      }
    });
  });
}

test.describe('review: sheets', () => {
  test('one contact sheet per state', async ({ page }, info) => {
    test.setTimeout(120_000);
    for (const state of STATE_NAMES) {
      const list = shots.get(state);
      if (!list) continue;
      await sheet(page, info, `sheet-${state}`, list, 5);
    }
  });

  test('ultrawide at 1920 wide', async ({ page }, info) => {
    for (const state of ['title', 'play', 'cruise'] as const) {
      const shot = (shots.get(state) ?? []).find((s) => s.label.startsWith('ultrawide'));
      if (shot) await sheet(page, info, `ultrawide-${state}`, [shot], 1);
    }
  });

  test('play on all six palettes, on white, and the title under forced colours', async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const cells: { label: string; path: string }[] = [];
    for (let palette = 0; palette < 6; palette++) {
      await page.goto(url({ state: 'play', palette }));
      await freeze(page);
      cells.push({ label: `palette ${palette}`, path: await saveShot(page, info, `palette-${palette}`) });
    }
    await sheet(page, info, 'sheet-palettes', cells, 3);

    await page.goto(url({ state: 'play', bg: 'white' }));
    await freeze(page);
    await saveShot(page, info, 'play-white');

    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto(url({ state: 'title' }));
    await saveShot(page, info, 'title-forced-colors');
    await page.emulateMedia({ forcedColors: 'none' });
  });

  test('12 frames of a popup and of the beat kick', async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(url({ state: 'play' }));
    const popup: { label: string; path: string }[] = [];
    const kick: { label: string; path: string }[] = [];
    await page.evaluate((event) => {
      const dev = window.__ui!;
      dev.frame(dev.clock() + 5, { events: [event as never], at: { chunk: 777, local: 32 }, sim: { mode: 1 as never, autopilot: false, score: 1284500, sync: 8, shields: 2, overdrive: 0.62, beat: 11, travel: { chunk: 971, local: 0 } } });
      for (const a of document.getAnimations()) a.pause();
    }, GATE_EVENT);
    const score = await rectOf(page, '.mv-box-score');
    for (let i = 0; i < 12; i++) {
      const ms = i * 80;
      await page.evaluate((t) => {
        for (const a of document.getAnimations()) a.currentTime = t;
      }, ms);
      const at = String(i).padStart(2, '0');
      const popupPath = info.outputPath(`popup-${at}.png`);
      await page.screenshot({ path: popupPath, clip: { x: 330, y: 380, width: 220, height: 130 } });
      popup.push({ label: `${ms} ms`, path: popupPath });
      const kickPath = info.outputPath(`kick-${at}.png`);
      await page.screenshot({ path: kickPath, clip: { x: score.x, y: score.y, width: score.w, height: score.h } });
      kick.push({ label: `${ms} ms`, path: kickPath });
    }
    await sheet(page, info, 'sheet-motion-popup', popup, 4, true);
    await sheet(page, info, 'sheet-motion-kick', kick, 3, true);
  });
});

// ---- Amendment FH: FULLSCREEN and HIDE HUD in the CRUISE card (plan section 7, A29 to A35) ----

/** mv.settings.v1 exactly as the code before FH wrote it, and the same object with HIDE HUD on. */
const SETTINGS_PRE_FH = '{"music":0.8,"sfx":0.8,"muted":false,"quality":"auto","reduced":null}';
const SETTINGS_HIDDEN = '{"music":0.8,"sfx":0.8,"muted":false,"quality":"auto","reduced":null,"hideHud":true}';

/**
 * FH-31: a seed proves only the load path. It is written once per page, behind a sessionStorage flag, because an init
 * script runs again on every navigation and reload and would otherwise overwrite what the page itself saved.
 */
async function seedSettings(page: Page, json: string): Promise<void> {
  await page.addInitScript((value: string) => {
    if (sessionStorage.getItem('mv.fh.seeded') === '1') return;
    sessionStorage.setItem('mv.fh.seeded', '1');
    localStorage.setItem('mv.settings.v1', value);
  }, json);
}

/** The auto fixture watches only the test's own page; another page in the same test gets the same guard here. */
function guardPage(p: Page): string[] {
  const errors: string[] = [];
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
  p.on('pageerror', (e) => { errors.push(`pageerror: ${e.message}`); });
  return errors;
}

/** Where a label's centre is, for a real click or tap on it. Reading it is an evaluate, so never before a gesture test's gesture. */
async function labelCentre(page: Page, hook: string): Promise<{ x: number; y: number }> {
  return page.evaluate((h) => {
    const box = document.querySelector(`[data-mv="${h}"]`);
    if (!box) throw new Error(`no [data-mv="${h}"]`);
    const r = box.closest('label')!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, hook);
}

async function clickCentre(page: Page, selector: string): Promise<void> {
  const r = await rectOf(page, selector);
  await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
}

/** FH-23: images at CSS scale, so a DPR 2 or 3 page stays at most 1920 px wide; prints SCREENSHOT as saveShot does. */
async function saveCssShot(page: Page, info: TestInfo, name: string): Promise<string> {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, scale: 'css' });
  console.log(`SCREENSHOT ${path}`);
  return path;
}

// ---- The fullscreen event counter, FH-27 ----

interface FsCount { n: number }
type FsWindow = Window & { __fsCount: FsCount };

/**
 * Before any page script, counts fullscreenchange, webkitfullscreenchange, fullscreenerror and webkitfullscreenerror on
 * document and logs each as MV_FS <type> <count>. Dispatch is synchronous, so once a read sees the count move, the
 * product's own listener for that event has run too (FH-R2 (3)).
 */
function installFsCounter(): void {
  const c = { n: 0 };
  (window as unknown as { __fsCount: typeof c }).__fsCount = c;
  for (const type of ['fullscreenchange', 'webkitfullscreenchange', 'fullscreenerror', 'webkitfullscreenerror']) {
    document.addEventListener(type, () => { c.n++; console.log(`MV_FS ${type} ${c.n}`); });
  }
}

const fsCount = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as FsWindow).__fsCount.n);

/** Waits for the count to move past before, and returns it. */
async function fsMoved(page: Page, before: number): Promise<number> {
  await page.waitForFunction((b) => (window as unknown as FsWindow).__fsCount.n > b, before);
  return fsCount(page);
}

/** A fullscreen action (A30's header): its 'before' count, the action, then the wait for the count to move. */
async function fsAction(page: Page, act: () => Promise<unknown>): Promise<number> {
  const before = await fsCount(page);
  await act();
  return fsMoved(page, before);
}

interface FsRead { std: string | null; webkit: string | null; box: boolean | null; mode: string | null; toggles: number; count: number }

async function fsRead(page: Page): Promise<FsRead> {
  return page.evaluate(() => {
    const d = document as Document & { webkitFullscreenElement?: Element | null };
    const box = document.querySelector<HTMLInputElement>('[data-mv="fullscreen"]');
    return {
      std: d.fullscreenElement?.tagName ?? null,
      webkit: d.webkitFullscreenElement?.tagName ?? null,
      box: box ? box.checked : null,
      mode: document.documentElement.getAttribute('data-mv-mode'),
      toggles: window.__ui!.calls.filter((c) => c.name === 'togglePause').length,
      count: (window as unknown as FsWindow).__fsCount.n,
    };
  });
}

/**
 * An action taken in settled fullscreen that must leave it unchanged (A30's header, FH-27): the count as it was before
 * the action, and <html> still in fullscreen.
 */
async function fsSteady(page: Page, before: number, where: string): Promise<FsRead> {
  const r = await fsRead(page);
  expect(r.count, `${where}: no fullscreen event`).toBe(before);
  expect(r.std ?? r.webkit, `${where}: still in fullscreen`).toBe('HTML');
  return r;
}

const step = (page: Page, n: number): Promise<void> => page.evaluate((k) => { window.__ui!.step(k); }, n);

/** FH-36: what the last frame drew, read in the same task as the n steps before it, so no other frame comes between. */
interface FrameDrawn { view: string | null; mode: string | null; live: string | null; active: string | null; toggles: number }

async function stepDrawn(page: Page, n: number): Promise<FrameDrawn> {
  return page.evaluate((k) => {
    if (k > 0) window.__ui!.step(k);
    const a = document.activeElement;
    return {
      view: document.querySelector('.mv-ui')!.getAttribute('data-view'),
      mode: document.documentElement.getAttribute('data-mv-mode'),
      live: document.querySelector('[data-mv="live"]')!.textContent,
      active: a === document.body ? 'body' : a?.getAttribute('data-mv') ?? a?.tagName ?? null,
      toggles: window.__ui!.calls.filter((c) => c.name === 'togglePause').length,
    };
  }, n);
}

async function clickBox(page: Page, hook = 'fullscreen'): Promise<void> {
  const at = await labelCentre(page, hook);
  await page.mouse.click(at.x, at.y);
}

/** FH-21: the standard members gone, so Chromium's own prefixed API runs. */
function removeStandardFullscreen(): void {
  Reflect.deleteProperty(Element.prototype, 'requestFullscreen');
  Reflect.deleteProperty(Document.prototype, 'exitFullscreen');
  Object.defineProperty(Document.prototype, 'fullscreenEnabled', { configurable: true, get() { return undefined; } });
  Object.defineProperty(Document.prototype, 'fullscreenElement', { configurable: true, get() { return undefined; } });
}

/** The iPhone stand-in: neither form of element fullscreen. */
function removeAllFullscreen(): void {
  for (const name of ['requestFullscreen', 'webkitRequestFullscreen', 'webkitRequestFullScreen']) Reflect.deleteProperty(Element.prototype, name);
  for (const name of ['exitFullscreen', 'webkitExitFullscreen', 'webkitCancelFullScreen']) Reflect.deleteProperty(Document.prototype, name);
  for (const name of ['fullscreenEnabled', 'webkitFullscreenEnabled', 'fullscreenElement', 'webkitFullscreenElement']) {
    Object.defineProperty(Document.prototype, name, { configurable: true, get() { return undefined; } });
  }
}

/** FH-R2 (2): both flags false with all four request and exit functions present, as in an iframe without allow (FH-5). */
function disableFullscreenFlags(): void {
  for (const name of ['fullscreenEnabled', 'webkitFullscreenEnabled']) {
    Object.defineProperty(Document.prototype, name, { configurable: true, get() { return false; } });
  }
}

/** A30 (5): with no activation, a timer 1 s after load ticks the box and dispatches change, as a stray script would. */
function refuseLater(): void {
  window.addEventListener('load', () => {
    setTimeout(() => {
      const box = document.querySelector<HTMLInputElement>('[data-mv="fullscreen"]');
      if (!box) {
        console.log('MV_FS no box');
        return;
      }
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    }, 1000);
  });
}

/** Chromium 1234's console warning for a refused request [O: P5 B]. */
const REFUSAL_WARNING = "Failed to execute 'requestFullscreen' on 'Element': API can only be initiated by a user gesture.";

/** From RESUME, Tab n times, and where focus went each time. */
async function tabCycle(page: Page, n: number): Promise<(string | null)[]> {
  expect(await activeHookOf(page), 'the cycle starts on RESUME').toBe('resume');
  const seen: (string | null)[] = [];
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Tab');
    seen.push(await activeHookOf(page));
  }
  return seen;
}

// ---- fullscreen: A30, on the dev page ----

test.describe('fullscreen: desktop', () => {
  test('(1) FULLSCREEN is shown, unticked and first in the toggle row, and Tab from RESUME keeps the trap\'s ends', async ({ page }) => {
    await page.goto(url({ state: 'cruise' }));
    const box = page.locator('[data-mv="fullscreen"]');
    await expect(box).toBeVisible();
    await expect(box).not.toBeChecked();
    expect(await page.evaluate(() => document.querySelector('.mv-toggles > label:first-child input')?.getAttribute('data-mv') ?? null)).toBe('fullscreen');
    expect(await tabCycle(page, 9)).toEqual(['music', 'sfx', 'mute-toggle', 'camera', 'INPUT', 'fullscreen', 'hide-hud', 'reduced', 'resume']);
  });

  test('(2) a mouse click on its label enters and ticks, a second leaves and unticks, and neither toggles the run', async ({ page }) => {
    await page.addInitScript(installFsCounter);
    await page.goto(url({ state: 'cruise' }));
    await fsAction(page, () => clickBox(page));
    expect(await fsRead(page)).toMatchObject({ std: 'HTML', box: true, toggles: 0 });
    await fsAction(page, () => clickBox(page));
    await step(page, 2);
    expect(await fsRead(page)).toMatchObject({ std: null, webkit: null, box: false, toggles: 0, mode: 'cruise' });
  });

  test('(3) Tab to it and Space enters and ticks; Space again leaves and unticks', async ({ page }) => {
    await page.addInitScript(installFsCounter);
    await page.goto(url({ state: 'cruise' }));
    expect((await tabCycle(page, 6))[5]).toBe('fullscreen');
    await fsAction(page, () => page.keyboard.press('Space'));
    expect(await fsRead(page)).toMatchObject({ std: 'HTML', box: true });
    await fsAction(page, () => page.keyboard.press('Space'));
    expect(await fsRead(page)).toMatchObject({ std: null, box: false, toggles: 0 });
  });

  test('(4) mirror: a page-script exit, standing in for Esc, the browser or the OS, unticks the box, and in CRUISE toggles nothing', async ({ page }) => {
    await page.addInitScript(installFsCounter);
    await page.goto(url({ state: 'cruise' }));
    await fsAction(page, () => clickBox(page));
    expect((await fsRead(page)).box).toBe(true);
    await fsAction(page, () => page.evaluate(() => document.exitFullscreen()));
    expect(await fsRead(page)).toMatchObject({ std: null, box: false });
    await step(page, 2);
    expect(await fsRead(page)).toMatchObject({ box: false, toggles: 0, mode: 'cruise' });
  });

  test('(5) refusal: a request with no activation is refused, the box ends unticked, and nothing reaches the console as an error', async ({ page }) => {
    await page.addInitScript(installFsCounter);
    await page.addInitScript(refuseLater);
    const lines: { type: string; text: string }[] = [];
    page.on('console', (m) => { lines.push({ type: m.type(), text: m.text() }); });
    // Armed before goto, so a line that arrives early is not missed. waitForEvent grants no activation (Agents.md).
    const settled = page.waitForEvent('console', { predicate: (m) => m.text() === 'MV_FS fullscreenerror 1' || m.text() === 'MV_FS no box', timeout: 15_000 });
    await page.goto(url({ state: 'cruise' }));
    // FH-R3 (2): the 'before' count is 0 by construction, from the lines collected here, not read from the page.
    expect(lines.filter((l) => l.text.startsWith('MV_FS ')), 'no fullscreen event before the timer').toEqual([]);
    expect((await settled).text()).toBe('MV_FS fullscreenerror 1');
    // From here an evaluate may grant activation: the request has been made and refused.
    expect(await fsRead(page)).toMatchObject({ std: null, box: false, count: 1 });
    await expect.poll(() => lines.filter((l) => l.type === 'warning' && l.text === REFUSAL_WARNING).length, { timeout: 2000 }).toBe(1);
    console.log(`A30 (5) console: ${lines.filter((l) => l.type !== 'debug').map((l) => `${l.type}: ${l.text}`).join(' | ')}`);
  });

  test('(6) prefixed only: with the standard members removed, the row shows, and webkit enters, mirrors and leaves', async ({ page }) => {
    await page.addInitScript(removeStandardFullscreen);
    await page.addInitScript(installFsCounter);
    await page.goto(url({ state: 'cruise' }));
    expect(await page.evaluate(() => ({ request: typeof document.documentElement.requestFullscreen, enabled: String(document.fullscreenEnabled) })))
      .toEqual({ request: 'undefined', enabled: 'undefined' });
    await expect(page.locator('[data-mv="fullscreen"]')).toBeVisible();
    // FH-35: the prefixed calls return nothing, so the box must hold what was asked until the event, with no flicker
    // back. Read straight after the input, which is usually before the event (P1: an entry's event up to 129 ms later).
    let before = await fsCount(page);
    await clickBox(page);
    const early = await fsRead(page);
    console.log(`A30 (6) straight after the click: ${JSON.stringify(early)}`);
    if (early.count === before) expect(early.box, 'ticked from the click until the event').toBe(true);
    await fsMoved(page, before);
    expect(await fsRead(page)).toMatchObject({ webkit: 'HTML', box: true });
    before = await fsCount(page);
    await clickBox(page);
    const leaving = await fsRead(page);
    console.log(`A30 (6) straight after the untick: ${JSON.stringify(leaving)}`);
    if (leaving.count === before) expect(leaving.box, 'unticked from the untick until the event').toBe(false);
    await fsMoved(page, before);
    expect(await fsRead(page)).toMatchObject({ webkit: null, box: false });
    // A browser's own exit, by page script: the box follows webkitfullscreenchange.
    await fsAction(page, () => clickBox(page));
    expect(await fsRead(page)).toMatchObject({ webkit: 'HTML', box: true });
    await fsAction(page, () => page.evaluate(() => { (document as Document & { webkitExitFullscreen(): void }).webkitExitFullscreen(); }));
    expect(await fsRead(page)).toMatchObject({ webkit: null, box: false, toggles: 0 });
  });

  test('(7) unavailable: with no element fullscreen the label is not rendered, the role locator finds no box, and Tab skips it', async ({ page, context }) => {
    const variants = [['both APIs removed', removeAllFullscreen], ['both flags false, all four functions present', disableFullscreenFlags]] as const;
    for (const [name, script] of variants) {
      const p = name === variants[0][0] ? page : await context.newPage();
      const errors = p === page ? [] : guardPage(p);
      await p.addInitScript(script);
      await p.goto(url({ state: 'cruise' }));
      const label = await p.evaluate(() => {
        const l = document.querySelector('[data-mv="fullscreen"]')?.closest('label');
        if (!l) return null;
        const r = l.getBoundingClientRect();
        return { w: r.width, h: r.height, display: getComputedStyle(l).display, hidden: l.hidden };
      });
      expect(label, name).toEqual({ w: 0, h: 0, display: 'none', hidden: true });
      await expect(p.getByRole('checkbox', { name: 'FULLSCREEN' })).toHaveCount(0);
      expect(await tabCycle(p, 8), name).toEqual(['music', 'sfx', 'mute-toggle', 'camera', 'INPUT', 'hide-hud', 'reduced', 'resume']);
      if (p !== page) {
        const api = await p.evaluate(() => {
          const d = document as Document & Record<string, unknown>;
          const e = document.documentElement as HTMLElement & Record<string, unknown>;
          return [d['fullscreenEnabled'], d['webkitFullscreenEnabled'], typeof e['requestFullscreen'], typeof e['webkitRequestFullscreen'], typeof d['exitFullscreen'], typeof d['webkitExitFullscreen']];
        });
        expect(api, 'the second variant has both flags false and all four functions').toEqual([false, false, 'function', 'function', 'function', 'function']);
        await p.close();
      }
      expect(errors).toEqual([]);
    }
  });

  test('(8) Esc in fullscreen is the browser\'s, and leaving while in PLAY opens CRUISE once, never by the box', async ({ page }) => {
    test.setTimeout(90_000);
    await page.addInitScript(installFsCounter);
    await page.goto(url({ state: 'cruise' }));
    const exitByScript = (): Promise<unknown> => page.evaluate(() => document.exitFullscreen());

    // In CRUISE in fullscreen, Escape: no togglePause, still in fullscreen and in CRUISE.
    const n = await fsAction(page, () => clickBox(page));
    await page.keyboard.press('Escape');
    await fsSteady(page, n, 'Escape in CRUISE');
    await step(page, 2);
    expect(await fsSteady(page, n, 'Escape in CRUISE, after a step')).toMatchObject({ toggles: 0, mode: 'cruise', box: true });

    // Resume: PLAY, still in fullscreen.
    await clickCentre(page, '[data-mv="resume"]');
    await fsSteady(page, n, 'Resume');
    await step(page, 2);
    expect(await fsSteady(page, n, 'Resume, after a step')).toMatchObject({ toggles: 1, mode: 'play' });

    // Escape in PLAY: no togglePause.
    await page.keyboard.press('Escape');
    await fsSteady(page, n, 'Escape in PLAY');
    await step(page, 2);
    expect(await fsSteady(page, n, 'Escape in PLAY, after a step')).toMatchObject({ toggles: 1, mode: 'play' });

    // P, then P: CRUISE, then PLAY, as outside fullscreen.
    await page.keyboard.press('KeyP');
    await fsSteady(page, n, 'P');
    await step(page, 2);
    expect(await fsSteady(page, n, 'P, after a step')).toMatchObject({ toggles: 2, mode: 'cruise' });
    await page.keyboard.press('KeyP');
    await fsSteady(page, n, 'P again');
    await step(page, 2);
    expect(await fsSteady(page, n, 'P again, after a step')).toMatchObject({ toggles: 3, mode: 'play' });

    // In PLAY, a page-script exit: exactly one more togglePause, CRUISE, unticked, RESUME focused.
    await fsAction(page, exitByScript);
    await step(page, 2);
    expect(await fsRead(page)).toMatchObject({ std: null, box: false, toggles: 4, mode: 'cruise' });
    expect(await activeHookOf(page)).toBe('resume');

    // In CRUISE, a page-script exit: no togglePause.
    await fsAction(page, () => clickBox(page));
    await fsAction(page, exitByScript);
    await step(page, 2);
    expect(await fsRead(page)).toMatchObject({ std: null, box: false, toggles: 4, mode: 'cruise' });

    // In SIGNAL_LOST, a page-script exit, then frames back into PLAY: no togglePause.
    await fsAction(page, () => clickBox(page));
    await page.evaluate(() => { window.__ui!.state('signal-lost'); });
    await fsAction(page, exitByScript);
    await step(page, 2);
    expect(await fsRead(page)).toMatchObject({ std: null, toggles: 4, mode: 'lost' });
    await page.evaluate(() => { window.__ui!.state('play'); window.__ui!.step(2); });
    expect(await fsRead(page)).toMatchObject({ toggles: 4, mode: 'play' });

    // Untick in CRUISE, Resume at once: no togglePause beyond Resume's. Resume falls inside the untick's own exit, so it
    // is read under the untick's wait: the count up by one and <html> out (FH-R3 (1) (ii)).
    await page.keyboard.press('KeyP');
    await step(page, 2);
    expect(await fsRead(page)).toMatchObject({ toggles: 5, mode: 'cruise' });
    await fsAction(page, () => clickBox(page));
    const beforeUntick = await fsCount(page);
    await clickBox(page);
    await clickCentre(page, '[data-mv="resume"]');
    await fsMoved(page, beforeUntick);
    await step(page, 2);
    expect(await fsRead(page)).toMatchObject({ count: beforeUntick + 1, std: null, box: false, toggles: 6, mode: 'play' });
  });

  test('(9) in fullscreen the stage and the UI equal the viewport, and follow a resize while fullscreen stays on', async ({ page }) => {
    await page.addInitScript(installFsCounter);
    await page.goto(url({ state: 'cruise' }));
    const n = await fsAction(page, () => clickBox(page));
    const fill = (): Promise<unknown> => page.evaluate(() => {
      const b = (s: string): number[] => {
        const r = document.querySelector(s)!.getBoundingClientRect();
        return [r.left, r.top, r.width, r.height];
      };
      return { stage: b('#stage'), ui: b('.mv-ui'), viewport: [innerWidth, innerHeight] };
    });
    expect(await fill()).toEqual({ stage: [0, 0, 1920, 1080], ui: [0, 0, 1920, 1080], viewport: [1920, 1080] });
    await page.setViewportSize({ width: 1280, height: 720 });
    await fsSteady(page, n, 'setViewportSize');
    await expect.poll(fill, { timeout: 2000 }).toEqual({ stage: [0, 0, 1280, 720], ui: [0, 0, 1280, 720], viewport: [1280, 720] });
  });

  test('(12) unticked in the gap after a browser exit and before its event: nothing rejects, nothing toggles, and no mark is left', async ({ page }) => {
    await page.addInitScript(installFsCounter);
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => { pageErrors.push(e.message); });
    await page.goto(url({ state: 'cruise' }));
    await fsAction(page, () => clickBox(page));
    const before = await fsCount(page);
    // The browser's own exit, then a click on the still-ticked box from the exit's then, before its change event [O: P5 D].
    await page.evaluate(() => {
      const gap = { clicked: false, element: 'unset' as string | null, count: -1 };
      (window as unknown as { __gap: typeof gap }).__gap = gap;
      void document.exitFullscreen().then(() => {
        gap.element = document.fullscreenElement?.tagName ?? null;
        gap.count = (window as unknown as FsWindow).__fsCount.n;
        document.querySelector<HTMLInputElement>('[data-mv="fullscreen"]')!.click();
        gap.clicked = true;
      });
    });
    await fsMoved(page, before);
    expect(await page.evaluate(() => (window as unknown as { __gap: unknown }).__gap), 'the click landed in the gap').toEqual({ clicked: true, element: null, count: before });
    expect(pageErrors).toEqual([]);
    expect(await fsRead(page)).toMatchObject({ std: null, box: false });
    await step(page, 2);
    expect(await fsRead(page)).toMatchObject({ toggles: 0, mode: 'cruise' });

    // In again, Resume, then a page-script exit in PLAY: exactly one togglePause past Resume's, so no mark was left.
    const n = await fsAction(page, () => clickBox(page));
    await clickCentre(page, '[data-mv="resume"]');
    await fsSteady(page, n, 'Resume after the re-entry');
    await step(page, 2);
    expect(await fsSteady(page, n, 'Resume after the re-entry, after a step')).toMatchObject({ toggles: 1, mode: 'play' });
    await fsAction(page, () => page.evaluate(() => document.exitFullscreen()));
    await step(page, 2);
    expect(await fsRead(page)).toMatchObject({ std: null, box: false, toggles: 2, mode: 'cruise' });
    expect(pageErrors).toEqual([]);
  });

  test('(13) leaving in PLAY gives CRUISE in the frame that sees it, as P does: no autopilot view or announcement, and RESUME focused at once (FH-36)', async ({ page }, info) => {
    await page.addInitScript(installFsCounter);
    await page.goto(url({ state: 'cruise' }));
    const n = await fsAction(page, () => clickBox(page));
    // PLAY with nobody's autopilot on, as after a launch or a Resume on the app. state() is a page script, taken in
    // settled fullscreen, so it gets the no-change read (A30's header).
    await page.evaluate(() => { window.__ui!.state('play'); });
    await fsSteady(page, n, 'state play');
    const before = await stepDrawn(page, 0);
    expect(before, 'PLAY with the autopilot off, before the exit').toMatchObject({ view: 'hud', mode: 'play' });
    expect(before.live, 'no autopilot announcement before the exit').not.toBe(AUTOPILOT_TAG);

    // A page-script exit, the count moves, then one frame. The dev page's togglePause writes the frame's sim at once, as
    // the app's sim command does, so that frame is the one the app would draw.
    await fsAction(page, () => page.evaluate(() => document.exitFullscreen()));
    const first = await stepDrawn(page, 1);
    await saveCssShot(page, info, 'fh-leave-first-frame-1920x1080');
    expect(first, 'the first frame after the exit').toEqual({ view: 'hud menu', mode: 'cruise', live: before.live, active: 'resume', toggles: before.toggles + 1 });
    expect(await stepDrawn(page, 1), 'the frame after it').toEqual(first);
    expect(await fsRead(page)).toMatchObject({ std: null, box: false });

    // Guard, the same before and after FH-36: P back to PLAY, then P in PLAY, read the same way, gives the same frame.
    await page.keyboard.press('KeyP');
    expect(await stepDrawn(page, 1), 'P from CRUISE').toMatchObject({ view: 'hud', mode: 'play', toggles: before.toggles + 2 });
    await page.keyboard.press('KeyP');
    expect(await stepDrawn(page, 1), 'P in PLAY, the first frame').toEqual({ view: 'hud menu', mode: 'cruise', live: before.live, active: 'resume', toggles: before.toggles + 3 });
  });
});

for (const v of [{ name: '390x844', width: 390, height: 844, dpr: 3 }, { name: '1024x768', width: 1024, height: 768, dpr: 2 }] as const) {
  test.describe(`fullscreen: touch ${v.name}`, () => {
    test.use({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: v.dpr, hasTouch: true, isMobile: true });

    test('(10, 11) a tap on the label enters and ticks, a second tap leaves and unticks', async ({ page }) => {
      await page.addInitScript(installFsCounter);
      await page.goto(url({ state: 'cruise' }));
      const at = await labelCentre(page, 'fullscreen');
      await fsAction(page, () => page.touchscreen.tap(at.x, at.y));
      expect(await fsRead(page)).toMatchObject({ std: 'HTML', box: true, toggles: 0 });
      await fsAction(page, () => page.touchscreen.tap(at.x, at.y));
      expect(await fsRead(page)).toMatchObject({ std: null, box: false, toggles: 0 });
    });
  });
}

// ---- hud: hidden, A29 ----

/** FH-22: II alone, and nothing else, which by default Playwright would also find inside a full HUD. */
const HIDDEN_HUD_SNAPSHOT = `
  - /children: equal
  - button "Open cruise menu": II
`;
const LOOSE_HUD_SNAPSHOT = `
  - button "Open cruise menu": II
`;

const HUD_READOUTS = ['score', 'sync', 'km', 'sector', 'objective', 'shields', 'overdrive'] as const;

interface HudRead {
  readouts: Record<string, string>; labels: string[]; menuButton: string; chip: string; boost: string; popups: string; banner: string;
  hideAttr: string | null;
}

async function hudVisibility(page: Page): Promise<HudRead> {
  return page.evaluate((hooks) => {
    const vis = (el: Element | null): string => (el ? getComputedStyle(el).visibility : 'missing');
    const readouts: Record<string, string> = {};
    for (const h of hooks) readouts[h] = vis(document.querySelector(`[data-mv="${h}"]`));
    return {
      readouts,
      labels: Array.from(document.querySelectorAll('.mv-hud .mv-label'), (el) => vis(el)),
      menuButton: vis(document.querySelector('[data-mv="menu-button"]')),
      chip: vis(document.querySelector('[data-mv="mute"]')),
      boost: vis(document.querySelector('[data-mv="boost"]')),
      popups: vis(document.querySelector('[data-mv="popups"]')),
      banner: vis(document.querySelector('[data-mv="banner"]')),
      hideAttr: document.querySelector('.mv-ui')!.getAttribute('data-hide-hud'),
    };
  }, HUD_READOUTS);
}

function expectReadouts(r: HudRead, visibility: 'hidden' | 'visible', where: string): void {
  for (const [hook, v] of Object.entries(r.readouts)) expect(v, `${where}: ${hook}`).toBe(visibility);
  expect(r.labels.length, `${where}: the HUD has its labels`).toBeGreaterThan(0);
  for (const v of r.labels) expect(v, `${where}: a HUD label`).toBe(visibility);
}

const boxChecked = (page: Page, hook: string): Promise<boolean | null> =>
  page.evaluate((h) => document.querySelector<HTMLInputElement>(`[data-mv="${h}"]`)?.checked ?? null, hook);

test.describe('hud: hidden', () => {
  test('(1) ticked in CRUISE by a click: the root says so, it is stored, no command is sent, and in PLAY only II is left', async ({ page }) => {
    await page.goto(url({ state: 'cruise' }));
    const before = (await callsOf(page)).length;
    await clickBox(page, 'hide-hud');
    await expect(page.locator('.mv-ui')).toHaveAttribute('data-hide-hud', '1');
    expect(((await stored(page)).settings as { hideHud?: unknown } | null)?.hideHud, 'saved at the tick').toBe(true);
    expect((await callsOf(page)).length, 'no UiCommands call').toBe(before);
    await clickCentre(page, '[data-mv="resume"]');
    await step(page, 2);
    await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'play');
    await expect(page.locator('[data-mv="hud"]')).toMatchAriaSnapshot(HIDDEN_HUD_SNAPSHOT);
    const r = await hudVisibility(page);
    expectReadouts(r, 'hidden', 'PLAY, HUD hidden');
    expect(r.menuButton).toBe('visible');
    await page.keyboard.press('KeyM');
    await expect(page.locator('.mv-ui')).toHaveAttribute('data-muted', '1');
    expect((await hudVisibility(page)).chip, 'the MUTED chip, shown by M, stays hidden').toBe('hidden');
  });

  test('(2) control: that template fails against a shown HUD, which the loose form without /children: equal matches', async ({ page }) => {
    await page.goto(url({ state: 'play' }));
    const hud = page.locator('[data-mv="hud"]');
    await expect(hud).toMatchAriaSnapshot(LOOSE_HUD_SNAPSHOT);
    let failure: string | null = null;
    try {
      await expect(hud).toMatchAriaSnapshot(HIDDEN_HUD_SNAPSHOT, { timeout: 1000 });
    } catch (e) {
      failure = (e as Error).message.split('\n')[0] ?? 'failed';
    }
    console.log(`A29 (2) control: ${failure ?? 'no failure'}`);
    expect(failure, 'the /children: equal template must not match a shown HUD').not.toBeNull();
  });

  test('(3) no GATE popup and no sector banner show, and the live region still announces the sector', async ({ page }) => {
    await seedSettings(page, SETTINGS_HIDDEN);
    await page.goto(url({ state: 'play' }));
    await firePopup(page);
    const popup = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('.mv-popup')).find((p) => (p.getAttribute('data-k') ?? '') !== '');
      return el ? { k: el.getAttribute('data-k'), text: el.textContent, visibility: getComputedStyle(el).visibility } : null;
    });
    expect(popup, 'a GATE popup was fired').not.toBeNull();
    expect(popup!.visibility, `popup ${popup!.k} ${popup!.text}`).toBe('hidden');
    await page.evaluate(({ PLAY }) => {
      const dev = window.__ui!;
      const sim = { mode: PLAY as never, autopilot: false, travel: { chunk: 800, local: 0 } };
      let t = dev.clock() + 20;
      for (let i = 0; i < 12; i++) dev.frame(t += 8 / 120, { at: { chunk: 800, local: 0 }, sim });
    }, { PLAY: SimMode.PLAY });
    await expect(page.locator('[data-mv="banner"]')).toHaveAttribute('data-show', '1');
    expect((await hudVisibility(page)).banner).toBe('hidden');
    await expect(page.locator('[data-mv="live"]')).toHaveText('SECTOR 08 - ULTRAVIOLET - CRYSTAL DESERT');
  });

  test('(4) guard: with HIDE HUD stored, SIGNAL LOST, the autopilot tag, the context-lost layer and the fatal page each show', async ({ page }) => {
    await seedSettings(page, SETTINGS_HIDDEN);
    for (const [state, hook] of [['signal-lost', 'signal-lost'], ['autopilot', 'autopilot'], ['context-lost', 'context-lost'], ['fatal-no-webgl2', 'fatal']] as const) {
      await page.goto(url({ state }));
      console.log(`A29 (4) ${state}: data-hide-hud ${await page.evaluate(() => document.querySelector('.mv-ui')?.getAttribute('data-hide-hud') ?? null)}`);
      await expect(page.locator(`[data-mv="${hook}"]`), state).toBeVisible();
      await expect(page.locator('[data-mv="live"]')).toHaveAttribute('aria-live', 'polite');
    }
  });

  // DI-119, the operator's HC13, superseding FH-12: II is dimmed with the HUD hidden, and full with keyboard focus.
  test('II is dimmed to .5 with the HUD hidden, full with it shown and under keyboard focus (DI-119)', async ({ page }) => {
    const ii = page.locator('[data-mv="menu-button"]');
    const opacity = async (): Promise<string> => ii.evaluate((e) => getComputedStyle(e).opacity);
    await page.goto(url({ state: 'play' }));
    expect(await opacity(), 'HUD shown').toBe('1');
    await seedSettings(page, SETTINGS_HIDDEN);
    await page.goto(url({ state: 'play' }));
    expect(await opacity(), 'HUD hidden').toBe('0.5');
    // A script focus with no pointer used yet is keyboard-like, so it matches :focus-visible. No key is pressed: in PLAY a
    // key meant for the ship blurs II (VI-game).
    await ii.evaluate((e) => { (e as HTMLElement).focus(); });
    expect(await ii.evaluate((e) => e.matches(':focus-visible')), 'focus-visible').toBe(true);
    expect(await opacity(), 'HUD hidden, focused').toBe('1');
  });

  test('(5) the load path and the save path, each alone, and the warm HUD in DEMO (FH-31)', async ({ page, context }) => {
    // (5b) Save, no seed: nothing seeds this context, so only the page's own save can carry the value across the reload.
    await page.goto(url({ state: 'cruise' }));
    await clickBox(page, 'hide-hud');
    await page.reload();
    expect(await boxChecked(page, 'hide-hud'), '(5b) ticked after the reload').toBe(true);
    await page.evaluate(() => { window.__ui!.state('play'); });
    expectReadouts(await hudVisibility(page), 'hidden', '(5b) PLAY after the reload');

    // (5a) Load, seeded, no reload, each seed on a page of its own after (5b), so no seed can reach (5b). (5c) In DEMO.
    for (const [json, on] of [[SETTINGS_PRE_FH, false], [SETTINGS_HIDDEN, true]] as const) {
      const p = await context.newPage();
      const errors = guardPage(p);
      await seedSettings(p, json);
      await p.goto(url({ state: 'play' }));
      expect(await boxChecked(p, 'hide-hud'), `(5a) ${json}`).toBe(on);
      expectReadouts(await hudVisibility(p), on ? 'hidden' : 'visible', `(5a) ${json}`);
      if (on) {
        await p.goto(url());
        const warm = await p.evaluate(() => ({
          view: document.querySelector('.mv-ui')!.getAttribute('data-view'),
          hide: document.querySelector('.mv-ui')!.getAttribute('data-hide-hud'),
          opacity: Number(getComputedStyle(document.querySelector('[data-mv="hud"]')!).opacity),
          score: getComputedStyle(document.querySelector('[data-mv="score"]')!).visibility,
        }));
        expect(warm, '(5c) the warm HUD is still drawn in DEMO (D-012)').toEqual({ view: 'title', hide: '1', opacity: 0.001, score: 'visible' });
      }
      await p.close();
      expect(errors).toEqual([]);
    }
  });

  test('(6) unticking brings every readout back, showing the latest frame\'s values', async ({ page }) => {
    await seedSettings(page, SETTINGS_HIDDEN);
    await page.goto(url({ state: 'play' }));
    expectReadouts(await hudVisibility(page), 'hidden', 'seeded PLAY');
    // dev.clock() moves only in state() and step(), so each frame here takes its own later time, past the slot throttle.
    let later = 0;
    const play = (score: number, sync: number, mode: SimMode): Promise<void> => page.evaluate(({ score, sync, mode, dt }) => {
      const dev = window.__ui!;
      dev.frame(dev.clock() + dt, { at: { chunk: 777, local: 32 }, sim: { mode: mode as never, autopilot: false, score, sync, shields: 2, overdrive: 0.4, travel: { chunk: 971, local: 0 } } });
    }, { score, sync, mode, dt: (later += 0.25) });
    // FH-16: the slots keep writing while the HUD is hidden.
    await play(4242424, 3, SimMode.PLAY);
    await expect(page.locator('[data-mv="score"]')).toHaveText('04242424');
    await page.keyboard.press('KeyP');
    await play(4242424, 3, SimMode.CRUISE);
    await clickBox(page, 'hide-hud');
    await expect(page.locator('.mv-ui')).toHaveAttribute('data-hide-hud', '0');
    await clickCentre(page, '[data-mv="resume"]');
    await play(5151515, 5, SimMode.PLAY);
    expectReadouts(await hudVisibility(page), 'visible', 'PLAY after the untick');
    await expect(page.locator('[data-mv="score"]')).toHaveText('05151515');
    await expect(page.locator('[data-mv="sync"]')).toHaveText('×5');
  });

  test('(7) guard: in PLAY with the HUD hidden, Tab reaches II and Enter opens CRUISE', async ({ page }) => {
    await seedSettings(page, SETTINGS_HIDDEN);
    await page.goto(url({ state: 'play' }));
    await page.keyboard.press('Tab');
    expect(await activeHookOf(page)).toBe('menu-button');
    await page.keyboard.press('Enter');
    expect((await callNames(page, 'togglePause')).length).toBe(1);
    await step(page, 2);
    await expect(page.getByRole('dialog', { name: 'Cruise' })).toBeVisible();
  });
});

test.describe('hud: hidden, touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });

  test('(8) a tap on II opens the menu, the hidden BOOST button takes no touch, and a drag and a second finger still boost', async ({ page, context }) => {
    await seedSettings(page, SETTINGS_HIDDEN);
    await page.goto(url({ state: 'play' }));
    const boost = await rectOf(page, '[data-mv="boost"]');
    expect(await hitAt(page, boost.x + boost.w / 2, boost.y + boost.h / 2), 'the hidden BOOST button\'s centre').toBe('stage');
    const cdp = await context.newCDPSession(page);
    await touch(cdp, 'touchStart', [{ x: 195, y: 520, id: 1 }]);
    for (let i = 1; i <= 4; i++) await touch(cdp, 'touchMove', [{ x: 195 + i * 10, y: 520, id: 1 }]);
    await afterFrames(page);
    let f = await sample(page);
    expect(f.absolute).toBe(true);
    expect(f.boost).toBe(false);
    await touch(cdp, 'touchStart', [{ x: 235, y: 520, id: 1 }, { x: 300, y: 300, id: 2 }]);
    f = await sample(page);
    expect(f.boost, 'a second finger boosts').toBe(true);
    await touch(cdp, 'touchEnd', [{ x: 300, y: 300, id: 2 }]);
    f = await sample(page);
    expect(f.boost, 'lifting it stops').toBe(false);
    await touch(cdp, 'touchEnd', []);
    await cdp.detach();
    const ii = await rectOf(page, '[data-mv="menu-button"]');
    await page.touchscreen.tap(ii.x + ii.w / 2, ii.y + ii.h / 2);
    expect((await callNames(page, 'togglePause')).length, 'a tap on II').toBe(1);
  });
});

// ---- app: fullscreen, A31, the app read-only on gpu (FH-18) ----

interface AppFill { fs: string | null; box: boolean | null; mode: string | null; stage: number[]; canvas: number[]; ui: number[]; buffer: number[]; viewport: number[] }

async function appFill(page: Page): Promise<AppFill> {
  return page.evaluate(() => {
    const b = (el: Element): number[] => {
      const r = el.getBoundingClientRect();
      return [r.left, r.top, r.width, r.height];
    };
    const canvas = document.querySelector<HTMLCanvasElement>('#mv-stage canvas')!;
    return {
      fs: document.fullscreenElement?.tagName ?? null,
      box: document.querySelector<HTMLInputElement>('[data-mv="fullscreen"]')?.checked ?? null,
      mode: document.documentElement.getAttribute('data-mv-mode'),
      stage: b(document.querySelector('#mv-stage')!), canvas: b(canvas), ui: b(document.querySelector('#mv-ui')!),
      buffer: [canvas.width, canvas.height], viewport: [innerWidth, innerHeight],
    };
  });
}

function expectFills(r: AppFill, w: number, h: number, where: string): void {
  for (const k of ['stage', 'canvas', 'ui'] as const) expect(r[k], `${where}: ${k}`).toEqual([0, 0, w, h]);
  const [bw, bh] = r.buffer as [number, number];
  expect(Math.abs(bw - bh * w / h), `${where}: the buffer ${bw}x${bh} has the viewport's aspect within a pixel`).toBeLessThanOrEqual(1);
}

/**
 * A31 opens /?harness, not /: the app logs MV_READY only under ?harness [O: src/app/boot.ts, step 15], as A23 and P3
 * found. It uses MV_READY and DOM reads, never __mvE2e or the harness's own calls.
 */
async function openApp(page: Page): Promise<void> {
  await page.addInitScript(installFsCounter);
  const ready = page.waitForEvent('console', { predicate: (m) => m.text() === 'MV_READY', timeout: 60_000 });
  await page.goto('/?harness');
  await ready;
  await nodeWait(1000);
}

/** One UI write as the app made it. b is the MutationObserver batch: records in one batch were written in one task. */
interface UiRec { b: number; k: 'view' | 'mode' | 'live'; v: string | null }
type UiLogWindow = Window & { __uiLog: UiRec[]; __uiLogOn: boolean };

/**
 * FH-36, before any page script: records every data-view write on #mv-ui, every data-mv-mode write on <html> and every
 * change to the live region's text, by MutationObserver batch. The app writes all of these inside ui.frame, in one rAF
 * callback, so the card and the mode of one frame share a batch. It attaches once mount has built the live region.
 */
function installUiRecorder(): void {
  const w = window as unknown as UiLogWindow;
  const log: UiRec[] = [];
  w.__uiLog = log;
  w.__uiLogOn = false;
  let batch = 0;
  const start = (): void => {
    const ui = document.querySelector('#mv-ui');
    const live = document.querySelector('[data-mv="live"]');
    if (!ui || !live) {
      requestAnimationFrame(start);
      return;
    }
    const mo = new MutationObserver((recs) => {
      batch++;
      for (const r of recs) {
        if (r.type !== 'attributes') log.push({ b: batch, k: 'live', v: live.textContent });
        else log.push({ b: batch, k: r.attributeName === 'data-view' ? 'view' : 'mode', v: (r.target as Element).getAttribute(r.attributeName!) });
      }
    });
    mo.observe(ui, { attributes: true, attributeFilter: ['data-view'] });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mv-mode'] });
    mo.observe(live, { characterData: true, childList: true, subtree: true });
    w.__uiLogOn = true;
  };
  start();
}

/** The records so far, and a fresh log. */
const takeUiLog = (page: Page): Promise<UiRec[]> => page.evaluate(() => {
  const w = window as unknown as UiLogWindow;
  return w.__uiLog.splice(0, w.__uiLog.length);
});

/**
 * FH-36: what P in PLAY gives on the app [O: the verifier's control, `view=hud menu | mode=cruise` at one time]. The first
 * panel view written is the card, in the same frame as the mode, no view names the autopilot, and nothing announces it.
 */
function expectParks(log: readonly UiRec[], where: string): void {
  const views = log.filter((r) => r.k === 'view');
  const modes = log.filter((r) => r.k === 'mode');
  expect(views.filter((r) => (r.v ?? '').split(' ').includes('auto')).map((r) => r.v), `${where}: no autopilot view`).toEqual([]);
  expect(views[0]?.v, `${where}: the first panel view written`).toBe('hud menu');
  expect(modes.map((r) => r.v), `${where}: the mode written`).toEqual(['cruise']);
  expect(views[0]?.b, `${where}: the card in the same frame as the mode`).toBe(modes[0]?.b);
  expect(log.filter((r) => r.k === 'live' && r.v === AUTOPILOT_TAG).length, `${where}: no autopilot announcement`).toBe(0);
}

test.describe('app: fullscreen', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'gpu', 'the app needs the gpu project'); });

  test('desktop 1920x1080: FULLSCREEN engages on the real app, and its sizing follows a resize while fullscreen stays on', async ({ page }, info) => {
    test.setTimeout(120_000);
    await openApp(page);
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'play');
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'cruise');
    const n = await fsAction(page, () => clickBox(page));
    let r = await appFill(page);
    console.log(`A31 desktop in fullscreen: ${JSON.stringify(r)}`);
    expect(r).toMatchObject({ fs: 'HTML', box: true, mode: 'cruise' });
    expectFills(r, 1920, 1080, 'fullscreen at 1920x1080');
    await saveCssShot(page, info, 'app-fullscreen-desktop-1920x1080');
    await page.setViewportSize({ width: 1280, height: 720 });
    expect(await fsCount(page), 'setViewportSize fired no fullscreen event').toBe(n);
    await expect.poll(async () => (await appFill(page)).canvas, { timeout: 1000 }).toEqual([0, 0, 1280, 720]);
    r = await appFill(page);
    console.log(`A31 desktop after the resize: ${JSON.stringify(r)}`);
    expect(r.fs).toBe('HTML');
    expectFills(r, 1280, 720, 'fullscreen at 1280x720');
    await fsAction(page, () => clickBox(page));
    expect(await appFill(page)).toMatchObject({ fs: null, box: false, mode: 'cruise' });
  });

  test('desktop 1920x1080: a page-script exit in PLAY opens CRUISE in the frame that sees it, as P does, with no autopilot view or announcement (FH-36)', async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(installUiRecorder);
    await openApp(page);
    expect(await page.evaluate(() => (window as unknown as UiLogWindow).__uiLogOn), 'the recorder is attached').toBe(true);
    const html = page.locator('html');
    await page.keyboard.press('Enter');
    await expect(html).toHaveAttribute('data-mv-mode', 'play');
    await page.keyboard.press('Escape');
    await expect(html).toHaveAttribute('data-mv-mode', 'cruise');
    await fsAction(page, () => clickBox(page));
    await clickCentre(page, '[data-mv="resume"]');
    await expect(html).toHaveAttribute('data-mv-mode', 'play');
    expect((await appFill(page)).fs, 'Resume keeps fullscreen').toBe('HTML');
    await nodeWait(300);

    // Fresh input keeps idle autopilot (10 s) out of the window. Then a page-script exit, standing in for the browser's.
    await page.keyboard.press('ArrowLeft');
    await takeUiLog(page);
    await fsAction(page, () => page.evaluate(() => document.exitFullscreen()));
    await expect(html).toHaveAttribute('data-mv-mode', 'cruise');
    await nodeWait(1200);
    const leave = await takeUiLog(page);
    console.log(`A31 leave in PLAY: ${JSON.stringify(leave)}`);
    expectParks(leave, 'a page-script exit in PLAY');
    expect(await appFill(page)).toMatchObject({ fs: null, box: false, mode: 'cruise' });
    expect(await activeHookOf(page), 'RESUME focused').toBe('resume');

    // Guard, the same before and after FH-36: P back to PLAY, then P in PLAY, recorded the same way.
    await page.keyboard.press('KeyP');
    await expect(html).toHaveAttribute('data-mv-mode', 'play');
    await nodeWait(300);
    await page.keyboard.press('ArrowLeft');
    await takeUiLog(page);
    await page.keyboard.press('KeyP');
    await expect(html).toHaveAttribute('data-mv-mode', 'cruise');
    await nodeWait(1200);
    const p = await takeUiLog(page);
    console.log(`A31 P in PLAY: ${JSON.stringify(p)}`);
    expectParks(p, 'P in PLAY');
  });

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });

    test('390x844 then 844x390: a tap launches, a tap on II opens CRUISE, a tap on FULLSCREEN engages, and a rotation is followed', async ({ page }, info) => {
      test.setTimeout(120_000);
      await openApp(page);
      await page.touchscreen.tap(195, 600);
      await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'play');
      // Past the 36-tick guard that keeps a launching tap from also pressing II.
      await nodeWait(800);
      const ii = await rectOf(page, '[data-mv="menu-button"]');
      await page.touchscreen.tap(ii.x + ii.w / 2, ii.y + ii.h / 2);
      await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'cruise');
      const at = await labelCentre(page, 'fullscreen');
      const n = await fsAction(page, () => page.touchscreen.tap(at.x, at.y));
      let r = await appFill(page);
      console.log(`A31 phone in fullscreen: ${JSON.stringify(r)}`);
      expect(r).toMatchObject({ fs: 'HTML', box: true, mode: 'cruise' });
      expectFills(r, 390, 844, 'fullscreen at 390x844');
      await page.setViewportSize({ width: 844, height: 390 });
      expect(await fsCount(page), 'setViewportSize fired no fullscreen event').toBe(n);
      await expect.poll(async () => (await appFill(page)).canvas, { timeout: 1000 }).toEqual([0, 0, 844, 390]);
      r = await appFill(page);
      console.log(`A31 phone after the rotation: ${JSON.stringify(r)}`);
      expect(r.fs).toBe('HTML');
      expectFills(r, 844, 390, 'fullscreen at 844x390');
      await saveCssShot(page, info, 'app-fullscreen-phone-844x390');
    });
  });
});

// ---- firstshow: hidden HUD, A32 (D-012) ----

/** The hide rules also in the title view, adopted before any element exists, so the panels are first drawn at the untick. */
const HIDE_IN_TITLE_CSS = [
  '.mv-ui[data-hide-hud="1"] > .mv-hud .mv-panel', '.mv-ui[data-hide-hud="1"] > .mv-hud .mv-box-boost', '.mv-ui[data-hide-hud="1"] > .mv-hud .mv-chip',
  '.mv-ui[data-hide-hud="1"] > .mv-popups', '.mv-ui[data-hide-hud="1"] > .mv-banner',
].join(', ') + ' { visibility: hidden !important; }';

interface Interval { clickFrameMs: number; otherMs: number; long: string[] }
interface HiddenShow { demoScore: string; mode: string | null; launch: Interval; untick: Interval; afterHide: string | null; afterScore: string; afterMode: string | null }

/** As firstShow, with hideHud seeded: launch, Esc, then a mouse click on HIDE HUD to untick it, in one fresh browser. */
async function firstShowHidden(info: TestInfo, baseURL: string, css: string): Promise<HiddenShow> {
  const browser = await chromium.launch({ ...(info.project.use.launchOptions ?? {}), headless: true });
  try {
    const context = await browser.newContext({ baseURL, viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();
    await page.addInitScript(({ override, settings }: { override: string; settings: string }) => {
      localStorage.setItem('mv.settings.v1', settings);
      const h = { ups: [] as number[], e: [] as number[] };
      (window as unknown as { __fsh: typeof h }).__fsh = h;
      window.addEventListener('pointerup', () => { h.ups.push(performance.now()); }, true);
      const rec = (): void => { h.e.push(performance.now()); requestAnimationFrame(rec); };
      requestAnimationFrame(rec);
      if (override !== '') {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(override);
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      }
    }, { override: css, settings: SETTINGS_HIDDEN });
    await page.goto(url({ live: 1 }));
    const demoScore = await page.evaluate(() => getComputedStyle(document.querySelector('[data-mv="score"]')!).visibility);
    await nodeWait(1500);
    await page.mouse.click(FIRST_SHOW.click.x, FIRST_SHOW.click.y);
    await nodeWait(FIRST_SHOW.windowMs + 200);
    const mode = await page.evaluate(() => document.documentElement.getAttribute('data-mv-mode'));
    await page.keyboard.press('Escape');
    await nodeWait(FIRST_SHOW.escWindowMs + 200);
    const at = await labelCentre(page, 'hide-hud');
    await page.mouse.click(at.x, at.y);
    await nodeWait(FIRST_SHOW.windowMs + 200);
    return await page.evaluate(({ windowMs, demoScore, mode }) => {
      const h = (window as unknown as { __fsh: { ups: number[]; e: number[] } }).__fsh;
      const read = (at: number, span: number): { clickFrameMs: number; otherMs: number; long: string[] } => {
        let clickFrameMs = NaN;
        let otherMs = 0;
        const long: string[] = [];
        for (let i = 1; i < h.e.length; i++) {
          const e0 = h.e[i - 1]!, e1 = h.e[i]!;
          if (e1 < at || e1 > at + span) continue;
          const d = e1 - e0;
          const isClick = e0 <= at && e1 >= at;
          if (isClick) clickFrameMs = d;
          else otherMs = Math.max(otherMs, d);
          if (isClick || d > 20) long.push(`+${(e0 - at).toFixed(0)}: ${d.toFixed(1)}${isClick ? ' (input frame)' : ''}`);
        }
        return { clickFrameMs, otherMs, long };
      };
      return {
        demoScore, mode,
        launch: read(h.ups[0] ?? NaN, windowMs),
        untick: read(h.ups[h.ups.length - 1] ?? NaN, windowMs),
        afterHide: document.querySelector('.mv-ui')!.getAttribute('data-hide-hud'),
        afterScore: getComputedStyle(document.querySelector('[data-mv="score"]')!).visibility,
        afterMode: document.documentElement.getAttribute('data-mv-mode'),
      };
    }, { windowMs: FIRST_SHOW.windowMs, demoScore, mode });
  } finally {
    await browser.close();
  }
}

const fmtInterval = (i: Interval): string => `click frame ${i.clickFrameMs.toFixed(1)} ms, other frames at most ${i.otherMs.toFixed(1)} ms [${i.long.join(', ')}]`;
const fmtHiddenShow = (r: HiddenShow): string =>
  `score in DEMO ${r.demoScore}; launch: ${fmtInterval(r.launch)}, mode ${r.mode}; untick: ${fmtInterval(r.untick)}, data-hide-hud ${r.afterHide}, score ${r.afterScore}, mode ${r.afterMode}`;

test.describe('firstshow: hidden HUD', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'gpu', 'gpu only, as T10\'s launch gate'); });

  // FH-24 and FH-34: the untick half is printed, not gated. Its control exceeded 33 ms in 3 of its first 5 runs after FH2,
  // and this row's untick once in 10, so no 33 ms gate there had a control that dependably fails it (plan section 11).
  test('with HIDE HUD stored: every frame in the 2 s after the launch, other than the click frame, at most 33 ms; the untick printed (FH-24)', async ({ baseURL }, info) => {
    test.setTimeout(60_000);
    const r = await firstShowHidden(info, baseURL!, '');
    console.log(`FIRSTSHOW hidden HUD, fresh browser: ${fmtHiddenShow(r)}`);
    expect(r.demoScore, 'the warm HUD is drawn in DEMO').toBe('visible');
    expect(r.mode).toBe('play');
    expect(r.afterHide).toBe('0');
    expect(r.afterScore).toBe('visible');
    expect(Number.isFinite(r.launch.clickFrameMs)).toBe(true);
    expect(r.launch.otherMs).toBeLessThanOrEqual(FIRST_SHOW.frameMs);
    expect(Number.isFinite(r.untick.clickFrameMs)).toBe(true);
  });

  test('control: the hide rules in the title view too, so the panels are first drawn at the untick', async ({ baseURL }, info) => {
    test.setTimeout(60_000);
    const r = await firstShowHidden(info, baseURL!, HIDE_IN_TITLE_CSS);
    console.log(`FIRSTSHOW hidden HUD control, fresh browser: ${fmtHiddenShow(r)}`);
    expect(r.demoScore, 'the control hides the HUD in DEMO too').toBe('hidden');
    expect(r.mode).toBe('play');
    expect(r.afterScore).toBe('visible');
    expect(Number.isFinite(r.untick.clickFrameMs)).toBe(true);
  });
});

// ---- geometry: A33's added rows ----

const FH_SIZES: readonly Viewport[] = [
  { name: 'tablet-768x1024', width: 768, height: 1024, dpr: 2, touch: true, kind: 'tablet' },
  { name: 'tablet-1024x768', width: 1024, height: 768, dpr: 2, touch: true, kind: 'tablet' },
  { name: 'hd-1280x720', width: 1280, height: 720, dpr: 1, touch: false, kind: 'desktop' },
];
const viewportNamed = (name: string): Viewport => [...VIEWPORTS, ...FH_SIZES].find((x) => x.name === name)!;

for (const v of FH_SIZES) {
  test.describe(`geometry: ${v.name}`, () => {
    useViewport(v);
    for (const state of ['cruise', 'cruise-max'] as const) {
      test(state, async ({ page }) => {
        await page.goto(url({ state }));
        const problems = geometryProblems(await dumpGeometry(page), v, state);
        expect(problems, problems.join('\n')).toEqual([]);
      });
    }
  });
}

/** With the HUD hidden in PLAY: no readout box shown, and II still there. Its size and place are geometryProblems' own checks. */
function hiddenHudProblems(d: Dump): string[] {
  const p: string[] = [];
  for (const k of ['score', 'distance', 'vitals', 'boost']) if (d.play[k]) p.push(`readout shown with the HUD hidden: ${k} ${JSON.stringify(d.play[k])}`);
  for (const c of d.clip) p.push(`readout shown with the HUD hidden: ${c.name}`);
  if (!d.visible.some((x) => x.name === 'menu-button')) p.push('II not shown');
  return p;
}

for (const name of ['phone-small', 'phone-portrait', 'phone-landscape', 'tablet-768x1024', 'tablet-1024x768', 'hd-1280x720', 'desktop']) {
  const v = viewportNamed(name);
  test.describe(`geometry: HUD hidden, ${v.name}`, () => {
    useViewport(v);
    test('play', async ({ page }) => {
      await seedSettings(page, SETTINGS_HIDDEN);
      await page.goto(url({ state: 'play' }));
      const d = await dumpGeometry(page);
      const problems = [...geometryProblems(d, v, 'play'), ...hiddenHudProblems(d)];
      expect(problems, problems.join('\n')).toEqual([]);
    });
  });
}

for (const name of ['phone-small', 'phone-portrait', 'phone-landscape']) {
  const v = viewportNamed(name);
  test.describe(`geometry: no element fullscreen, ${v.name}`, () => {
    useViewport(v);
    test('cruise', async ({ page }) => {
      await page.addInitScript(removeAllFullscreen);
      await page.goto(url({ state: 'cruise' }));
      const problems = geometryProblems(await dumpGeometry(page), v, 'cruise');
      expect(problems, problems.join('\n')).toEqual([]);
    });
  });
}

/** f13's shape: FULLSCREEN, HIDE HUD and REDUCED MOTION as three full rows in place of the grid (P2's L1). */
const TOGGLES_AS_ROWS_CSS = '.mv-ui .mv-toggles { display: flex !important; flex-direction: column !important; gap: .2em !important; }';
/** The toggle check's control: three columns forced at 320 px wide, where two fit (P7 run 2). */
const TOGGLES_THREE_CSS = '.mv-ui .mv-toggles { display: grid !important; grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }';

test.describe('geometry: toggles control, rows', () => {
  const v = viewportNamed('phone-landscape');
  useViewport(v);

  test('two full rows in place of the toggle grid make the card scroll', async ({ page }) => {
    await page.goto(url({ state: 'cruise' }));
    expect(geometryProblems(await dumpGeometry(page), v, 'cruise'), 'the planned row fits').toEqual([]);
    await page.addStyleTag({ content: TOGGLES_AS_ROWS_CSS });
    const problems = geometryProblems(await dumpGeometry(page), v, 'cruise');
    console.log(`toggles control, rows: ${problems.join('; ') || 'none'}`);
    expect(problems.some((s) => s.startsWith('card scrolls:')), 'expected card scrolls').toBe(true);
  });
});

test.describe('geometry: toggles control, three columns', () => {
  const v = viewportNamed('phone-small');
  useViewport(v);

  test('three columns at 320 px wide give toggle clip and toggle overlap', async ({ page }) => {
    await page.goto(url({ state: 'cruise' }));
    await page.addStyleTag({ content: TOGGLES_THREE_CSS });
    const problems = geometryProblems(await dumpGeometry(page), v, 'cruise').filter((s) => s.startsWith('toggle '));
    console.log(`toggles control, three columns: ${problems.join('; ') || 'none'}`);
    expect(problems.length, 'expected toggle problems').toBeGreaterThan(0);
    expect(problems.some((s) => s.startsWith('toggle clip:'))).toBe(true);
    expect(problems.some((s) => s.startsWith('toggle overlap:'))).toBe(true);
  });
});

// ---- review: FH, A35. Images to open and describe; nothing here judges them. ----

interface FhReview extends Viewport { notices: boolean; nofs: boolean; focus: boolean; only: 'cruise' | null }

const FH_REVIEW: readonly FhReview[] = [
  { ...viewportNamed('phone-portrait'), notices: true, nofs: true, focus: false, only: null },
  { ...viewportNamed('phone-landscape'), notices: false, nofs: true, focus: false, only: null },
  { ...viewportNamed('tablet-768x1024'), notices: false, nofs: false, focus: false, only: null },
  { ...viewportNamed('tablet-1024x768'), notices: false, nofs: false, focus: false, only: null },
  { ...viewportNamed('desktop'), notices: true, nofs: false, focus: true, only: null },
  { ...viewportNamed('hd-1280x720'), notices: false, nofs: false, focus: false, only: null },
  { ...viewportNamed('phone-small'), notices: false, nofs: false, focus: false, only: 'cruise' },
];

for (const v of FH_REVIEW) {
  test.describe(`review: FH ${v.name}`, () => {
    useViewport(v);

    test(`${v.width}x${v.height}`, async ({ page, context }, info) => {
      test.setTimeout(120_000);
      const tag = `${v.width}x${v.height}`;
      const press = async (hook: string): Promise<void> => {
        const at = await labelCentre(page, hook);
        if (v.touch) await page.touchscreen.tap(at.x, at.y);
        else await page.mouse.click(at.x, at.y);
      };
      await page.addInitScript(installFsCounter);
      await page.goto(url({ state: 'cruise' }));
      await freeze(page);
      await saveCssShot(page, info, `fh-cruise-${tag}`);
      if (v.only === 'cruise') return;

      if (v.nofs) {
        const p = await context.newPage();
        const errors = guardPage(p);
        await p.addInitScript(removeAllFullscreen);
        await p.goto(url({ state: 'cruise' }));
        await freeze(p);
        await saveCssShot(p, info, `fh-cruise-nofs-${tag}`);
        await p.close();
        expect(errors).toEqual([]);
      }

      await fsAction(page, () => press('fullscreen'));
      await press('hide-hud');
      await expect(page.locator('.mv-ui')).toHaveAttribute('data-hide-hud', '1');
      console.log(`review FH ${tag}: ticked ${JSON.stringify(await fsRead(page))}`);
      await saveCssShot(page, info, `fh-cruise-ticked-${tag}`);

      // HIDE HUD was saved by the tick, so a fresh load of PLAY has the HUD hidden; the navigation ends fullscreen.
      await page.goto(url({ state: 'play' }));
      await freeze(page);
      await saveCssShot(page, info, `fh-play-hidden-${tag}`);

      if (v.notices) {
        for (const state of ['signal-lost', 'autopilot'] as const) {
          await page.goto(url({ state }));
          await freeze(page);
          await saveCssShot(page, info, `fh-hidden-${state}-${tag}`);
        }
        await page.goto(url({ state: 'banner-sector' }));
        await page.evaluate((event) => {
          const dev = window.__ui!;
          // The state's own PLAY, not autopilot: a frame without it takes the scripted default and shows the autopilot tag.
          dev.frame(dev.clock() + 8 / 120, { events: [event as never], at: { chunk: 800, local: 0 }, sim: { autopilot: false, travel: { chunk: 971, local: 0 } } });
        }, GATE_EVENT);
        console.log(`review FH ${tag}: after a GATE popup and a sector change, banner data-show ${await page.locator('[data-mv="banner"]').getAttribute('data-show')}, popups ${JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('.mv-popup'), (p) => p.getAttribute('data-k'))))}`);
        await freeze(page);
        await saveCssShot(page, info, `fh-hidden-popup-banner-${tag}`);
      }

      if (v.focus) {
        await page.goto(url({ state: 'cruise' }));
        expect((await tabCycle(page, 6))[5]).toBe('fullscreen');
        await freeze(page);
        await saveCssShot(page, info, `fh-focus-fullscreen-${tag}`);
      }
    });
  });
}

// ---- Amendment LH: LAUNCH and LAUNCH - NO HUD on the title (plan section 7, A42 to A46) ----

const SETTINGS_SHOWN = '{"music":0.8,"sfx":0.8,"muted":false,"quality":"auto","reduced":null,"hideHud":false}';

const storedHide = async (page: Page): Promise<unknown> =>
  ((await stored(page)).settings as { hideHud?: unknown } | null)?.hideHud;

const activeHook = (page: Page): Promise<string | null> =>
  page.evaluate(() => document.activeElement?.getAttribute('data-mv') ?? null);

interface StartButton { hook: string; x: number; y: number; w: number; h: number }

async function startButtons(page: Page): Promise<StartButton[]> {
  return page.evaluate(() => Array.from(document.querySelectorAll('.mv-launch'), (b) => {
    const r = b.getBoundingClientRect();
    return { hook: b.getAttribute('data-mv') ?? '', x: r.left, y: r.top, w: r.width, h: r.height };
  }));
}

function expectStartButtonsFit(rows: StartButton[], vw: number, vh: number): void {
  expect(rows.map((r) => r.hook)).toEqual(['launch', 'launch-nohud']);
  for (const r of rows) {
    expect(r.w, `${r.hook} width`).toBeGreaterThanOrEqual(44);
    expect(r.h, `${r.hook} height`).toBeGreaterThanOrEqual(44);
    expect(r.x, `${r.hook} left`).toBeGreaterThanOrEqual(0);
    expect(r.y, `${r.hook} top`).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w, `${r.hook} right`).toBeLessThanOrEqual(vw);
    expect(r.y + r.h, `${r.hook} bottom`).toBeLessThanOrEqual(vh);
  }
}

test.describe('launch: hud choice', () => {
  test('A42: the title has LAUNCH and LAUNCH - NO HUD, each a 44 px target inside the viewport', async ({ page }, info) => {
    await page.goto(url());
    await expect(page.getByRole('button', { name: 'LAUNCH', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'LAUNCH - NO HUD', exact: true })).toBeVisible();
    const vp = page.viewportSize()!;
    expectStartButtonsFit(await startButtons(page), vp.width, vp.height);
    await saveShot(page, info, 'lh-title');
  });

  test('A43: LAUNCH - NO HUD launches with the HUD hidden and stored, the CRUISE box ticked, and the box switches it back', async ({ page }) => {
    await page.goto(url());
    expect(await activeHook(page), 'defaults focus LAUNCH').toBe('launch');
    await clickCentre(page, '[data-mv="launch-nohud"]');
    expect((await callNames(page, 'launch')).length).toBeGreaterThanOrEqual(1);
    await expect(page.locator('.mv-ui')).toHaveAttribute('data-hide-hud', '1');
    expect(await storedHide(page), 'stored at the launch').toBe(true);
    await step(page, 2);
    await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'play');
    expectReadouts(await hudVisibility(page), 'hidden', 'PLAY after LAUNCH - NO HUD');

    await page.keyboard.press('Escape');
    await step(page, 2);
    await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'cruise');
    await expect(page.locator('[data-mv="hide-hud"]')).toBeChecked();
    await clickBox(page, 'hide-hud');
    await expect(page.locator('[data-mv="hide-hud"]')).not.toBeChecked();
    await expect(page.locator('.mv-ui')).toHaveAttribute('data-hide-hud', '0');
    await clickCentre(page, '[data-mv="resume"]');
    await step(page, 2);
    await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'play');
    expectReadouts(await hudVisibility(page), 'visible', 'PLAY after unticking HIDE HUD');
    expect(await storedHide(page)).toBe(false);
  });

  test('A44: LAUNCH over a stored hidden HUD launches with the HUD shown, stored, and the box unticked', async ({ page }) => {
    await seedSettings(page, SETTINGS_HIDDEN);
    await page.goto(url());
    await expect(page.locator('.mv-ui')).toHaveAttribute('data-hide-hud', '1');
    await clickCentre(page, '[data-mv="launch"]');
    expect((await callNames(page, 'launch')).length).toBeGreaterThanOrEqual(1);
    await expect(page.locator('.mv-ui')).toHaveAttribute('data-hide-hud', '0');
    expect(await storedHide(page)).toBe(false);
    await expect(page.locator('[data-mv="hide-hud"]')).not.toBeChecked();
    await step(page, 2);
    await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'play');
    expectReadouts(await hudVisibility(page), 'visible', 'PLAY after LAUNCH');
  });

  test('A45: focus at load follows a stored hidden HUD, and a key launches that choice', async ({ page }) => {
    await seedSettings(page, SETTINGS_HIDDEN);
    await page.goto(url());
    expect(await activeHook(page)).toBe('launch-nohud');
    await page.keyboard.press('a');
    expect((await callNames(page, 'launch')).length).toBe(1);
    await expect(page.locator('.mv-ui')).toHaveAttribute('data-hide-hud', '1');
    expect(await storedHide(page)).toBe(true);
  });

  test('A45: with the HUD stored shown, focus is on LAUNCH and a key launches with the HUD', async ({ page }) => {
    await seedSettings(page, SETTINGS_SHOWN);
    await page.goto(url());
    expect(await activeHook(page)).toBe('launch');
    await page.keyboard.press('a');
    expect((await callNames(page, 'launch')).length).toBe(1);
    await expect(page.locator('.mv-ui')).toHaveAttribute('data-hide-hud', '0');
    expect(await storedHide(page)).toBe(false);
  });

  test('A46: Tab to LAUNCH - NO HUD, then Enter, launches with the HUD hidden', async ({ page }) => {
    await page.goto(url());
    await page.keyboard.press('Tab');
    expect(await activeHook(page)).toBe('launch-nohud');
    await page.keyboard.press('Enter');
    expect((await callNames(page, 'launch')).length).toBeGreaterThanOrEqual(1);
    await expect(page.locator('.mv-ui')).toHaveAttribute('data-hide-hud', '1');
    expect(await storedHide(page)).toBe(true);
  });

  test('control: a key with nothing focused keeps the stored choice and writes nothing, so A45 and A46 read the focus', async ({ page }) => {
    await page.goto(url());
    await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); });
    await page.keyboard.press('a');
    expect((await callNames(page, 'launch')).length).toBe(1);
    await expect(page.locator('.mv-ui')).toHaveAttribute('data-hide-hud', '0');
    expect(await storedHide(page), 'nothing written when the choice is unchanged').toBeUndefined();
  });
});

test.describe('launch: hud choice, touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });

  test('A42: on a phone both start buttons are 44 px targets inside the viewport', async ({ page }, info) => {
    await page.goto(url());
    expectStartButtonsFit(await startButtons(page), 390, 844);
    await saveCssShot(page, info, 'lh-title-phone');
  });

  test('A46: a tap away from the buttons launches and keeps a stored hidden HUD', async ({ page }) => {
    await seedSettings(page, SETTINGS_HIDDEN);
    await page.goto(url());
    const word = await rectOf(page, '[data-mv="wordmark"]');
    await page.touchscreen.tap(word.x + word.w / 2, word.y + word.h / 2);
    expect((await callNames(page, 'launch')).length).toBeGreaterThanOrEqual(1);
    await expect(page.locator('.mv-ui')).toHaveAttribute('data-hide-hud', '1');
    expect(await storedHide(page)).toBe(true);
  });

  test('a tap on LAUNCH - NO HUD launches with the HUD hidden', async ({ page }) => {
    await page.goto(url());
    const b = await rectOf(page, '[data-mv="launch-nohud"]');
    await page.touchscreen.tap(b.x + b.w / 2, b.y + b.h / 2);
    expect((await callNames(page, 'launch')).length).toBeGreaterThanOrEqual(1);
    await expect(page.locator('.mv-ui')).toHaveAttribute('data-hide-hud', '1');
  });
});

// ---- Amendment WM: the wordmark rim follows the glyph silhouette (plan section 7, A48 and A49) ----

interface RimStyle { stroke: string; filter: string }

const rimStyles = (page: Page): Promise<RimStyle[]> =>
  page.evaluate(() => Array.from(document.querySelectorAll('.mv-wm'), (el) => {
    const cs = getComputedStyle(el);
    return { stroke: cs.getPropertyValue('-webkit-text-stroke-width'), filter: cs.filter };
  }));

test.describe('wordmark: rim', () => {
  test('A48: no text stroke on either line, and the white rim is four silhouette drop-shadows', async ({ page }, info) => {
    await page.goto(url());
    const rows = await rimStyles(page);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.stroke, 'a stroke outlines every contour, overlaps included').toBe('0px');
      expect(r.filter.match(/drop-shadow\(/g) ?? [], r.filter).toHaveLength(4);
    }
    // A font that builds letters from overlapping contours, as Roboto does on Android (viewed, not asserted).
    await page.addStyleTag({ content: '.mv-wordmark { font-family: Bahnschrift, Roboto, sans-serif !important; }' });
    await saveShot(page, info, 'wm-title-overlap-font');
  });

  test('A49: under forced colors the rim is off with the gradient', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto(url());
    for (const r of await rimStyles(page)) {
      expect(r.stroke).toBe('0px');
      expect(r.filter).toBe('none');
    }
  });
});

// ---- Amendment WM: the wordmark keeps its chrome under a browser's forced dark theme (A51, A52) ----

/** Share of a 4 px strip across the top line, at a fifth of its height (the light part of the chrome), lighter than 0.5. */
async function chromeShare(page: Page): Promise<number> {
  const r = await rectOf(page, '.mv-wm-top');
  const png = await page.screenshot({ clip: { x: r.x, y: r.y + r.h * 0.2, width: r.w, height: 4 } });
  const { data } = await decode(page, png);
  let light = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (luminance(data[i]!, data[i + 1]!, data[i + 2]!) > 0.5) light++;
  }
  return light / (data.length / 4);
}

test.describe('wordmark: forced dark', () => {
  test('A51: the UI declares a dark color-scheme', async ({ page }) => {
    await page.goto(url());
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.mv-ui')!).colorScheme)).toBe('dark');
  });

  test('A52: under Chrome forced dark with the user preferring dark, the chrome stays light; control without the declaration goes dark', async ({ baseURL }, info) => {
    const o = info.project.use.launchOptions ?? {};
    const browser = await chromium.launch({ ...o, headless: true, args: [...(o.args ?? []), '--enable-features=WebContentsForceDark'] });
    try {
      const share = async (css: string): Promise<number> => {
        const context = await browser.newContext({ baseURL: baseURL!, viewport: { width: 412, height: 915 }, colorScheme: 'dark' });
        const page = await context.newPage();
        if (css !== '') await page.addInitScript((c: string) => {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(c);
          document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        }, css);
        await page.goto(url());
        await page.waitForTimeout(500);
        const v = await chromeShare(page);
        await context.close();
        return v;
      };
      const shown = await share('');
      const control = await share('.mv-ui { color-scheme: normal !important; }');
      console.log(`WM forced dark: light share ${shown.toFixed(3)}, control ${control.toFixed(3)}`);
      expect(shown, 'chrome kept').toBeGreaterThan(0.2);
      expect(control, 'forced dark engaged in this browser').toBeLessThan(0.1);
    } finally {
      await browser.close();
    }
  });
});
