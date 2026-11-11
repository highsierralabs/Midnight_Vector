// Wash-out, section 6.7. No single metric is sufficient: near-white and chroma pass a flood, haze lift catches a flood
// and improves under a veil, and blackP10 catches a veil and misses a flood. So each control must fail one metric while
// the others still pass, or it would prove nothing.
import { Biome, PaletteId } from '../../src/contracts/index';
import { expect, saveShot, test } from '../support/pw';
import { armedOnly, openHarness, sameStateTolerance } from './support/open';

const KEY = { chunk: 5, local: 12.5, tick: 28800 };
/**
 * The two control tests run on the palette their limits came from (V2-T09): the shell's zone 0, which is Sunset Drive
 * with biome 0 and hero 0 on T00's fake world, where flood and veil were measured, and the palette B11's default frame
 * gates. Without it the app's zone 0 at chunk 5 is Ultraviolet, at day phase .007, and a chroma over 55 under a veil
 * would be asked of a palette nobody measured. The day phase is not forced: forceZone does not reach it.
 */
const CONTROL_ZONE = { palette: PaletteId.SUNSET_DRIVE, biome: Biome.BOULEVARD, hero: 0 } as const;
/**
 * DI-76, amending DI-72: the veil control's strength. The control exists to show a veil that near-white, chroma and haze
 * lift all pass, caught by blackP10 alone. On the real layers veil(.1) took chroma to 51 to 55 on either palette at any
 * day phase, so chroma caught it too (DI-72, [O: T09 R3, labPost]). With T06's post on the app veil(.05) read blackP10 25
 * to 27 over 13 poses, on the limit, so it passed or failed by load timing; .06 read blackP10 32 and chroma 59.6 at the
 * standalone pose [O: T10, D-003]. No gate threshold moved. T10's D-003 regression reads this constant from this file.
 */
const VEIL_L = 0.06;
const NEAR_WHITE = 0.5;
const CHROMA = 55;
const HAZE = 20;
const BLACK_P10 = 25;
/**
 * DI-76: every B11 frame is taken at this sim tick, as B10's shimmer is. On the app renderAt takes the camera's lateral
 * pose from the sim, and DEMO moves it, so without this the frame depended on where DEMO was at manual(true). The sim is
 * deterministic from boot, so a fixed tick is a fixed pose; stepToTick throws if a page is already past it. The same tick
 * as shimmer.spec.ts. On the shell the floor does not follow the sim unless ?follow=1, so nothing there moves.
 */
const SIM_TICK = 1200;

test.setTimeout(120_000);

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'gpu', 'needs the 1080p viewport and the real GPU');
});

test('wash-out control: thin neon flood passes near-white and chroma, and fails haze lift (A14, B11)', async ({ page }, info) => {
  await openHarness(page, info, { tier: 3 });
  const r = await page.evaluate(({ key, zone, simTick }) => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    mv.manual(true);
    lab.stepToTick(simTick);
    mv.forceZone(zone.palette, zone.biome, zone.hero);
    mv.setPost('full');
    mv.setMsaa(2);
    const clean = lab.washoutAt(key);
    lab.controls.floodLines(16);
    const flood = lab.washoutAt(key);
    mv.renderAt(key.chunk, key.local, key.tick);
    return { tick: mv.stats().tick, clean, flood };
  }, { key: KEY, zone: CONTROL_ZONE, simTick: SIM_TICK });
  console.log(`WASHOUT clean ${JSON.stringify(r.clean)} at sim tick ${r.tick}`);
  console.log(`WASHOUT flood ${JSON.stringify(r.flood)}`);
  await saveShot(page, info, 'washout-flood');
  expect(r.tick, 'measured at the fixed pose (DI-76)').toBe(SIM_TICK);
  expect(r.flood.nearWhitePct).toBeLessThan(NEAR_WHITE);
  expect(r.flood.meanChroma).toBeGreaterThan(CHROMA);
  expect(r.flood.hazeLift).toBeGreaterThan(HAZE);
});

