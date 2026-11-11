// Fog hides the terrain's far edge, section 6.4: at 21:9, full bend and maximum FOV, every painted boundary pixel must have
// fogK = 1. Armed: it needs real terrain. Known gap: the worst row of section 6.4 is at camera x -28.8, which renderAt cannot
// reach since it leaves sim.x alone. T03's A-test covers that on its dev page.
import { CAMERA_FOV_MAX, CHUNK_LEN } from '../../src/contracts/index';
import { expect, test } from '../support/pw';
import { armedOnly, openHarness } from './support/open';

const POSITIONS = 30;
const OK_MIN = 1000;
const TICK = 28800;

test.setTimeout(300_000);
test.use({ viewport: { width: 2520, height: 1080 } });

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'gpu', 'needs the real GPU');
});

for (const world of [{ name: 'world 0', chunk: 5 }, { name: 'world 1e9', chunk: 15625000 }]) {
  test(`edge paint: 21:9, FOV 68, bend 8e-5, ${world.name} (B7)`, async ({ page }, info) => {
    armedOnly();
    // tier 4 keeps 2520x1080 unscaled, as T03's own proof does: tier 3's pixel cap would scale it to 2199x943.
    await openHarness(page, info, { tier: 4 });
    const r = await page.evaluate(({ chunk, fov, positions, len, tick }) => {
      const mv = window.__mv!;
      const lab = window.__mvLab!;
      mv.manual(true);
      mv.setPost('off');
      mv.setMsaa(0);
      mv.setEdgePaint(true);
      mv.forceBend(8e-5, 0);
      mv.forceFov(fov);
      const totals = { ok: 0, bad: 0, interior: 0, clear: 0, other: 0, worstOk: Number.POSITIVE_INFINITY };
      for (let i = 0; i < positions; i++) {
        const c = lab.edgePaintAt({ chunk, local: (i * len) / positions, tick });
        totals.ok += c.ok;
        totals.bad += c.bad;
        totals.interior += c.interior;
        totals.clear += c.clear;
        totals.other += c.other;
        if (c.ok < totals.worstOk) totals.worstOk = c.ok;
      }
      const s = mv.stats();
      mv.setEdgePaint(false);
      return { ...totals, width: s.width, height: s.height };
    }, { chunk: world.chunk, fov: CAMERA_FOV_MAX, positions: POSITIONS, len: CHUNK_LEN, tick: TICK });
    console.log(`EDGE ${world.name} ${JSON.stringify(r)}`);
    expect(r.width).toBe(2520);
    expect(r.height).toBe(1080);
    expect(r.bad, 'a painted boundary pixel without full fog').toBe(0);
    // Per frame, as T03's A9 has it [O there: about 13,000 per frame at 21:9].
    expect(r.worstOk, 'too few painted pixels to mean anything').toBeGreaterThanOrEqual(OK_MIN);
  });
}
