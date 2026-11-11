// A18: R1 in one real-time page. travel and uTravel rise through every mode, reduced motion, a context loss and restore,
// and warps to 1e9 u and 1e15 u. A18n: the same detector fails when the loop is stopped. A18b: production, no harness.
import { writeFileSync } from 'node:fs';
import type { Page } from 'playwright/test';
import { expect, test } from '../support/pw';
import { floorClip, installR1Sampler, loseContext, nodeWait, openApp, panelState, readR1, restoreContext, setSegment } from './lib/app';
import type { WarmPanel } from './lib/app';

test.beforeEach(({}, info) => { test.skip(info.project.name !== 'gpu', 'gpu only'); });

const SEGMENT_MS = 3000;

async function speed(page: Page): Promise<number> {
  return page.evaluate(() => window.__mvE2e!.sim.speed);
}

/** D-012, DI-89: the HUD and the CRUISE card are drawn, inert, during DEMO, so a player's view is read from T08's signals. */
async function expectShown(page: Page, panel: WarmPanel, shown: boolean): Promise<void> {
  await expect.poll(async () => (await panelState(page, panel)).shown, { message: `${panel} shown to a player: ${String(shown)}` }).toBe(shown);
}

async function clipsDiffer(page: Page): Promise<boolean> {
  const a = await floorClip(page);
  await nodeWait(250);
  const b = await floorClip(page);
  return !a.equals(b);
}

