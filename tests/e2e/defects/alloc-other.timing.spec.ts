// D-008 and T10's own browser allocation gate. Section 9.2's `other` class on the integrated build, project code outside
// src/world, was at most 128 B per frame (DI-16); DI-78 loosens it to 512 B, the line B19 now holds. Test 1 prints every
// /src/ function the sampling profiler charges and asserts that line, read from T09's spec so it follows any ruled
// change. Test 2 bisects the shares, print-only. Test 3 is T10's gate on its own loop. Same harness path and URL classes
// as T09's alloc.timing.spec.ts.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CDPSession } from 'playwright/test';
import { expect, test } from '../../support/pw';
import { openHarness } from '../../forever/support/open';
import { classify } from '../../perf/support/heap';

const DT = 1 / 60;
/** Section 9.2's other line, B19's constant (DI-78: 512). */
const OTHER_LIMIT = Number(/const OTHER_LIMIT = (\d+);/.exec(readFileSync(resolve('tests/perf/alloc.timing.spec.ts'), 'utf8'))?.[1]);
/**
 * T10's own browser gate on the loop alone, with every layer frame and post stubbed, because the profiler charges code
 * inlined into drawStep or body to them. The same 64 B as A8's Node gate; measured 18.5 to 39.9 over three runs, mostly
 * doubles boxed into contract calls (feel.update(dt), post.render(dt)) and frozen core helpers (writePhases, writeCameraPose).
 */
const LOOP_LIMIT = 64;

interface Node { callFrame: { functionName: string; url: string; lineNumber: number }; selfSize: number; children: Node[] }

async function profile(cdp: CDPSession, run: () => Promise<number>): Promise<{ frames: number; rows: { fn: string; url: string; line: number; bytes: number; cls: string }[] }> {
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 1024, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  const frames = await run();
  const { profile: p } = await cdp.send('HeapProfiler.stopSampling');
  const map = new Map<string, { fn: string; url: string; line: number; bytes: number; cls: string }>();
  const walk = (n: Node): void => {
    if (n.selfSize > 0) {
      const { functionName, url, lineNumber } = n.callFrame;
      const key = `${functionName}|${url}|${lineNumber}`;
      const e = map.get(key) ?? { fn: functionName || '(anonymous)', url: url.replace(/^https?:\/\/[^/]+/, '').replace(/\?t=\d+$/, ''), line: lineNumber + 1, bytes: 0, cls: classify(url) };
      e.bytes += n.selfSize;
      map.set(key, e);
    }
    for (const c of n.children) walk(c);
  };
  walk((p as unknown as { head: Node }).head);
  const rows = [...map.values()].map((r) => ({ ...r, bytes: r.bytes / frames })).sort((a, b) => b.bytes - a.bytes);
  return { frames, rows };
}

