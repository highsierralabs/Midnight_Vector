// The planted sheet that tests the reviewer (plan M2 step 3, A5). Only with TERRAIN_PLANT=1. Tiles come from the
// round's real tiles; 6 to 10 of them are damaged, chosen and shuffled with crypto. The key is written to
// plant-key.json and never printed: open plant-sheet.png, write plant-answer.txt, and only then open the key.
//
// The second test is DI-101's retest, only with TERRAIN_PLANT_DIR=<name>: three sheets of 3 x 3 tiles at 640 x 360,
// native size, in a fresh folder test-results/T11-art/u7-retest/<name>/ holding only the sheets, README.txt and the
// key, whose file name is random and never printed.
import { randomBytes, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BIOME_NAMES, PALETTE_NAMES } from '../../src/contracts/index';
import { test, expect } from '../support/pw';
import { buildCombos } from './support/combos';
import { ART_SEED, frame, goto, openHarness } from './support/capture';
import { decodePng } from './support/png';
import { applyPlant, STRONG, WEAK, type PlantKind } from './support/plant';
import { ART_ROOT, roundDir, roundFile, checkImage } from './support/round';
import { downscale, writeSheet, type Rgba } from './support/sheet';

const SEED = Number(process.env['TERRAIN_SEED'] ?? ART_SEED);
/** Names of the sheet and key, so a retry never reuses a file a reviewer's tools have already shown (Surprises, M2). */
const TAG = process.env['TERRAIN_PLANT_TAG'] ? `-${process.env['TERRAIN_PLANT_TAG']}` : '';

test('planted sheet: 6 to 10 damaged tiles, key hidden', async ({ page, browser }, info) => {
  test.skip(process.env['TERRAIN_PLANT'] !== '1' || !!process.env['TERRAIN_PLANT_DIR'], 'runs only with TERRAIN_PLANT=1 and no TERRAIN_PLANT_DIR');
  test.setTimeout(300_000);
  const combos = buildCombos(SEED);
  const dir = roundDir(`tiles-seed${SEED}`);
  const tiles: { p: number; b: number; img: Rgba }[] = [];
  for (let p = 0; p < 6; p++) for (let b = 0; b < 6; b++) {
    const f = join(dir, `p${p}b${b}.png`);
    if (!existsSync(f)) throw new Error(`missing ${f}: run sheet36 in this round first`);
    tiles.push({ p, b, img: decodePng(readFileSync(f)) });
  }
  const count = randomInt(6, 11);
  const order = tiles.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = randomInt(i + 1); const t = order[i]!; order[i] = order[j]!; order[j] = t; }
  const victims = new Set<number>();
  while (victims.size < count) victims.add(randomInt(36));
  const kinds: PlantKind[] = [];
  const pool: PlantKind[] = [...STRONG, ...WEAK];
  for (let k = 0; k < count; k++) kinds.push(pool[randomInt(pool.length)]!);
  // At least three strong plants and one weak one, so both figures exist.
  let strong = kinds.filter((k) => (STRONG as readonly string[]).includes(k)).length;
  for (let k = 0; k < count && strong < 3; k++) if (!(STRONG as readonly string[]).includes(kinds[k]!)) { kinds[k] = STRONG[randomInt(STRONG.length)]!; strong++; }
  if (!kinds.some((k) => (WEAK as readonly string[]).includes(k))) kinds[count - 1] = WEAK[randomInt(WEAK.length)]!;

  const needPage = kinds.includes('noprops');
  if (needPage) await openHarness(page, info, { seed: SEED, tier: 3, period: 0 });
  const key: { tile: number; pair: string; defect: string }[] = [];
  const shown: Rgba[] = [];
  let v = 0;
  for (let pos = 0; pos < 36; pos++) {
    const t = tiles[order[pos]!]!;
    let img = t.img;
    if (victims.has(pos)) {
      const kind = kinds[v++]!;
      if (kind === 'noprops') {
        const s = combos.pairs.find((x) => x.palette === t.p && x.biome === t.b)!.tile;
        await goto(page, s);
        img = downscale(await frame(page, s, { post: 'full', layers: { props: false } }), 3);
      } else {
        img = applyPlant(kind, t.img);
      }
      key.push({ tile: pos + 1, pair: `${PALETTE_NAMES[t.p]} / ${BIOME_NAMES[t.b]}`, defect: kind });
    }
    shown.push(downscale(img, 2));
  }
  await writeSheet(browser, shown.map((img, i) => ({ img, label: `${i + 1}` })), { cols: 6, tileW: 320, tileH: 180, path: roundFile(`plant-sheet${TAG}.png`) });
  writeFileSync(roundFile(`plant-key${TAG}.json`), JSON.stringify({ count, key }, null, 1));
  console.log(`plant: sheet written with hidden plants; key in ${roundFile(`plant-key${TAG}.json`)} (not printed)`);
  expect(checkImage(roundFile(`plant-sheet${TAG}.png`)).ok).toBe(true);
});

/** DI-101: sheets of 3 x 3 tiles at 640 x 360, so each sheet is 1920 x 1128, the size measured as shown unscaled. */
const RETEST_SHEETS = 3;
const RETEST_COLS = 3;
const RETEST_TILES = RETEST_SHEETS * RETEST_COLS * RETEST_COLS;

