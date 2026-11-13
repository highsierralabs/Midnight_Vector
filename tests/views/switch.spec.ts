// T13 A5 and A6, on the integrated build: changing camera by real input, and the sim's blindness to it.
import type { Page } from 'playwright/test';
import { linkSpyScript, nodeWait, openApp } from '../e2e/lib/app';
import { expect, test } from '../support/pw';

test.beforeEach(({}, info) => { test.skip(info.project.name !== 'gpu', 'gpu only'); });

const CHASE = 0, COCKPIT = 1, NOSE = 2;
const AHEAD = [0, 14, 16.2] as const;
const NAMES = ['chase', 'cockpit', 'nose'] as const;
/** Section 9: the draw-call budget at tier 3. */
const DRAW_BUDGET = 68;

interface CamRead { want: number; mode: number; ahead: number; cockpitIn: number; calls: number; rebuilds: number; links: number }

async function readCam(page: Page): Promise<CamRead> {
  return page.evaluate(() => {
    const e = window.__mvE2e!;
    const c = e.cam();
    return {
      want: c.want, mode: c.mode, ahead: c.ahead, cockpitIn: c.cockpitIn,
      calls: e.host.ctx.renderer.info.render.calls, rebuilds: e.counters.rebuilds, links: window.__mvLinks ?? -1,
    };
  });
}

/** Waits until the camera rests at `mode`, then returns the read. */
async function atRest(page: Page, mode: number): Promise<CamRead> {
  await expect.poll(async () => {
    const c = await readCam(page);
    return c.mode === mode && Math.abs(c.ahead - AHEAD[mode]!) < 1e-9 && c.cockpitIn === (mode === COCKPIT ? 1 : 0);
  }, { message: `the camera at rest in ${NAMES[mode]}`, timeout: 5000 }).toBe(true);
  return readCam(page);
}

test('A5: C steps cockpit, nose, chase with no rebuild and no program link, within the draw budget, and the title stays chase', async ({ page }) => {
  await page.addInitScript(linkSpyScript);
  await openApp(page, '&tier=3');
  const html = page.locator('html');
  const ui = page.locator('#mv-ui');

  // On the title C neither launches nor changes anything.
  await expect(html).toHaveAttribute('data-mv-mode', 'demo');
  await page.keyboard.press('KeyC');
  await nodeWait(300);
  await expect(html).toHaveAttribute('data-mv-mode', 'demo');
  expect((await readCam(page)).want).toBe(CHASE);
  await expect(ui).toHaveAttribute('data-cam', 'chase');

  await page.mouse.click(960, 700);
  await expect(html).toHaveAttribute('data-mv-mode', 'play');
  // The first PLAY frames can still link nothing new, but read the baseline after them.
  await nodeWait(500);
  const base = await atRest(page, CHASE);
  expect(base.calls).toBeLessThanOrEqual(DRAW_BUDGET);

  const seen: string[] = [];
  for (const mode of [COCKPIT, NOSE, CHASE]) {
    await page.keyboard.press('KeyC');
    const c = await atRest(page, mode);
    await expect(ui).toHaveAttribute('data-cam', NAMES[mode]!);
    await expect(ui).toHaveAttribute('data-dash', mode === COCKPIT ? '1' : '0');
    seen.push(`${NAMES[mode]} ${c.calls} calls`);
    expect(c.calls, `draw calls in ${NAMES[mode]}`).toBeLessThanOrEqual(DRAW_BUDGET);
    expect(c.rebuilds, `rebuilds after the move to ${NAMES[mode]}`).toBe(base.rebuilds);
    expect(c.links, `program links after the move to ${NAMES[mode]}`).toBe(base.links);
  }
  console.log(`A5 tier 3: chase ${base.calls} calls; ${seen.join('; ')}; rebuilds ${base.rebuilds} throughout; links ${base.links} throughout`);
});

