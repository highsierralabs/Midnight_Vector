// Browser acceptance for T04. Test titles start with the A number from plans/T04-sky.md, so -g "A8" selects one.
// Sheets are built from pixels(), because a rehearsal page.screenshot once came back black with no other symptom.
import { writeFileSync } from 'node:fs';
import type { Page, Route, TestInfo } from 'playwright/test';
import type {} from '../../src/render/sky/dev/devHarness';
import type { FrameSpec, ProbeCase, Rect, SheetCell } from '../../src/render/sky/dev/devHarness';
import { diffBytes, type Diff } from '../../src/render/sky/dev/metrics';
import { createSkyEvents, SKY_CYCLE, writeSkyEvents } from '../../src/render/sky/events';
import { PALETTE_NAMES, PHASE_PERIOD_TICKS } from '../../src/contracts/index';
import { FAKE_SEED } from '../../src/testing/fakeWorld';   // dev/sky.html builds createFakeWorld() with no seed (DI-102)
import { expect, openDevPage, test as shared } from '../support/pw';

const PAGE = '/dev/sky.html';
/** Which hero the sky compiles: { candidate: 1 } until M3 publishes, then empty. */
const HERO_QUERY: Record<string, string | number> = {};
const BEND_C = -1.2e-5;
const PALETTES = [0, 1, 2, 3, 4, 5] as const;
const MODES = [0, 1, 2, 3] as const;
const AT = { chunk: 1, local: 0 };

/** One still: tick held, no camera motion, night, so nothing but the listed fields can differ. */
function still(o: Record<string, unknown> = {}): FrameSpec {
  return { tick: 600, palette: 0, hero: 0, biome: 0, at: AT, camX: 0, ...o, zone: { dayPhase: 0, ...(o['zone'] as object | undefined) } };
}

type Edits = readonly (readonly [string, string])[];
interface Served { served: number; missed: string[]; off: () => Promise<void> }

/** Serves one project file with text replaced, to this page only. Nothing on disk changes, so siblings never see it. */
async function serveEdited(page: Page, file: string, edits: Edits): Promise<Served> {
  const matcher = (url: URL): boolean => url.pathname.endsWith(`/${file}`);
  const state: Served = { served: 0, missed: [], off: async () => { /* set below */ } };
  const handler = async (route: Route): Promise<void> => {
    const response = await route.fetch();
    let body = await response.text();
    for (const [from, to] of edits) {
      if (body.includes(from)) body = body.replace(from, to);
      else state.missed.push(from);
    }
    state.served++;
    const headers = Object.fromEntries(Object.entries(response.headers()).filter(([k]) => k !== 'content-length' && k !== 'content-encoding'));
    await route.fulfill({ status: response.status(), headers, body });
  };
  state.off = () => page.unroute(matcher, handler);
  await page.route(matcher, handler);
  return state;
}

/**
 * Negative controls for the rows the V1 review repaired. T04_MUTANT=name[,name] serves each named fault for the whole
 * run, so the row it names can be shown failing on a real fault with nothing changed on disk (plans/T04-sky.md, section 7).
 */
const MUTANTS: Record<string, { file: string; edits: Edits }> = {
  // A2, and A11's phase-4 wrap: the band scroll at a non-integer harmonic of phase 4.
  sunScroll: { file: 'src/contracts/glsl/hero.glsl', edits: [['float f = fract(v * 9. + uPhases[1].x);', 'float f = fract(v * 9. + uPhases[1].x * 1.5);']] },
  // A11's phase-6 wrap in mode 1.
  eclipseHarmonic: { file: 'src/contracts/glsl/hero.glsl', edits: [['sin(th * 5. + TAU * ph)', 'sin(th * 5. + TAU * 1.5 * ph)']] },
  // A11's phase-5 wrap: twinkle.
  twinkleHarmonic: { file: 'src/render/sky/skyStars.glsl', edits: [['k3 * uTwPhase', '(k3 + .5) * uTwPhase']] },
  // A11's phase-6 wrap in biome 4: the aurora's sway.
  auroraHarmonic: { file: 'src/render/sky/skyEvents.glsl', edits: [['sin(x * 2.1 + TAU * uAuP.x)', 'sin(x * 2.1 + TAU * 1.5 * uAuP.x)']] },
  // A11's phase-7 wrap on the full sky, mode 3, which the iso nebula view cannot see: the wire moon's spin.
  moonHarmonic: { file: 'src/contracts/glsl/hero.glsl', edits: [['18. + 18. * phaseAt(7)', '18. + 18.5 * phaseAt(7)']] },
  // A6's mix-1 end: the wrong disc returned.
  swapEnd: { file: 'src/contracts/glsl/hero.glsl', edits: [['if (uHero.z >= 1.) return B;', 'if (uHero.z >= 1.) return A;']] },
  // A9's same tick and A17: twinkle on an accumulator, the pattern section 4.5 bans.
  drift: {
    file: 'src/render/sky/skyLayer.ts',
    edits: [['const PHASE_16S = 5;', 'const PHASE_16S = 5; let drift = 0;'], ['.value = v.reducedMotion ? slow : p[PHASE_16S]', '.value = v.reducedMotion ? slow : (drift += 0.002) + p[PHASE_16S]']],
  },
  // A13's reduced row: lightning left on under reduced motion.
  reducedBolt: { file: 'src/render/sky/events.ts', edits: [['reduced ? 0 : biomeWeight(z, Biome.CYBER_CANYON)', 'biomeWeight(z, Biome.CYBER_CANYON)']] },
  // A12's every-frame row: the nebula drawn on even ticks only.
  evenNebula: { file: 'src/render/sky/skyLayer.ts', edits: [['if (visible && nebulaOn) drawNebula();', 'if (visible && nebulaOn && v.tick % 2 === 0) drawNebula();']] },
  // A13's aurora luminance: five times its L.
  auroraBright: { file: 'src/render/sky/skyEvents.glsl', edits: [['.30) * body * rays * uAurora', '1.5) * body * rays * uAurora']] },
  // A23's link count: tier 0's sky mesh joins the scene after precompile, so its program links at the first tier-0 frame.
  lateLow: { file: 'src/render/sky/skyLayer.ts', edits: [['c.scene.add(mainMesh, lowMesh);', 'c.scene.add(mainMesh); setTimeout(() => { if (lowMesh) c.scene.add(lowMesh); }, 0);']] },
  // A23's mode rows: HERO_SUN_ONLY ignored, so tier 0 draws every mode again.
  allModes: { file: 'src/contracts/glsl/hero.glsl', edits: [['#ifdef HERO_SUN_ONLY', '#ifdef HERO_SUN_ONLY_OFF']] },
};

/**
 * The plan's X4000 rule: D3D11 translator warnings reach console.warn through three, so the shared fixture would miss them.
 * It does not fail on "Program Info Log" as such, since the frozen phaseAt logs a dynamic-indexing warning there (DI-38).
 */
const test = shared.extend<{ x4000: void; mutant: void }>({
  x4000: [async ({ page }, use) => {
    const warnings: string[] = [];
    page.on('console', (m) => { if (m.type() === 'warning' && m.text().includes('X4000')) warnings.push(m.text().slice(0, 600)); });
    await use();
    expect(warnings, 'X4000 translator warnings').toEqual([]);
  }, { auto: true }],
  mutant: [async ({ page }, use) => {
    const served: [string, Served][] = [];
    for (const name of (process.env['T04_MUTANT'] ?? '').split(',').filter((n) => n !== '')) {
      const m = MUTANTS[name];
      if (!m) throw new Error(`T04_MUTANT: no mutant named ${name}`);
      served.push([name, await serveEdited(page, m.file, m.edits)]);
    }
    await use();
    for (const [name, s] of served) {
      console.log(`MUTANT ${name}: served ${s.served} times`);
      expect(s.missed, `MUTANT ${name} did not apply`).toEqual([]);
    }
  }, { auto: true }],
});

/**
 * DI-58: two renders of one state. On the gpu project at most 64 bytes may differ and none by more than 1 level, because
 * the RTX flips 1 to 41 fixed pixels by 1 level once other states are drawn between. On software, 0 bytes.
 */
function sameStateFault(info: TestInfo, d: Diff): string | null {
  if (info.project.name === 'gpu') {
    if (d.max > 1) return `a byte differs by ${d.max} levels, over DI-58's 1`;
    if (d.bytes > 64) return `${d.bytes} bytes differ, over DI-58's 64`;
    return null;
  }
  return d.bytes === 0 ? null : `${d.bytes} bytes differ on ${info.project.name}, where DI-58 allows none`;
}

