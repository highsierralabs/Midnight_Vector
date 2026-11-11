// A11: sparkle (S1) and motion presence (S2) per biome at cruise and boost, with slit scans, heat maps and crop
// strips for viewing (plan M6 "Motion captures"). Computed in the page. These are proxies: they can show a defect, and
// a clean result does not show smooth motion (J10 stops at 2).
import { join } from 'node:path';
import { BIOME_NAMES, PALETTE_NAMES } from '../../src/contracts/index';
import { test, expect } from '../support/pw';
import { buildCombos } from './support/combos';
import { ART_SEED, goto, openHarness } from './support/capture';
import { gateRow, roundDir, roundFile, roundName, writeSpecResults, checkImage, type GateRow } from './support/round';
import { upscale, writePng, writeSheet, type Tile } from './support/sheet';
import { runSequence, type SeqArgs } from './support/temporalPage';
import { LIMITS, BANDS, BOOST_DU, CRUISE_DU, SPARKLE_THRESH, TICKS_PER_FRAME } from './support/thresholds';

const SEED = Number(process.env['TERRAIN_SEED'] ?? ART_SEED);
const ALL_LAYERS: SeqArgs['layers'] = [['sky', true], ['terrain', true], ['props', true], ['fx', true]];
/** S1's floor bands are gated with props hidden, as T09's B10 gates shimmer (DI-74): near props sweeping those rows is motion, not sparkle (Decision log, M2). */
const NO_PROPS: SeqArgs['layers'] = [['sky', true], ['terrain', true], ['props', false], ['fx', true]];
const SPARKLE_BANDS: [number, number][] = [[...BANDS.farFloor], [...BANDS.midFloor], [...BANDS.farObjects]];
const STRIP_BOX: [number, number, number, number] = [380, 430, 700, 610];
const SLIT_ROWS = [560, 612, 640];
const SLIT_COL = 700;

function args(chunk: number, local: number, tick: number, o: Partial<SeqArgs>): SeqArgs {
  return {
    chunk, local, tick, frames: 48, du: CRUISE_DU, dticks: TICKS_PER_FRAME, post: 'full', layers: ALL_LAYERS, feel: null,
    sparkleBands: SPARKLE_BANDS, diffBands: [[...BANDS.nearFloor]], thresh: SPARKLE_THRESH, heat: false, heatGain: 8,
    slitRows: [], slitCols: [], blocks: false, curvesEvery: 0, stripBox: null, stripAt: 0, stripCount: 0, keepFramesAt: [], ...o,
  };
}

