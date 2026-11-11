// A12 to A14: context loss and restore on the integrated build (section 10.2).
import type { Page } from 'playwright/test';
import { CHUNK_LEN } from '../../src/contracts/index';
import { expect, test } from '../support/pw';
import { renderUntilRestored } from '../forever/support/restore';
import { sameStateTolerance } from '../forever/support/open';
import { audioRecorderScript, collectConsole, installR1Sampler, loseContext, nodeWait, openApp, readR1, restoreContext, setSegment } from './lib/app';

const LOST = '[data-mv="context-lost"]';

async function counters(page: Page): Promise<{ frames: number; rendered: number; restores: number; ok: boolean }> {
  return page.evaluate(() => {
    const h = window.__mvE2e!;
    return { frames: h.counters.frames, rendered: h.counters.rendered, restores: h.counters.restores, ok: h.contextOk() };
  });
}

/**
 * Two frames of one held state, post off and full, at MSAA 0 (DI-67), after a refill (T05's collected shards). Kept in
 * the page under slot, so the compare never ships 8 MB through evaluate.
 */
async function captureHeld(page: Page, key: { chunk: number; local: number; tick: number }, slot: 'pre' | 'post'): Promise<void> {
  await page.evaluate(({ k, slot }) => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    mv.setMsaa(0);
    const grab = (post: 'off' | 'full'): Uint8Array => {
      mv.setPost(post);
      lab.refill(k);
      lab.settle(k, post === 'off' ? 1000 : 3000);
      mv.renderAt(k.chunk, k.local, k.tick);
      return mv.pixels();
    };
    const w = window as unknown as Record<string, unknown>;
    w[`__a12${slot}`] = { off: grab('off'), full: grab('full') };
  }, { k: key, slot });
}

async function compareHeld(page: Page): Promise<{ off: { bytes: number; max: number; mean: number }; full: { bytes: number; max: number; mean: number } }> {
  return page.evaluate(() => {
    const w = window as unknown as Record<string, { off: Uint8Array; full: Uint8Array }>;
    const a = w['__a12pre']!;
    const b = w['__a12post']!;
    const cmp = (x: Uint8Array, y: Uint8Array): { bytes: number; max: number; mean: number } => {
      let bytes = 0;
      let max = 0;
      let sum = 0;
      for (let i = 0; i < x.length; i++) {
        const d = Math.abs(x[i]! - y[i]!);
        if (d > 0) bytes++;
        if (d > max) max = d;
        sum += d;
      }
      return { bytes, max, mean: sum / x.length };
    };
    return { off: cmp(a.off, b.off), full: cmp(a.full, b.full) };
  });
}

