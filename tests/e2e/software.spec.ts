// A29: a software boot, under the software project only. It skips itself under gpu, by routing (T00's seam).
import { expect, saveShot, test } from '../support/pw';
import { checkRasterizer } from '../support/rasterizer';
import { installR1Sampler, nodeWait, openApp, readR1 } from './lib/app';

test('software boot: SwiftShader, tier 0, no timed frames, R1 holds for 5 s (A29)', async ({ page }, info) => {
  test.skip(info.project.name !== 'software', 'software project only');
  test.setTimeout(120_000);
  await openApp(page, '', 90_000);
  const boot = await page.evaluate(() => {
    const h = window.__mvE2e!;
    return { boot: h.boot, tier: window.__mv!.stats().tier };
  });
  console.log(`A29 ${JSON.stringify(boot)}`);
  expect(checkRasterizer('software', true, boot.boot.rendererString)).toBeNull();
  expect(boot.boot.software).toBe(true);
  expect(boot.boot.measuredP95Ms).toBe(0);
  expect(boot.tier).toBe(0);
  await installR1Sampler(page, 45);
  await nodeWait(5000);
  const r = await readR1(page);
  console.log(`A29 R1 ${JSON.stringify(r.samples)} bad ${r.bad.length}`);
  expect(r.bad).toEqual([]);
  expect(r.samples['demo'] ?? 0).toBeGreaterThanOrEqual(30);
  await saveShot(page, info, 'software-tier0');
});
