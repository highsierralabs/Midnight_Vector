// D-010 (seam, T08, T02, T10): an input edge sampled on a rendered frame that takes no sim step is lost. Section 3.3 has
// input.sample run once per rendered frame, and section 8.1 has the sim reuse that sample for every step of the frame.
// T08's sample() reports a press since the last sample (`human`, from its pending flag) once, then clears it. When the
// frame's accumulator holds less than one step, nothing consumes that sample, and the next frame reads human false. A tap
// shorter than a frame interval can therefore fail to retake control from the idle autopilot. Deterministic here: idle,
// then one synthetic key tap, then either a frame with no step or a frame with steps.
import { expect, test } from '../../support/pw';
import { openApp } from '../lib/app';

test('D-010: a key tap retakes control from the idle autopilot even when the next frame takes no sim step', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', 'gpu only');
  test.setTimeout(120_000);
  await openApp(page);
  await page.mouse.click(960, 700);
  await expect(page.locator('html')).toHaveAttribute('data-mv-mode', 'play');
  const r = await page.evaluate(() => {
    const h = window.__mvE2e!;
    const host = h.host;
    host.setManual(true);
    const tap = (): void => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', key: 'd' }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD', key: 'd' }));
    };
    // Idle in PLAY: a hit run that ends in SIGNAL_LOST before the autopilot takes over returns to PLAY by itself in about
    // 3 s, and a tap during SIGNAL_LOST is ignored by the rules, so the tap waits for PLAY with the autopilot on.
    const goIdle = (): boolean => {
      for (let i = 0; i < 2400 && !(h.sim.autopilot && h.sim.mode === 1); i++) host.runFrame(1 / 60);
      return h.sim.autopilot && h.sim.mode === 1;
    };
    // Case 1: tap, then a frame with steps.
    const idle1 = goIdle();
    tap();
    host.runFrame(1 / 60);
    const afterStepping = h.sim.autopilot;
    const mode1 = h.sim.mode;
    // Case 2: tap, then a frame too short for a step, then a frame with steps.
    const idle2 = goIdle();
    // Drain the accumulator to a known state: right after a 1 ms frame that stepped, less than 1 ms is left, so the
    // next 1 ms frame cannot step. Without this the short frame steps whenever the residual was within 1 ms of a step.
    const t0 = h.sim.tick;
    for (let i = 0; i < 20 && h.sim.tick === t0; i++) host.runFrame(0.001);
    tap();
    const tickBeforeShort = h.sim.tick;
    host.runFrame(0.001);
    const tickAfterShort = h.sim.tick;
    host.runFrame(1 / 60);
    const afterShortThenStep = h.sim.autopilot;
    const mode2 = h.sim.mode;
    host.setManual(false);
    return { idle1, afterStepping, mode1, idle2, drained: tickBeforeShort > t0, shortStepped: tickAfterShort !== tickBeforeShort, tickAfterShort, afterShortThenStep, mode2 };
  });
  console.log(`D-010 ${JSON.stringify(r)}`);
  expect(r.idle1, 'idle in PLAY before the first tap').toBe(true);
  expect(r.mode1).toBe(1);
  expect(r.mode2).toBe(1);
  expect(r.afterStepping, 'a tap followed by a stepping frame retakes control').toBe(false);
  expect(r.idle2, 'idle in PLAY before the second tap').toBe(true);
  expect(r.drained, 'the accumulator was drained by a stepping 1 ms frame').toBe(true);
  expect(r.shortStepped, 'the 1 ms frame after the tap took no step').toBe(false);
  expect(r.afterShortThenStep, 'a tap followed by a frame with no step must not be lost').toBe(false);
});
