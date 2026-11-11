// The four false-result traps of section 11.3. Each gets a positive drill, which reproduces the trap so its reality is
// itself a test, and the guard or check that stops it.
import type { LayerName } from '../../src/contracts/index';
import { expect, test } from '../support/pw';
import { armedOnly, openHarness, sameStateTolerance, target } from './support/open';

const KEY = { chunk: 5, local: 12.5, tick: 28800 };

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'gpu', 'the traps are about the real GPU path');
});

test('trap 1: autoClear left false by the composer (A11, B14)', async ({ page }, info) => {
  await openHarness(page, info);
  const isApp = target() === 'app';
  const r = await page.evaluate(({ key, app }) => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    mv.manual(true);
    const raw = lab.traps.rawDirectNoClear();
    function guarded(post: 'off' | 'bare'): { before: number; after: number; total: number } {
      mv.setPost(post);
      mv.setMsaa(0);
      mv.setCrackMode(false);
      mv.renderAt(key.chunk, key.local, key.tick);
      const { width, height } = mv.stats();
      const before = lab.metrics.skyCount(mv.pixels());
      mv.setCrackMode(true);
      // Crack mode leaves terrain on; with it hidden too, only the clear can reach the frame.
      if (app) mv.setLayerVisible('terrain', false);
      mv.renderAt(key.chunk, key.local, key.tick);
      const after = lab.metrics.skyCount(mv.pixels());
      if (app) mv.setLayerVisible('terrain', true);
      mv.setCrackMode(false);
      return { before, after, total: width * height };
    }
    return { raw, off: guarded('off'), bare: guarded('bare') };
  }, { key: KEY, app: isApp });
  console.log(`TRAP1 ${JSON.stringify(r)}`);
  expect(r.raw.autoClear, 'the composer no longer leaves autoClear false: re-read section 11.3').toBe(false);
  expect(r.raw.magenta / r.raw.total).toBeLessThan(0.01);
  for (const g of [r.off, r.bare]) {
    expect(g.before / g.total, 'the frame before must not already be magenta').toBeLessThan(0.5);
    expect(g.after).toBe(g.total);
  }
});

test('trap 2: a stale update range blocks the full upload (A11, B14)', async ({ page }, info) => {
  await openHarness(page, info);
  const r = await page.evaluate((key) => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    mv.manual(true);
    mv.setPost('off');
    mv.setMsaa(0);
    const drill = lab.traps.rawStaleUpload(key);
    mv.renderAt(key.chunk, key.local, key.tick);
    return { drill, audit: lab.audit() };
  }, KEY);
  console.log(`TRAP2 ${JSON.stringify(r)}`);
  expect(r.drill.differ, 'a stale range must leave the frame different from a full upload').toBeGreaterThan(1000);
  expect(r.drill.pendingVisible).toBe(0);
  expect(r.audit.pendingVisible).toBe(0);
  expect(r.audit.pendingHiddenMax).toBeLessThanOrEqual(64);
});

// One page and one sim state for both frames (V1-T09). A fresh page would have run its DEMO loop for a different time, and
// renderState takes camX and camY from the sim's prevX and prevY (section 8.1), so its frame would differ for a reason
// that has nothing to do with update ranges. The reference is instead a self-healing refill of the same state: a jump far
// behind it, which renderState answers with a full rebuild (section 3.3 step 10, T10's host table), and back. By then the
// warp frame's render has uploaded and cleared every visible range, so the refill starts as a fresh page's jump would.
test('trap 2: warp after hidden rings matches a self-healing refill of the same state (B14)', async ({ page }, info) => {
  armedOnly();
  test.setTimeout(180_000);
  const state = { chunk: 5 + 1024 * 15259, local: 12.5, tick: 28800 };
  const away = { chunk: 5, local: 12.5, tick: 28800 };
  // On the shell the one layer stands in for the props rings, and its camera follows the sim, as the app's does.
  const rings: LayerName = target() === 'app' ? 'props' : 'sky';
  await openHarness(page, info, { follow: true });
  const tol = sameStateTolerance(info.project.name);
  const r = await page.evaluate(({ key, away, rings }) => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    mv.manual(true);
    mv.setPost('off');
    mv.setMsaa(0);
    mv.setLayerVisible(rings, false);
    mv.stepFrames(240, 1 / 60);
    const hidden = lab.audit();
    mv.warp(key.chunk, key.local);
    mv.setLayerVisible(rings, true);
    mv.renderAt(key.chunk, key.local, key.tick);
    const afterWarp = mv.pixels();
    const audit = lab.audit();
    const tick = mv.stats().tick;
    mv.renderAt(away.chunk, away.local, away.tick);
    mv.renderAt(key.chunk, key.local, key.tick);
    const refilled = mv.pixels();
    return {
      hidden, audit, diff: lab.metrics.byteDiff(afterWarp, refilled), meanLuma: lab.metrics.meanLuma(afterWarp), simHeld: mv.stats().tick === tick,
    };
  }, { key: state, away, rings });
  console.log(`TRAP2 armed ${JSON.stringify(r)} tolerance ${JSON.stringify(tol)}`);
  expect(r.hidden.pendingHiddenMax).toBeLessThanOrEqual(64);
  expect(r.audit.pendingVisible).toBe(0);
  expect(r.meanLuma, 'a blank frame would match itself').toBeGreaterThan(1);
  // DI-58: the same state on gpu, with other states rendered in between.
  expect(r.diff.bytes, 'the warp frame and the refill of the same state: DI-58').toBeLessThanOrEqual(tol.bytes);
  expect(r.diff.max, 'DI-58: a byte over 1 level fails').toBeLessThanOrEqual(tol.max);
  expect(r.simHeld, 'no sim step between the two frames').toBe(true);
});

