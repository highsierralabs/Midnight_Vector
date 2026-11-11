// A9: X0 on the palette table, X1 on all 30 ordered transitions at m = .5, X2 on three full sequences chosen by rule,
// with strips, curves and the midpoint sheet (plan M1 gate table, M6 "Transitions").
import { BIOME_NAMES, PALETTE_NAMES, PALETTE_FLOATS } from '../../src/contracts/index';
import { mixPalette } from '../../src/world/palettes';
import { test, expect } from '../support/pw';
import { buildCombos, opening, tickFor, type Transition } from './support/combos';
import { ART_SEED, frame, goto, openHarness, at } from './support/capture';
import { meanChroma, litSaturation, nearWhitePct, meanLuma, srgbSaturationOfLinear } from './support/metrics';
import { gateRow, roundFile, roundName, writeSpecResults, checkImage, type GateRow } from './support/round';
import { downscale, writeSheet, writeCurves, type Tile } from './support/sheet';
import { runSequence, type SeqArgs, type SeqResult } from './support/temporalPage';
import { LIMITS, CRUISE_DU, TICKS_PER_FRAME } from './support/thresholds';

const SEED = Number(process.env['TERRAIN_SEED'] ?? ART_SEED);
const SEQ_FRAMES = 1500;
/** Drill runs only (M3, DR7): X0 and X1 without the three full sequences. */
const SKIP_SEQ = process.env['TERRAIN_SKIP_SEQ'] === '1';
const ALL_LAYERS: SeqArgs['layers'] = [['sky', true], ['terrain', true], ['props', true], ['fx', true]];
/** X2's pop measure runs with props hidden: plain cruise with props steps the mean luma by 16 to 36 as objects pass the camera [O: r00], which hides any palette or hero pop (Decision log, M2). */
const NO_PROPS: SeqArgs['layers'] = [['sky', true], ['terrain', true], ['props', false], ['fx', true]];
const name = (t: { a: number; b: number }): string => `${PALETTE_NAMES[t.a]} > ${PALETTE_NAMES[t.b]}`;

test.describe.configure({ mode: 'serial' });
const rows: GateRow[] = [];
const metrics: Record<string, unknown> = {};

function seqArgs(chunk: number, local: number, o: Partial<SeqArgs> = {}): SeqArgs {
  return {
    chunk, local, tick: tickFor(chunk, local), frames: SEQ_FRAMES, du: CRUISE_DU, dticks: TICKS_PER_FRAME,
    post: 'full', layers: ALL_LAYERS, feel: null, sparkleBands: [], diffBands: [], thresh: 60, heat: false, heatGain: 8,
    slitRows: [], slitCols: [], blocks: true, curvesEvery: 0, stripBox: null, stripAt: 0, stripCount: 0, keepFramesAt: [], ...o,
  };
}

test('X0: grid and accent saturation through every crossfade', () => {
  const out = new Float32Array(PALETTE_FLOATS);
  const vals: { v: number; at: string }[] = [];
  for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) {
    if (a === b) continue;
    for (const m of [0.25, 0.5, 0.75]) {
      mixPalette(a, b, m, out);
      for (const slot of [5, 6]) {
        const v = srgbSaturationOfLinear(out[slot * 3]!, out[slot * 3 + 1]!, out[slot * 3 + 2]!);
        vals.push({ v, at: `${PALETTE_NAMES[a]} > ${PALETTE_NAMES[b]} m ${m} ${slot === 5 ? 'grid' : 'accent'}` });
      }
    }
  }
  rows.push(gateRow('X0', LIMITS.X0, vals, '30 ordered pairs x 3 m x 2 slots'));
  metrics['X0'] = vals;
  console.log(`X0 worst ${Math.min(...vals.map((v) => v.v)).toFixed(3)} over ${vals.length}; under .4: ${vals.filter((v) => v.v < 0.4).length}`);
  expect(vals.length).toBe(180);
});

