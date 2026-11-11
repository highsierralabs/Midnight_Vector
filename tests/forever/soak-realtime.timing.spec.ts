// The operator's 2-hour real-time soak, section 14 risk 7 and human check B22. Off by default: set TERRAIN_SOAK_MINUTES.
// The rAF loop runs as it would for a player, and the harness only samples, every 5 minutes.
import { leakStats } from '../../src/harness/metrics';
import { expect, test } from '../support/pw';
import { openHarness } from './support/open';

const SAMPLE_EVERY_MS = 5 * 60_000;
const MB = 1024 * 1024;
const HEAP_LIMIT = 64 * MB;
const GROWTH_LIMIT = MB;

const minutes = Number(process.env['TERRAIN_SOAK_MINUTES'] ?? 0);

test('real-time soak: heap within section 9.3, travel rising (B22)', async ({ page }, info) => {
  test.skip(!(minutes > 0), 'operator-run: set TERRAIN_SOAK_MINUTES');
  test.setTimeout((minutes + 2) * 60_000);
  await openHarness(page, info, { period: 0 });
  const heaps: number[] = [];
  let lastDistance = -1;
  const samples = Math.max(1, Math.floor((minutes * 60_000) / SAMPLE_EVERY_MS));
  for (let i = 0; i < samples; i++) {
    await page.waitForTimeout(SAMPLE_EVERY_MS);
    const s = await page.evaluate(() => {
      const st = window.__mv!.stats();
      return { heap: window.__mvLab!.heapAfterGc(), chunk: st.chunk, local: st.local, links: window.__mvLab!.links() };
    });
    const distance = s.chunk * 64 + s.local;
    console.log(`REALTIME ${(i + 1) * 5} min, heap ${(s.heap / MB).toFixed(3)} MB, chunk ${s.chunk}, links ${s.links}`);
    expect(distance, 'travel must rise').toBeGreaterThan(lastDistance);
    lastDistance = distance;
    expect(s.heap).toBeLessThanOrEqual(HEAP_LIMIT);
    heaps.push(s.heap);
  }
  const r = leakStats(heaps);
  console.log(`REALTIME ${JSON.stringify(r)}`);
  expect(r.growth).toBeLessThanOrEqual(GROWTH_LIMIT);
});
