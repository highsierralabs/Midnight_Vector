// The warp guard and the aperiodic world at huge distance, section 11.3. Armed: both need the real sim and world. T01's
// per-octave test is the real guard on noise; this proves it holds through integration.
import { CHUNK_LEN, CHUNK_LIMIT, ZONE_CHUNKS } from '../../src/contracts/index';
import { between } from '../../src/core/coords';
import { expect, test } from '../support/pw';
import { armedOnly, openHarness } from './support/open';

const TICK = 28800;
const SHIMMER_RATIO = 1.25;
const NON_FLAT_STD = 1;
const SILHOUETTE_STD = 2;
/**
 * B8's home zone, at or past the zone where difficulty stops rising: T01's DIFFICULTY_CAP_ZONE (src/world/zones.ts), not
 * imported, since T09 imports no sibling. The first biome-0 zone from world 0 was zone 1, at difficulty 1, against 12 in
 * every far zone, so its hazard density differed from theirs and the ratio measured more than distance (V2-T09).
 */
const HOME_ZONE = 12;
/**
 * DI-93: R1 is exact for chunk < 2^48, and from about 2^49 T03's atlas row loop cannot advance (q + 2 rounds to q), so a
 * render there hung the app's tab: VI-r1's compareAt to chunk 2^49 + 5 did not return in 20 s. warp refuses chunk >=
 * CHUNK_LIMIT; renderAt and every harness frame refuse chunk >= RENDER_END with a RangeError.
 */
const RENDER_END = CHUNK_LIMIT + 1024;
/** How long B9b waits for the page before calling it hung. Every refusal is one comparison, so this is generous. */
const HANG_MS = 15_000;

test.setTimeout(300_000);

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'gpu', 'needs the real GPU');
});

test('warp guard: six refusals with state unchanged, CHUNK_LIMIT - 1 works, travel rises (B9)', async ({ page }, info) => {
  armedOnly();
  await openHarness(page, info, { period: 0 });
  const r = await page.evaluate((limit) => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    mv.manual(true);
    const before = mv.stats();
    const refused = ([[limit, 0], [2 ** 48, 0], [1.5, 0], [5, 64], [-1, 0], [Number.NaN, 0]] as const).map(([c, l]) => mv.warp(c, l));
    const after = mv.stats();
    const accepted = mv.warp(limit - 1, 0);
    const warped = mv.stats();
    const nonFlat = lab.nonFlat(limit - 1);
    const finite = lab.finite();
    mv.setPost('off');
    mv.setMsaa(0);
    mv.renderAt(limit - 1, 0, warped.tick);
    const nonZero = lab.metrics.nonZeroCount(mv.pixels());
    const trail = [];
    for (let i = 0; i < 10; i++) {
      mv.stepFrames(1, 1 / 60);
      const s = mv.stats();
      trail.push({ chunk: s.chunk, local: s.local });
    }
    return { before, after, refused, accepted, warped, nonFlat, finite, nonZero, trail, finiteAfter: lab.finite() };
  }, CHUNK_LIMIT);
  console.log(`WARP guard ${JSON.stringify(r)}`);
  expect(r.refused).toEqual([false, false, false, false, false, false]);
  expect({ c: r.after.chunk, l: r.after.local, w: r.after.warpSerial }).toEqual({ c: r.before.chunk, l: r.before.local, w: r.before.warpSerial });
  expect(r.accepted).toBe(true);
  expect(r.warped.warpSerial).toBe(r.before.warpSerial + 1);
  expect(r.warped.chunk).toBe(CHUNK_LIMIT - 1);
  expect(r.nonFlat.std).toBeGreaterThanOrEqual(NON_FLAT_STD);
  expect(r.finite).toEqual({ ok: true, bad: [] });
  expect(r.finiteAfter).toEqual({ ok: true, bad: [] });
  expect(r.nonZero).toBeGreaterThan(0);
  let prev = { chunk: r.warped.chunk, local: r.warped.local };
  for (const t of r.trail) {
    expect(between(t, prev), 'travel must rise on every frame').toBeGreaterThan(0);
    prev = t;
  }
});