/** The reviewer's instructions. Nothing here names a defect type (plan M9 step 3 says no more than that). */
const RETEST_README = `Planted-sheet test

You are reviewing an unfinished synthwave game from images alone. You have not seen its code, history or metrics.

This folder holds three sheets: sheet-1.png, sheet-2.png and sheet-3.png. Each is 1920 x 1128 pixels: nine tiles of
640 x 360 in a 3 x 3 grid, each under a thin strip with its number. The tiles are numbered 1 to 27 across the three
sheets (sheet-1 holds 1 to 9, sheet-2 holds 10 to 18, sheet-3 holds 19 to 27). Each tile shows the game.

Some tiles have been deliberately damaged.

1. Open sheet-1.png, sheet-2.png and sheet-3.png, each at its full size. Do not open any other file, in this folder or
   anywhere else, until step 3.
2. Write answer.txt in this folder. List the tile numbers you think are damaged, one per line, each with one short line
   saying what you saw. You may mark a line "uncertain"; it still counts as a listing, for hits and for false alarms.
   If you think no tile is damaged, write that.
3. Only after answer.txt is written, open the key: the one file in this folder whose name begins with "key-". It lists
   the damaged tiles. Report your hits, your misses and your false alarms, and say what you could not judge from
   images. Do not soften.

Do not change or delete any file here other than answer.txt.
`;

test('planted retest (DI-101): three 3 x 3 sheets of 640 x 360, key hidden', async ({ page, browser }, info) => {
  const sub = process.env['TERRAIN_PLANT_DIR'];
  test.skip(!sub, 'runs only with TERRAIN_PLANT_DIR=<fresh folder name under test-results/T11-art/u7-retest>');
  if (!/^[A-Za-z0-9_-]+$/.test(sub!)) throw new Error(`TERRAIN_PLANT_DIR must be a plain name, got ${sub}`);
  test.setTimeout(300_000);
  const out = join(ART_ROOT, 'u7-retest', sub!);
  if (existsSync(out)) throw new Error(`${out} already exists: the retest folder must be fresh`);
  const combos = buildCombos(SEED);
  const dir = roundDir(`tiles-seed${SEED}`);
  const tiles: { p: number; b: number; img: Rgba }[] = [];
  for (let p = 0; p < 6; p++) for (let b = 0; b < 6; b++) {
    const f = join(dir, `p${p}b${b}.png`);
    if (!existsSync(f)) throw new Error(`missing ${f}: run sheet36 in this round first`);
    const img = decodePng(readFileSync(f));
    if (img.w !== 640 || img.h !== 360) throw new Error(`${f} is ${img.w} x ${img.h}, not 640 x 360`);
    tiles.push({ p, b, img });
  }
  // Which 27 of the 36 tiles, in what order, how many plants, where, and of which kind: all from crypto.
  const order = tiles.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = randomInt(i + 1); const t = order[i]!; order[i] = order[j]!; order[j] = t; }
  const count = randomInt(6, 11);
  const victims = new Set<number>();
  while (victims.size < count) victims.add(randomInt(RETEST_TILES));
  // Every strong kind once, so a miss of any strong kind can show; one weak; the rest from the whole pool; shuffled.
  const pool: PlantKind[] = [...STRONG, ...WEAK];
  const kinds: PlantKind[] = [...STRONG, WEAK[randomInt(WEAK.length)]!];
  while (kinds.length < count) kinds.push(pool[randomInt(pool.length)]!);
  for (let i = kinds.length - 1; i > 0; i--) { const j = randomInt(i + 1); const t = kinds[i]!; kinds[i] = kinds[j]!; kinds[j] = t; }

  await openHarness(page, info, { seed: SEED, tier: 3, period: 0 });
  const key: { tile: number; sheet: number; pair: string; defect: string }[] = [];
  const shown: Rgba[] = [];
  let v = 0;
  for (let pos = 0; pos < RETEST_TILES; pos++) {
    const t = tiles[order[pos]!]!;
    let img = t.img;
    if (victims.has(pos)) {
      const kind = kinds[v++]!;
      if (kind === 'noprops') {
        const s = combos.pairs.find((x) => x.palette === t.p && x.biome === t.b)!.tile;
        await goto(page, s);
        img = downscale(await frame(page, s, { post: 'full', layers: { props: false } }), 3);
      } else {
        img = applyPlant(kind, t.img);
      }
      key.push({ tile: pos + 1, sheet: Math.floor(pos / 9) + 1, pair: `${PALETTE_NAMES[t.p]} / ${BIOME_NAMES[t.b]}`, defect: kind });
    }
    shown.push(img);
  }
  mkdirSync(out, { recursive: true });
  const sheets: string[] = [];
  for (let s = 0; s < RETEST_SHEETS; s++) {
    const path = join(out, `sheet-${s + 1}.png`);
    await writeSheet(browser, shown.slice(s * 9, s * 9 + 9).map((img, i) => ({ img, label: `${s * 9 + i + 1}` })), { cols: RETEST_COLS, tileW: 640, tileH: 360, path, html: false });
    sheets.push(path);
  }
  const keyName = `key-${randomBytes(12).toString('hex')}.json`;
  writeFileSync(join(out, keyName), JSON.stringify({ count, key, unplanted: order.slice(0, RETEST_TILES).map((o, pos) => victims.has(pos) ? null : `${pos + 1}: ${PALETTE_NAMES[tiles[o]!.p]} / ${BIOME_NAMES[tiles[o]!.b]}`).filter((x) => x !== null), seed: SEED, tilesFrom: dir, written: new Date().toISOString() }, null, 1));
  writeFileSync(join(out, 'README.txt'), RETEST_README);
  console.log(`plant retest: ${RETEST_SHEETS} sheets and README.txt written to ${out}; key written under a name that is not printed`);
  for (const p of sheets) {
    const c = checkImage(p);
    expect(c.ok, `${p}: ${c.why}`).toBe(true);
    expect([c.w, c.h]).toEqual([1920, 3 * (360 + 16)]);
  }
});
