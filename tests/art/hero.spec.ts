// Hero disc by palette and mode on the real scene, through forceZone at one fixed zone, and the landmark RING on the
// disc outline per palette (plan M1 sheet list; A10 at M5). Each test uses a page of its own, because forceZone has no
// clearing call. Sky events (lightning, aurora, meteors) on real zones are the last test (A10, M5).
import { Biome, BIOME_NAMES, PALETTE_NAMES, type HeroMode } from '../../src/contracts/index';
import { createSkyEvents, writeSkyEvents, type SkyEvents } from '../../src/render/sky/events';
import { measureDisc } from '../e2e/lib/view';
import { test, expect } from '../support/pw';
import { buildCombos, findRing, tickFor, zoneAtNode } from './support/combos';
import { ART_SEED, frame, goto, openHarness, forceZone, at } from './support/capture';
import { discCentre, nearWhitePct, meanChroma } from './support/metrics';
import { gateRow, roundFile, roundName, writeSpecResults, checkImage, type GateRow } from './support/round';
import { downscale, writeSheet, type Tile } from './support/sheet';
import { CAM, LIMITS } from './support/thresholds';

const SEED = Number(process.env['TERRAIN_SEED'] ?? ART_SEED);
const MODES = ['banded sun', 'eclipse', 'ringed planet', 'wire moon'] as const;

test.describe.configure({ mode: 'serial' });
const rows: GateRow[] = [];
const metrics: Record<string, unknown> = {};

test('hero-palette: four modes by six palettes at one fixed zone', async ({ page, browser }, info) => {
  test.setTimeout(600_000);
  const combos = buildCombos(SEED);
  const s = combos.pairs.find((p) => p.palette === 0 && p.biome === 0)!.tile;
  await openHarness(page, info, { seed: SEED, tier: 3, period: 0 });
  await goto(page, s);
  const tiles: Tile[] = [];
  const big: Tile[][] = [[], [], [], []];
  const w1: { v: number; at: string }[] = [];
  const centre: { mode: number; palette: number; x: number; y: number; dx: number; dy: number }[] = [];
  const ana = discCentre(1920, 1080, CAM);
  for (let mode = 0; mode < 4; mode++) {
    for (let p = 0; p < 6; p++) {
      await forceZone(page, p, s.biome, mode as HeroMode);
      const f = await frame(page, s, { post: 'full' });
      w1.push({ v: nearWhitePct(f.w, f.h, f.rgba), at: `${PALETTE_NAMES[p]} mode ${mode} (${MODES[mode]})` });
      tiles.push({ img: downscale(f, 6), label: `${PALETTE_NAMES[p]} / ${MODES[mode]}` });
      big[mode]!.push({ img: downscale(f, 3), label: `${PALETTE_NAMES[p]} / ${MODES[mode]}` });
      if (mode === 0) {
        const sky = await frame(page, s, { post: 'bare', layers: { terrain: false, props: false, fx: false } });
        const d = measureDisc(sky.rgba, sky.w, sky.h, 589, 100);
        if (d) centre.push({ mode, palette: p, x: d.centreX, y: d.centreY, dx: d.centreX - ana.x, dy: d.centreY - ana.y });
      }
    }
  }
  await writeSheet(browser, tiles, { cols: 6, tileW: 320, tileH: 180, path: roundFile('hero-palette.png'), title: `hero-palette ${roundName()}: columns palette, rows mode; zone ${s.chunk} (${BIOME_NAMES[s.biome]}) via forceZone` });
  // The validated reviewer format (DI-101): one 3 x 2 sheet of 640 x 360 per mode. hero-palette.png stays as the overview.
  for (let mode = 0; mode < 4; mode++) {
    await writeSheet(browser, big[mode]!, { cols: 3, tileW: 640, tileH: 360, path: roundFile(`hero-m${mode}.png`), title: `hero-m${mode} ${roundName()}: ${MODES[mode]} on six palettes, zone ${s.chunk} (${BIOME_NAMES[s.biome]}) via forceZone` });
    expect(checkImage(roundFile(`hero-m${mode}.png`)).ok).toBe(true);
  }
  rows.push(gateRow('W1hero', LIMITS.W1, w1));
  metrics['heroCentre'] = { analytic: ana, measured: centre };
  console.log(`hero centre, mode 0, analytic ${ana.x.toFixed(1)},${ana.y.toFixed(1)} r ${ana.radiusPx.toFixed(1)}: ${centre.map((c) => `${PALETTE_NAMES[c.palette]} dx ${c.dx.toFixed(1)} dy ${c.dy.toFixed(1)}`).join('; ')}`);
  expect(checkImage(roundFile('hero-palette.png')).ok).toBe(true);
});

