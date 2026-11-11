// The soak, section 9.3 and 11.3: 72,000 frames at 600 u/s, which is about 720 km. Heap slope is kept for leaks only, since
// it reads 0 for a 15.5 KB/frame allocator (section 9.2). Runs on the shell for the machinery and on the app for the real
// ceilings. Warm-up is the first batch; the constant-resource gates read from sample 1 on.
import { CHUNK_LEN } from '../../src/contracts/index';
import { leakStats } from '../../src/harness/metrics';
import { expect, test } from '../support/pw';
import { openHarness, target } from './support/open';

const BATCH = 3600;
const DT = 0.125;
const MB = 1024 * 1024;
const GROWTH_LIMIT = MB;
const SPREAD_LIMIT = 64 * 1024;
const HEAP_LIMIT = 64 * MB;
const CALLS_LIMIT = 68;
const TRIANGLES_LIMIT = 1_500_000;
const HIDDEN_LIMIT = 64;
const SOAK_KM_FLOOR = 700;

test.setTimeout(45 * 60_000);

test('soak: every ceiling holds (A18, B15)', async ({ page }, info) => {
  const frames = Number(process.env['TERRAIN_SOAK_FRAMES'] ?? 72000);
  const batches = Math.max(2, Math.round(frames / BATCH));
  await openHarness(page, info, { period: 0, tier: 3 });
  const calibration = await page.evaluate(() => {
    window.__mv!.manual(true);
    return { gc: typeof (window as unknown as { gc?: unknown }).gc, heap: window.__mvLab!.heapCalibration() };
  });
  expect(calibration.gc, 'gc() is missing: this belongs under gpu-timing').toBe('function');
  expect(calibration.heap, 'bucketed memory info would make this soak read nothing').toBeGreaterThanOrEqual(1000);

  // Read before batch 0, so the distance gate measures every frame flown and assumes no speed for the warm-up (V1-T09).
  const origin = await page.evaluate(() => { const s = window.__mv!.stats(); return { chunk: s.chunk, local: s.local }; });
  const wall = Date.now();
  const samples = [];
  for (let i = 0; i < batches; i++) {
    const s = await page.evaluate(({ batch, dt }) => {
      const mv = window.__mv!;
      const lab = window.__mvLab!;
      const start = performance.now();
      mv.stepFrames(batch, dt);
      const ms = performance.now() - start;
      const st = mv.stats();
      const heap = lab.heapAfterGc();
      const a = lab.audit();
      const f = lab.finite();
      return {
        heap, chunk: st.chunk, local: st.local, geometries: st.geometries, textures: st.textures, programs: st.programs, objects: a.objects,
        attributeBytes: a.attributeBytes, links: lab.links(), finite: f.ok, bad: f.bad, pendingVisible: a.pendingVisible, pendingHiddenMax: a.pendingHiddenMax,
        calls: st.calls, triangles: st.triangles, ms,
      };
    }, { batch: BATCH, dt: DT });
    samples.push(s);
    console.log(`SOAK ${i} heap ${(s.heap / MB).toFixed(3)} MB, chunk ${s.chunk}, geo ${s.geometries}, tex ${s.textures}, prog ${s.programs}, objects ${s.objects}, links ${s.links}, calls ${s.calls}, tris ${s.triangles}, ${s.ms.toFixed(0)} ms`);
  }
  console.log(`SOAK wall ${Date.now() - wall} ms, ${batches * BATCH} frames, target ${target()}`);

  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const km = (a: { chunk: number; local: number }, b: { chunk: number; local: number }): number => ((b.chunk - a.chunk) * CHUNK_LEN + (b.local - a.local)) / 1000;
  const travelled = km(origin, last);
  // From sample 1 on, past the warm-up. A short run has too few for that, so it reads all it has, and the gate still runs.
  const heapStats = leakStats((samples.length > 2 ? samples.slice(1) : samples).map((s) => s.heap));
  console.log(`SOAK travelled ${travelled.toFixed(1)} km in all, measured from before batch 0; ${km(first, last).toFixed(1)} km after warm-up; heap ${JSON.stringify(heapStats)}`);

  // Constant resources from sample 1 on. With only 2 samples, sample 1 against itself would prove nothing (V1-T09), so a
  // short run compares sample 1 with sample 0, which is already past the warm-up batch.
  const ref = samples.length > 2 ? samples[1]! : first;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    expect(b.chunk * CHUNK_LEN + b.local, `sample ${i}: travel must rise`).toBeGreaterThan(a.chunk * CHUNK_LEN + a.local);
    expect(b.geometries, `sample ${i}: geometries`).toBe(ref.geometries);
    expect(b.textures, `sample ${i}: textures`).toBe(ref.textures);
    expect(b.programs, `sample ${i}: programs`).toBe(ref.programs);
    expect(b.objects, `sample ${i}: objects`).toBe(ref.objects);
    expect(b.attributeBytes, `sample ${i}: attribute bytes`).toBe(ref.attributeBytes);
    expect(b.links, `sample ${i}: a program linked mid-game`).toBe(ref.links);
  }
  for (const [i, s] of samples.entries()) {
    expect(s.finite, `sample ${i}: ${s.bad.join(', ')}`).toBe(true);
    expect(s.pendingVisible, `sample ${i}`).toBe(0);
    expect(s.pendingHiddenMax, `sample ${i}`).toBeLessThanOrEqual(HIDDEN_LIMIT);
    expect(s.calls, `sample ${i}`).toBeLessThanOrEqual(CALLS_LIMIT);
    expect(s.triangles, `sample ${i}`).toBeLessThanOrEqual(TRIANGLES_LIMIT);
    expect(s.heap, `sample ${i}`).toBeLessThanOrEqual(HEAP_LIMIT);
  }
  expect(heapStats.growth).toBeLessThanOrEqual(GROWTH_LIMIT);
  if (samples.length >= 4) expect(heapStats.lastThreeSpread).toBeLessThanOrEqual(SPREAD_LIMIT);
  if (frames >= 72000 && target() === 'app') expect(travelled, 'section 11.3: about 723 km, measured over every batch').toBeGreaterThanOrEqual(SOAK_KM_FLOOR);
});

test('soak control: a 512-byte-per-frame leak breaches growth in 2 batches (A18, B15)', async ({ page }, info) => {
  await openHarness(page, info, { period: 0, tier: 3 });
  await page.evaluate(() => {
    window.__mv!.manual(true);
    window.__mvLab!.controls.leakProbe(512);
  });
  const heaps: number[] = [];
  for (let i = 0; i < 2; i++) {
    heaps.push(await page.evaluate(({ batch, dt }) => {
      window.__mv!.stepFrames(batch, dt);
      return window.__mvLab!.heapAfterGc();
    }, { batch: BATCH, dt: DT }));
  }
  const r = leakStats(heaps);
  console.log(`SOAK control ${JSON.stringify(r)}: 512 B over 3600 frames is 1.8 MB a batch`);
  expect(r.growth).toBeGreaterThan(GROWTH_LIMIT);
  await page.evaluate(() => { window.__mvLab!.controls.leakProbe(0); });
});