// The edge comes first, alone in its own evaluate. Past 2^48 the old code still returned (VI-r1: 2^48 + 5 to + 65541, about
// 150 ms each), so without the guard this test fails there and never makes a call that would hang the tab. Every call
// after it is raced against a timer, so a regression is reported as a hang rather than waited on until the test timeout.
test('renderAt and the lab sweeps refuse a chunk outside [0, CHUNK_LIMIT + 1024) with a RangeError, and the page still draws (DI-93, B9b)', async ({ page }, info) => {
  armedOnly();
  await openHarness(page, info, { period: 0 });
  const { warm, edge } = await page.evaluate(({ end, tick }) => {
    const mv = window.__mv!;
    mv.manual(true);
    mv.setPost('off');
    mv.setMsaa(0);
    // The first harness frame after a browser launch took about 5 s here (plan section 10), so it is spent before the race.
    const warmMs = mv.renderAt(5, 12.5, tick);
    try {
      return { warm: warmMs, edge: `returned after ${mv.renderAt(end, 12.5, tick)} ms` };
    } catch (e) {
      return { warm: warmMs, edge: e instanceof RangeError ? `RangeError: ${e.message}` : `not a RangeError: ${String(e)}` };
    }
  }, { end: RENDER_END, tick: TICK });
  console.log(`WARP range first frame ${warm.toFixed(1)} ms, edge ${edge}`);
  expect(edge, 'a render at CHUNK_LIMIT + 1024 must be refused (DI-93)').toMatch(/^RangeError: .*CHUNK_LIMIT \+ 1024/);

  const run = page.evaluate(({ tick }) => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    const far = 2 ** 49 + 5;
    const near = { chunk: 5, local: 12.5, tick };
    const beyond = { chunk: far, local: 12.5, tick };
    const verdict = (f: () => unknown): string => {
      try {
        f();
        return 'no throw';
      } catch (e) {
        return e instanceof RangeError ? 'RangeError' : `not a RangeError: ${String(e)}`;
      }
    };
    const before = mv.stats();
    const t0 = performance.now();
    const refused = {
      'renderAt 2^49 + 5': verdict(() => mv.renderAt(far, 12.5, tick)),
      'renderAt -1': verdict(() => mv.renderAt(-1, 12.5, tick)),
      'renderAt 1.5': verdict(() => mv.renderAt(1.5, 12.5, tick)),
      'renderAt NaN': verdict(() => mv.renderAt(Number.NaN, 12.5, tick)),
      'renderAt Infinity': verdict(() => mv.renderAt(Number.POSITIVE_INFINITY, 12.5, tick)),
      'compareAt to 2^49 + 5': verdict(() => lab.compareAt(near, beyond, { attempts: 1 })),
      'settle at 2^49 + 5': verdict(() => { lab.settle(beyond, 100); }),
      'refill at 2^49 + 5': verdict(() => { lab.refill(beyond); }),
    };
    return { refused, refusedMs: performance.now() - t0, before };
  }, { tick: TICK });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hung = new Promise<'hung'>((resolve) => { timer = setTimeout(() => { resolve('hung'); }, HANG_MS); });
  const r = await Promise.race([run, hung]);
  clearTimeout(timer);
  if (r === 'hung') throw new Error(`the page did not answer within ${HANG_MS} ms: a render past the range hung it (DI-93)`);
  console.log(`WARP range refused ${JSON.stringify(r.refused)} in ${r.refusedMs.toFixed(1)} ms`);
  for (const [call, v] of Object.entries(r.refused)) expect(v, call).toBe('RangeError');

  // Inside the range, by the test timeout only: a slow frame here is a layer's matter, not the guard's.
  const s = await page.evaluate(({ end, tick }) => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    const lastIn = mv.renderAt(end - 1, 12.5, tick);
    const back = mv.renderAt(5, 12.5, tick);
    return { lastIn, back, nonZero: lab.metrics.nonZeroCount(mv.pixels()), after: mv.stats() };
  }, { end: RENDER_END, tick: TICK });
  console.log(`WARP range inside ${JSON.stringify({ lastIn: s.lastIn, back: s.back, nonZero: s.nonZero })}`);
  expect(Number.isFinite(s.lastIn), 'CHUNK_LIMIT + 1023 is inside the range, and renders').toBe(true);
  expect(Number.isFinite(s.back), 'the page still renders at chunk 5 after the refusals').toBe(true);
  expect(s.nonZero).toBeGreaterThan(0);
  expect({ c: s.after.chunk, l: s.after.local, t: s.after.tick, w: s.after.warpSerial }, 'a refused render moves nothing')
    .toEqual({ c: r.before.chunk, l: r.before.local, t: r.before.tick, w: r.before.warpSerial });
});

