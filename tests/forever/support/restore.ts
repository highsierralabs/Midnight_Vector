// B12's held cycle: waiting for the app's restore to finish while the sim is held by manual(true). Its own file with no
// runtime import, so a throwaway probe can drive this exact function against T08's real UI (V2-T09, R3).
//
// With the loop held, the app's overlay changes only when a frame runs ui.frame (section 3.3 step 13), and the restore
// ends after an await (post.precompile), when contextOk and the overlay flip together. T08 throttles every panel write
// (src/ui/slots.ts, createGate): a changed view is written only once the frame's tick has moved SLOT_MIN_TICKS or more
// since the last write, and a tick that moves backward opens the gate again. So if the first frame after the restore
// event runs while the precompile is pending, it writes the overlay at its tick, and no later frame at that same tick
// can hide it (V2-T09: 400 frames at 28800 left it visible, one at 28806 hid it). Each wait frame therefore renders the
// held position at a tick PANEL_GATE_TICKS past the last one. renderState steps no sim, so the camera stays put, and
// the compare that follows renders at the key's own tick again: that tick is lower, which reopens the gate, and the
// view written last already has the overlay hidden, so nothing is written and it stays hidden.
import type { Page } from 'playwright/test';
import type {} from '../../../src/harness/index';   // brings window.__mv into the program

/** T08's SLOT_MIN_TICKS (src/ui/slots.ts). Not imported: T09 imports no sibling. */
export const PANEL_GATE_TICKS = 6;
export const CONTEXT_LOST = '[data-mv="context-lost"]';

export interface HeldKey { chunk: number; local: number; tick: number }

/** The tick wait frame n renders at, n from 1: always PANEL_GATE_TICKS past the previous frame's. */
export function waitTick(key: HeldKey, frame: number): number {
  return key.tick + PANEL_GATE_TICKS * frame;
}

/**
 * Renders the held position until the overlay is hidden after a frame, which with the gate open on every frame means
 * contextOk is true. The shell has no overlay and restores in its listener, so one frame does there. Throws after waitMs.
 */
export async function renderUntilRestored(page: Page, key: HeldKey, waitMs: number): Promise<{ frames: number; lastTick: number }> {
  const start = Date.now();
  for (let frames = 1; ; frames++) {
    const tick = waitTick(key, frames);
    await page.evaluate(({ k, t }) => { window.__mv!.renderAt(k.chunk, k.local, t); }, { k: key, t: tick });
    if (await page.locator(CONTEXT_LOST).isHidden()) return { frames, lastTick: tick };
    if (Date.now() - start > waitMs) throw new Error(`the overlay did not hide within ${waitMs} ms of the restore, with the sim held (last tick ${tick})`);
    await page.waitForTimeout(50);
  }
}