test('motion: sparkle, motion presence, slit scans and heat maps in all six biomes', async ({ page, browser }, info) => {
  test.setTimeout(1_200_000);
  const combos = buildCombos(SEED);
  await openHarness(page, info, { seed: SEED, tier: 3, period: 0 });
  const dir = roundDir();
  const rows: GateRow[] = [];
  const per: Record<string, unknown>[] = [];
  const s1: Record<'far' | 'farBoost' | 'mid' | 'obj' | 'farAll' | 'midAll', { v: number; at: string }[]> = { far: [], farBoost: [], mid: [], obj: [], farAll: [], midAll: [] };
  const s2: { v: number; at: string }[] = [];
  for (let b = 0; b < 6; b++) {
    // The biome's first palette: its pair with the lowest zone.
    const pair = combos.pairs.filter((p) => p.biome === b).sort((x, y) => x.z0 - y.z0)[0]!;
    const s = pair.tile;
    const where = `${BIOME_NAMES[b]} (${PALETTE_NAMES[pair.palette]}) ${s.chunk}/${s.local}`;
    await goto(page, s);
    const cruise = await page.evaluate(runSequence, args(s.chunk, s.local, s.tick, { heat: true, stripBox: STRIP_BOX, stripAt: 20, stripCount: 6 }));
    await goto(page, s);
    const boost = await page.evaluate(runSequence, args(s.chunk, s.local, s.tick, { du: BOOST_DU }));
    await goto(page, s);
    const cruiseFloor = await page.evaluate(runSequence, args(s.chunk, s.local, s.tick, { layers: NO_PROPS }));
    await goto(page, s);
    const boostFloor = await page.evaluate(runSequence, args(s.chunk, s.local, s.tick, { du: BOOST_DU, layers: NO_PROPS }));
    await goto(page, s);
    const slit = await page.evaluate(runSequence, args(s.chunk, s.local, s.tick, { frames: 360, sparkleBands: [], diffBands: [], slitRows: SLIT_ROWS, slitCols: [SLIT_COL] }));
    for (const [k, f, mode] of [[cruise, cruiseFloor, 'cruise'], [boost, boostFloor, 'boost']] as const) {
      (mode === 'cruise' ? s1.far : s1.farBoost).push({ v: f.sparkle[0]!, at: `${where} ${mode}, props hidden` });
      s1.mid.push({ v: f.sparkle[1]!, at: `${where} ${mode}, props hidden` });
      s1.farAll.push({ v: k.sparkle[0]!, at: `${where} ${mode}` });
      s1.midAll.push({ v: k.sparkle[1]!, at: `${where} ${mode}` });
      s1.obj.push({ v: k.sparkle[2]!, at: `${where} ${mode}` });
    }
    s2.push({ v: cruise.diff[0]!, at: `${where} cruise` });
    writePng(join(dir, `heat-b${b}.png`), { w: cruise.w, h: cruise.h, rgba: new Uint8Array(Buffer.from(cruise.heat!, 'base64')) });
    SLIT_ROWS.forEach((row, i) => writePng(join(dir, `slit-b${b}-r${row}.png`), { w: slit.w, h: 360, rgba: new Uint8Array(Buffer.from(slit.slitRows[i]!, 'base64')) }));
    writePng(join(dir, `slit-b${b}-c${SLIT_COL}.png`), { w: 360, h: slit.h, rgba: new Uint8Array(Buffer.from(slit.slitCols[0]!, 'base64')) });
    const cw = STRIP_BOX[2] - STRIP_BOX[0], ch = STRIP_BOX[3] - STRIP_BOX[1];
    const strip: Tile[] = cruise.strips.map((b64, i) => ({ img: upscale({ w: cw, h: ch, rgba: new Uint8Array(Buffer.from(b64, 'base64')) }, 2), label: `frame ${20 + i}` }));
    await writeSheet(browser, strip, { cols: 3, tileW: cw * 2, tileH: ch * 2, path: join(dir, `strip-b${b}.png`), title: `strip ${where}: far band x ${STRIP_BOX[0]}-${STRIP_BOX[2]}, rows ${STRIP_BOX[1]}-${STRIP_BOX[3]}, 2x, consecutive cruise frames` });
    per.push({ biome: b, palette: pair.palette, chunk: s.chunk, local: s.local, tick: s.tick, cruise: { sparkle: cruise.sparkle, diff: cruise.diff, msP50: cruise.msP50 }, boost: { sparkle: boost.sparkle, diff: boost.diff }, cruiseNoProps: { sparkle: cruiseFloor.sparkle, diff: cruiseFloor.diff }, boostNoProps: { sparkle: boostFloor.sparkle, diff: boostFloor.diff }, slitMsP50: slit.msP50 });
    console.log(`motion ${where}: props hidden, cruise far ${(cruiseFloor.sparkle[0]! * 100).toFixed(3)}% mid ${(cruiseFloor.sparkle[1]! * 100).toFixed(3)}%, boost far ${(boostFloor.sparkle[0]! * 100).toFixed(3)}% mid ${(boostFloor.sparkle[1]! * 100).toFixed(3)}%`);
    console.log(`motion ${where}: cruise sparkle far ${(cruise.sparkle[0]! * 100).toFixed(3)}% mid ${(cruise.sparkle[1]! * 100).toFixed(3)}% obj ${(cruise.sparkle[2]! * 100).toFixed(4)}%, near diff ${cruise.diff[0]!.toFixed(2)}; boost far ${(boost.sparkle[0]! * 100).toFixed(3)}% mid ${(boost.sparkle[1]! * 100).toFixed(3)}% obj ${(boost.sparkle[2]! * 100).toFixed(4)}%`);
  }
  rows.push(gateRow('S1far', LIMITS.S1far, s1.far, 'cruise, props hidden'));
  rows.push(gateRow('S1farBoost', { value: LIMITS.S1far.value, dir: 'max', reportOnly: true }, s1.farBoost, 'boost, props hidden, printed: overlaps the drill (M3)'));
  rows.push(gateRow('S1mid', LIMITS.S1mid, s1.mid));
  rows.push(gateRow('S1obj', LIMITS.S1obj, s1.obj));
  rows.push(gateRow('S1farAll', { value: LIMITS.S1far.value, dir: 'max', reportOnly: true }, s1.farAll, 'all layers, printed'));
  rows.push(gateRow('S1midAll', { value: LIMITS.S1mid.value, dir: 'max', reportOnly: true }, s1.midAll, 'all layers, printed'));
  rows.push(gateRow('S2', LIMITS.S2, s2));
  writeSpecResults('motion', { round: roundName(), seed: SEED, biomes: per }, rows);
  for (let b = 0; b < 6; b++) for (const f of [`strip-b${b}.png`, `slit-b${b}-r612.png`]) expect.soft(checkImage(roundFile(f)).ok, f).toBe(true);
  for (const r of rows) if (!r.reportOnly) expect.soft(r.pass, `${r.gate} worst ${r.value} at ${r.worst}`).toBe(true);
});
