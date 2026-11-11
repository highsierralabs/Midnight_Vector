// A4 and A7: 180 samples of the 36 real pairs plus 12 day-phase samples, the stills gates, and the review sheets
// (plan M1, "Captures per sample" and "Sheets"). Artifacts are written before any assertion, so a red run still
// leaves everything to look at. Gates read tier 3, asserted.
import { createHash, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BIOME_NAMES, PALETTE_NAMES } from '../../src/contracts/index';
import { test, expect } from '../support/pw';
import { buildCombos, type NamedSample } from './support/combos';
import { ART_SEED, POSE_TICK, frame, goto, openHarness, forceBend, shipProjection, type Rgba } from './support/capture';
import {
  nearWhitePct, meanChroma, centreHaze, hazeLiftWhole, floorBlack, litSaturation, clippedPct, bandingRobust, discOcclusion,
  propCoverage, emptyColumns, columnCoverage, median, shipMask, discMask, rasterTriangles, maskCount,
} from './support/metrics';
import { decodePng, encodePng } from './support/png';
import { flood, lift, dim, desat, toward, glow } from './support/plant';
import { gateRow, roundDir, roundFile, roundName, baseRound, ART_ROOT, writeSpecResults, checkImage, type GateRow } from './support/round';
import { downscale, crop, stretch, writePng, writeSheet, type Tile } from './support/sheet';
import { LIMITS, B1_BOX, B1_MIN_LEVELS, CAM, CENTRE_R, HORIZON_LAST_ROW, FLOOR_FIRST_ROW } from './support/thresholds';

const SEED = Number(process.env['TERRAIN_SEED'] ?? ART_SEED);
const TILE_ONLY = process.env['TERRAIN_TILE_ONLY'] === '1' || SEED !== ART_SEED;
/** Drill runs only (M3): restrict the samples to one biome or one palette. No sheets are written then. */
const ONLY_BIOME = process.env['TERRAIN_ONLY_BIOME'] !== undefined ? Number(process.env['TERRAIN_ONLY_BIOME']) : null;
const ONLY_PALETTE = process.env['TERRAIN_ONLY_PALETTE'] !== undefined ? Number(process.env['TERRAIN_ONLY_PALETTE']) : null;
const PARTIAL = ONLY_BIOME !== null || ONLY_PALETTE !== null;
const CANYON = 3;
/** M2 calibration: also measure image-space plants on every pair sample's real frames. */
const CALIBRATE = process.env['TERRAIN_CALIBRATE'] === '1';

interface M {
  id: string; kind: string; palette: number; biome: number; chunk: number; local: number; tick: number; into: number; dayPhase: number;
  W1: number; W2: number; W4: number; W5: number; C1: number;
  W3?: number; hazeWhole?: number; B1?: number; B1levels?: number[]; B1cols?: number[]; O1?: number; O1withShip?: number; O1oldMask?: number; shipOutside?: number; D1?: number; D2?: number; cols?: number[];
  ms: number;
  plants?: Record<string, Record<string, number>>;
}

const label = (s: { palette: number; biome: number }): string => `${PALETTE_NAMES[s.palette]} / ${BIOME_NAMES[s.biome]}`;

/**
 * A24 (Decision log): O1's ship mask, a fixed artifact. Made once by the `ship mask: write` test below from the ship's own
 * projected geometry at POSE_TICK on ART_SEED's page (body and engine glow, the union over the 36 tile samples, dilated by
 * `dilate` px), and never rebuilt from the frames under test. Every sheet36 run checks the file's sha256 and pixel counts, and
 * that each sample's live projection and pose match it; a change to the ship's geometry or pose fails here until the artifact is
 * deliberately rewritten (TERRAIN_SHIPMASK_WRITE=1) and these constants updated, with a Decision log entry.
 */
const SHIP_MASK = {
  file: 'tests/art/fixtures/ship-mask-seed1985-tick2717.png',
  // Written 2026-11-07T22:5xZ (round op1, DI-118): 142 triangles in 2 meshes (the closed hull), pose identical on all 36 tiles, bend
  // a from -7.7e-5 to 7.1e-5. The ship flies the swooping lane at y 10.13 here, and with the camera's height follow at .15 its
  // projection lies wholly on the disc. Was (a24, 03:43Z): sha256 3464a733..., 130 triangles, 12820 px, 5490 on the disc, y 7.46.
  sha256: 'aad039b3048e9e259b3802a80fa7c5f19c220eae4e69c82b07281e82ff31e1d7',
  px: 22361,
  discPx: 22361,
  dilate: 2,
  pose: { x: -1.7631150484085083, y: 10.129947662353516, bank: -0.06398504227399826, pitch: 0.05664439499378204 },
} as const;
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadShipMask(): Uint8Array {
  const path = join(REPO, SHIP_MASK.file);
  if (!existsSync(path)) throw new Error(`sheet36: the fixed ship mask ${SHIP_MASK.file} is missing (write it with TERRAIN_SHIPMASK_WRITE=1)`);
  const bytes = readFileSync(path);
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== SHIP_MASK.sha256) throw new Error(`sheet36: ${SHIP_MASK.file} sha256 ${sha}, expected ${SHIP_MASK.sha256}: the fixed ship mask changed`);
  const png = decodePng(bytes);
  if (png.w !== 1920 || png.h !== 1080) throw new Error(`sheet36: ship mask is ${png.w}x${png.h}`);
  const m = new Uint8Array(png.w * png.h);
  for (let p = 0; p < m.length; p++) m[p] = png.rgba[p * 4]! > 127 ? 1 : 0;
  const px = maskCount(m), discPx = maskCount(m, discMask(png.w, png.h, CAM));
  if (px !== SHIP_MASK.px || discPx !== SHIP_MASK.discPx) throw new Error(`sheet36: ship mask counts ${px} and ${discPx} on the disc, expected ${SHIP_MASK.px} and ${SHIP_MASK.discPx}`);
  return m;
}