test('section 9.2 other: every /src/ function charged per frame, and src/app within its own gate', async ({ page }, info) => {
  test.setTimeout(600_000);
  await openHarness(page, info, { tier: 3 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  const steps = (n: number): Promise<number> => page.evaluate(({ n, dt }) => { window.__mv!.stepFrames(n, dt); return n; }, { n, dt: DT });
  await page.evaluate(() => { const mv = window.__mv!; mv.manual(true); mv.setPost('full'); mv.setMsaa(2); });
  for (let i = 0; i < 6; i++) await steps(3000);
  await profile(cdp, () => steps(4000));
  const runs = [await profile(cdp, () => steps(4000)), await profile(cdp, () => steps(4000))];
  const sums = runs.map((r) => {
    const by: Record<string, number> = {};
    for (const row of r.rows) by[row.cls] = (by[row.cls] ?? 0) + row.bytes;
    const app = r.rows.filter((x) => x.url.includes('/src/app/')).reduce((s, x) => s + x.bytes, 0);
    return { by, app };
  });
  for (const [i, r] of runs.entries()) {
    console.log(`ALLOC-OTHER run ${i}: classes ${JSON.stringify(Object.fromEntries(Object.entries(sums[i]!.by).map(([k, v]) => [k, Number(v.toFixed(1))])))}, src/app ${sums[i]!.app.toFixed(1)} B/frame`);
    for (const row of r.rows.filter((x) => x.cls === 'other' || x.cls === 'world')) {
      console.log(`ALLOC-OTHER   ${row.bytes.toFixed(1).padStart(7)} ${row.cls.padEnd(5)} ${row.fn} ${row.url}:${row.line}`);
    }
  }
  // src/app's line here includes sibling code inlined into the loop; test 3 measures the loop alone.
  const other = Math.max(...sums.map((s) => s.by['other'] ?? 0));
  console.log(`ALLOC-OTHER other ${other.toFixed(1)} B/frame against ${OTHER_LIMIT} (DI-78)`);
  expect(OTHER_LIMIT, 'B19 still declares its other line').toBe(512);
  expect(other, 'section 9.2 other').toBeLessThanOrEqual(OTHER_LIMIT);
});

/**
 * The profiler charges an allocation to the physical frame, so code inlined into a caller is charged to the caller: the
 * per-function list cannot separate src/app from a layer frame inlined into drawStep. This bisects instead: each
 * component's per-frame methods are replaced by no-ops in turn, and the drop in the `other` and `world` classes is that
 * component's own allocation, with whatever it inlines. The remainder with everything stubbed is the loop's own.
 */
test('section 9.2 other, by bisection, print-only: each component stubbed in turn', async ({ page }, info) => {
  test.setTimeout(900_000);
  await openHarness(page, info, { tier: 3 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  const steps = (n: number): Promise<number> => page.evaluate(({ n, dt }) => { window.__mv!.stepFrames(n, dt); return n; }, { n, dt: DT });
  await page.evaluate(() => { const mv = window.__mv!; mv.manual(true); mv.setPost('full'); mv.setMsaa(2); });
  const stub = (which: string[]): Promise<void> => page.evaluate((w) => {
    const h = window.__mvE2e!.host;
    const g = window as unknown as { __saved?: [object, string, unknown][] };
    for (const [o, k, f] of g.__saved ?? []) (o as Record<string, unknown>)[k] = f;
    g.__saved = [];
    const noop = (): void => undefined;
    const put = (o: object, k: string): void => { g.__saved!.push([o, k, (o as Record<string, unknown>)[k]]); (o as Record<string, unknown>)[k] = noop; };
    for (const name of w) {
      const layer = h.layers.find((l) => l.name === name);
      if (layer) put(layer, 'frame');
      if (name === 'post') { put(h.post, 'frame'); put(h.post, 'render'); }
    }
  }, which);
  const measure = async (label: string, which: string[]): Promise<Record<string, number>> => {
    await stub(which);
    for (let i = 0; i < 3; i++) await steps(3000);
    await profile(cdp, () => steps(3000));
    const r = await profile(cdp, () => steps(4000));
    const by: Record<string, number> = {};
    for (const row of r.rows) by[row.cls] = (by[row.cls] ?? 0) + row.bytes;
    const app = r.rows.filter((x) => x.url.includes('/src/app/')).reduce((s, x) => s + x.bytes, 0);
    const out = { other: Number((by['other'] ?? 0).toFixed(1)), world: Number((by['world'] ?? 0).toFixed(1)), libs: Number((by['libs'] ?? 0).toFixed(1)), app: Number(app.toFixed(1)) };
    console.log(`ALLOC-BISECT ${label.padEnd(18)} ${JSON.stringify(out)}`);
    return out;
  };
  const base = await measure('none stubbed', []);
  const res: Record<string, Record<string, number>> = {};
  for (const c of ['sky', 'terrain', 'props', 'fx', 'post']) res[c] = await measure(`${c} stubbed`, [c]);
  const all = await measure('all stubbed', ['sky', 'terrain', 'props', 'fx', 'post']);
  await stub([]);
  for (const [c, r] of Object.entries(res)) console.log(`ALLOC-BISECT share of ${c}: other ${(base['other']! - r['other']!).toFixed(1)}, world ${(base['world']! - r['world']!).toFixed(1)} B/frame`);
  console.log(`ALLOC-BISECT left with sky, terrain, props, fx and post stubbed: other ${all['other']}, of which src/app ${all['app']} B/frame`);
  expect(all['libs']!, 'with post stubbed nothing renders, so three allocates nothing').toBeLessThan(50);
});

test('loop alone: src/app per frame with every layer and post stubbed', async ({ page }, info) => {
  test.setTimeout(600_000);
  await openHarness(page, info, { tier: 3 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  const steps = (n: number): Promise<number> => page.evaluate(({ n, dt }) => { window.__mv!.stepFrames(n, dt); return n; }, { n, dt: DT });
  await page.evaluate(() => {
    const mv = window.__mv!;
    mv.manual(true);
    const h = window.__mvE2e!.host;
    const noop = (): void => undefined;
    for (const l of h.layers) l.frame = noop;
    h.post.frame = noop;
    h.post.render = noop;
  });
  for (let i = 0; i < 4; i++) await steps(3000);
  await profile(cdp, () => steps(3000));
  const apps: number[] = [];
  for (let k = 0; k < 3; k++) {
    const r = await profile(cdp, () => steps(4000));
    const appRows = r.rows.filter((x) => x.url.includes('/src/app/'));
    apps.push(appRows.reduce((s, x) => s + x.bytes, 0));
    console.log(`ALLOC-LOOP run ${k}: src/app ${apps[k]!.toFixed(1)} B/frame: ${appRows.map((x) => `${x.fn}:${x.line} ${x.bytes.toFixed(1)}`).join(', ')}`);
  }
  expect(Math.max(...apps), 'src/app per frame, loop alone').toBeLessThanOrEqual(LOOP_LIMIT);
});