test('ring-palette: the RING at 465 u, one real zone per palette', async ({ page, browser }, info) => {
  test.setTimeout(600_000);
  const combos = buildCombos(SEED);
  await openHarness(page, info, { seed: SEED, tier: 3, period: 0 });
  const tiles: Tile[] = [];
  const w1: { v: number; at: string }[] = [];
  const found: Record<string, unknown>[] = [];
  for (let p = 0; p < 6; p++) {
    let ring: { chunk: number; zLocal: number } | null = null;
    let biome = -1;
    for (const pair of combos.pairs.filter((x) => x.palette === p)) {
      ring = findRing(SEED, pair.z0 + 9, 74);
      if (ring) { biome = pair.biome; break; }
    }
    if (!ring) throw new Error(`no RING inside a mix-0 zone of palette ${p}`);
    const travel = ring.chunk * 64 + ring.zLocal - 465;
    const chunk = Math.floor(travel / 64), local = travel - chunk * 64;
    const s = at(chunk, local, tickFor(chunk, local));
    await goto(page, s);
    const f = await frame(page, s, { post: 'full' });
    w1.push({ v: nearWhitePct(f.w, f.h, f.rgba), at: `${PALETTE_NAMES[p]} ring ${ring.chunk}` });
    found.push({ palette: p, biome, ring, chunk, local, chroma: meanChroma(f.w, f.h, f.rgba) });
    tiles.push({ img: downscale(f, 3), label: `${PALETTE_NAMES[p]} / ${BIOME_NAMES[biome]}: RING at 465 u` });
  }
  await writeSheet(browser, tiles, { cols: 3, tileW: 640, tileH: 360, path: roundFile('ring-palette.png'), title: `ring-palette ${roundName()}` });
  rows.push(gateRow('W1ring', LIMITS.W1, w1));
  metrics['rings'] = found;
  writeSpecResults('hero', { round: roundName(), seed: SEED, ...metrics }, rows);
  expect(checkImage(roundFile('ring-palette.png')).ok).toBe(true);
  for (const r of rows) if (!r.reportOnly) expect.soft(r.pass, `${r.gate} worst ${r.value} at ${r.worst}`).toBe(true);
});

// A10 (M5): sky events on real zones. Ticks come from T04's pure writeSkyEvents, in Node, for the zone the page renders, so
// each frame is chosen by rule (the first tick in the zone's window where the event is near its peak), not by looking.
test('sky events (A10): lightning, aurora and meteors on real zones, W1 on each', async ({ page, browser }, info) => {
  test.setTimeout(600_000);
  const combos = buildCombos(SEED);
  await openHarness(page, info, { seed: SEED, tier: 3, period: 0 });
  const ev = createSkyEvents();
  const kinds = [
    { name: 'lightning', biome: Biome.CYBER_CANYON, ok: (e: SkyEvents): boolean => e.boltK > 0.85 },
    // Aurora strength depends on day phase, not tick: .6 by day, 1 at deepest night. So candidates go darkest first (below).
    { name: 'aurora', biome: Biome.ORBITAL_NIGHT, ok: (e: SkyEvents): boolean => e.aurora > 0.6 },
    { name: 'meteor', biome: Biome.ORBITAL_NIGHT, ok: (e: SkyEvents): boolean => Math.max(e.metK[0]!, e.metK[1]!) > 0.5 },
  ] as const;
  const tiles: Tile[] = [];
  const w1: { v: number; at: string }[] = [];
  const found: Record<string, unknown>[] = [];
  for (const k of kinds) {
    for (let p = 0; p < 6; p++) {
      const pair = combos.pairs.find((x) => x.palette === p && x.biome === k.biome)!;
      // The pair's five samples, deepest night first (night only matters for aurora and meteors), then the first tick in
      // each sample's next 30720 where the event is near its peak.
      const cands = [...pair.samples].sort((a, b) => Math.cos(2 * Math.PI * b.dayPhase) - Math.cos(2 * Math.PI * a.dayPhase));
      let s0 = cands[0]!;
      let tick = -1;
      for (const c of cands) {
        const z = zoneAtNode(SEED, c.chunk, c.local);
        for (let t = c.tick; t < c.tick + 30720 && tick < 0; t++) {
          writeSkyEvents(SEED, t, 0, z, false, ev);
          if (k.ok(ev)) { tick = t; s0 = c; }
        }
        if (tick >= 0) break;
      }
      if (tick < 0) throw new Error(`no ${k.name} near its peak in 30720 ticks of any sample of palette ${p}`);
      writeSkyEvents(SEED, tick, 0, zoneAtNode(SEED, s0.chunk, s0.local), false, ev);
      const s = at(s0.chunk, s0.local, tick);
      await goto(page, s);
      const f = await frame(page, s, { post: 'full' });
      w1.push({ v: nearWhitePct(f.w, f.h, f.rgba), at: `${k.name} ${PALETTE_NAMES[p]} / ${BIOME_NAMES[k.biome]} ${s0.chunk}/${s0.local} t${tick}` });
      found.push({ kind: k.name, palette: p, chunk: s0.chunk, tick, boltK: ev.boltK, aurora: ev.aurora, metK: [ev.metK[0], ev.metK[1]], chroma: meanChroma(f.w, f.h, f.rgba) });
      tiles.push({ img: downscale(f, 3), label: `${k.name}: ${PALETTE_NAMES[p]} / ${BIOME_NAMES[k.biome]} t${tick}` });
    }
    await writeSheet(browser, tiles.splice(0), { cols: 3, tileW: 640, tileH: 360, path: roundFile(`sky-${k.name}.png`), title: `sky-${k.name} ${roundName()}: first tick near the event's peak in each palette's tile zone` });
    expect(checkImage(roundFile(`sky-${k.name}.png`)).ok).toBe(true);
  }
  rows.push(gateRow('W1sky', LIMITS.W1, w1, 'lightning at strobe over .85, aurora over .6 (darkest sample first), meteor over .5'));
  metrics['skyEvents'] = found;
  writeSpecResults('hero', { round: roundName(), seed: SEED, ...metrics }, rows);
  for (const r of rows) if (!r.reportOnly) expect.soft(r.pass, `${r.gate} worst ${r.value} at ${r.worst}`).toBe(true);
});