test('R1: travel and the camera rise through every segment (A18), and the detector fails with the loop stopped (A18n)', async ({ page }) => {
  test.setTimeout(180_000);
  await openApp(page, '&period=0');
  await installR1Sampler(page, 45);
  const report: Record<string, unknown> = {};
  const differ: Record<string, boolean> = {};

  // demo
  await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'demo');
  await expect(page.locator('[data-mv="title"]')).toBeVisible();
  // The warm panels are drawn but not shown in DEMO, which toBeVisible() cannot tell apart (DI-89).
  await expectShown(page, 'hud', false);
  await expectShown(page, 'cruise', false);
  report['demo-panels'] = [await panelState(page, 'hud'), await panelState(page, 'cruise')];
  report['demo-isVisible'] = [await page.locator('[data-mv="hud"]').isVisible(), await page.locator('[data-mv="cruise"]').isVisible()];
  await nodeWait(SEGMENT_MS);
  differ['demo'] = await clipsDiffer(page);
  report['demo'] = await speed(page);

  // play: a real click launches; KeyD held keeps human true
  await setSegment(page, 'play');
  await page.mouse.click(960, 700);
  await page.keyboard.down('KeyD');
  await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'play');
  await expectShown(page, 'hud', true);
  await expectShown(page, 'cruise', false);
  await nodeWait(SEGMENT_MS);
  differ['play'] = await clipsDiffer(page);
  const cruiseSpeed = await speed(page);
  report['play'] = cruiseSpeed;

  // cruise
  await setSegment(page, 'cruise');
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'cruise');
  await expectShown(page, 'cruise', true);
  report['cruise-panel'] = await panelState(page, 'cruise');
  await nodeWait(SEGMENT_MS);
  differ['cruise'] = await clipsDiffer(page);
  report['cruise'] = await speed(page);

  // play2
  await setSegment(page, 'play2');
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'play');
  await nodeWait(SEGMENT_MS);
  differ['play2'] = await clipsDiffer(page);
  report['play2'] = await speed(page);

  // lost: a hazard may already have taken the ship to lost, so wait for play first
  await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'play', { timeout: 10_000 });
  await setSegment(page, 'lost');
  // Score is recorded on every frame while the sim reads SIGNAL_LOST, in the page, because T08 writes data-mv-mode up
  // to 6 ticks after the sim changes mode, and a shard just after the return legitimately scores.
  const score0 = await page.evaluate(() => {
    const h = window.__mvE2e!;
    const w = window as unknown as { __lostScores: number[] };
    w.__lostScores = [];
    const s0 = h.sim.score;
    h.forceSignalLost();
    (function rec() {
      if (h.sim.mode === 3) w.__lostScores.push(h.sim.score);
      if (h.sim.mode === 3 || w.__lostScores.length === 0) requestAnimationFrame(rec);
    })();
    return s0;
  });
  await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'lost');
  await expect(page.locator('[data-mv="signal-lost"]')).toBeVisible();
  differ['lost'] = await clipsDiffer(page);
  await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'play', { timeout: 8000 });
  const lostScores = await page.evaluate(() => (window as unknown as { __lostScores: number[] }).__lostScores);
  const score1 = Math.max(...lostScores);
  report['lost'] = { score0, lostFrames: lostScores.length, min: Math.min(...lostScores), max: score1 };

  // reduced
  await setSegment(page, 'reduced', 27);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await nodeWait(SEGMENT_MS);
  const reducedSpeed = await speed(page);
  differ['reduced'] = await clipsDiffer(page);
  report['reduced'] = { speed: reducedSpeed, reducedView: await page.evaluate(() => document.querySelector('.mv-ui')?.getAttribute('data-reduced')) };

  // reduced-off
  await setSegment(page, 'reduced-off', 27);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await nodeWait(1000);
  await setSegment(page, 'reduced-off', 45);
  await nodeWait(2000);
  const offSpeed = await speed(page);
  differ['reduced-off'] = await clipsDiffer(page);
  report['reduced-off'] = offSpeed;

  // context
  await setSegment(page, 'context');
  const r0 = await page.evaluate(() => window.__mvE2e!.counters.rendered);
  // DI-114: frames drawn while the loss call reached the page come before the loss. Batches 4 to 6 read r1 - r0 = 1, and batch7
  // and its re-run read 2 in 2 of 4. So the no-rendering-while-lost check counts from the loss event itself.
  const rLoss = await loseContext(page);
  await expect(page.locator('[data-mv="context-lost"]')).toBeVisible();
  const okLost = await page.evaluate(() => window.__mvE2e!.contextOk());
  await nodeWait(2000);
  const r1 = await page.evaluate(() => window.__mvE2e!.counters.rendered);
  await restoreContext(page);
  await expect(page.locator('[data-mv="context-lost"]')).toBeHidden();
  await nodeWait(800);
  const r2 = await page.evaluate(() => window.__mvE2e!.counters.rendered);
  const okBack = await page.evaluate(() => window.__mvE2e!.contextOk());
  differ['context'] = await clipsDiffer(page);
  report['context'] = { r0, rLoss, r1, r2, okLost, okBack };

  // far
  for (const [seg, chunk] of [['far-1e9', 15625000], ['far-1e15', 15625000000000]] as const) {
    await setSegment(page, seg);
    const warped = await page.evaluate((c) => window.__mv!.warp(c, 0), chunk);
    expect(warped).toBe(true);
    await nodeWait(SEGMENT_MS);
    differ[seg] = await clipsDiffer(page);
    const lit = await page.evaluate(() => {
      const h = window.__mvE2e!;
      const s = h.host.ctx.renderer.domElement;
      return { travel: { ...h.sim.travel }, w: s.width };
    });
    report[seg] = lit;
  }

  // A18n, same run: with the loop stopped, the detector reports flat within 500 ms and the clips are identical.
  await setSegment(page, 'control');
  await page.evaluate(() => { window.__mvE2e!.host.setManual(true); });
  await nodeWait(600);
  const ctrl = await readR1(page);
  const a = await floorClip(page);
  await nodeWait(250);
  const b = await floorClip(page);
  const controlFlat = ctrl.bad.filter((x) => x.seg === 'control' && x.why === 'flat').length;
  await page.evaluate(() => { window.__mvE2e!.host.setManual(false); });
  await setSegment(page, 'resumed', undefined, true);
  await nodeWait(1000);
  await page.keyboard.up('KeyD');
  const final = await readR1(page);

  const real = final.bad.filter((x) => x.seg !== 'control');
  console.log(`A18 speeds and states ${JSON.stringify(report)}`);
  console.log(`A18 samples ${JSON.stringify(final.samples)}`);
  console.log(`A18 clips differ ${JSON.stringify(differ)}`);
  console.log(`A18 bad outside control: ${JSON.stringify(real.slice(0, 10))} (${real.length})`);
  console.log(`A18n control: flat ${controlFlat}, clips identical ${a.equals(b)}, resumed samples ${final.samples['resumed'] ?? 0}`);

  expect(real).toEqual([]);
  for (const seg of ['demo', 'play', 'cruise', 'play2', 'lost', 'reduced', 'reduced-off', 'context', 'far-1e9', 'far-1e15']) {
    expect(final.samples[seg] ?? 0, `samples in ${seg}`).toBeGreaterThanOrEqual(30);
    expect(differ[seg], `clips differ in ${seg}`).toBe(true);
  }
  expect(lostScores.length).toBeGreaterThan(100);
  expect(Math.min(...lostScores)).toBe(score0);
  expect(score1).toBe(score0);
  expect(reducedSpeed).toBeLessThanOrEqual(0.6 * cruiseSpeed + 2);
  expect(offSpeed).toBeGreaterThan(60);
  expect(okLost).toBe(false);
  expect(okBack).toBe(true);
  expect(rLoss).toBeGreaterThanOrEqual(r0);
  expect(r1 - rLoss).toBeLessThanOrEqual(1);
  expect(r2).toBeGreaterThan(r1 + 20);
  expect(controlFlat).toBeGreaterThan(0);
  expect(a.equals(b)).toBe(true);
  expect(final.samples['resumed'] ?? 0).toBeGreaterThan(10);
});

