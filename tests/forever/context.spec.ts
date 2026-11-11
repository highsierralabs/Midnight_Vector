// Context loss and restore, section 10.2 and 11.3. Armed: the overlay, the restore sequence and the fatal page are the app's.
//
// DI-65: B12 takes two loss cycles. On the app renderState takes camX and camY from the sim's prevX and prevY (section
// 8.1), and DEMO autopilot moves them, so a byte compare across a loss with the loop running fails whatever the restore
// does (V1-T09). So the first test holds the sim with manual(true) from the first capture to the last compare and proves
// the frames match, and the second runs the loop and proves travel rises through the loss. Section 11.3's "Same, with
// travel still rising" means both hold, not that one cycle shows both.
//
// DI-67: both held compares, post off and full, run at MSAA 0. A blended MSAA resolve differs between identical renders
// on D3D11 by more than DI-58's bound, so at MSAA 2 the full compare could fail with nothing wrong.
//
// R3 (V2-T09): the wait after the restore renders at a tick that advances by T08's panel throttle, see
// support/restore.ts, and both sides' reference frames come after a refill, because T10's restore rebuilds every props
// ring and so shows any shard DEMO hid before the capture.
import { between } from '../../src/core/coords';
import { expect, test } from '../support/pw';
import { armedOnly, openHarness, sameStateTolerance, target } from './support/open';
import { CONTEXT_LOST, renderUntilRestored } from './support/restore';

const KEY = { chunk: 5, local: 12.5, tick: 28800 };
const OVERLAY = CONTEXT_LOST;
const FATAL = '[data-mv="fatal"]';
/** The app's restore timer is 15 s (section 10.2); a restore that has not finished by 20 s is a failure. */
const RESTORE_WAIT_MS = 20_000;
/** T03 saw a direct-path frame differ from itself for about 2 s after a load, and clean after 1 s. */
const SETTLE_EXACT_MS = 1000;

/** The frames cannot cross evaluate cheaply, so they stay on the page in window.__t09Frames. */
declare global { interface Window { __t09Frames?: Record<string, Uint8Array> } }

test.setTimeout(180_000);

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'gpu', 'needs the real GPU');
});

test('restore with the sim held: the frames before and after the loss match, within DI-58, at MSAA 0 (B12, DI-65, DI-67)', async ({ page }, info) => {
  armedOnly();
  // tier 3, so the frames on both sides are at one tier, whatever auto boot would have chosen. follow: on the shell the
  // camera follows the sim, as on the app, so a sim step between the captures would show here too.
  await openHarness(page, info, { tier: 3, follow: true });
  const tol = sameStateTolerance(info.project.name);

  const before = await page.evaluate(({ key, settleMs }) => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    // Held from here to the last compare.
    mv.manual(true);
    mv.setPost('off');
    mv.setMsaa(0);
    // The restore rebuilds every ring, so the frames before it must come from rebuilt rings too (V2-T09).
    lab.refill(key);
    lab.settle(key, settleMs);
    mv.renderAt(key.chunk, key.local, key.tick);
    const off = mv.pixels();
    mv.setPost('full');
    mv.setMsaa(0);
    lab.settle(key);
    mv.renderAt(key.chunk, key.local, key.tick);
    window.__t09Frames = { off, full: mv.pixels() };
    const s = mv.stats();
    return { sim: { chunk: s.chunk, local: s.local, tick: s.tick }, width: s.width, meanLuma: lab.metrics.meanLuma(off) };
  }, { key: KEY, settleMs: SETTLE_EXACT_MS });

  await page.evaluate(() => window.__mv!.loseContext());
  const lostDraw = await page.evaluate((k) => Number.isNaN(window.__mv!.renderAt(k.chunk, k.local, k.tick)), KEY);
  await page.evaluate(() => window.__mv!.restoreContext());
  const restoreWait = await renderUntilRestored(page, KEY, RESTORE_WAIT_MS);

  const r = await page.evaluate(({ key, settleMs }) => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    const s = mv.stats();
    mv.setPost('off');
    mv.setMsaa(0);
    // Back at the key's own tick after the wait frames, and refilled the same way as before the loss.
    lab.refill(key);
    lab.settle(key, settleMs);
    mv.renderAt(key.chunk, key.local, key.tick);
    const off = lab.metrics.byteDiff(window.__t09Frames!['off']!, mv.pixels());
    mv.setPost('full');
    mv.setMsaa(0);
    // Settled on both sides of the loss, as before it.
    lab.settle(key);
    mv.renderAt(key.chunk, key.local, key.tick);
    const full = lab.metrics.byteDiff(window.__t09Frames!['full']!, mv.pixels());
    return { sim: { chunk: s.chunk, local: s.local, tick: s.tick }, width: s.width, off, full };
  }, { key: KEY, settleMs: SETTLE_EXACT_MS });
  // The compare frames ran at KEY.tick, below the last wait frame's, and must not have brought the overlay back.
  const overlayAfter = await page.locator(OVERLAY).isHidden();
  console.log(`CONTEXT held ${JSON.stringify({ before, lostDraw, restoreWait, after: r, overlayHiddenAfterCompare: overlayAfter, tol })}`);

  expect(lostDraw, 'renderAt reads NaN while lost, so the loss was real').toBe(true);
  expect(overlayAfter, 'the overlay stays hidden through the compare frames at the key tick').toBe(true);
  expect(before.meanLuma, 'a blank frame would match itself').toBeGreaterThan(1);
  expect(r.width, 'one tier on both sides').toBe(before.width);
  expect(r.off.bytes, 'post off across a loss: DI-58').toBeLessThanOrEqual(tol.bytes);
  expect(r.off.max, 'post off across a loss: DI-58, a byte over 1 level fails').toBeLessThanOrEqual(tol.max);
  expect(r.full.bytes, 'full across a loss: DI-58').toBeLessThanOrEqual(tol.bytes);
  expect(r.full.max, 'full across a loss: DI-58, a byte over 1 level fails').toBeLessThanOrEqual(tol.max);
  // What makes the compare mean something: no sim step between the frames, so the camera cannot have moved.
  expect(r.sim, 'the sim was held through the loss').toEqual(before.sim);
});