function expectSame(info: TestInfo, d: Diff, what: string): void {
  expect(sameStateFault(info, d), `${what}: ${d.bytes} bytes, max ${d.max}`).toBeNull();
}

function expectNotSame(info: TestInfo, d: Diff, what: string): void {
  expect(sameStateFault(info, d), `${what}: ${d.bytes} bytes, max ${d.max}`).not.toBeNull();
}

function gpuOnly(info: TestInfo): void {
  test.skip(info.project.name !== 'gpu', 'needs the 1080p viewport and the real GPU');
}

async function openSky(page: Page, query: Record<string, string | number> = {}): Promise<void> {
  await openDevPage(page, PAGE, { manual: 1, ...HERO_QUERY, ...query });
}

function saveUrl(info: TestInfo, name: string, dataUrl: string): string {
  const path = info.outputPath(name);
  writeFileSync(path, Buffer.from(dataUrl.split(',')[1]!, 'base64'));
  console.log(`SCREENSHOT ${path}`);
  return path;
}

/** Builds a sheet in the page, guards against a blank frame, saves it, and returns the per-cell photometry. */
async function sheet(page: Page, info: TestInfo, name: string, cols: number, cellW: number, cellH: number, cells: SheetCell[]) {
  const r = await page.evaluate((s) => window.__skyDev!.sheet(s), { cols, cellW, cellH, cells });
  for (const c of r.stats) expect(c.meanLuma, `blank frame in ${name}: ${c.label}`).toBeGreaterThan(1 / 255);
  saveUrl(info, name, r.url);
  return r.stats;
}

function luma(p: readonly number[]): number {
  return 0.2126 * p[0]! + 0.7152 * p[1]! + 0.0722 * p[2]!;
}

async function column(page: Page, frame: FrameSpec, x: number, rows: number[]): Promise<number[][]> {
  return page.evaluate(([f, c, r]) => window.__skyDev!.column(f as FrameSpec, c as number, r as number[]), [frame, x, rows] as const);
}

async function diff(page: Page, a: FrameSpec, b: FrameSpec): Promise<Diff> {
  return page.evaluate(([p, q]) => window.__skyDev!.diff(p as FrameSpec, q as FrameSpec), [a, b] as const);
}

/** A frame's bytes on the Node side, for comparisons across two pages. */
async function frameBytes(page: Page, f: FrameSpec): Promise<Uint8Array> {
  return Buffer.from(await page.evaluate((s) => window.__skyDev!.bytes(s), f), 'base64');
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

function mean(a: readonly number[]): number {
  return a.reduce((s, v) => s + v, 0) / a.length;
}

// ---- the page as a person opens it ----

test('A0 live: the page runs from rAF with a clean console', async ({ page }, info) => {
  gpuOnly(info);
  await openDevPage(page, PAGE, { hero: 2, palette: 3, ...HERO_QUERY });
  await page.waitForTimeout(600);
  const frames = await page.evaluate(async () => {
    const shell = window.__shell!;
    await new Promise((resolve) => { requestAnimationFrame(resolve); });
    shell.setManual(true);
    return shell.stats();
  });
  expect(frames.width).toBe(1920);
  await sheet(page, info, 'live.png', 1, 1280, 720, [{ frame: { t: 4.2, palette: 3, hero: 2 } }]);
});

// ---- M1: horizon ----

const BAND_ROWS = range(575, 612);
const DEEP_ROWS = [630, 640, 660, 680];
const HEIGHTS = [{ label: 'camY 7', sim: {} }, { label: 'camY 5.6', sim: { y: 2 } }, { label: 'camY 9.8', sim: { y: 14 } }];

/** The dark-band check: every row at least 60% of the smaller of the means of rows 575-585 and 608-612. */
function darkBand(rows: number[][]): { floor: number; low: number; lowRow: number } {
  const l = rows.map(luma);
  const floor = 0.6 * Math.min(mean(l.slice(0, 11)), mean(l.slice(33, 38)));
  let low = Infinity, lowRow = -1;
  l.forEach((v, i) => { if (v < low) { low = v; lowRow = BAND_ROWS[i]!; } });
  return { floor, low, lowRow };
}

function horizonFrame(c: number, sim: object): FrameSpec {
  return still({ bend: { a: 0, c }, sim });
}

async function horizonTable(page: Page, rows: number[]): Promise<Record<string, number[][]>> {
  const table: Record<string, number[][]> = {};
  for (const c of [BEND_C, 0, 2 * BEND_C]) {
    for (const h of HEIGHTS) table[`${c} ${h.label}`] = await column(page, horizonFrame(c, h.sim), 300, rows);
  }
  return table;
}

test('A1 horizon: no dark band under bend, and nothing leaks through the floor', async ({ page }, info) => {
  gpuOnly(info);
  test.setTimeout(240_000);
  const rows = [...BAND_ROWS, ...DEEP_ROWS];
  await openSky(page, { floor: 1 });
  const ours = await horizonTable(page, rows);
  await saveHorizonShot(page, info);
  await openSky(page, { floor: 1, below: 'legacy' });
  const legacy = await horizonTable(page, rows);
  const report: string[] = [];
  for (const c of [BEND_C, 0, 2 * BEND_C]) {
    for (const h of HEIGHTS) {
      const key = `${c} ${h.label}`;
      const a = ours[key]!, b = legacy[key]!;
      const band = darkBand(a.slice(0, BAND_ROWS.length));
      // Twice the fake value: section 6.3's fade reaches past row 630 by design, so only rows 640 and down are compared.
      const deep = c === 2 * BEND_C ? [640, 660, 680] : DEEP_ROWS;
      let worst = 0;
      for (const row of deep) {
        const i = rows.indexOf(row);
        for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(a[i]![k]! - b[i]![k]!));
      }
      report.push(`${key}: low ${band.low.toFixed(1)} at row ${band.lowRow}, limit ${band.floor.toFixed(1)}; deep rows differ by at most ${worst}`);
      expect(band.low, `${key} dark band`).toBeGreaterThanOrEqual(band.floor);
      expect(worst, `${key} leak`).toBeLessThanOrEqual(3);
    }
  }
  console.log(`A1\n${report.join('\n')}`);
});

async function saveHorizonShot(page: Page, info: TestInfo): Promise<void> {
  const cells: SheetCell[] = [
    { frame: horizonFrame(BEND_C, {}), label: `full bend, camY 7`, rect: [480, 500, 960, 260] },
    { frame: horizonFrame(BEND_C, { y: 14 }), label: 'full bend, camY 9.8', rect: [480, 500, 960, 260] },
    { frame: horizonFrame(0, {}), label: 'no bend', rect: [480, 500, 960, 260] },
    { frame: horizonFrame(2 * BEND_C, {}), label: 'twice the bend', rect: [480, 500, 960, 260] },
  ];
  await sheet(page, info, 'horizon.png', 2, 960, 260, cells);
}

test('A1n legacy rule shows the dark band, so the check can fail', async ({ page }, info) => {
  gpuOnly(info);
  await openSky(page, { floor: 1, below: 'legacy' });
  const band = darkBand(await column(page, horizonFrame(BEND_C, {}), 300, BAND_ROWS));
  console.log(`A1n low ${band.low.toFixed(1)} at row ${band.lowRow}, limit ${band.floor.toFixed(1)}`);
  expect(band.low).toBeLessThan(band.floor);
});

// ---- M2: hero ----

/** A2's comparison: the published mode 0 against T00's text, page against page, in 12 states; and heroB ignored at mix 0. */
async function modeZero(page: Page): Promise<{ states: Diff[]; heroB: Diff }> {
  const states: FrameSpec[] = [];
  for (const palette of [0, 5, 4]) for (const tick of [0, 123, 600, 4097]) states.push(still({ palette, tick }));
  await openSky(page, { post: 'off' });
  const ours: Uint8Array[] = [];
  for (const s of states) ours.push(await frameBytes(page, s));
  const heroB = await page.evaluate((f) => window.__skyDev!.diff(
    { ...f, hero: undefined, zone: { dayPhase: 0, heroA: 0, heroB: 0, heroMix: 0 } },
    { ...f, hero: undefined, zone: { dayPhase: 0, heroA: 0, heroB: 2, heroMix: 0 } },
  ), still());
  await openDevPage(page, PAGE, { manual: 1, verbatim: 1, post: 'off' });
  const diffs: Diff[] = [];
  for (let i = 0; i < states.length; i++) diffs.push(diffBytes(ours[i]!, await frameBytes(page, states[i]!)));
  return { states: diffs, heroB };
}