test('warp distances: shimmer within 1.25x of world 0 at 1e9, 1e12, 1e15, 1e16 (B8)', async ({ page }, info) => {
  armedOnly();
  await openHarness(page, info, { period: 0 });
  const r = await page.evaluate(({ tick, len, worlds, homeFrom }) => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    mv.manual(true);
    mv.setPost('full');
    mv.setMsaa(2);
    // Same biome on purpose, with forced palette and no bend: comparing across biomes would measure the biome.
    function measure(chunk: number): { chunk: number; warped: boolean; shimmer: number; finite: boolean; bad: string[]; nonFlat: number; silhouette: number } {
      const warped = mv.warp(chunk, 0);
      mv.forceZone(0, 0, 0);
      mv.forceBend(0, 0);
      const key = { chunk, local: 0, tick };
      mv.setPost('full');
      mv.setMsaa(2);
      const shimmer = lab.shimmer(key).mean;
      const finite = lab.finite();
      const nonFlat = lab.nonFlat(chunk).std;
      mv.setPost('off');
      mv.setMsaa(0);
      mv.setCrackMode(true);
      const silhouette = lab.crackSweep(key, 8, 2.5).silhouetteStd;
      mv.setCrackMode(false);
      return { chunk, warped, shimmer, finite: finite.ok, bad: finite.bad, nonFlat, silhouette };
    }
    const home = measure(lab.findBiomeChunk(0, homeFrom));
    const far = worlds.map((w) => measure(lab.findBiomeChunk(0, Math.round(w / len))));
    return { home, far };
  }, { tick: TICK, len: CHUNK_LEN, worlds: [1e9, 1e12, 1e15, 1e16], homeFrom: HOME_ZONE * ZONE_CHUNKS });
  console.log(`WARP home zone ${Math.floor(r.home.chunk / ZONE_CHUNKS)} ${JSON.stringify(r.home)}`);
  for (const f of r.far) console.log(`WARP far ${JSON.stringify(f)}`);
  expect(r.home.chunk).toBeGreaterThanOrEqual(0);
  // period 0, so the zone is the chunk over ZONE_CHUNKS. Home and far then share a difficulty; day phase, gate phase and
  // landmarks can still differ, which the plan records.
  expect(Math.floor(r.home.chunk / ZONE_CHUNKS), 'home at or past the difficulty cap, as every far zone is').toBeGreaterThanOrEqual(HOME_ZONE);
  expect(r.home.warped).toBe(true);
  for (const f of r.far) {
    expect(f.chunk, 'no zone of biome 0 found in reach').toBeGreaterThan(0);
    expect(f.warped).toBe(true);
    expect(f.shimmer, `chunk ${f.chunk}`).toBeLessThanOrEqual(r.home.shimmer * SHIMMER_RATIO);
    expect(f.finite, `chunk ${f.chunk}: ${f.bad.join(', ')}`).toBe(true);
    expect(f.nonFlat, `chunk ${f.chunk}`).toBeGreaterThanOrEqual(NON_FLAT_STD);
    expect(f.silhouette, `chunk ${f.chunk}`).toBeGreaterThanOrEqual(SILHOUETTE_STD);
  }
});