test('restore with the loop running: overlay, travel rising, a tier forced in the loss, all variants, no links (B12, DI-65)', async ({ page }, info) => {
  armedOnly();
  await openHarness(page, info, { tier: 3 });
  const app = target() === 'app';
  // openHarness leaves manual off, so the loop runs from here to after the restore.
  const widthBefore = await page.evaluate(() => window.__mv!.stats().width);
  const at0 = await page.evaluate(() => { const s = window.__mv!.stats(); return { chunk: s.chunk, local: s.local }; });
  await page.evaluate(() => window.__mv!.loseContext());
  // The shell has no UI, so the overlay is the app's alone.
  if (app) await expect(page.locator(OVERLAY)).toBeVisible();
  const at1 = await page.evaluate(() => { const s = window.__mv!.stats(); return { chunk: s.chunk, local: s.local }; });
  await page.waitForTimeout(500);
  const at2 = await page.evaluate(() => { const s = window.__mv!.stats(); return { chunk: s.chunk, local: s.local }; });
  console.log(`CONTEXT travel ${JSON.stringify([at0, at1, at2])}`);
  expect(between(at2, at1), 'travel must rise through a loss: R1').toBeGreaterThan(0);

  // Forced during the loss, applied after the restore.
  await page.evaluate(() => { window.__mv!.setTier(2); });
  await page.evaluate(() => window.__mv!.restoreContext());
  if (app) await expect(page.locator(OVERLAY)).toBeHidden();

  const r = await page.evaluate((key) => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    mv.manual(true);
    // stats().tier moved at the force, so the buffer is what shows the tier really applied: it lands on a frame's step 15
    // and shows from the frame after.
    mv.renderAt(key.chunk, key.local, key.tick);
    mv.renderAt(key.chunk, key.local, key.tick);
    const tierAfter = mv.stats().tier;
    const widthAfter = mv.stats().width;
    mv.setTier(3);
    mv.renderAt(key.chunk, key.local, key.tick);
    mv.renderAt(key.chunk, key.local, key.tick);
    const variants: Record<string, number> = {};
    for (const v of ['full', 'noCa', 'min', 'bare'] as const) {
      mv.setPost(v);
      mv.renderAt(key.chunk, key.local, key.tick);
      mv.renderAt(key.chunk, key.local, key.tick);
      variants[v] = lab.metrics.nonZeroCount(mv.pixels());
    }
    mv.setPost('full');
    const linksBefore = lab.links();
    for (const t of [4, 3, 2, 1, 0, 1, 2, 3] as const) {
      mv.setTier(t);
      mv.renderAt(key.chunk, key.local, key.tick);
      mv.renderAt(key.chunk, key.local, key.tick);
    }
    return { tierAfter, widthAfter, variants, links: lab.links() - linksBefore };
  }, KEY);
  console.log(`CONTEXT after restore ${JSON.stringify(r)}`);
  expect(r.tierAfter).toBe(2);
  expect(r.widthAfter, 'a tier forced during the loss applies after the restore').toBeLessThan(widthBefore);
  for (const [v, n] of Object.entries(r.variants)) expect(n, `variant ${v} is blank`).toBeGreaterThan(0);
  expect(r.links, 'a tier cycle after a restore links nothing, or the precompile did not run again').toBe(0);
});

test('never restored: the fatal page within 20 s, and the page closes at once (B13)', async ({ page }, info) => {
  armedOnly();
  // A never-restored state crashed a tab within 100 s (section 10.2), so nothing lingers here.
  test.setTimeout(60_000);
  await openHarness(page, info);
  await page.evaluate(() => window.__mv!.loseContext());
  const start = Date.now();
  await expect(page.locator(FATAL)).toBeVisible({ timeout: 20_000 });
  console.log(`CONTEXT fatal after ${Date.now() - start} ms`);
  await page.close();
});