/**
 * A18n's clips with a popup animating in the floor band (T08 section 13). T08's popups sit at 64% of the height, inside
 * the band, and animate on CSS for .9 s whether or not the loop runs, so a popup that starts at the stop changed the
 * band on T08's old CSS too. The worst case is forced here: a popup start is awaited in the page, and the loop is stopped
 * in the same task, from the MutationObserver's microtask. Two clips 600 and 850 ms later: with the UI layer they must
 * differ, so a popup really was moving in the band; floorClip's canvas-only clips must be identical.
 */
test('A18n popup: a popup animating in the floor band leaves the canvas clips identical with the loop stopped (A18n)', async ({ page }, info) => {
  test.setTimeout(90_000);
  await openApp(page, '&period=0');
  await page.mouse.click(960, 700);
  await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'play');
  await page.keyboard.down('KeyD');
  await nodeWait(1500);
  const start = await page.evaluate(() => new Promise<{ k: string; tick: number }>((done, fail) => {
    const mo = new MutationObserver((recs) => {
      for (const r of recs) {
        const k = (r.target as Element).getAttribute('data-k') ?? '';
        if (!/-(a|b)$/.test(k)) continue;
        mo.disconnect();
        clearTimeout(timer);
        window.__mvE2e!.host.setManual(true);
        done({ k, tick: window.__mvE2e!.sim.tick });
        return;
      }
    });
    const timer = setTimeout(() => { mo.disconnect(); fail(new Error('no popup started within 20 s')); }, 20_000);
    for (const s of document.querySelectorAll('.mv-popup')) mo.observe(s, { attributes: true, attributeFilter: ['data-k'] });
  }));
  await nodeWait(600);
  const ui1 = await floorClip(page, true);
  const canvas1 = await floorClip(page);
  await nodeWait(250);
  const ui2 = await floorClip(page, true);
  const canvas2 = await floorClip(page);
  const rendered = await page.evaluate(() => window.__mvE2e!.counters.rendered);
  await nodeWait(200);
  const renderedLater = await page.evaluate(() => window.__mvE2e!.counters.rendered);
  await page.evaluate(() => { window.__mvE2e!.host.setManual(false); });
  await page.keyboard.up('KeyD');
  for (const [name, png] of [['ui-600', ui1], ['ui-850', ui2], ['canvas-600', canvas1], ['canvas-850', canvas2]] as const) {
    writeFileSync(info.outputPath(`a18n-popup-${name}.png`), png);
  }
  console.log(`A18n popup: stopped at the start of ${start.k} (tick ${start.tick}); with the UI layer the clips differ ${!ui1.equals(ui2)}; canvas only identical ${canvas1.equals(canvas2)}; rendered ${rendered} -> ${renderedLater} while stopped`);
  expect(renderedLater, 'the loop stayed stopped').toBe(rendered);
  expect(ui1.equals(ui2), 'a popup was moving in the band (the control)').toBe(false);
  expect(canvas1.equals(canvas2), 'canvas-only floor clips identical with the loop stopped').toBe(true);
});

test('no harness: a real click launches, km rises, the floor moves, and no test object exists (A18b)', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-mv-boot', 'running', { timeout: 30_000 });
  await page.mouse.click(960, 700);
  await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'play');
  const km0 = (await page.locator('[data-mv="km"]').textContent()) ?? '';
  await nodeWait(4000);
  const km1 = (await page.locator('[data-mv="km"]').textContent()) ?? '';
  const moved = await clipsDiffer(page);
  const globals = await page.evaluate(() => [typeof window.__mv, typeof window.__mvE2e]);
  console.log(`A18b km ${km0} -> ${km1}, floor moved ${moved}, globals ${JSON.stringify(globals)}`);
  expect(Number.parseFloat(km1)).toBeGreaterThan(Number.parseFloat(km0));
  expect(moved).toBe(true);
  expect(globals).toEqual(['undefined', 'undefined']);
});
