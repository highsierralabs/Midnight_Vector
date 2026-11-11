// The harness over T00's fake host on real GL. It proves the contract's plumbing before any pixel matters (A6).
// distant and again compare renders of one state with others in between, so they use DI-58's same-state bound (DI-68);
// nextRow is a different state, and keeps its own limit.
import { expect, test } from '../support/pw';
import type {} from '../../src/harness/index';
import { sameStateTolerance } from './support/open';
import { isolateFromHmr } from './support/spies';

test('pixels and stats on real GL, through a fake host (A6)', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', 'one rasterizer is enough');
  const tol = sameStateTolerance(info.project.name);
  await isolateFromHmr(page);
  await page.goto('/tests/forever/fixture/fake.html');
  await page.waitForFunction(() => window.__mv?.ready === true);
  const r = await page.evaluate(() => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    mv.manual(true);
    const at = (chunk: number, local: number, tick: number): Uint8Array => {
      mv.renderAt(chunk, local, tick);
      return mv.pixels();
    };
    const base = at(5, 3, 120);
    const { width, height } = mv.stats();
    const stats = mv.stats();
    return {
      ready: mv.ready,
      marker: window.__mvHarnessChunk,
      length: base.length,
      expected: width * height * 4,
      distant: lab.metrics.byteDiff(base, at(1029, 3, 120)),
      again: lab.metrics.byteDiff(base, at(5, 3, 120)),
      nextRow: lab.metrics.byteDiff(base, at(6, 3, 120)).bytes,
      nonZero: lab.metrics.nonZeroCount(base),
      numeric: Object.values(stats).every((v) => typeof v === 'number' && Number.isFinite(v)),
      calls: stats.calls,
      width,
      height,
    };
  });
  console.log(`FAKE ${JSON.stringify(r)} tolerance ${JSON.stringify(tol)}`);
  expect(r.ready).toBe(true);
  expect(r.marker).toBe('MV-HARNESS-CHUNK');
  expect(r.length).toBe(r.expected);
  expect(r.expected).toBe(320 * 180 * 4);
  expect(r.nonZero).toBeGreaterThan(0);
  for (const [name, d] of [['distant', r.distant], ['again', r.again]] as const) {
    expect(d.bytes, `${name}: DI-58, DI-68`).toBeLessThanOrEqual(tol.bytes);
    expect(d.max, `${name}: DI-58, a byte over 1 level fails`).toBeLessThanOrEqual(tol.max);
  }
  expect(r.nextRow).toBeGreaterThan(0);
  expect(r.numeric).toBe(true);
  expect(r.calls).toBeGreaterThan(0);
});

test('a read in a later evaluate rejects on real GL, and the guards do not depend on Node (A6)', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', 'one rasterizer is enough');
  await isolateFromHmr(page);
  await page.goto('/tests/forever/fixture/fake.html');
  await page.waitForFunction(() => window.__mv?.ready === true);
  await page.evaluate(() => {
    const mv = window.__mv!;
    mv.manual(true);
    mv.renderAt(5, 3, 120);
  });
  await expect(page.evaluate(() => window.__mv!.pixels().length)).rejects.toThrow('same run');
  await expect(page.evaluate(() => window.__mv!.restoreContext())).rejects.toThrow('loss event');
  const notManual = await page.evaluate(() => {
    const mv = window.__mv!;
    mv.manual(false);
    try {
      mv.renderAt(5, 3, 120);
      return 'no throw';
    } catch (e) {
      return String(e);
    }
  });
  expect(notManual).toContain('manual');
  // DI-93: past the R1 range a render is refused before the host is asked, so a hang in a layer cannot be reached.
  const outOfRange = await page.evaluate(() => {
    const mv = window.__mv!;
    mv.manual(true);
    try {
      mv.renderAt(2 ** 49 + 5, 3, 120);
      return 'no throw';
    } catch (e) {
      return e instanceof RangeError ? `RangeError: ${e.message}` : `not a RangeError: ${String(e)}`;
    }
  });
  expect(outOfRange).toMatch(/^RangeError: .*CHUNK_LIMIT \+ 1024/);
});
