import { expect, expectRasterizer, openDevPage, test } from '../pw';

test('gpu-timing has gc and precise memory, and the sync timer reads the proof scene (A10c)', async ({ page }, info) => {
  await openDevPage(page, '/tests/support/devshell/smoke.html', { manual: 1 });
  await expectRasterizer(page, info);
  const r = await page.evaluate(() => {
    const shell = window.__shell!;
    shell.setManual(true);
    const ms: number[] = [];
    // A tight loop, per section 11.4. rAF deltas would not track the load.
    for (let i = 0; i < 240; i++) {
      const t = shell.frameAt(1 + i / 120);
      if (i >= 30) ms.push(t);
    }
    ms.sort((a, b) => a - b);
    const at = (p: number): number => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))]!;
    return {
      gc: typeof (window as unknown as { gc?: unknown }).gc === 'function',
      memory: typeof (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory?.usedJSHeapSize === 'number',
      p50: at(0.5),
      p95: at(0.95),
      stats: shell.stats(),
    };
  });
  console.log(`SYNC p50 ${r.p50.toFixed(2)} ms, p95 ${r.p95.toFixed(2)} ms, ${r.stats.calls} calls, ${r.stats.programs} programs, ${r.stats.triangles} triangles`);
  expect(r.gc).toBe(true);
  expect(r.memory).toBe(true);
  expect(r.p50).toBeGreaterThan(0);
  expect(Number.isFinite(r.p95)).toBe(true);
});