test('trap 3: a read in a later task (A11, B14)', async ({ page }, info) => {
  await openHarness(page, info);
  const later = await page.evaluate(async () => {
    const mv = window.__mv!;
    mv.manual(true);
    mv.setPost('full');
    mv.setMsaa(0);
    return window.__mvLab!.traps.rawReadLater();
  });
  console.log(`TRAP3 later ${JSON.stringify(later)}`);
  expect(later.total).toBeGreaterThan(0);
  expect(later.nonZero, 'a read after a presented frame must read empty, or the trap has gone away').toBe(0);

  await page.evaluate((key) => { window.__mv!.renderAt(key.chunk, key.local, key.tick); }, KEY);
  await expect(page.evaluate(() => window.__mv!.pixels().length)).rejects.toThrow('same run');
  const afterAwait = await page.evaluate(async (key) => {
    const mv = window.__mv!;
    mv.renderAt(key.chunk, key.local, key.tick);
    await Promise.resolve();
    try {
      mv.pixels();
      return 'no throw';
    } catch (e) {
      return String(e);
    }
  }, KEY);
  expect(afterAwait).toContain('same run');

  const same = await page.evaluate((key) => {
    const mv = window.__mv!;
    mv.renderAt(key.chunk, key.local, key.tick);
    const px = mv.pixels();
    const s = mv.stats();
    return { length: px.length, expected: s.width * s.height * 4, nonZero: window.__mvLab!.metrics.nonZeroCount(px), total: s.width * s.height };
  }, KEY);
  console.log(`TRAP3 same ${JSON.stringify(same)}`);
  expect(same.length).toBe(same.expected);
  expect(same.nonZero / same.total).toBeGreaterThan(0.9);
});

test.describe('trap 4', () => {
  test.use({ allowConsoleErrors: true });

  // Always on the shell page, which the dev server keeps serving after T10: on the app this state heads for the fatal page.
  // So it never skips, and B1 can require zero skips.
  test('trap 4: a restore inside the loss dispatch is ignored (A11, shell only)', async ({ page }, info) => {
    test.setTimeout(60_000);
    const messages: string[] = [];
    page.on('console', (m) => { if (/restoreContext|context restoration/i.test(m.text())) messages.push(`${m.type()}: ${m.text()}`); });
    await openHarness(page, info, {}, 'shell');
    const r = await page.evaluate(async () => {
      const mv = window.__mv!;
      mv.manual(true);
      return window.__mvLab!.traps.restoreInDispatch();
    });
    console.log(`TRAP4 drill ${JSON.stringify(r)} ${JSON.stringify(messages)}`);
    expect(r.restoredWithin3s, 'a restore inside the dispatch must not work, or the trap has gone away').toBeNull();
    expect(r.secondCallRestoredAt, 'a second call, out of the dispatch, must work').not.toBeNull();
  });
});

test('trap 4: the API refuses the wrong order, and the right order restores (A11, B14)', async ({ page }, info) => {
  await openHarness(page, info);
  await expect(page.evaluate(() => window.__mv!.restoreContext())).rejects.toThrow('loss event');
  const r = await page.evaluate(async () => {
    const mv = window.__mv!;
    mv.manual(true);
    const lost = mv.loseContext();
    let inFlight = 'no throw';
    try {
      await mv.restoreContext();
    } catch (e) {
      inFlight = String(e);
    }
    const start = performance.now();
    await lost;
    const lostAt = performance.now() - start;
    let second = 'no throw';
    try {
      await mv.loseContext();
    } catch (e) {
      second = String(e);
    }
    const restoreStart = performance.now();
    await mv.restoreContext();
    return { inFlight, second, lostAt, restoredIn: performance.now() - restoreStart };
  });
  console.log(`TRAP4 api ${JSON.stringify(r)}`);
  expect(r.inFlight).toContain('loss event');
  expect(r.second).toContain('not live');
  const after = await page.evaluate(() => {
    const gl = document.querySelector('canvas')!.getContext('webgl2')!;
    return { lost: gl.isContextLost(), error: gl.getError() };
  });
  expect(after).toEqual({ lost: false, error: 0 });
});
