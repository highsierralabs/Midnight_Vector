// D-007: tier 0 on SwiftShader misses section 9.2's 50 ms. T09's B20 reads p95 63.9 ms at 640x360. This regression
// repeats B20's measurement (timedFrames(120, 1/60) after a warm-up, tier 0) and prints the cost with each layer hidden
// and with post off, so the owner is named by the data. T03 and T04 name their tier-0 responses (NO_SUN_COLUMN,
// HERO_SUN_ONLY) in their plans. Red until all layers fit.
import { expect, test } from '../../support/pw';
import { openHarness } from '../../forever/support/open';

const P95_LIMIT = 50;

test('D-007: tier 0 on SwiftShader at p95 50 ms, by layer', async ({ page }, info) => {
  test.skip(info.project.name !== 'software', 'software project only');
  test.setTimeout(300_000);
  await openHarness(page, info);
  const r = await page.evaluate(() => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    mv.manual(true);
    const p95 = (ms: number[]): number => { const s = [...ms].sort((a, b) => a - b); return s[Math.ceil(0.95 * s.length) - 1]!; };
    const p50 = (ms: number[]): number => { const s = [...ms].sort((a, b) => a - b); return s[Math.ceil(0.5 * s.length) - 1]!; };
    const measure = (): { p50: number; p95: number; calls: number; triangles: number } => {
      lab.timedFrames(30, 1 / 60);
      const ms = lab.timedFrames(120, 1 / 60);
      const s = mv.stats();
      return { p50: p50(ms), p95: p95(ms), calls: s.calls, triangles: s.triangles };
    };
    const out: Record<string, unknown> = { tier: mv.stats().tier, size: [mv.stats().width, mv.stats().height] };
    out['all'] = measure();
    for (const n of ['sky', 'terrain', 'props', 'fx'] as const) {
      mv.setLayerVisible(n, false);
      out[`no ${n}`] = measure();
      mv.setLayerVisible(n, true);
    }
    mv.setPost('off');
    out['post off'] = measure();
    mv.setPost('bare');
    out['all again'] = measure();
    return out;
  });
  for (const [k, v] of Object.entries(r)) console.log(`D-007 ${k} ${JSON.stringify(v)}`);
  expect(r['tier']).toBe(0);
  expect((r['all'] as { p95: number }).p95).toBeLessThanOrEqual(P95_LIMIT);
});
