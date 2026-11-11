// Tier 0 on SwiftShader, section 9.2. Failing means T04's HERO_SUN_ONLY path before any threshold discussion.
import { percentile } from '../../src/harness/metrics';
import { armedOnly, openHarness } from '../forever/support/open';
import { expect, test } from '../support/pw';

const P95_LIMIT = 50;

test.setTimeout(180_000);

test('tier 0 on SwiftShader: p95 at most 50 ms (B20)', async ({ page }, info) => {
  armedOnly();
  test.skip(info.project.name !== 'software', 'SwiftShader only');
  await openHarness(page, info);
  const r = await page.evaluate(() => {
    const mv = window.__mv!;
    mv.manual(true);
    const ms = window.__mvLab!.timedFrames(120, 1 / 60);
    const s = mv.stats();
    return { ms, tier: s.tier, calls: s.calls, triangles: s.triangles, renderer: window.__mvLab!.rendererInfo().renderer };
  });
  const p95 = percentile(r.ms, 0.95);
  console.log(`SOFTWARE ${r.renderer}: tier ${r.tier}, p50 ${percentile(r.ms, 0.5).toFixed(1)}, p95 ${p95.toFixed(1)} ms, ${r.calls} calls, ${r.triangles} triangles`);
  expect(r.tier).toBe(0);
  expect(p95).toBeLessThanOrEqual(P95_LIMIT);
});