test('A2 mode zero: the published mode 0 matches the T00 text within DI-58', async ({ page }, info) => {
  gpuOnly(info);
  test.setTimeout(240_000);
  const r = await modeZero(page);
  const within = r.states.filter((d) => sameStateFault(info, d) === null).length;
  console.log(`A2 ${within} of ${r.states.length} states within DI-58, bytes ${r.states.map((d) => `${d.bytes}/${d.max}`).join(' ')}; heroB at mix 0: ${r.heroB.bytes} bytes, max ${r.heroB.max}`);
  r.states.forEach((d, i) => expectSame(info, d, `A2 state ${i}`));
  expectSame(info, r.heroB, 'A2 heroB at mix 0');
});

test('A2n mode 0 against modes 1, 2 and 3 fails the same-state check, so A2 can fail', async ({ page }, info) => {
  gpuOnly(info);
  await openSky(page, { post: 'off' });
  for (const hero of [1, 2, 3]) {
    const d = await diff(page, still(), still({ hero }));
    console.log(`A2n mode ${hero}: ${d.bytes} bytes, max ${d.max}`);
    expect(d.bytes).toBeGreaterThan(1_000_000);
    expectNotSame(info, d, `A2n mode ${hero}`);
  }
});

test('A3 geometry: the disc sits where section 2 says, at both FOVs', async ({ page }, info) => {
  gpuOnly(info);
  await openSky(page, { iso: 'hero', post: 'off' });
  const report: string[] = [];
  const edges = (hero: number, fovDeg: number) => page.evaluate(
    ([f]) => window.__skyDev!.edges(f as FrameSpec, 960, 150, 420, 8),
    [still({ hero, feel: { fovDeg } })] as const,
  );
  for (const [fovDeg, top, planet] of [[58, 262, 331], [68, 312, 369]] as const) {
    const m0 = await edges(0, fovDeg);
    report.push(`FOV ${fovDeg} mode 0 first lit ${m0.firstEdge}, want ${top}`);
    expect(Math.abs(m0.firstEdge - top), `mode 0 at FOV ${fovDeg}`).toBeLessThanOrEqual(3);
    for (const hero of [1, 3]) {
      const m = await edges(hero, fovDeg);
      report.push(`FOV ${fovDeg} mode ${hero} rim peak ${m.peak}, want ${top}`);
      expect(Math.abs(m.peak - top), `mode ${hero} at FOV ${fovDeg}`).toBeLessThanOrEqual(3);
    }
    const m2 = await edges(2, fovDeg);
    report.push(`FOV ${fovDeg} mode 2 body top ${m2.firstEdge}, want ${planet}`);
    expect(Math.abs(m2.firstEdge - planet), `mode 2 at FOV ${fovDeg}`).toBeLessThanOrEqual(4);
  }
  console.log(`A3\n${report.join('\n')}`);
});

const A4_TICKS = [0, 600, 1440, 3000, 5000, 9000];

test('A4 sheets: all 24 combinations, near-white and chroma, everything on', async ({ page }, info) => {
  gpuOnly(info);
  test.setTimeout(420_000);
  await openSky(page);
  const rows: { mode: number; palette: string; tick: number; nearWhite: number; meanChroma: number }[] = [];
  for (const hero of MODES) {
    const cells = PALETTES.map((palette): SheetCell => ({ frame: still({ hero, palette }), label: `${PALETTE_NAMES[palette]} mode ${hero}` }));
    await sheet(page, info, `mode${hero}.png`, 3, 640, 360, cells);
    await sheet(page, info, `crop${hero}.png`, 3, 640, 360, cells.map((c) => ({ ...c, rect: [640, 180, 640, 360] as const })));
    // The lower half too, which the row's crop stops short of: bands, the front of the ring across the body, the disc against the horizon.
    await sheet(page, info, `low${hero}.png`, 3, 640, 360, cells.map((c) => ({ ...c, rect: [640, 280, 640, 360] as const })));
    for (const palette of PALETTES) {
      for (const tick of A4_TICKS) {
        const p = await page.evaluate((f) => window.__skyDev!.photometry(f), still({ hero, palette, tick }));
        rows.push({ mode: hero, palette: PALETTE_NAMES[palette], tick, nearWhite: p.nearWhite, meanChroma: p.meanChroma });
      }
    }
  }
  const path = info.outputPath('sheet-metrics.json');
  writeFileSync(path, JSON.stringify(rows, null, 1));
  const worstWhite = rows.reduce((a, b) => (b.nearWhite > a.nearWhite ? b : a));
  const worstChroma = rows.reduce((a, b) => (b.meanChroma < a.meanChroma ? b : a));
  console.log(`A4 worst near-white ${(worstWhite.nearWhite * 100).toFixed(3)}% (${worstWhite.palette} mode ${worstWhite.mode} tick ${worstWhite.tick}); worst chroma ${worstChroma.meanChroma.toFixed(1)} (${worstChroma.palette} mode ${worstChroma.mode} tick ${worstChroma.tick}), ${rows.length} frames`);
  expect(worstWhite.nearWhite).toBeLessThanOrEqual(0.005);
  expect(worstChroma.meanChroma).toBeGreaterThanOrEqual(55);
});

test('A5 fog join: the fully fogged floor row matches the sky above it', async ({ page }, info) => {
  gpuOnly(info);
  test.setTimeout(240_000);
  await openSky(page, { floor: 1 });
  const report: string[] = [];
  for (const [fovDeg, row] of [[58, 590], [68, 581]] as const) {
    for (const palette of PALETTES) {
      const [floor, sky] = await column(page, still({ palette, feel: { fovDeg }, bend: { a: 0, c: 0 } }), 300, [row, row - 2]);
      const worst = Math.max(...[0, 1, 2].map((k) => Math.abs(floor![k]! - sky![k]!)));
      report.push(`FOV ${fovDeg} ${PALETTE_NAMES[palette]}: row ${row} against ${row - 2} differs by ${worst}`);
      expect(worst, `FOV ${fovDeg} ${PALETTE_NAMES[palette]}`).toBeLessThanOrEqual(12);
    }
    for (const [name, c] of [['flat', 0], ['bent', BEND_C]] as const) {
      await sheet(page, info, `join-${name}-${fovDeg}.png`, 3, 640, 360, PALETTES.map((palette): SheetCell => ({
        frame: still({ palette, feel: { fovDeg }, bend: { a: 0, c } }), label: `${PALETTE_NAMES[palette]} ${name} FOV ${fovDeg}`,
      })));
    }
  }
  await sheet(page, info, 'join-modes.png', 2, 960, 540, MODES.map((hero): SheetCell => ({ frame: still({ hero, tick: 1000 }), label: `mode ${hero} reflection` })));
  console.log(`A5\n${report.join('\n')}`);
});

const WIPE_PAIRS = [[0, 2], [1, 3], [2, 0]] as const;
const WIPE_MIXES = [0, 0.3, 0.45, 0.5, 0.55, 0.7, 1];

function wipe(heroA: number, heroB: number, heroMix: number, o: Record<string, unknown> = {}): FrameSpec {
  return still({ hero: undefined, ...o, zone: { heroA, heroB, heroMix } });
}

/** A6's ends: mix 0 against pure A and mix 1 against pure B, on a page already open with post off. */
async function wipeEnds(page: Page): Promise<{ label: string; d: Diff }[]> {
  const out: { label: string; d: Diff }[] = [];
  for (const [a, b] of WIPE_PAIRS) {
    out.push({ label: `${a}>${b} mix 0`, d: await diff(page, wipe(a, b, 0), still({ hero: a })) });
    out.push({ label: `${a}>${b} mix 1`, d: await diff(page, wipe(a, b, 1), still({ hero: b })) });
  }
  return out;
}