test('wash-out control: an additive veil passes haze lift, and fails blackP10 (A14, B11, DI-72, DI-76)', async ({ page }, info) => {
  await openHarness(page, info, { tier: 3 });
  const r = await page.evaluate(({ key, zone, veilL, simTick }) => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    mv.manual(true);
    lab.stepToTick(simTick);
    mv.forceZone(zone.palette, zone.biome, zone.hero);
    mv.setPost('full');
    mv.setMsaa(2);
    lab.controls.veil(veilL);
    const veil = lab.washoutAt(key);
    mv.renderAt(key.chunk, key.local, key.tick);
    return { tick: mv.stats().tick, veil };
  }, { key: KEY, zone: CONTROL_ZONE, veilL: VEIL_L, simTick: SIM_TICK });
  console.log(`WASHOUT veil(${VEIL_L}) ${JSON.stringify(r.veil)} at sim tick ${r.tick}`);
  await saveShot(page, info, 'washout-veil');
  expect(r.tick, 'measured at the fixed pose (DI-76)').toBe(SIM_TICK);
  expect(r.veil.nearWhitePct).toBeLessThan(NEAR_WHITE);
  expect(r.veil.meanChroma).toBeGreaterThan(CHROMA);
  expect(r.veil.hazeLift).toBeLessThan(HAZE);
  expect(r.veil.blackP10).toBeGreaterThan(BLACK_P10);
});

// 'during' compares two different states, so it keeps its own limit. 'after' compares one state rendered before and after
// the controls, with other states in between, so it is DI-58's same-state compare (DI-68): on gpu at most 64 bytes and
// none over 1 level, on software 0. A control left on reads millions of bytes, far past that.
test('wash-out: the controls leave the frame clean when switched off (A14, DI-68)', async ({ page }, info) => {
  await openHarness(page, info, { tier: 3 });
  const tol = sameStateTolerance(info.project.name);
  const r = await page.evaluate(({ key, veilL, simTick }) => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    mv.manual(true);
    lab.stepToTick(simTick);
    mv.setPost('off');
    mv.setMsaa(0);
    mv.renderAt(key.chunk, key.local, key.tick);
    const before = mv.pixels();
    lab.controls.floodLines(16);
    lab.controls.veil(veilL);
    mv.renderAt(key.chunk, key.local, key.tick);
    const during = mv.pixels();
    lab.controls.floodLines(0);
    lab.controls.veil(0);
    mv.renderAt(key.chunk, key.local, key.tick);
    const after = mv.pixels();
    return { during: lab.metrics.byteDiff(before, during).bytes, after: lab.metrics.byteDiff(before, after) };
  }, { key: KEY, veilL: VEIL_L, simTick: SIM_TICK });
  console.log(`WASHOUT off ${JSON.stringify(r)} tolerance ${JSON.stringify(tol)}`);
  expect(r.during).toBeGreaterThan(1000);
  expect(r.after.bytes, 'the same state after the controls are off: DI-58, DI-68').toBeLessThanOrEqual(tol.bytes);
  expect(r.after.max, 'DI-58: a byte over 1 level fails').toBeLessThanOrEqual(tol.max);
});

test('wash-out: default frame, palette 0, passes all four; palettes 1 to 5 printed (B11)', async ({ page }, info) => {
  armedOnly();
  await openHarness(page, info, { tier: 3 });
  const { tick, palettes: r } = await page.evaluate(({ key, simTick }) => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    mv.manual(true);
    lab.stepToTick(simTick);
    mv.setPost('full');
    mv.setMsaa(2);
    const palettes = [];
    for (let p = 0; p < 6; p++) {
      mv.forceZone(p, 0, 0);
      mv.renderAt(key.chunk, key.local, key.tick);
      palettes.push(lab.washoutAt(key));
    }
    return { tick: mv.stats().tick, palettes };
  }, { key: KEY, simTick: SIM_TICK });
  r.forEach((m, p) => { console.log(`WASHOUT palette ${p} ${JSON.stringify(m)}`); });
  expect(tick, 'measured at the fixed pose (DI-76)').toBe(SIM_TICK);
  const d = r[0]!;
  expect(d.nearWhitePct).toBeLessThan(NEAR_WHITE);
  expect(d.meanChroma).toBeGreaterThan(CHROMA);
  expect(d.hazeLift).toBeLessThanOrEqual(HAZE);
  expect(d.blackP10).toBeLessThanOrEqual(BLACK_P10);
});