test.describe('context loss', () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== 'gpu', 'gpu only'); });

  test('restore: travel rises through it, the overlay shows and clears, rendering resumes, and the held frame matches (A12)', async ({ page }, info) => {
    test.setTimeout(120_000);
    await openApp(page, '&tier=3');
    await installR1Sampler(page);
    await nodeWait(1000);
    await setSegment(page, 'context');
    const before = await counters(page);
    await loseContext(page);
    await expect(page.locator(LOST)).toBeVisible();
    const lost1 = await counters(page);
    expect(lost1.ok).toBe(false);
    await nodeWait(2000);
    const lost2 = await counters(page);
    expect(lost2.rendered).toBe(lost1.rendered);
    expect(lost2.frames).toBeGreaterThan(lost1.frames + 30);
    await restoreContext(page);
    await expect(page.locator(LOST)).toBeHidden();
    await nodeWait(1000);
    const after = await counters(page);
    expect(after.ok).toBe(true);
    expect(after.rendered).toBeGreaterThan(lost2.rendered + 30);
    expect(after.restores).toBe(before.restores + 1);
    const r1 = await readR1(page);
    console.log(`A12 loop running: ${JSON.stringify({ before, lost1, lost2, after, samples: r1.samples, bad: r1.bad.length })}`);
    expect(r1.bad).toEqual([]);
    expect(r1.samples['context'] ?? 0).toBeGreaterThanOrEqual(30);

    // The held cycle (DI-65): the same state before and after a loss, with the sim held throughout.
    const key = await page.evaluate(() => {
      const mv = window.__mv!;
      mv.manual(true);
      const s = mv.stats();
      return { chunk: s.chunk, local: s.local, tick: s.tick };
    });
    await captureHeld(page, key, 'pre');
    await loseContext(page);
    expect(await page.evaluate((k) => window.__mv!.renderAt(k.chunk, k.local, k.tick), key)).toBeNaN();
    await restoreContext(page);
    const waited = await renderUntilRestored(page, key, 20_000);
    await captureHeld(page, key, 'post');
    expect(await page.locator(LOST).isHidden()).toBe(true);
    const stateAfter = await page.evaluate(() => window.__mv!.stats());
    expect([stateAfter.chunk, stateAfter.local, stateAfter.tick]).toEqual([key.chunk, key.local, key.tick]);
    const { off, full } = await compareHeld(page);
    const tol = sameStateTolerance(info.project.name);
    console.log(`A12 held: waited ${JSON.stringify(waited)}, off ${JSON.stringify(off)}, full ${JSON.stringify(full)}, tolerance ${JSON.stringify(tol)}`);
    expect(off.max).toBeLessThanOrEqual(tol.max);
    expect(off.bytes).toBeLessThanOrEqual(tol.bytes);
    expect(full.mean).toBeLessThanOrEqual(2);
  });

  /**
   * A12r (VI-gates mutation B3): what restorePending buys. The restore handler rebuilds at the camera of the last frame,
   * then awaits post.precompile while the real loop keeps moving the sim with layer frames skipped, so the first live
   * frame draws further on, and restorePending makes it rebuild there again. Here the loop is held and renderState moves
   * only the camera, by d < CHUNK_LEN, so the jump rule cannot stand in for it. The first live frame is compared with a
   * self-healing refill of the same state (trap 2's reference: a jump ahead and back, which rebuilds), within DI-58, and
   * so is a frame that streamed the same d with no loss at all, as a control on streaming itself. Post off and full,
   * after 3 s of DEMO. Hidden-shard state is not a difference between the two paths: the restore's own rebuild clears it
   * whether or not the first live frame rebuilds again.
   */
  test('restore with the camera moved on: the first live frame equals a rebuild of the same state (A12r)', async ({ page }, info) => {
    test.setTimeout(120_000);
    await openApp(page, '&tier=3');
    await nodeWait(3000);
    const tol = sameStateTolerance(info.project.name);
    const rows: { d: number; restored: { bytes: number; max: number }; streamed: { bytes: number; max: number }; luma: number; waitedMs: number; restores: number }[] = [];
    for (const [post, d] of [['off', 30], ['off', 63], ['full', 30], ['full', 63]] as const) {
      const r = await page.evaluate(async ({ post, d, len }) => {
        const mv = window.__mv!;
        const lab = window.__mvLab!;
        const hook = window.__mvE2e!;
        mv.manual(true);
        mv.setMsaa(0);
        mv.setPost(post);
        const s = mv.stats();
        const k0 = { chunk: s.chunk, local: s.local, tick: s.tick };
        const l1 = k0.local + d;
        const k1 = l1 < len ? { chunk: k0.chunk, local: l1, tick: k0.tick } : { chunk: k0.chunk + 1, local: l1 - len, tick: k0.tick };
        const away = { chunk: k1.chunk + 2, local: k1.local, tick: k1.tick };
        // The reference: a rebuild at k1, by a jump ahead and back, then its frame.
        const reference = (): Uint8Array => {
          mv.renderAt(away.chunk, away.local, away.tick);
          mv.renderAt(k1.chunk, k1.local, k1.tick);
          return mv.pixels();
        };
        // Control: no loss, a rebuild at k0, then the same d streamed in one frame.
        lab.refill(k0);
        mv.renderAt(k1.chunk, k1.local, k1.tick);
        const streamed = mv.pixels();
        const ref1 = reference();
        // The restore: the last live frame at k0, a loss, a restore that rebuilds at k0, and no frame until it is live.
        lab.refill(k0);
        const renderer = hook.host.ctx.renderer;
        const canvas = renderer.domElement;
        const ext = renderer.getContext().getExtension('WEBGL_lose_context')!;
        await new Promise<void>((res) => { canvas.addEventListener('webglcontextlost', () => { res(); }, { once: true }); ext.loseContext(); });
        await new Promise((res) => { setTimeout(res, 0); });
        const restores0 = hook.counters.restores;
        const rebuilds0 = hook.counters.rebuilds;
        await new Promise<void>((res) => { canvas.addEventListener('webglcontextrestored', () => { res(); }, { once: true }); ext.restoreContext(); });
        const t0 = performance.now();
        while (!hook.contextOk()) {
          if (performance.now() - t0 > 20_000) throw new Error('the restore did not complete within 20 s');
          await new Promise((res) => { setTimeout(res, 20); });
        }
        const waitedMs = performance.now() - t0;
        const rebuilds1 = hook.counters.rebuilds;
        mv.renderAt(k1.chunk, k1.local, k1.tick);
        const first = mv.pixels();
        const rebuilds2 = hook.counters.rebuilds;
        const ref2 = reference();
        // Sensitivity: the same compare sees a camera a quarter unit off, so a match at this pose means something.
        mv.renderAt(away.chunk, away.local, away.tick);
        mv.renderAt(k1.chunk, k1.local >= 1 ? k1.local - 0.25 : k1.local + 0.25, k1.tick);
        const shifted = mv.pixels();
        return {
          post, d, k0, k1, waitedMs, restores: hook.counters.restores - restores0,
          // Which code ran: the restore handler's own rebuild, then restorePending's at the first live frame.
          rebuildsAtRestore: rebuilds1 - rebuilds0, rebuildsAtFirstFrame: rebuilds2 - rebuilds1,
          restored: lab.metrics.byteDiff(first, ref2), streamed: lab.metrics.byteDiff(streamed, ref1),
          refs: lab.metrics.byteDiff(ref1, ref2), shifted: lab.metrics.byteDiff(shifted, ref2), luma: lab.metrics.meanLuma(first),
        };
      }, { post, d, len: CHUNK_LEN });
      console.log(`A12r post ${post} d ${d}: ${JSON.stringify(r)} tolerance ${JSON.stringify(tol)}`);
      rows.push(r);
      expect(r.restores).toBe(1);
      expect(r.rebuildsAtRestore, 'section 10.2 step 1: the restore rebuilds').toBe(1);
      expect(r.luma, 'a blank frame would match itself').toBeGreaterThan(1);
      expect(r.shifted.bytes, 'the compare sees a camera a quarter unit off').toBeGreaterThan(tol.bytes * 100);
      expect(r.refs.bytes, 'the two references, before and after the loss: DI-58').toBeLessThanOrEqual(tol.bytes);
      expect(r.restored.bytes, `post ${post}, d ${d}: the first live frame after the restore against a rebuild of that state: DI-58`).toBeLessThanOrEqual(tol.bytes);
      expect(r.restored.max, 'DI-58: a byte over 1 level fails').toBeLessThanOrEqual(tol.max);
      // The self-heal the jump rule rests on: any forward move up to CHUNK_LEN draws as a rebuild would (section 8.1).
      expect(r.streamed.bytes, `post ${post}, d ${d}: a frame that streamed d u in one step against a rebuild: DI-58`).toBeLessThanOrEqual(tol.bytes);
      expect(r.streamed.max).toBeLessThanOrEqual(tol.max);
    }
    expect(rows.length).toBe(4);
  });

  test('never restored: the fatal page at 15 s, canvas removed, loop stopped, audio closed, Reload works (A13)', async ({ page }) => {
    test.setTimeout(90_000);
    await page.addInitScript(audioRecorderScript);
    const log = await openApp(page);
    // A real gesture launches, so an AudioContext exists for the fatal route to close.
    await page.mouse.click(960, 540);
    await nodeWait(500);
    expect(log.lines.some((l) => l.includes('AUDIOREC new AudioContext'))).toBe(true);
    const t0 = Date.now();
    await loseContext(page);
    await expect(page.locator('[data-mv="fatal"]')).toBeVisible({ timeout: 20_000 });
    const seconds = (Date.now() - t0) / 1000;
    await expect(page.locator('[data-mv="reload"]')).toBeVisible();
    const st = await page.evaluate(() => ({
      reason: document.querySelector('[data-mv="fatal"]')!.getAttribute('data-reason'),
      canvas: document.querySelector('#mv-stage canvas') !== null,
      frames: window.__mvE2e!.counters.frames,
      focused: document.activeElement?.getAttribute('data-mv') ?? null,
    }));
    await nodeWait(500);
    const frames2 = await page.evaluate(() => window.__mvE2e!.counters.frames);
    console.log(`A13 fatal after ${seconds.toFixed(2)} s: ${JSON.stringify(st)}, frames then ${frames2}`);
    expect(seconds).toBeGreaterThanOrEqual(14);
    expect(seconds).toBeLessThanOrEqual(17);
    expect(st.reason).toBe('context-lost-permanent');
    expect(st.canvas).toBe(false);
    expect(frames2).toBe(st.frames);
    expect(st.focused).toBe('reload');
    expect(log.lines.some((l) => l.includes('AUDIOREC call close'))).toBe(true);
    // Reload produces a new load and a working page.
    const ready = page.waitForEvent('console', { predicate: (m) => m.text() === 'MV_READY', timeout: 60_000 });
    const load = page.waitForEvent('load');
    await page.locator('[data-mv="reload"]').click();
    await load;
    await ready;
    expect(await page.evaluate(() => window.__mvE2e!.contextOk())).toBe(true);
    await page.close();
  });

  for (const tier of [4, 3, 2, 1] as const) {
    test(`combos at ?tier=${tier}: loss, restore, then every variant renders opaque (A14)`, async ({ page }) => {
      test.setTimeout(90_000);
      await openApp(page, `&tier=${tier}`);
      await loseContext(page);
      await nodeWait(300);
      await restoreContext(page);
      await expect(page.locator(LOST)).toBeHidden();
      const r = await page.evaluate(() => {
        const mv = window.__mv!;
        mv.manual(true);
        const s = mv.stats();
        const out: Record<string, { alpha255: boolean; lit: number }> = {};
        for (const v of ['off', 'bare', 'min', 'noCa', 'full'] as const) {
          mv.setPost(v);
          mv.renderAt(s.chunk, s.local, s.tick);
          mv.renderAt(s.chunk, s.local, s.tick);
          const px = mv.pixels();
          let opaque = true;
          let lit = 0;
          for (let i = 0; i < px.length; i += 4) {
            if (px[i + 3] !== 255) opaque = false;
            if (px[i]! + px[i + 1]! + px[i + 2]! > 30) lit++;
          }
          out[v] = { alpha255: opaque, lit: lit / (px.length / 4) };
        }
        return { out, tier: mv.stats().tier };
      });
      console.log(`A14 tier ${tier}: ${JSON.stringify(r)}`);
      expect(r.tier).toBe(tier);
      for (const v of Object.values(r.out)) {
        expect(v.alpha255).toBe(true);
        expect(v.lit).toBeGreaterThan(0.2);
      }
    });
  }

  test('restore during a tier change: force(1) during the loss, restored at tier 1 (A14)', async ({ page }) => {
    await openApp(page, '&tier=3');
    await loseContext(page);
    await page.evaluate(() => { window.__mvE2e!.host.governor.force(1); });
    await nodeWait(300);
    await restoreContext(page);
    await expect(page.locator(LOST)).toBeHidden();
    await nodeWait(500);
    const r = await page.evaluate(() => {
      const gl = window.__mvE2e!.host.ctx.renderer.getContext();
      return { tier: window.__mv!.stats().tier, w: gl.drawingBufferWidth, h: gl.drawingBufferHeight, ok: window.__mvE2e!.contextOk() };
    });
    console.log(`A14 tier change in loss: ${JSON.stringify(r)}`);
    expect(r.tier).toBe(1);
    expect(r.ok).toBe(true);
    // Tier 1 at 1920x1080: min(1, .75, sqrt(921600 / 2073600)) = 2/3, so the buffer shows the tier really applied.
    expect(r.w).toBe(1280);
    expect(r.h).toBe(720);
  });

  test('second loss during precompile: only the newer restore completes (A14)', async ({ page }) => {
    test.setTimeout(60_000);
    const log = collectConsole(page);
    await openApp(page, '&tier=3');
    await loseContext(page);
    // Lose again in the task after the restore event, while the app awaits post.precompile().
    const r = await page.evaluate(async () => {
      const hook = window.__mvE2e!;
      const ext = window.__mvLoseExt!;
      const canvas = hook.host.ctx.renderer.domElement;
      const states: string[] = [];
      const relost = new Promise<void>((res) => {
        canvas.addEventListener('webglcontextrestored', () => {
          states.push(`restored ok=${hook.contextOk()}`);
          setTimeout(() => {
            states.push(`before second loss ok=${hook.contextOk()}`);
            canvas.addEventListener('webglcontextlost', () => { res(); }, { once: true });
            ext.loseContext();
          }, 0);
        }, { once: true });
      });
      ext.restoreContext();
      await relost;
      await new Promise((r2) => { setTimeout(r2, 300); });
      states.push(`after second loss ok=${hook.contextOk()}`);
      return states;
    });
    await restoreContext(page);
    await expect(page.locator(LOST)).toBeHidden();
    await nodeWait(500);
    const c = await counters(page);
    console.log(`A14 second loss: ${JSON.stringify(r)} then ${JSON.stringify(c)}`);
    expect(r[1]).toBe('before second loss ok=false');
    expect(r[2]).toBe('after second loss ok=false');
    expect(c.restores).toBe(2);
    expect(c.ok).toBe(true);
    expect(log.of('error')).toEqual([]);
  });
});