test('A6 wipe: exact at both ends within DI-58, no pop at the production rate', async ({ page }, info) => {
  gpuOnly(info);
  test.setTimeout(300_000);
  const STEP = 1 / 1200;
  await openSky(page, { post: 'off' });
  const report: string[] = [];
  for (const e of await wipeEnds(page)) {
    report.push(`${e.label}: ${e.d.bytes} bytes, max ${e.d.max}`);
    expectSame(info, e.d, e.label);
  }
  for (const [a, b] of WIPE_PAIRS) {
    const mid = await diff(page, wipe(a, b, 0.5), wipe(a, b, 0.5 + STEP));
    const last58 = await diff(page, wipe(a, b, 1 - STEP), wipe(a, b, 1));
    const last68 = await diff(page, wipe(a, b, 1 - STEP, { feel: { fovDeg: 68 } }), wipe(a, b, 1, { feel: { fovDeg: 68 } }));
    report.push(`${a}>${b} landscape: mid max ${mid.max} over ${mid.bytes} bytes; last step FOV 58 max ${last58.max} over ${last58.bytes}, FOV 68 max ${last68.max} over ${last68.bytes}`);
    expect(mid.max, `${a}>${b} mid`).toBeLessThanOrEqual(8);
    expect(last58.max, `${a}>${b} last at FOV 58`).toBeLessThanOrEqual(8);
    expect(last68.max, `${a}>${b} last at FOV 68`).toBeLessThanOrEqual(8);
  }
  // Rear chrome-orb reflections: sunDisc over the whole sphere, the last production step, in 8-bit sRGB on black.
  for (const [a, b] of [...WIPE_PAIRS, [3, 1], [0, 1], [1, 0]] as const) {
    for (const [name, m0, m1] of [['first', 0, STEP], ['last tenth', 0.95, 0.95 + STEP], ['last', 1 - STEP, 1]] as const) {
      const s = await page.evaluate(([p, q, x, y, n]) => window.__skyDev!.discStep(n as string, p as number, q as number, x as number, y as number), [a, b, m0, m1, name] as const);
      report.push(`${a}>${b} sphere, ${s.label} step: max linear ${s.maxLinear.toFixed(5)}, encoded ${s.maxEncoded.toFixed(1)}, behind the camera ${s.rearMaxEncoded.toFixed(1)}; directions over 1 level ${s.over1}, over 4 levels ${s.over4}, of ${s.samples}`);
      // The row's limit of 8 levels per step, applied to what a chrome orb can reflect, on black, which is the worst case.
      if (name !== 'last tenth') expect(s.maxEncoded, `${a}>${b} sphere ${name}`).toBeLessThanOrEqual(8);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [a, b] of WIPE_PAIRS) {
    const last = await diff(page, wipe(a, b, 1 - STEP), wipe(a, b, 1));
    report.push(`${a}>${b} portrait 390x844: last step max ${last.max} over ${last.bytes} bytes`);
    expect(last.max, `${a}>${b} portrait`).toBeLessThanOrEqual(8);
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openSky(page);
  for (const [a, b] of WIPE_PAIRS) {
    const mid = await diff(page, wipe(a, b, 0.5), wipe(a, b, 0.5 + STEP));
    const last = await diff(page, wipe(a, b, 1 - STEP), wipe(a, b, 1));
    report.push(`${a}>${b} DevPost: mid max ${mid.max} over ${mid.bytes} bytes; last step max ${last.max} over ${last.bytes} bytes`);
    await sheet(page, info, `wipe-${a}-${b}.png`, 3, 640, 360, [...WIPE_MIXES, 0.9].map((m): SheetCell => ({
      frame: wipe(a, b, m), label: `${a}>${b} mix ${m}`, rect: [640, 180, 640, 360],
    })));
  }
  console.log(`A6\n${report.join('\n')}`);
});

const PROBE_CASES: ProbeCase[] = [
  ...MODES.map((m): ProbeCase => ({ label: `mode ${m}`, heroA: m, heroB: m, heroMix: 0 })),
  ...WIPE_PAIRS.map(([a, b]): ProbeCase => ({ label: `${a}>${b} mix .5`, heroA: a, heroB: b, heroMix: 0.5 })),
];

test('A7 finite probe: the sky and sunDisc are finite over the whole sphere', async ({ page }, info) => {
  gpuOnly(info);
  test.setTimeout(240_000);
  await openSky(page, { post: 'off' });
  const r = await page.evaluate((c) => window.__skyDev!.probe(c), PROBE_CASES);
  console.log(`A7 ${JSON.stringify(r)}`);
  for (const p of r) {
    expect(p.skyNonFinite, `${p.label} sky`).toBe(0);
    expect(p.discNonFinite, `${p.label} disc`).toBe(0);
    expect(p.discMinRgb, `${p.label} rgb`).toBeGreaterThanOrEqual(-1e-4);
    expect(p.discMinA, `${p.label} alpha low`).toBeGreaterThanOrEqual(-1e-4);
    expect(p.discMaxA, `${p.label} alpha high`).toBeLessThanOrEqual(1 + 1e-4);
  }
});

test('A7n injected NaN is reported, so the probe can fail', async ({ page }, info) => {
  gpuOnly(info);
  await openSky(page, { post: 'off', nan: 1 });
  const r = await page.evaluate((c) => window.__skyDev!.probe(c), [PROBE_CASES[0]!]);
  console.log(`A7n ${JSON.stringify(r)}`);
  expect(r[0]!.skyNonFinite).toBeGreaterThan(1000);
});

// ---- M4: stars ----

const PX_PER_RAD = 974.2;

async function starMotion(page: Page) {
  const f = still({ tick: 600 });
  const run = (axis: 'shakeX' | 'shakeY') => page.evaluate(
    ([frame, a, rad]) => window.__skyDev!.trackStars(frame as FrameSpec, a as 'shakeX' | 'shakeY', 40, 0.17, rad as number),
    [f, axis, PX_PER_RAD] as const,
  );
  return { pitch: await run('shakeY'), yaw: await run('shakeX') };
}

test('A8 star motion: tracked stars hold brightness under shake', async ({ page }, info) => {
  gpuOnly(info);
  test.setTimeout(180_000);
  await openSky(page, { iso: 'stars', post: 'off' });
  const { pitch, yaw } = await starMotion(page);
  console.log(`A8 pitch ${JSON.stringify(pitch)} yaw ${JSON.stringify(yaw)}`);
  for (const t of [pitch, yaw]) {
    expect(t.stars).toBeGreaterThanOrEqual(100);
    expect(t.fluxP95).toBeLessThanOrEqual(0.2);
    expect(t.peakP95).toBeLessThanOrEqual(0.05);
  }
});

test('A8n naive stars fail the same gate', async ({ page }, info) => {
  gpuOnly(info);
  test.setTimeout(180_000);
  await openSky(page, { iso: 'stars', post: 'off', naive: 1 });
  const { pitch, yaw } = await starMotion(page);
  console.log(`A8n pitch ${JSON.stringify(pitch)} yaw ${JSON.stringify(yaw)}`);
  for (const t of [pitch, yaw]) {
    expect(t.stars).toBeGreaterThan(0);
    expect(t.fluxP95).toBeGreaterThanOrEqual(0.4);
  }
});

test('A9 star still: identical at one tick, slow between frames, no popping in the strips', async ({ page }, info) => {
  gpuOnly(info);
  test.setTimeout(300_000);
  await openSky(page, { iso: 'stars', post: 'off' });
  const same = await diff(page, still(), still());
  expectSame(info, same, 'A9 same tick');
  const live = (tick: number, o: object = {}): FrameSpec => still({ tick, ...o });
  // 1/60 s is two ticks. A range covering several twinkle positions, since the 16 s phase moves slowly.
  let worst = 0, worstReduced = 0;
  for (const tick of [100, 700, 1300, 1900]) {
    worst = Math.max(worst, (await diff(page, live(tick), live(tick + 2))).max);
    worstReduced = Math.max(worstReduced, (await diff(page, live(tick, { reducedMotion: true }), live(tick + 2, { reducedMotion: true }))).max);
  }
  console.log(`A9 same tick ${same.bytes} bytes, max ${same.max}; 1/60 s max ${worst}; reduced motion max ${worstReduced}`);
  expect(worst).toBeLessThanOrEqual(3);
  expect(worstReduced).toBeLessThanOrEqual(1);
  const crop = [880, 120, 160, 90] as const;
  // 160x90 at 4x, nearest neighbour, in a sheet no wider than the 1920 px review limit.
  await sheet(page, info, 'stars-fov.png', 3, 640, 360, range(0, 7).map((i): SheetCell => {
    const fovDeg = 58 + (8 * i) / 7;
    return { frame: still({ feel: { fovDeg } }), label: `FOV ${fovDeg.toFixed(1)}`, rect: crop };
  }));
  await sheet(page, info, 'stars-roll.png', 3, 640, 360, range(0, 7).map((i): SheetCell => {
    const roll = -0.02 + (0.04 * i) / 7;
    return { frame: still({ feel: { roll } }), label: `roll ${roll.toFixed(3)}`, rect: crop };
  }));
  await sheet(page, info, 'stars-1to1.png', 1, 1600, 600, [{ frame: still(), rect: [160, 0, 1600, 600] }]);
  // The strips of all layers: 8 frames 1 s apart per mode, at 1:1 on the disc.
  await openSky(page);
  for (const hero of MODES) {
    await sheet(page, info, `strip${hero}.png`, 4, 480, 270, range(0, 7).map((i): SheetCell => ({
      frame: still({ hero, tick: 600 + i * 120 }), label: `mode ${hero} t+${i}s`, rect: [720, 200, 480, 270],
    })));
  }
});

// ---- M5: nebula, and M7: banding ----

test('A10 banding: dark gradients are dithered under the stand-in stack', async ({ page }, info) => {
  gpuOnly(info);
  test.setTimeout(180_000);
  await openSky(page, { iso: 'gradient' });
  const report: string[] = [];
  for (const palette of PALETTES) {
    const b = await page.evaluate((f) => window.__skyDev!.banding(f, 64, 320, 0, 240), still({ palette }));
    report.push(`${PALETTE_NAMES[palette]}: ${b.map((c) => `${c.levels.toFixed(1)}L ${c.changesPerLevel.toFixed(2)}`).join(' | ')}`);
    for (const c of b) {
      if (c.levels >= 8) expect(c.changesPerLevel, `${PALETTE_NAMES[palette]} channel ${c.channel}`).toBeGreaterThanOrEqual(1.3);
    }
  }
  console.log(`A10\n${report.join('\n')}`);
  await sheet(page, info, 'stretch-dither.png', 3, 640, 300, PALETTES.map((palette): SheetCell => ({
    frame: still({ palette }), label: `${PALETTE_NAMES[palette]} stretched`, rect: [0, 0, 640, 300], stretch: true,
  })));
});

test('A10n the same gradients with post off read exactly 1.00 and show contours', async ({ page }, info) => {
  gpuOnly(info);
  test.setTimeout(180_000);
  await openSky(page, { iso: 'gradient', post: 'off' });
  const report: string[] = [];
  for (const palette of PALETTES) {
    const b = await page.evaluate((f) => window.__skyDev!.banding(f, 64, 320, 0, 240), still({ palette }));
    report.push(`${PALETTE_NAMES[palette]}: ${b.map((c) => `${c.levels.toFixed(1)}L ${c.changesPerLevel.toFixed(2)}`).join(' | ')}`);
    for (const c of b) if (c.levels >= 8) expect(c.changesPerLevel, `${PALETTE_NAMES[palette]} channel ${c.channel}`).toBe(1);
  }
  console.log(`A10n\n${report.join('\n')}`);
  await sheet(page, info, 'stretch-nodither.png', 3, 640, 300, PALETTES.map((palette): SheetCell => ({
    frame: still({ palette }), label: `${PALETTE_NAMES[palette]} stretched`, rect: [0, 0, 640, 300], stretch: true,
  })));
});

/** t only, so alpha is live. Palette, biome, hero and day phase are pinned, because the cam moves a hair. */
function alphaFrame(tick: number, alpha: number, o: Record<string, unknown> = {}): FrameSpec {
  return { t: (tick + alpha) / 120, palette: 0, hero: 0, biome: 0, camX: 0, zone: { dayPhase: 0 }, ...o };
}

/** No meteor or strike at this tick and alpha in biomes 0 and 4: a moving head would differ between the two frames of a pair. */
function quiet(tick: number, alpha: number): boolean {
  const e = createSkyEvents();
  return [0, 4].every((b) => {
    writeSkyEvents(FAKE_SEED, tick, alpha, { biomeA: b, biomeB: b, biomeMix: 0, dayPhase: 0 }, false, e);
    return e.metK[0]! + e.metK[1]! + e.boltK === 0;
  });
}

/**
 * The phases the sky reads are 4 to 7: uPhases[1].x is phase 4, the band scroll; twinkle and aurora rays 5; corona and aurora
 * sway 6; planet, moon and nebula 7. Each wrap is taken at the first multiple of its period with no event active either side.
 */
function quietWraps(): { phase: number; period: number; tick: number }[] {
  return [4, 5, 6, 7].map((phase) => {
    const period = PHASE_PERIOD_TICKS[phase]!;
    let tick = period;
    while (!quiet(tick - 1, 0.999) || !quiet(tick, 0)) tick += period;
    return { phase, period, tick };
  });
}

/** The full-sky pair across a wrap: just before against exactly on it. */
async function wrapPair(page: Page, tick: number, o: Record<string, unknown> = {}): Promise<Diff> {
  return diff(page, alphaFrame(tick - 1, 0.999, o), still({ tick, ...o }));
}

test('A11 nebula: no block structure, and the phase wraps do not pop', async ({ page }, info) => {
  gpuOnly(info);
  test.setTimeout(240_000);
  await openSky(page, { iso: 'nebula', post: 'off' });
  const wrap7 = await diff(page, alphaFrame(30719, 0.999), still({ tick: 30720 }));
  console.log(`A11 iso nebula phase-7 wrap: ${wrap7.bytes} bytes, max ${wrap7.max}`);
  expect(wrap7.bytes).toBeLessThanOrEqual(8);
  expect(wrap7.max).toBeLessThanOrEqual(1);
  await sheet(page, info, 'nebula-iso.png', 3, 640, 360, PALETTES.map((palette): SheetCell => ({ frame: still({ palette }), label: `${PALETTE_NAMES[palette]} nebula x4` })));
  await sheet(page, info, 'nebula-iso-1to1.png', 1, 1600, 800, [{ frame: still({ palette: 2 }), rect: [160, 0, 1600, 800] }]);
  // The full sky in all four modes, with the aurora in biome 4, across the wrap of every phase it reads (V1 review).
  await openSky(page, { post: 'off' });
  const report: string[] = [];
  for (const { phase, tick } of quietWraps()) {
    const row: string[] = [];
    for (const biome of [0, 4]) {
      for (const hero of MODES) {
        const d = await wrapPair(page, tick, { hero, biome });
        row.push(`${hero}/${biome} ${d.bytes}:${d.max}`);
        expect(d.max, `phase ${phase} wrap at tick ${tick}, mode ${hero}, biome ${biome}: ${d.bytes} bytes`).toBeLessThanOrEqual(1);
      }
    }
    report.push(`phase ${phase} wrap at tick ${tick}, mode/biome bytes:max ${row.join(' ')}`);
  }
  console.log(`A11\n${report.join('\n')}`);
  await openSky(page);
  await sheet(page, info, 'nebula-full.png', 3, 640, 360, PALETTES.map((palette): SheetCell => ({ frame: still({ palette }), label: `${PALETTE_NAMES[palette]} full sky` })));
  await sheet(page, info, 'nebula-corner.png', 3, 640, 360, PALETTES.map((palette): SheetCell => ({ frame: still({ palette }), label: `${PALETTE_NAMES[palette]} top right, 1:1`, rect: [1280, 0, 640, 360] })));
});

test('A11n a non-integer harmonic of each phase pops at its own wraps and nowhere else, so each A11 pair can fail', async ({ page }, info) => {
  gpuOnly(info);
  test.setTimeout(240_000);
  const wraps = quietWraps();
  const report: string[] = [];
  for (const { phase, period } of wraps) {
    // A sky-wide term at 1.5 times phase k: continuous except where phase k wraps, where it jumps by .025, about 6 levels.
    const served = await serveEdited(page, 'src/render/sky/sky.frag.glsl', [['gl_FragColor = vec4(c, 1.);', `gl_FragColor = vec4(c + .05 * fract(1.5 * phaseAt(${phase})), 1.);`]]);
    await openSky(page, { post: 'off' });
    expect(served.missed, 'injection applied').toEqual([]);
    for (const { tick } of wraps) {
      const d = await wrapPair(page, tick);
      const crosses = tick % period === 0;
      report.push(`phase ${phase} injected, pair at ${tick}: ${d.bytes} bytes, max ${d.max}, ${crosses ? 'crosses its wrap' : 'does not'}`);
      if (crosses) expect(d.max, `phase ${phase} at ${tick}`).toBeGreaterThan(1);
      else expect(d.max, `phase ${phase} at ${tick}`).toBeLessThanOrEqual(1);
    }
    await served.off();
  }
  console.log(`A11n\n${report.join('\n')}`);
});

test('A12 tiers: nebula size, draw counts and no link after the first cycle', async ({ page }, info) => {
  gpuOnly(info);
  test.setTimeout(180_000);
  await openSky(page, { post: 'off' });
  const r = await page.evaluate((f) => {
    const shell = window.__shell!, dev = window.__skyDev!;
    const out: { tier: number; size: string; calls: number; programs: number; lit: boolean }[] = [];
    const cycle = (): void => {
      for (const tier of [3, 2, 1, 0, 1, 3] as const) {
        shell.setTier(tier);
        const p = dev.photometry(f);
        out.push({ tier, size: dev.core.nebulaSize.join('x'), calls: shell.stats().calls, programs: shell.stats().programs, lit: p.meanLuma > 1 });
      }
    };
    cycle();
    dev.spyLinks();
    const before = dev.links;
    const first = out.length;
    cycle();
    return { out, first, links: dev.links - before };
  }, still());
  console.log(`A12 ${JSON.stringify(r)}`);
  // Every frame draws the nebula, as section 6.3 says: consecutive odd and even ticks with the camera held, so no rebuild
  // draws it instead (V1 review), and a frame after a different history.
  const every = await page.evaluate((f) => {
    const shell = window.__shell!, dev = window.__skyDev!;
    const out: Record<string, number[]> = {};
    for (const tier of [3, 2] as const) {
      shell.setTier(tier);
      const calls: number[] = [];
      for (let tick = 600; tick < 606; tick++) {
        dev.hash({ ...f, tick });
        calls.push(shell.stats().calls);
      }
      out[`tier ${tier}`] = calls;
    }
    shell.setTier(3);
    return { calls: out, history: dev.diffAfter({ ...f, tick: 600 }, { ...f, tick: 9000 }, { ...f, tick: 601 }) };
  }, still());
  console.log(`A12 every frame ${JSON.stringify(every.calls)}; tick 601 after 600 against after 9000: ${every.history.bytes} bytes, max ${every.history.max}`);
  for (const calls of Object.values(every.calls)) expect(calls).toEqual([2, 2, 2, 2, 2, 2]);
  expectSame(info, every.history, 'A12 tick 601 after different histories');
  // T09's seam: hidden means no sky draw and no nebula draw. Then dispose frees what the layer holds.
  const hidden = await page.evaluate((f) => {
    const shell = window.__shell!, dev = window.__skyDev!;
    shell.setLayerVisible('sky', false);
    dev.hash(f);
    const calls = shell.stats().calls;
    shell.setLayerVisible('sky', true);
    dev.hash(f);
    const shown = shell.stats().calls;
    const before = shell.ctx.renderer.info.memory.geometries;
    dev.core.dispose();
    return { calls, shown, before, after: shell.ctx.renderer.info.memory.geometries };
  }, still());
  console.log(`A12 hidden ${JSON.stringify(hidden)}`);
  expect(hidden.calls).toBe(0);
  expect(hidden.shown).toBe(2);
  expect(hidden.after).toBeLessThan(hidden.before);
  const wantSize = ['384x192', '192x96', '192x96', '192x96', '192x96', '384x192'];
  const wantCalls = [2, 2, 1, 1, 1, 2];
  r.out.forEach((row, i) => {
    const j = i % 6;
    expect(row.size, `step ${i}`).toBe(wantSize[j]);
    expect(row.calls, `step ${i}`).toBe(wantCalls[j]);
    expect(row.lit, `step ${i}`).toBe(true);
    // The plan's row: constant on the second cycle. The first cycle can drop programs, because DevPost rebuilds its bloom blur.
    if (i >= r.first) expect(row.programs, `step ${i}`).toBe(r.out[r.first - 1]!.programs);
  });
  expect(r.links).toBe(0);
});

// ---- M6: events ----

interface MeteorShot { tick: number; rect: Rect }
interface Strike { tick: number; strobe2: number; x: number }
interface EventTicks { meteors: MeteorShot[]; strikes: Strike[] }

/** A w x h crop around a gnomonic point, at camera pitch .05 and FOV 58 on 1920x1080. */
function cropAround(gx: number, gy: number, w = 480, h = 270): Rect {
  const c = Math.cos(0.05), s = Math.sin(0.05), z = s * gy + c;
  const x = 960 + (PX_PER_RAD * gx) / z, row = 540 - (PX_PER_RAD * (c * gy - s)) / z;
  return [Math.max(0, Math.min(1920 - w, Math.round(x - w / 2))), Math.max(0, Math.min(1080 - h, Math.round(row - h / 2))), w, h];
}

/** Scans the real schedule in Node. */
function scanEvents(): EventTicks {
  const e = createSkyEvents();
  const boulevard = { biomeA: 0, biomeB: 0, biomeMix: 0, dayPhase: 0 };
  const canyon = { biomeA: 3, biomeB: 3, biomeMix: 0, dayPhase: 0 };
  // The last tick at full strength in each meteor's life, when its streak is longest.
  const meteors: MeteorShot[] = [];
  let was = false, head = [0, 0];
  for (let t = 0; t < SKY_CYCLE && meteors.length < 6; t++) {
    writeSkyEvents(FAKE_SEED, t, 0, boulevard, false, e);
    const on = e.metK[0]! >= 1;
    if (was && !on) meteors.push({ tick: t - 1, rect: cropAround(head[0]!, head[1]!) });
    was = on;
    head = [e.met[0]!, e.met[1]!];
  }
  const strikes: Strike[] = [];
  let previous = 0;
  for (let t = 0; t < SKY_CYCLE; t++) {
    writeSkyEvents(FAKE_SEED, t, 0, canyon, false, e);
    if (e.boltK > 0 && previous === 0 && (strikes.length === 0 || t - strikes[strikes.length - 1]!.tick > 100)) {
      strikes.push({ tick: t, strobe2: t + 20, x: e.boltX.reduce((a, b) => a + b, 0) / e.boltX.length });
    }
    previous = e.boltK;
  }
  return { meteors, strikes };
}

/** A 960x540 crop on a bolt's mean x, from just under the screen top to the horizon, so a review sheet cannot miss it. */
function boltCrop(s: Strike): Rect {
  const [x] = cropAround(s.x, 0.3, 960, 540);
  return [x, 90, 960, 540];
}

test('A13 events: meteors, aurora and lightning, each gated by zone and by reduced motion', async ({ page }, info) => {
  gpuOnly(info);
  test.setTimeout(300_000);
  const { meteors, strikes } = scanEvents();
  console.log(`A13 meteors at ${meteors.map((m) => m.tick).join(' ')}; strikes at ${strikes.map((s) => s.tick).join(' ')}`);
  expect(meteors.length).toBeGreaterThanOrEqual(6);
  expect(strikes.length).toBeGreaterThanOrEqual(2);
  await openSky(page, { floor: 1 });
  const meteorStats = await sheet(page, info, 'meteors.png', 3, 640, 360, PALETTES.map((palette, i): SheetCell => ({
    frame: still({ palette, tick: meteors[i]!.tick }), label: `${PALETTE_NAMES[palette]} meteor tick ${meteors[i]!.tick}`,
  })));
  const auroraStats = await sheet(page, info, 'aurora.png', 3, 640, 360, PALETTES.map((palette, i): SheetCell => ({
    frame: still({ palette, biome: 4, hero: i % 4 }), label: `${PALETTE_NAMES[palette]} aurora mode ${i % 4}`,
  })));
  const strikeStats = await sheet(page, info, 'lightning.png', 3, 640, 360, PALETTES.map((palette, i): SheetCell => {
    const s = strikes[i % strikes.length]!;
    return { frame: still({ palette, biome: 3, tick: i % 2 === 0 ? s.tick : s.strobe2 }), label: `${PALETTE_NAMES[palette]} strobe ${i % 2 === 0 ? 1 : 2}` };
  }));
  for (const c of [...meteorStats, ...auroraStats, ...strikeStats]) expect(c.nearWhite, c.label).toBeLessThanOrEqual(0.005);
  console.log(`A13 worst near-white ${(Math.max(...[...meteorStats, ...auroraStats, ...strikeStats].map((c) => c.nearWhite)) * 100).toFixed(3)}%`);
  await sheet(page, info, 'meteors-2x.png', 3, 640, 360, PALETTES.map((palette, i): SheetCell => ({
    frame: still({ palette, tick: meteors[i]!.tick }), label: `${PALETTE_NAMES[palette]} meteor at 1.33x`, rect: meteors[i]!.rect,
  })));
  await sheet(page, info, 'bolts-1to1.png', 2, 960, 540, [0, 1, 2, 3].map((i): SheetCell => {
    const s = strikes[i % strikes.length]!;
    return { frame: still({ palette: [0, 3, 4, 5][i]!, biome: 3, tick: s.tick }), label: `${PALETTE_NAMES[[0, 3, 4, 5][i]!]} bolt at x ${s.x.toFixed(2)}`, rect: boltCrop(s) };
  }));
  await sheet(page, info, 'aurora-1to1.png', 2, 960, 540, [0, 3, 4, 5].map((palette): SheetCell => ({
    frame: still({ palette, biome: 4 }), label: `${PALETTE_NAMES[palette]} aurora`, rect: [480, 0, 960, 540],
  })));
  await sheet(page, info, 'aurora-zoom.png', 2, 960, 540, [0, 3].map((palette): SheetCell => ({
    frame: still({ palette, biome: 4 }), label: `${PALETTE_NAMES[palette]} aurora at 3x`, rect: [480, 90, 320, 180],
  })));
  await openSky(page, { post: 'off' });
  const aurora = await diff(page, still({ biome: 4 }), still({ biome: 0 }));
  const strike = await diff(page, still({ biome: 3, tick: strikes[0]!.tick }), still({ biome: 0, tick: strikes[0]!.tick }));
  const reduced = await reducedStrike(page, strikes[0]!.tick);
  console.log(`A13 aurora ${aurora.bytes} bytes; lightning ${strike.bytes} bytes; reduced lightning ${reduced.bytes} bytes, max ${reduced.max}`);
  expect(aurora.bytes).toBeGreaterThan(100_000);
  expect(strike.bytes).toBeGreaterThan(100_000);
  expectNotSame(info, strike, 'A13 lightning, the same comparison with motion on');
  expectSame(info, reduced, 'A13 reduced lightning');
  // The aurora at gain 1 stays inside section 6.7's sky budget, L .8, in linear HDR. Stars are compiled out, so a star in a curtain does not count.
  expect(quiet(600, 0), 'tick 600 has no meteor in biome 0 or 4').toBe(true);
  await openSky(page, { iso: 'nostars', post: 'off' });
  const light: string[] = [];
  for (const palette of PALETTES) {
    const a = await page.evaluate((f) => window.__skyDev!.addedLight(f[0]!, f[1]!, 0.01), [still({ palette, biome: 4 }), still({ palette, biome: 0 })]);
    light.push(`${PALETTE_NAMES[palette]} ${a.pixels} px, peak ${a.peak.toFixed(3)}, added ${a.peakAdded.toFixed(3)}`);
    expect(a.pixels, `${PALETTE_NAMES[palette]} aurora pixels`).toBeGreaterThan(50_000);
    expect(a.peak, `${PALETTE_NAMES[palette]} aurora peak luminance`).toBeLessThanOrEqual(0.8);
  }
  console.log(`A13 aurora luminance, gain 1, post off: ${light.join('; ')}`);
});

/** A13's reduced row: biome 3 against biome 0 at a strike tick, both under reduced motion, on a page open with post off. */
async function reducedStrike(page: Page, tick: number): Promise<Diff> {
  return diff(page, still({ biome: 3, tick, reducedMotion: true }), still({ biome: 0, tick, reducedMotion: true }));
}

// ---- M8: whole layer ----

test('A15 viewports: 21:9, portrait and roll', async ({ page }, info) => {
  gpuOnly(info);
  test.setTimeout(180_000);
  await openSky(page);
  const wide = still({ feel: { fovDeg: 68 } });
  await page.setViewportSize({ width: 2560, height: 1080 });
  await sheet(page, info, 'view-21x9.png', 1, 1920, 810, [{ frame: wide }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await sheet(page, info, 'view-portrait.png', 1, 390, 844, [{ frame: still() }]);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await sheet(page, info, 'view-roll.png', 1, 1920, 1080, [{ frame: still({ feel: { roll: 0.05 } }) }]);
});

test.describe('device scale', () => {
  test.use({ deviceScaleFactor: 2 });

  test('A16 dpr: stars keep their count and grow in buffer pixels at tier 4', async ({ page }, info) => {
    gpuOnly(info);
    test.setTimeout(180_000);
    const census = async (tier: number, scale: number) => {
      await openSky(page, { iso: 'stars', post: 'off', tier });
      const region = [Math.round(500 * scale), Math.round(30 * scale), Math.round(920 * scale), Math.round(430 * scale)] as const;
      return page.evaluate(([f, r]) => {
        const c = window.__skyDev!.starCensus(f as FrameSpec, r as readonly [number, number, number, number], 40);
        return { ...c, height: window.__shell!.stats().height };
      }, [still(), region] as const);
    };
    const t3 = await census(3, 1);
    const t4 = await census(4, 4 / 3);
    console.log(`A16 tier 3 ${JSON.stringify(t3)}; tier 4 ${JSON.stringify(t4)}`);
    expect(t3.height).toBe(1080);
    expect(t4.height).toBe(1440);
    expect(Math.abs(t4.peaks - t3.peaks) / t3.peaks).toBeLessThanOrEqual(0.05);
    const growth = t4.radius / t3.radius;
    expect(growth).toBeGreaterThan(1.15);
    expect(growth).toBeLessThan(1.55);
    await sheet(page, info, 'dpr-tier4.png', 1, 1600, 800, [{ frame: still(), rect: [640, 40, 1600, 800] }]);
  });
});

/** A17's first case: one frame before a context loss against the same frame after restore and rebuild, post off. */
async function restoreDiff(page: Page): Promise<Diff> {
  await openSky(page, { post: 'off' });
  const f = still({ hero: 1 });
  const before = await frameBytes(page, f);
  await page.evaluate(() => window.__skyDev!.loseAndRestore());
  await page.evaluate(() => { window.__shell!.rebuild(); });
  return diffBytes(before, await frameBytes(page, f));
}

test('A17 restore: same bytes within DI-58 after context loss, and rebuild compiles the nebula at any tier', async ({ page }, info) => {
  gpuOnly(info);
  test.setTimeout(180_000);
  const f = still({ hero: 1 });
  const restored = await restoreDiff(page);
  console.log(`A17 tier 3: ${restored.bytes} bytes, max ${restored.max}`);
  expectSame(info, restored, 'A17 tier 3 after restore');
  // Nebula off: the only thing that can compile its program at boot or after a restore is rebuild's draw.
  await openSky(page, { post: 'off', tier: 1 });
  await page.evaluate(() => window.__skyDev!.loseAndRestore());
  const links = await page.evaluate((s) => {
    const shell = window.__shell!, dev = window.__skyDev!;
    shell.rebuild();
    dev.hash(s);
    dev.spyLinks();
    const start = dev.links;
    shell.setTier(3);
    dev.hash(s);
    return dev.links - start;
  }, f);
  console.log(`A17 tier 1 restore, then tier 3: ${links} further links`);
  expect(links).toBe(0);
});

test('A22 same state on software: the DI-58 rows read 0 bytes on SwiftShader', async ({ page }, info) => {
  test.skip(info.project.name !== 'software', 'runs under the software project');
  test.setTimeout(420_000);
  const report: string[] = [];
  const m0 = await modeZero(page);
  report.push(`A2 bytes ${m0.states.map((d) => d.bytes).join(' ')}; heroB ${m0.heroB.bytes}`);
  m0.states.forEach((d, i) => expectSame(info, d, `A2 state ${i}`));
  expectSame(info, m0.heroB, 'A2 heroB at mix 0');
  await openSky(page, { post: 'off' });
  // The comparison itself can fail here: mode 0 against mode 1.
  const other = await diff(page, still(), still({ hero: 1 }));
  report.push(`A2n mode 1: ${other.bytes} bytes`);
  expectNotSame(info, other, 'A2n mode 1');
  for (const e of await wipeEnds(page)) {
    report.push(`A6 ${e.label}: ${e.d.bytes}`);
    expectSame(info, e.d, `A6 ${e.label}`);
  }
  const { strikes } = scanEvents();
  const reduced = await reducedStrike(page, strikes[0]!.tick);
  report.push(`A13 reduced lightning: ${reduced.bytes}`);
  expectSame(info, reduced, 'A13 reduced lightning');
  await openSky(page, { iso: 'stars', post: 'off' });
  const same = await diff(page, still(), still());
  report.push(`A9 same tick: ${same.bytes}`);
  expectSame(info, same, 'A9 same tick');
  const restored = await restoreDiff(page);
  report.push(`A17 tier 3: ${restored.bytes}`);
  expectSame(info, restored, 'A17 after restore');
  const { width, height, renderer } = await page.evaluate(() => ({ ...window.__shell!.stats(), renderer: window.__shell!.rendererInfo().renderer }));
  console.log(`A22 ${width}x${height} on ${renderer}\n${report.join('\n')}`);
  expect(renderer).toMatch(/swiftshader/i);
});

/** A23: two states, so the sun's bands and its colours both vary. */
const TIER0_STATES = [still(), still({ palette: 4, tick: 4097 })];

/** The sky alone at the page's tier, post off: p50 of 60 frameAt calls, as A18 measures. */
async function skyCost(page: Page): Promise<number> {
  return page.evaluate((f) => {
    const shell = window.__shell!;
    const times: number[] = [];
    for (let i = 0; i < 60; i++) times.push(shell.frameAt(0, { ...f, tick: 600 + i * 2 }));
    times.sort((a, b) => a - b);
    return times[30]!;
  }, still());
}

/**
 * Links during a switch from tier 3 to tier 0 and back, on a page opened at tier 3 with post on. Post on, because under
 * post=off DevPost draws the scene to the canvas while precompile compiled it for the composer's target, and the output
 * colour space is part of a program's key (Agents.md), so with post off every scene program links at its first draw.
 */
async function tierZeroLinks(page: Page): Promise<number> {
  return page.evaluate((f) => {
    const shell = window.__shell!, dev = window.__skyDev!;
    dev.hash(f);
    dev.spyLinks();
    const start = dev.links;
    shell.setTier(0);
    dev.hash(f);
    shell.setTier(3);
    dev.hash(f);
    return dev.links - start;
  }, still());
}

/** Sky draw calls at tier 0 and then tier 3, on a page with post off so composer draws do not count. */
async function tierCalls(page: Page): Promise<{ calls0: number; calls3: number }> {
  return page.evaluate((f) => {
    const shell = window.__shell!, dev = window.__skyDev!;
    shell.setTier(0);
    dev.hash(f);
    const calls0 = shell.stats().calls;
    shell.setTier(3);
    dev.hash(f);
    return { calls0, calls3: shell.stats().calls };
  }, still());
}

test('A23 tier 0: mode 0 unchanged but for the stars, the plain sun in every mode, cheaper, and no link at the switch', async ({ page }, info) => {
  test.skip(info.project.name !== 'software', 'runs under the software project, where tier 0 is the software tier');
  test.setTimeout(300_000);
  const report: string[] = [];
  // Controls first: tier 0 drawn with the program of tiers 1 to 4, as before D-007. With stars compiled out it gives the
  // frames the cut must equal in mode 0, since the nebula's gain is 0 at tier 0 anyway. It tells the modes apart, so the
  // equalities below can fail. With everything on it gives the cost the cut is judged against, and the stars it drops.
  await openSky(page, { post: 'off', tier: 0, tier0: 'full', iso: 'nostars' });
  const noStars: Uint8Array[] = [];
  for (const s of TIER0_STATES) noStars.push(await frameBytes(page, s));
  for (const hero of [1, 2, 3]) {
    const d = await diff(page, still(), still({ hero }));
    report.push(`control mode ${hero} against mode 0: ${d.bytes} bytes, max ${d.max}`);
    expect(d.bytes, `control mode ${hero}`).toBeGreaterThan(100_000);
  }
  await openSky(page, { post: 'off', tier: 0, tier0: 'full' });
  const withStars = await frameBytes(page, still());
  const fullCost = await skyCost(page);
  await openSky(page, { tier: 3, tier0: 'full' });
  const fullSwitch = await tierZeroLinks(page);
  // The shipped tier 0.
  await openSky(page, { post: 'off', tier: 0 });
  for (let i = 0; i < TIER0_STATES.length; i++) {
    const d = diffBytes(noStars[i]!, await frameBytes(page, TIER0_STATES[i]!));
    report.push(`mode 0 state ${i} against the control without stars: ${d.bytes} bytes, max ${d.max}`);
    expectSame(info, d, `A23 mode 0 state ${i}`);
  }
  const stars = diffBytes(withStars, await frameBytes(page, still()));
  report.push(`mode 0 against the control with stars: ${stars.bytes} bytes, max ${stars.max}`);
  expect(stars.bytes, 'A23 the stars are what tier 0 drops').toBeGreaterThan(0);
  for (const hero of [1, 2, 3]) {
    const d = await diff(page, still(), still({ hero }));
    report.push(`mode ${hero} against mode 0: ${d.bytes} bytes, max ${d.max}`);
    expectSame(info, d, `A23 mode ${hero} is the sun`);
  }
  const mid = await diff(page, still(), wipe(1, 2, 0.5));
  report.push(`wipe 1>2 mix .5 against mode 0: ${mid.bytes} bytes, max ${mid.max}`);
  expectSame(info, mid, 'A23 a wipe is the sun');
  const cost = await skyCost(page);
  report.push(`sky alone at tier 0, frameAt p50: ${cost.toFixed(1)} ms, control ${fullCost.toFixed(1)} ms`);
  const calls = await tierCalls(page);
  // Precompile links both sky programs, so the switch to tier 0 links no more than the control's, which has none of its own.
  await openSky(page, { tier: 3 });
  const links = await tierZeroLinks(page);
  report.push(`tier 3 to 0 and back, post on: ${links} links, control ${fullSwitch}; post off: ${calls.calls0} calls at tier 0, ${calls.calls3} at tier 3`);
  console.log(`A23\n${report.join('\n')}`);
  expect(cost, 'A23 tier 0 cheaper than the control').toBeLessThan(fullCost);
  expect(links, 'A23 links at the switch').toBe(fullSwitch);
  expect(calls.calls0).toBe(1);
  expect(calls.calls3).toBe(2);
});

test('A23v tier 0 sheets: the four modes at tier 0, shipped and as before D-007, for viewing', async ({ page }, info) => {
  test.setTimeout(120_000);
  for (const [name, query] of [['tier0-modes.png', {}], ['tier0-before.png', { tier0: 'full' }]] as const) {
    await openSky(page, { tier: 0, ...query });
    const { width, height } = await page.evaluate(() => window.__shell!.stats());
    await sheet(page, info, name, 2, width, height, MODES.map((hero) => ({ frame: still({ hero }), label: `mode ${hero}` })));
  }
});

test('A18 software: clean on SwiftShader at tier 0', async ({ page }, info) => {
  test.skip(info.project.name !== 'software', 'runs under the software project');
  test.setTimeout(240_000);
  await openSky(page, { tier: 0, post: 'off' });
  const r = await page.evaluate((f) => {
    const shell = window.__shell!;
    const times: number[] = [];
    for (let i = 0; i < 60; i++) times.push(shell.frameAt(0, { ...f, tick: 600 + i * 2 }));
    times.sort((a, b) => a - b);
    return { p50: times[30]!, p95: times[57]!, renderer: shell.rendererInfo().renderer };
  }, still());
  console.log(`A18 ${JSON.stringify(r)}`);
  expect(r.renderer).toMatch(/swiftshader/i);
  await sheet(page, info, 'software.png', 1, 1280, 720, [{ frame: still() }]);
  expect(r.p50).toBeLessThanOrEqual(25);
});

test('A19 timing: indicative frame time under the stand-in stack', async ({ page }, info) => {
  gpuOnly(info);
  test.setTimeout(120_000);
  await openSky(page);
  const r = await page.evaluate((f) => {
    const shell = window.__shell!;
    const times: number[] = [];
    for (let i = 0; i < 300; i++) times.push(shell.frameAt(0, { ...f, tick: 600 + i * 2 }));
    times.sort((a, b) => a - b);
    return { p50: times[150]!, p95: times[285]! };
  }, still());
  console.log(`A19 p50 ${r.p50.toFixed(2)} ms, p95 ${r.p95.toFixed(2)} ms`);
  expect(r.p50).toBeLessThanOrEqual(3);
});