test('A5: the camera button in the cruise menu steps the camera too, and the choice survives a reload', async ({ page }) => {
  await openApp(page, '&tier=3');
  const html = page.locator('html');
  await page.mouse.click(960, 700);
  await expect(html).toHaveAttribute('data-mv-mode', 'play');
  await page.keyboard.press('KeyP');
  await expect(html).toHaveAttribute('data-mv-mode', 'cruise');
  const button = page.locator('[data-mv="camera"]');
  await expect(button).toHaveAccessibleName(/Camera: chase/);
  await button.click();
  await expect(button).toHaveAccessibleName(/Camera: cockpit/);
  await expect(button).toContainText('COCKPIT');
  await atRest(page, COCKPIT);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mv.settings.v1') ?? '{}').cam)).toBe('cockpit');

  // A reload: the title draws chase whatever is stored, and the stored camera returns with the run.
  await openApp(page, '&tier=3');
  await expect(html).toHaveAttribute('data-mv-mode', 'demo');
  const onTitle = await readCam(page);
  expect([onTitle.want, onTitle.mode, onTitle.ahead]).toEqual([COCKPIT, CHASE, 0]);
  await page.mouse.click(960, 700);
  await expect(html).toHaveAttribute('data-mv-mode', 'play');
  await atRest(page, COCKPIT);
});

/**
 * One fixed-step run from a reproducible start: the loop goes manual on the title, the tick is aligned, LAUNCH is pressed
 * at step 30, and a scripted pointer steers. With cams on, C is pressed every 240 steps. Returns the sim's state after
 * every step and the cameras the frames were drawn with.
 */
async function fixedRun(page: Page, steps: number, cams: boolean): Promise<{ trace: number[][]; modes: number[] }> {
  await openApp(page, '&tier=3&period=0');
  return page.evaluate(({ steps, cams }) => {
    const mv = window.__mv!;
    const e = window.__mvE2e!;
    const s = e.sim;
    const TICK = 1 / 120;
    mv.manual(true);
    // The loop's remainder between a half and three quarters of a tick, so a 1/60 s step is always two ticks.
    const t = s.tick;
    let n = 0;
    while (s.tick === t && n++ < 64) mv.stepFrames(1, TICK / 4);
    mv.stepFrames(1, TICK / 2);
    const target = Math.ceil((s.tick + 240) / 600) * 600;
    while (target - s.tick >= 2) mv.stepFrames(Math.min(60, Math.floor((target - s.tick) / 2)), 1 / 60);
    if (s.tick < target) mv.stepFrames(1, TICK);
    if (s.tick !== target) throw new Error(`start tick ${s.tick}, wanted ${target}`);

    const canvas = document.querySelector('#mv-stage canvas')!;
    const launch = document.querySelector<HTMLElement>('[data-mv="launch"]')!;
    const trace: number[][] = [];
    const modes = new Set<number>();
    for (let k = 0; k < steps; k++) {
      if (k === 30) launch.click();
      if (cams && k > 60 && k % 240 === 0) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC', key: 'c', bubbles: true, cancelable: true }));
      if (k > 30) {
        const r = canvas.getBoundingClientRect();
        const fx = 0.5 + 0.36 * Math.sin(k / 37);
        const fy = 0.5 + 0.3 * Math.sin(k / 53);
        canvas.dispatchEvent(new PointerEvent('pointermove', {
          pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true, clientX: r.left + fx * r.width, clientY: r.top + fy * r.height,
        }));
      }
      mv.stepFrames(1, 1 / 60);
      modes.add(e.cam().mode);
      trace.push([s.tick, s.x, s.y, s.score, s.shields, s.sync, s.travel.chunk, s.travel.local, s.mode, s.overdrive, s.speed, s.ghost]);
    }
    return { trace, modes: [...modes].sort() };
  }, { steps, cams });
}

test('A6: the sim is blind to the camera: the same inputs give the same run with and without camera changes', async ({ page }) => {
  test.setTimeout(240_000);
  const STEPS = 1800;
  const plain = await fixedRun(page, STEPS, false);
  const moved = await fixedRun(page, STEPS, true);
  expect(plain.modes).toEqual([CHASE]);
  expect(moved.modes).toEqual([CHASE, COCKPIT, NOSE]);
  expect(plain.trace.length).toBe(STEPS);
  let first = -1;
  for (let k = 0; k < STEPS && first < 0; k++) {
    const a = plain.trace[k]!, b = moved.trace[k]!;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { first = k; break; }
  }
  const end = plain.trace[STEPS - 1]!;
  console.log(`A6: ${STEPS} steps, first difference ${first < 0 ? 'none' : `at step ${first}`}; end tick ${end[0]}, score ${end[3]}, shields ${end[4]}, mode ${end[8]}`);
  expect(first, 'the first step at which the two runs differ').toBe(-1);
  // The run was a real one: it left the title and the ship moved.
  expect(end[8]).not.toBe(0);
  expect(new Set(plain.trace.map((r) => Math.round(r[1]!))).size).toBeGreaterThan(10);
});