test('sheet36: 180 samples, stills gates, contact sheets', async ({ page, browser }, info) => {
  test.setTimeout(2_400_000);
  const combos = buildCombos(SEED);
  const o = await openHarness(page, info, { seed: SEED, tier: 3, period: 0 });
  const st = await page.evaluate(() => window.__mv!.stats());
  expect(st.tier, 'gates read tier 3').toBe(3);
  expect([st.width, st.height]).toEqual([1920, 1080]);
  const round = roundName();
  const tilesDir = roundDir(`tiles-seed${SEED}`);
  console.log(`sheet36 round ${round} seed ${SEED} renderer ${o.renderer}${TILE_ONLY ? ' (tiles only)' : ''}`);

  const list: NamedSample[] = (TILE_ONLY ? combos.pairs.map((p) => p.tile) : [...combos.samples, ...combos.day])
    .filter((s) => (ONLY_BIOME === null || s.biome === ONLY_BIOME) && (ONLY_PALETTE === null || s.palette === ONLY_PALETTE));
  if (PARTIAL) console.log(`sheet36 PARTIAL drill run: biome ${ONLY_BIOME ?? 'all'}, palette ${ONLY_PALETTE ?? 'all'}, ${list.length} samples, no sheets`);
  // The ship's screen mask at the fixed pose. In DEMO the autopilot flies at y 7.4 or more, so the ship stands on the horizon in
  // front of the disc's lower edge in every sample. O1 is about scenery and items under the keep-out, so it excludes the ship.
  // A24 (Decision log): the mask is a fixed artifact, made once from the ship's own projected geometry (shipProjection) and checked
  // here by hash and pixel count, never rebuilt from the frames under test; every sample's live projection must lie inside it.
  // At another seed the pose differs, so there the mask is that page's live projection, dilated the same way, and says so.
  const dm = discMask(1920, 1080, CAM);
  let ship: Uint8Array;
  let shipSource: string;
  if (SEED === ART_SEED) {
    ship = loadShipMask();
    shipSource = `fixed artifact ${SHIP_MASK.file}, sha256 ${SHIP_MASK.sha256.slice(0, 12)}...`;
  } else {
    const ref = combos.pairs.find((p) => p.palette === 0 && p.biome === 0)!.tile;
    await goto(page, ref);
    await frame(page, ref, { post: 'bare' });
    const pr = await shipProjection(page);
    ship = rasterTriangles(pr.w, pr.h, pr.xy, SHIP_MASK.dilate);
    shipSource = `live projection at seed ${SEED}, not the fixed artifact (its pose is seed ${ART_SEED}'s)`;
  }
  const shipAll = maskCount(ship), shipN = maskCount(ship, dm), discN = maskCount(dm);
  console.log(`sheet36 ship mask: ${shipSource}: ${shipAll} px, ${shipN} of the disc's ${discN} px above the horizon (${(shipN / discN * 100).toFixed(2)}%)`);
  writePng(roundFile('ship-mask.png'), { w: 1920, h: 1080, rgba: Uint8Array.from({ length: ship.length * 4 }, (_, i) => (i % 4 === 3 ? 255 : i % 4 === 0 ? (ship[i >> 2] ? 255 : 0) : i % 4 === 2 ? (dm[i >> 2] ? 120 : 0) : 0)) });
  // The r04 mask, superseded, kept only to print O1oldMask beside O1 at the same state.
  const shipA = combos.pairs.find((p) => p.palette === 0 && p.biome === 0)!.tile, shipB = combos.pairs.find((p) => p.palette === 0 && p.biome === 4)!.tile;
  await goto(page, shipA);
  const sa = await frame(page, shipA, { post: 'bare' }), sa0 = await frame(page, shipA, { post: 'bare', layers: { props: false } });
  await goto(page, shipB);
  const sb = await frame(page, shipB, { post: 'bare' }), sb0 = await frame(page, shipB, { post: 'bare', layers: { props: false } });
  const shipOld = shipMask(sa.w, sa.h, sa.rgba, sa0.rgba, sb.rgba, sb0.rgba);
  console.log(`sheet36 r04 mask (superseded, printed only): ${maskCount(shipOld)} px, ${maskCount(shipOld, dm)} of the disc, ${maskCount(Uint8Array.from(shipOld, (v, p) => (v && !ship[p] ? 1 : 0)), dm)} of them outside the fixed mask`);
  const shipCheck = { samples: 0, worstOutside: 0, worstAt: '', poseOff: 0, poseWorst: 0 };
  const per: M[] = [];
  const tiles = new Map<string, Rgba>();
  const tileKey = (p: number, b: number): string => `p${p}b${b}`;
  const t0 = Date.now();
  for (const s of list) {
    await goto(page, s);
    const full = await frame(page, s, { post: 'full' });
    const m: M = {
      id: s.id, kind: s.kind, palette: s.palette, biome: s.biome, chunk: s.chunk, local: s.local, tick: s.tick, into: s.into, dayPhase: s.dayPhase,
      W1: nearWhitePct(full.w, full.h, full.rgba), W2: meanChroma(full.w, full.h, full.rgba),
      W4: floorBlack(full.w, full.h, full.rgba, FLOOR_FIRST_ROW), W5: litSaturation(full.w, full.h, full.rgba), C1: clippedPct(full.w, full.h, full.rgba),
      ms: full.ms,
    };
    if (s.kind === 'pair') {
      const min = await frame(page, s, { post: 'min' });
      const min0 = await frame(page, s, { post: 'min', feel: { bloomGain: 0 } });
      const bareAll = await frame(page, s, { post: 'bare' });
      // A24: the ship as drawn in this very frame, projected from its own geometry, must lie inside the fixed mask.
      const proj = await shipProjection(page);
      const shipOutside = maskCount(Uint8Array.from(rasterTriangles(proj.w, proj.h, proj.xy), (v, p) => (v && !ship[p] ? 1 : 0)));
      shipCheck.samples++;
      if (shipOutside > shipCheck.worstOutside) { shipCheck.worstOutside = shipOutside; shipCheck.worstAt = s.id; }
      if (SEED === ART_SEED) {
        const off = Math.max(Math.abs(proj.pos[0]! - SHIP_MASK.pose.x), Math.abs(proj.pos[1]! - SHIP_MASK.pose.y), Math.abs(proj.rot[0]! - SHIP_MASK.pose.bank), Math.abs(proj.rot[1]! - SHIP_MASK.pose.pitch));
        if (off > 1e-5) shipCheck.poseOff++;
        shipCheck.poseWorst = Math.max(shipCheck.poseWorst, off);
      }
      const bareNoProps = await frame(page, s, { post: 'bare', layers: { props: false } });
      const bareSky = await frame(page, s, { post: 'bare', layers: { terrain: false, props: false, fx: false } });
      m.W3 = centreHaze(min.w, min.h, min.rgba, min0.rgba, CENTRE_R);
      m.hazeWhole = hazeLiftWhole(min.w, min.h, min.rgba, min0.rgba);
      // B1 reads the sky alone under `min`, so terrain, beams and saucers in the crop cannot enter it; stars are
      // rejected per column by bandingRobust (Decision log, M2).
      const minSky = await frame(page, s, { post: 'min', layers: { terrain: false, props: false, fx: false } });
      const band = bandingRobust(minSky.w, minSky.h, minSky.rgba, B1_BOX);
      m.B1levels = band.map((c) => c.levels);
      m.B1cols = band.map((c) => c.cols);
      const counted = band.filter((c) => c.levels >= B1_MIN_LEVELS && c.cols >= 16).map((c) => c.changesPerLevel);
      m.B1 = counted.length > 0 ? Math.min(...counted) : Number.POSITIVE_INFINITY;
      m.O1 = discOcclusion(bareAll.w, bareAll.h, bareAll.rgba, bareSky.rgba, CAM, ship);
      m.O1withShip = discOcclusion(bareAll.w, bareAll.h, bareAll.rgba, bareSky.rgba, CAM);
      m.O1oldMask = discOcclusion(bareAll.w, bareAll.h, bareAll.rgba, bareSky.rgba, CAM, shipOld);
      m.shipOutside = shipOutside;
      m.D1 = propCoverage(bareAll.w, bareAll.h, bareAll.rgba, bareNoProps.rgba, HORIZON_LAST_ROW);
      m.D2 = emptyColumns(bareAll.w, bareAll.h, bareAll.rgba, bareNoProps.rgba, HORIZON_LAST_ROW);
      m.cols = columnCoverage(bareAll.w, bareAll.h, bareAll.rgba, bareNoProps.rgba, HORIZON_LAST_ROW).map((v) => Math.round(v * 1e4) / 1e4);
      if (CALIBRATE) {
        // What each plant does to the gates on this real frame: the "mildest plant that should fail" side of M2.
        const stat = (f: Rgba): Record<string, number> => ({
          W1: nearWhitePct(f.w, f.h, f.rgba), W2: meanChroma(f.w, f.h, f.rgba), W4: floorBlack(f.w, f.h, f.rgba, FLOOR_FIRST_ROW),
          W5: litSaturation(f.w, f.h, f.rgba), C1: clippedPct(f.w, f.h, f.rgba),
        });
        const fl = flood(full), flMin = flood(min);
        m.plants = {
          flood: { ...stat(fl), W3: centreHaze(min.w, min.h, flMin.rgba, min0.rgba, CENTRE_R), hazeWhole: hazeLiftWhole(min.w, min.h, flMin.rgba, min0.rgba) },
          glow: { ...stat(glow(full)), W3: centreHaze(min.w, min.h, glow(min).rgba, min0.rgba, CENTRE_R) },
          'lift.08': stat(lift(full, 0.08)), 'dim.6': stat(dim(full, 0.6)), 'desat.4': stat(desat(full, 0.4)),
          'desat.2': stat(desat(full, 0.2)), 'toward.15': stat(toward(full, 0.15)),
        };
      }
      if (s.into === combos.pairs.find((p) => p.palette === s.palette && p.biome === s.biome)!.tile.into) {
        const t = downscale(full, 3);
        tiles.set(tileKey(s.palette, s.biome), t);
        writePng(join(tilesDir, `${tileKey(s.palette, s.biome)}.png`), t);
        if (s.palette === 0 && s.biome === 0) {
          // Reference crops at 1:1 (plan M1 sheet list), from the Sunset Drive / Boulevard tile.
          writePng(roundFile('crop-ref-horizon.png'), crop(full, { x0: 480, y0: 390, x1: 1440, y1: 790 }));
          writePng(roundFile('crop-ref-far.png'), crop(full, { x0: 0, y0: 360, x1: 960, y1: 760 }));
          writePng(roundFile('crop-ref-floor.png'), crop(full, { x0: 480, y0: 680, x1: 1440, y1: 1080 }));
          writePng(roundFile('crop-ref-sky-stretched.png'), stretch(crop(min, { x0: 0, y0: 0, x1: 960, y1: 400 })));
        }
      }
    }
    per.push(m);
    if (per.length % 24 === 0) console.log(`sheet36 ${per.length}/${list.length} samples, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  console.log(`sheet36 samples=${per.length} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

  // ---- B1's negative control (T04's A10n): the same sky with post off has no dither, so it must read under 1.3 ----
  const b1control: { v: number; at: string }[] = [];
  if (!TILE_ONLY && !PARTIAL) {
    for (let p = 0; p < 6; p++) {
      const s = combos.pairs.find((x) => x.palette === p && x.biome === 0)!.tile;
      await goto(page, s);
      const off = await frame(page, s, { post: 'off', layers: { terrain: false, props: false, fx: false } });
      const band = bandingRobust(off.w, off.h, off.rgba, B1_BOX).filter((c) => c.levels >= B1_MIN_LEVELS && c.cols >= 16).map((c) => c.changesPerLevel);
      b1control.push({ v: band.length ? Math.max(...band) : Number.NaN, at: `${label(s)} post off, sky only, highest channel` });
    }
  }

  // ---- sheets ----
  const tile320 = (p: number, b: number): Rgba => downscale(tiles.get(tileKey(p, b))!, 2);
  const sheet: Tile[] = [];
  if (!PARTIAL) {
    for (let p = 0; p < 6; p++) for (let b = 0; b < 6; b++) sheet.push({ img: tile320(p, b), label: `${PALETTE_NAMES[p]} / ${BIOME_NAMES[b]}` });
    await writeSheet(browser, sheet, { cols: 6, tileW: 320, tileH: 180, path: roundFile(SEED === ART_SEED ? 'sheet36.png' : `sheet36-seed${SEED}.png`), title: `sheet36 ${round} seed ${SEED}: rows palette, columns biome, tile = into 38` });
  }
  if (!TILE_ONLY && !PARTIAL) {
    for (let p = 0; p < 6; p++) {
      await writeSheet(browser, [0, 1, 2, 3, 4, 5].map((b) => ({ img: tiles.get(tileKey(p, b))!, label: label({ palette: p, biome: b }) })), { cols: 3, tileW: 640, tileH: 360, path: roundFile(`pal-${p}.png`), title: `pal-${p} ${PALETTE_NAMES[p]} ${round}` });
    }
    for (let b = 0; b < 6; b++) {
      await writeSheet(browser, [0, 1, 2, 3, 4, 5].map((p) => ({ img: tiles.get(tileKey(p, b))!, label: label({ palette: p, biome: b }) })), { cols: 3, tileW: 640, tileH: 360, path: roundFile(`biome-${b}.png`), title: `biome-${b} ${BIOME_NAMES[b]} ${round}` });
    }
    // Blind sheet: three tiles per biome, palettes drawn by crypto, shuffled; the key is written and never printed.
    const blind: { p: number; b: number }[] = [];
    for (let b = 0; b < 6; b++) {
      const ps = [0, 1, 2, 3, 4, 5];
      for (let k = 0; k < 3; k++) blind.push({ p: ps.splice(randomInt(ps.length), 1)[0]!, b });
    }
    for (let i = blind.length - 1; i > 0; i--) { const j = randomInt(i + 1); const t = blind[i]!; blind[i] = blind[j]!; blind[j] = t; }
    await writeSheet(browser, blind.map((x, i) => ({ img: tile320(x.p, x.b), label: `${i + 1}` })), { cols: 6, tileW: 320, tileH: 180, path: roundFile('biome-blind.png') });
    writeFileSync(roundFile('biome-blind-key.json'), JSON.stringify(blind.map((x, i) => ({ tile: i + 1, biome: BIOME_NAMES[x.b], palette: PALETTE_NAMES[x.p] }))));
    // DI-101's validated format, for the independent reviewer (M9): the same 18 tiles, order and numbers, as two
    // 3 x 3 sheets of 640 x 360 at native size, PNG only. The 6 x 3 sheet above stays as an overview.
    for (let s = 0; s < 2; s++) {
      await writeSheet(browser, blind.slice(s * 9, s * 9 + 9).map((x, i) => ({ img: tiles.get(tileKey(x.p, x.b))!, label: `${s * 9 + i + 1}` })), { cols: 3, tileW: 640, tileH: 360, path: roundFile(`biome-blind-${s + 1}.png`), html: false });
    }

    // A/B against the base round's tiles for every pair, where it has them.
    const base = baseRound();
    if (base) {
      const bdir = join(ART_ROOT, base, `tiles-seed${SEED}`);
      for (let p = 0; p < 6; p++) for (let b = 0; b < 6; b++) {
        const f = join(bdir, `${tileKey(p, b)}.png`);
        if (!existsSync(f)) continue;
        const was = decodePng(readFileSync(f));
        await writeSheet(browser, [{ img: was, label: `${base} ${label({ palette: p, biome: b })}` }, { img: tiles.get(tileKey(p, b))!, label: `${round}` }], { cols: 2, tileW: 640, tileH: 360, path: roundFile(`ab-${tileKey(p, b)}.png`) });
      }
    }
  }

  // ---- gates ----
  const pairsM = per.filter((m) => m.kind === 'pair');
  const at = (m: M): string => `${m.id} (${label(m)}, ${m.chunk}/${m.local} t${m.tick})`;
  const rows: GateRow[] = [];
  rows.push(gateRow('W1', LIMITS.W1, per.map((m) => ({ v: m.W1, at: at(m) })), `${per.length} samples incl. ${per.length - pairsM.length} day-phase`));
  rows.push(gateRow('W2', LIMITS.W2, per.map((m) => ({ v: m.W2, at: at(m) }))));
  rows.push(gateRow('W3', LIMITS.W3, pairsM.map((m) => ({ v: m.W3!, at: at(m) }))));
  rows.push(gateRow('hazeWhole', { value: 20, dir: 'max', reportOnly: true }, pairsM.map((m) => ({ v: m.hazeWhole!, at: at(m) })), 'section 8.1 whole-frame haze lift, printed for DR1'));
  rows.push(gateRow('W4', LIMITS.W4, pairsM.map((m) => ({ v: m.W4, at: at(m) }))));
  rows.push(gateRow('W5', LIMITS.W5, pairsM.map((m) => ({ v: m.W5, at: at(m) })), LIMITS.W5.reportOnly ? 'report-only: does not separate on real frames (Decision log, M2)' : undefined));
  rows.push(gateRow('C1', LIMITS.C1, pairsM.map((m) => ({ v: m.C1, at: at(m) }))));
  rows.push(gateRow('B1', LIMITS.B1, pairsM.map((m) => ({ v: m.B1!, at: at(m) })), `channels spanning >= ${B1_MIN_LEVELS} levels; Infinity when none does`));
  // O1 per pair is the least occluded of its five samples: what persists through a zone (terrain and scenery under
  // the keep-out), not an item or fence that happens to cross the disc in one sample (Decision log, M2).
  const pairMin = (keep: (b: number) => boolean): { v: number; at: string }[] => combos.pairs.filter((p) => keep(p.biome) && pairsM.some((m) => m.palette === p.palette && m.biome === p.biome)).map((p) => {
    const ms = pairsM.filter((m) => m.palette === p.palette && m.biome === p.biome);
    const best = ms.reduce((a, b) => (b.O1! < a.O1! ? b : a));
    return { v: best.O1!, at: `${label(p)} least of 5 at ${best.id}` };
  });
  rows.push(gateRow('O1', LIMITS.O1, pairMin((b) => b !== CANYON), 'non-canyon, per pair, least occluded of 5 samples, the ship excluded'));
  rows.push(gateRow('O1withShip', { value: LIMITS.O1.value, dir: 'max', reportOnly: true }, combos.pairs.filter((p) => p.biome !== CANYON && pairsM.some((m) => m.palette === p.palette && m.biome === p.biome)).map((p) => {
    const ms = pairsM.filter((m) => m.palette === p.palette && m.biome === p.biome);
    const best = ms.reduce((a, b) => (b.O1withShip! < a.O1withShip! ? b : a));
    return { v: best.O1withShip!, at: `${label(p)} least of 5 at ${best.id}` };
  }), 'as O1 with the ship counted, printed'));
  rows.push(gateRow('O1sample', { value: LIMITS.O1.value, dir: 'max', reportOnly: true }, pairsM.filter((m) => m.biome !== CANYON).map((m) => ({ v: m.O1!, at: at(m) })), 'every non-canyon sample, items included, printed'));
  rows.push(gateRow('O1canyon', { value: LIMITS.O1.value, dir: 'max', reportOnly: true }, pairMin((b) => b === CANYON), 'Cyber Canyon per pair, printed and viewed'));
  rows.push(gateRow('O1oldMask', { value: LIMITS.O1.value, dir: 'max', reportOnly: true }, combos.pairs.filter((p) => p.biome !== CANYON && pairsM.some((m) => m.palette === p.palette && m.biome === p.biome)).map((p) => {
    const ms = pairsM.filter((m) => m.palette === p.palette && m.biome === p.biome);
    const best = ms.reduce((a, b) => (b.O1oldMask! < a.O1oldMask! ? b : a));
    return { v: best.O1oldMask!, at: `${label(p)} least of 5 at ${best.id}` };
  }), 'as O1 with the superseded r04 mask, printed for comparison only'));
  // A24: the ship drawn in each frame lies inside the fixed mask (pixels of its live projection outside it), and its pose is the
  // one the mask was made at. Gated at 0: a non-zero value means the mask no longer describes the ship, not that the art is wrong.
  rows.push(gateRow('O1shipFit', { value: 0, dir: 'max', reportOnly: SEED !== ART_SEED }, pairsM.map((m) => ({ v: m.shipOutside!, at: at(m) })), `live ship projection outside the mask, px; ${shipSource}`));
  if (SEED === ART_SEED) rows.push(gateRow('O1shipPose', { value: 1e-5, dir: 'max' }, [{ v: shipCheck.poseWorst, at: `${shipCheck.poseOff} of ${shipCheck.samples} samples off` }], 'largest |pose - the mask\'s pose| over x, y, bank, pitch'));
  if (b1control.length) rows.push(gateRow('B1control', { value: LIMITS.B1.value, dir: 'max', reportOnly: true }, b1control, 'must stay under the B1 limit: post off has no dither'));
  rows.push(gateRow('D1', LIMITS.D1, pairsM.map((m) => ({ v: m.D1!, at: at(m) }))));
  const all = median(pairsM.map((m) => m.D1!));
  const biomeMed = [0, 1, 2, 3, 4, 5].map((b) => median(pairsM.filter((m) => m.biome === b).map((m) => m.D1!)));
  rows.push(gateRow('D1ratio', LIMITS.D1ratio, biomeMed.map((v, b) => ({ v: v / all, at: `${BIOME_NAMES[b]} median ${v.toFixed(4)} of ${all.toFixed(4)}` }))));
  rows.push(gateRow('D2', LIMITS.D2, pairsM.map((m) => ({ v: m.D2!, at: at(m) }))));

  // ---- worst frames by number, re-rendered at 1920 x 1080 ----
  const worstOf: [string, (m: M) => number, 'full' | 'min', M[]][] = [
    ['W1', (m) => m.W1, 'full', per], ['W2', (m) => -m.W2, 'full', per], ['W3', (m) => m.W3!, 'min', pairsM],
    ['W4', (m) => m.W4, 'full', pairsM], ['W5', (m) => -m.W5, 'full', pairsM], ['C1', (m) => m.C1, 'full', pairsM],
    ['B1', (m) => -m.B1!, 'min', pairsM], ['O1', (m) => m.O1!, 'full', pairsM.filter((m) => m.biome !== CANYON)],
    ['D1', (m) => -m.D1!, 'full', pairsM], ['D2', (m) => m.D2!, 'full', pairsM],
  ];
  const worstIndex: string[] = [];
  if (!TILE_ONLY && !PARTIAL) {
    for (const [g, bad, post, pool] of worstOf) {
      const top = [...pool].sort((a, b) => bad(b) - bad(a)).slice(0, 3);
      for (let n = 0; n < top.length; n++) {
        const m = top[n]!;
        const s = list.find((x) => x.id === m.id)!;
        await goto(page, s);
        const f = await frame(page, s, { post });
        writePng(roundFile(`worst-${g}-${n + 1}.png`), f);
        worstIndex.push(`worst-${g}-${n + 1}.png: ${at(m)} value ${Math.abs(bad(m)).toFixed(4)} (${post})`);
        if (g === 'W3' && n === 0) {
          writePng(roundFile('crop-worstW3-horizon.png'), crop(f, { x0: 480, y0: 390, x1: 1440, y1: 790 }));
          writePng(roundFile('crop-worstW3-floor.png'), crop(f, { x0: 480, y0: 680, x1: 1440, y1: 1080 }));
        }
      }
    }
    writeFileSync(roundFile('worst-index.txt'), `${worstIndex.join('\n')}\n`);
  }

  writeSpecResults(SEED === ART_SEED ? 'sheet36' : `sheet36-seed${SEED}`, { round, seed: SEED, renderer: o.renderer, shipX: o.shipX, shipY: o.shipY, samples: per }, rows);

  // ---- A4: every sheet exists, is not blank, and is at most 1920 wide ----
  const names = PARTIAL ? [] : TILE_ONLY ? [SEED === ART_SEED ? 'sheet36.png' : `sheet36-seed${SEED}.png`]
    : ['sheet36.png', ...[0, 1, 2, 3, 4, 5].flatMap((k) => [`pal-${k}.png`, `biome-${k}.png`]), 'biome-blind.png', 'biome-blind-1.png', 'biome-blind-2.png', 'crop-ref-horizon.png', 'crop-ref-far.png', 'crop-ref-floor.png', 'crop-ref-sky-stretched.png',
      ...worstOf.flatMap(([g]) => [1, 2, 3].map((n) => `worst-${g}-${n}.png`))];
  const bad: string[] = [];
  for (const n of names) {
    const c = checkImage(roundFile(n));
    if (!c.ok) bad.push(`${n}: ${c.why}`);
  }
  console.log(`A4 sheet36 images checked: ${names.length}, bad: ${bad.length}`);
  expect.soft(bad, bad.join('\n')).toEqual([]);
  for (const r of rows) if (!r.reportOnly) expect.soft(r.pass, `${r.gate} worst ${r.value} at ${r.worst}`).toBe(true);
  expect(per.length).toBeGreaterThanOrEqual(PARTIAL ? 1 : TILE_ONLY ? 36 : 180);
});

test('ship mask: write the fixed artifact from the ship alone, only with TERRAIN_SHIPMASK_WRITE=1 (A24)', async ({ page }, info) => {
  test.skip(process.env['TERRAIN_SHIPMASK_WRITE'] !== '1', 'writes tests/art/fixtures only with TERRAIN_SHIPMASK_WRITE=1');
  test.skip(SEED !== ART_SEED, 'the fixed mask is ART_SEED\'s pose');
  test.setTimeout(600_000);
  const combos = buildCombos(SEED);
  const o = await openHarness(page, info, { seed: SEED, tier: 3, period: 0 });
  const all: number[] = [];
  const poses: { id: string; pos: number[]; rot: number[]; engine: number[]; bend: number[]; tris: number; behind: number; meshes: number }[] = [];
  let ref: { core: Uint8Array; bareAll: Rgba; bareNoProps: Rgba } | null = null;
  for (const pair of combos.pairs) {
    const s = pair.tile;
    await goto(page, s);
    const bareAll = await frame(page, s, { post: 'bare' });
    const pr = await shipProjection(page);
    for (const v of pr.xy) all.push(v);
    poses.push({ id: s.id, pos: pr.pos, rot: pr.rot, engine: pr.engine, bend: pr.bend, tris: pr.triangles, behind: pr.behind, meshes: pr.meshes });
    if (pair.palette === 0 && pair.biome === 0) {
      const bareNoProps = await frame(page, s, { post: 'bare', layers: { props: false } });
      ref = { core: rasterTriangles(pr.w, pr.h, pr.xy), bareAll, bareNoProps };
    }
  }
  const p0 = poses[0]!;
  let poseSpread = 0;
  for (const p of poses) poseSpread = Math.max(poseSpread, ...p.pos.map((v, i) => Math.abs(v - p0.pos[i]!)), ...p.rot.map((v, i) => Math.abs(v - p0.rot[i]!)));
  const mask = rasterTriangles(1920, 1080, all, SHIP_MASK.dilate);
  const dm = discMask(1920, 1080, CAM);
  const rgba = new Uint8Array(1920 * 1080 * 4);
  for (let p = 0; p < mask.length; p++) { const v = mask[p] ? 255 : 0; rgba[p * 4] = v; rgba[p * 4 + 1] = v; rgba[p * 4 + 2] = v; rgba[p * 4 + 3] = 255; }
  const bytes = encodePng(1920, 1080, rgba);
  const out = join(REPO, SHIP_MASK.file);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bytes);
  const sha = createHash('sha256').update(bytes).digest('hex');
  // Validation at the reference tile (Sunset Drive / Boulevard): how much of the projected ship over the disc props really change,
  // and how much of the r04 mask on the disc lies outside the new one.
  const r = ref!;
  let core = 0, coreChanged = 0;
  for (let p = 0; p < r.core.length; p++) {
    if (!r.core[p] || !dm[p]) continue;
    core++;
    const i = p * 4;
    if (Math.abs(r.bareAll.rgba[i]! - r.bareNoProps.rgba[i]!) > 24 || Math.abs(r.bareAll.rgba[i + 1]! - r.bareNoProps.rgba[i + 1]!) > 24 || Math.abs(r.bareAll.rgba[i + 2]! - r.bareNoProps.rgba[i + 2]!) > 24) coreChanged++;
  }
  const shipA = combos.pairs.find((p) => p.palette === 0 && p.biome === 0)!.tile, shipB = combos.pairs.find((p) => p.palette === 0 && p.biome === 4)!.tile;
  await goto(page, shipB);
  const sb = await frame(page, shipB, { post: 'bare' }), sb0 = await frame(page, shipB, { post: 'bare', layers: { props: false } });
  const old = shipMask(1920, 1080, r.bareAll.rgba, r.bareNoProps.rgba, sb.rgba, sb0.rgba);
  const oldOnly = Uint8Array.from(old, (v, p) => (v && !mask[p] ? 1 : 0));
  // Overlay for viewing, 1:1 crop around the disc's foot: green the new mask's edge, red the r04 mask outside it, blue the disc edge.
  const ov = new Uint8Array(r.bareAll.rgba);
  const edge = (m: Uint8Array, p: number): boolean => !!m[p] && (!m[p - 1] || !m[p + 1] || !m[p - 1920] || !m[p + 1920]);
  for (let p = 1921; p < mask.length - 1921; p++) {
    const i = p * 4;
    if (edge(mask, p)) { ov[i] = 0; ov[i + 1] = 255; ov[i + 2] = 0; }
    else if (oldOnly[p]) { ov[i] = 255; ov[i + 1] = 0; ov[i + 2] = 0; }
    else if (edge(dm, p)) { ov[i] = 60; ov[i + 1] = 120; ov[i + 2] = 255; }
  }
  writePng(roundFile('ship-mask-check.png'), crop({ w: 1920, h: 1080, rgba: ov }, { x0: 600, y0: 380, x1: 1320, y1: 720 }));
  writePng(roundFile('ship-mask-check-full.png'), { w: 1920, h: 1080, rgba: ov });
  writePng(roundFile('ship-mask-ref-bare.png'), crop(r.bareAll, { x0: 600, y0: 380, x1: 1320, y1: 720 }));
  console.log(`SHIPMASK file ${SHIP_MASK.file} sha256 ${sha} px ${maskCount(mask)} discPx ${maskCount(mask, dm)} disc ${maskCount(dm)} dilate ${SHIP_MASK.dilate}`);
  console.log(`SHIPMASK pose ${JSON.stringify({ x: p0.pos[0], y: p0.pos[1], z: p0.pos[2], bank: p0.rot[0], pitch: p0.rot[1] })} spread over 36 tiles ${poseSpread}; POSE_TICK ${POSE_TICK}; openHarness ship ${o.shipX}, ${o.shipY}`);
  console.log(`SHIPMASK per tile: triangles ${[...new Set(poses.map((p) => p.tris))].join(',')}, behind ${[...new Set(poses.map((p) => p.behind))].join(',')}, meshes ${[...new Set(poses.map((p) => p.meshes))].join(',')}, engine ${JSON.stringify([...new Set(poses.map((p) => p.engine.map((v) => v.toFixed(4)).join('/')))])}`);
  console.log(`SHIPMASK bend a range ${Math.min(...poses.map((p) => p.bend[0]!))} .. ${Math.max(...poses.map((p) => p.bend[0]!))}, c range ${Math.min(...poses.map((p) => p.bend[1]!))} .. ${Math.max(...poses.map((p) => p.bend[1]!))}`);
  console.log(`SHIPMASK check at ${shipA.id}: projected ship core on the disc ${core} px, of them changed by props > 24: ${coreChanged} (${(coreChanged / Math.max(1, core) * 100).toFixed(1)}%); r04 mask ${maskCount(old)} px, ${maskCount(old, dm)} on the disc, ${maskCount(oldOnly, dm)} of those outside the new mask, ${maskCount(oldOnly)} outside it in all`);
  expect(maskCount(mask)).toBeGreaterThan(1000);
});

test('bend: six biomes at the section 5.3 extreme', async ({ page, browser }, info) => {
  test.skip(TILE_ONLY, 'tiles-only run');
  test.setTimeout(300_000);
  const combos = buildCombos(SEED);
  await openHarness(page, info, { seed: SEED, tier: 3, period: 0 });
  await forceBend(page, 8e-5, -1.2e-5);
  const tiles: Tile[] = [];
  for (let b = 0; b < 6; b++) {
    const s = combos.pairs.find((p) => p.palette === 0 && p.biome === b)!.tile;
    await goto(page, s);
    const f = await frame(page, s, { post: 'full' });
    tiles.push({ img: downscale(f, 3), label: `${label(s)} bend (8e-5, -1.2e-5)` });
  }
  await writeSheet(browser, tiles, { cols: 3, tileW: 640, tileH: 360, path: roundFile('bend.png'), title: `bend ${roundName()}: verticals hold, the road still leads to the disc` });
  expect(checkImage(roundFile('bend.png')).ok).toBe(true);
});

test('diag: O1 and D1 difference masks for one sample, only with TERRAIN_DIAG', async ({ page }, info) => {
  const wantList = process.env['TERRAIN_DIAG'];
  test.skip(!wantList, 'runs only with TERRAIN_DIAG=<sample id>[,<sample id>...]');
  test.setTimeout(300_000);
  const combos = buildCombos(SEED);
  await openHarness(page, info, { seed: SEED, tier: 3, period: 0 });
  for (const want of wantList!.split(',')) {
  const s = [...combos.samples, ...combos.day].find((x) => x.id === want);
  if (!s) throw new Error(`no sample ${want}`);
  await goto(page, s);
  const all = await frame(page, s, { post: 'bare' });
  const noProps = await frame(page, s, { post: 'bare', layers: { props: false } });
  const noTerrain = await frame(page, s, { post: 'bare', layers: { terrain: false } });
  const sky = await frame(page, s, { post: 'bare', layers: { terrain: false, props: false, fx: false } });
  // Red: differs from sky only by > 24 (O1's test); green: props change it by > 12 (D1's test); blue: the analytic disc above the horizon.
  const mask = new Uint8Array(all.rgba.length);
  const disc = discOcclusion(all.w, all.h, all.rgba, sky.rgba, CAM);
  const discProps = discOcclusion(all.w, all.h, all.rgba, noProps.rgba, CAM);
  const discTerrain = discOcclusion(all.w, all.h, all.rgba, noTerrain.rgba, CAM);
  const { discMask } = await import('./support/metrics');
  const dm = discMask(all.w, all.h, CAM);
  for (let p = 0; p < all.w * all.h; p++) {
    const i = p * 4;
    const d = (a: Uint8Array, b: Uint8Array, t: number): boolean => Math.abs(a[i]! - b[i]!) > t || Math.abs(a[i + 1]! - b[i + 1]!) > t || Math.abs(a[i + 2]! - b[i + 2]!) > t;
    mask[i] = d(all.rgba, sky.rgba, 24) ? 255 : 0;
    mask[i + 1] = d(all.rgba, noProps.rgba, 12) ? 255 : 0;
    mask[i + 2] = dm[p] ? 120 : 0;
    mask[i + 3] = 255;
  }
  writePng(roundFile(`diag-${want}-mask.png`), { w: all.w, h: all.h, rgba: mask });
  writePng(roundFile(`diag-${want}-bare.png`), all);
  writePng(roundFile(`diag-${want}-sky.png`), sky);
  console.log(`diag ${want}: O1 all vs sky ${disc.toFixed(4)}; disc share changed by props ${discProps.toFixed(4)}; by terrain ${discTerrain.toFixed(4)}`);
  }
});