test('X1 and X2: midpoints of all 30 transitions, then three full sequences', async ({ page, browser }, info) => {
  test.setTimeout(1_800_000);
  const combos = buildCombos(SEED);
  await openHarness(page, info, { seed: SEED, tier: 3, period: 0 });
  const mids: { t: Transition; chroma: number; sat: number; white: number; lumaA: number; lumaB: number }[] = [];
  const tiles: Tile[] = [];
  const big: Tile[] = [];
  for (const t of combos.transitions) {
    await goto(page, t.mid);
    const f = await frame(page, t.mid, { post: 'full' });
    // The ends, for the "largest luma difference" rule: into 72 and the next zone's into 3.
    const sa = at(t.zone * 100 + 72, 0), sb = at(t.zone * 100 + 103, 0);
    await goto(page, sa);
    const fa = await frame(page, sa, { post: 'full' });
    await goto(page, sb);
    const fb = await frame(page, sb, { post: 'full' });
    mids.push({ t, chroma: meanChroma(f.w, f.h, f.rgba), sat: litSaturation(f.w, f.h, f.rgba), white: nearWhitePct(f.w, f.h, f.rgba), lumaA: meanLuma(fa.w, fa.h, fa.rgba), lumaB: meanLuma(fb.w, fb.h, fb.rgba) });
    tiles.push({ img: downscale(f, 6), label: `${name(t)} (${BIOME_NAMES[t.biomeA]}>${BIOME_NAMES[t.biomeB]})` });
    big.push({ img: downscale(f, 3), label: `${name(t)} (${BIOME_NAMES[t.biomeA]}>${BIOME_NAMES[t.biomeB]}), hero ${t.heroA}>${t.heroB}` });
  }
  // The validated reviewer format (DI-101): the 30 midpoints again as five 3 x 2 sheets of 640 x 360. mid-sheet.png is the overview.
  for (let k = 0; k < 5; k++) {
    await writeSheet(browser, big.slice(k * 6, k * 6 + 6), { cols: 3, tileW: 640, tileH: 360, path: roundFile(`mid-${k}.png`), title: `mid-${k} ${roundName()}: transitions ${k * 6 + 1} to ${k * 6 + 6} of 30 at m = .5` });
    expect.soft(checkImage(roundFile(`mid-${k}.png`)).ok, `mid-${k}.png`).toBe(true);
  }
  await writeSheet(browser, tiles, { cols: 6, tileW: 320, tileH: 180, path: roundFile('mid-sheet.png'), title: `mid-sheet ${roundName()}: all 30 ordered transitions at m = .5 (into 87, local 32)` });
  rows.push(gateRow('X1chroma', LIMITS.X1chroma, mids.map((m) => ({ v: m.chroma, at: `${name(m.t)} zone ${m.t.zone}` }))));
  rows.push(gateRow('X1sat', LIMITS.X1sat, mids.map((m) => ({ v: m.sat, at: `${name(m.t)} zone ${m.t.zone}` }))));
  rows.push(gateRow('X1white', LIMITS.W1, mids.map((m) => ({ v: m.white, at: `${name(m.t)} zone ${m.t.zone}` }))));

  // Three sequences, by rule: lowest X1 chroma, largest luma difference between ends, the opening's first.
  const byChroma = [...mids].sort((x, y) => x.chroma - y.chroma)[0]!.t;
  const byLuma = [...mids].sort((x, y) => Math.abs(y.lumaA - y.lumaB) - Math.abs(x.lumaA - x.lumaB)).find((m) => m.t !== byChroma)!.t;
  const open = opening(SEED, 2);
  const first = combos.transitions.find((t) => t.a === open[0]!.palette && t.b === open[1]!.palette)!;
  const openT: Transition = { ...first, zone: 0, biomeA: open[0]!.biome, biomeB: open[1]!.biome };
  const chosen: { why: string; t: Transition }[] = [{ why: 'lowest X1 chroma', t: byChroma }, { why: 'largest end luma difference', t: byLuma }];
  if (!chosen.some((c) => c.t.zone === openT.zone)) chosen.push({ why: "the opening's first", t: openT });
  const seqOut: Record<string, unknown>[] = [];
  const x2step: { v: number; at: string }[] = [];
  const x2ratio: { v: number; at: string }[] = [];
  const cruiseCache = new Map<number, SeqResult>();
  const cruiseBareCache = new Map<number, SeqResult>();
  const x2stepAll: { v: number; at: string }[] = [];
  if (SKIP_SEQ) { console.log('transition: TERRAIN_SKIP_SEQ=1, sequences not run (drill)'); chosen.length = 0; }
  for (const { why, t } of chosen) {
    const keep = Array.from({ length: 12 }, (_, i) => Math.round((i * (SEQ_FRAMES - 1)) / 11));
    const start = t.zone * 100 + 72;
    await goto(page, at(start, 0));
    const r = await page.evaluate(runSequence, seqArgs(start, 0, { curvesEvery: 10, keepFramesAt: keep }));
    // The same biome's plain cruise: zone t.zone from into 5, mix 0, same length.
    let cruise = cruiseCache.get(t.zone);
    if (!cruise) {
      const c0 = t.zone * 100 + 5;
      await goto(page, at(c0, 0));
      cruise = await page.evaluate(runSequence, seqArgs(c0, 0));
      cruiseCache.set(t.zone, cruise);
    }
    // The pop measure: the same sequence and its plain cruise with props hidden.
    await goto(page, at(start, 0));
    const rb = await page.evaluate(runSequence, seqArgs(start, 0, { layers: NO_PROPS }));
    let cruiseB = cruiseBareCache.get(t.zone);
    if (!cruiseB) {
      const c0 = t.zone * 100 + 5;
      await goto(page, at(c0, 0));
      cruiseB = await page.evaluate(runSequence, seqArgs(c0, 0, { layers: NO_PROPS }));
      cruiseBareCache.set(t.zone, cruiseB);
    }
    const tag = `${t.a}-${t.b}`;
    const strip: Tile[] = r.kept.map((k) => {
      const f = { w: r.w, h: r.h, rgba: new Uint8Array(Buffer.from(k.b64, 'base64')) };
      const into = 72 + (k.frame * CRUISE_DU) / 64;
      return { img: downscale(f, 3), label: `frame ${k.frame}, into ${into.toFixed(1)}` };
    });
    await writeSheet(browser, strip, { cols: 3, tileW: 640, tileH: 360, path: roundFile(`trans-${tag}.png`), title: `trans ${name(t)} zone ${t.zone} (${why}): ${BIOME_NAMES[t.biomeA]} > ${BIOME_NAMES[t.biomeB]}, hero ${t.heroA} > ${t.heroB}` });
    const xs = r.curves.map((c) => 72 + (c.frame * CRUISE_DU) / 64);
    await writeCurves(browser, xs, [
      { title: 'mean chroma (W2 / X1 at m .5)', series: [{ name: 'chroma', colour: '#ff4fd8', values: r.curves.map((c) => c.chroma), limit: LIMITS.W2.value }] },
      { title: 'lit saturation (W5 / X1)', series: [{ name: 'lit sat', colour: '#33e0ff', values: r.curves.map((c) => c.litSat), limit: LIMITS.X1sat.value }] },
      { title: 'mean luma', series: [{ name: 'luma', colour: '#ffd319', values: r.curves.map((c) => c.luma) }] },
      { title: 'near-white %', series: [{ name: 'near-white', colour: '#ffffff', values: r.curves.map((c) => c.nearWhite), limit: LIMITS.W1.value }] },
    ], { path: roundFile(`trans-${tag}-curves.png`), title: `trans ${name(t)} zone ${t.zone}: curves against into`, xLabel: 'into' });
    const ratio = rb.blockStepP999 / Math.max(1e-6, cruiseB.blockStepP999);
    x2step.push({ v: rb.maxMeanStep / Math.max(1e-6, cruiseB.maxMeanStep), at: `${name(t)} frame ${rb.maxMeanStepAt}, props hidden: ${rb.maxMeanStep.toFixed(3)} against plain cruise ${cruiseB.maxMeanStep.toFixed(3)}` });
    x2ratio.push({ v: ratio, at: `${name(t)}: props hidden, p99.9 ${rb.blockStepP999.toFixed(2)} against cruise ${cruiseB.blockStepP999.toFixed(2)}` });
    x2stepAll.push({ v: r.maxMeanStep, at: `${name(t)} frame ${r.maxMeanStepAt}, all layers (plain cruise ${cruise.maxMeanStep.toFixed(2)})` });
    seqOut.push({ why, a: t.a, b: t.b, zone: t.zone, maxMeanStep: r.maxMeanStep, maxMeanStepAt: r.maxMeanStepAt, blockStepP999: r.blockStepP999, blockStepMax: r.blockStepMax, cruiseP999: cruise.blockStepP999, cruiseMaxMeanStep: cruise.maxMeanStep,
      bare: { maxMeanStep: rb.maxMeanStep, maxMeanStepAt: rb.maxMeanStepAt, blockStepP999: rb.blockStepP999, blockStepMax: rb.blockStepMax, cruiseP999: cruiseB.blockStepP999, cruiseMaxMeanStep: cruiseB.maxMeanStep, meanLuma: rb.meanLuma }, msP50: r.msP50, curves: r.curves, ends: r.ends });
    console.log(`X2 ${name(t)} (${why}): props hidden: max mean step ${rb.maxMeanStep.toFixed(3)} at ${rb.maxMeanStepAt} (cruise ${cruiseB.maxMeanStep.toFixed(3)}), block p99.9 ${rb.blockStepP999.toFixed(2)} vs cruise ${cruiseB.blockStepP999.toFixed(2)} (ratio ${ratio.toFixed(2)}); all layers: max step ${r.maxMeanStep.toFixed(2)} at ${r.maxMeanStepAt} (cruise ${cruise.maxMeanStep.toFixed(2)})`);
  }
  if (!SKIP_SEQ) {
    rows.push(gateRow('X2step', LIMITS.X2step, x2step, 'ratio of the largest mean luma step to plain cruise, props hidden'));
    rows.push(gateRow('X2ratio', LIMITS.X2ratio, x2ratio));
    rows.push(gateRow('X2stepAll', { value: LIMITS.X2step.value, dir: 'max', reportOnly: true }, x2stepAll, 'all layers, printed'));
  }
  metrics['mids'] = mids.map((m) => ({ a: m.t.a, b: m.t.b, zone: m.t.zone, chroma: m.chroma, sat: m.sat, white: m.white, lumaA: m.lumaA, lumaB: m.lumaB }));
  metrics['sequences'] = seqOut;
  writeSpecResults('transition', { round: roundName(), seed: SEED, ...metrics }, rows);
  for (const f of ['mid-sheet.png', ...chosen.flatMap(({ t }) => [`trans-${t.a}-${t.b}.png`, `trans-${t.a}-${t.b}-curves.png`])]) expect.soft(checkImage(roundFile(f)).ok, f).toBe(true);
  for (const r of rows) if (!r.reportOnly) expect.soft(r.pass, `${r.gate} worst ${r.value} at ${r.worst}`).toBe(true);
});
