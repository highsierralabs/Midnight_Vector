// A forced tier switch, section 14 risk 10. Armed: it needs T03's and T05's ramps. tick + 2 per renderAt, because T05's
// density ramp runs on v.tick, so at a fixed tick the spec would sit at the start of the ramp and report a false pass. The
// printed difference therefore includes time-based animation.
//
// "Tiers as asked" is read from the drawing buffer, not stats().tier: governor.force moves profile.tier at once by
// contract, so stats().tier cannot fail (V1-T09). A tier applies at a frame's step 15 and shows from the frame after, so
// the buffer after a tier's second frame must fit that tier's maxPixels, and be larger than the tier below allows
// wherever the full-size buffer is. T06's pixelRatioFor keeps floor(w * r) * floor(h * r) within maxPixels.
import type { Tier } from '../../src/contracts/index';
import { fakeProfile } from '../../src/testing/scriptedFrame';
import { expect, test } from '../support/pw';
import { armedOnly, openHarness } from './support/open';

const CYCLE = [4, 3, 2, 1, 0, 1, 2, 3] as const;
const FRAMES_PER_TIER = 90;
const MAX_DIFF = 16;

test.setTimeout(300_000);

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'gpu', 'needs the real GPU');
});

test('tier switch: no links, tiers as asked, no large pop (B16)', async ({ page }, info) => {
  armedOnly();
  await openHarness(page, info);
  const r = await page.evaluate(({ cycle, frames, chunk }) => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    mv.manual(true);
    const linksBefore = lab.links();
    let tick = 28800;
    let width = 0;
    let height = 0;
    let prev: Uint8Array | null = null;
    const report: { tier: number; asked: number; maxDiff: number; resized: number; pixels: number; size: string }[] = [];
    for (const t of cycle) {
      mv.setTier(t);
      const asked = mv.stats().tier;
      let maxDiff = 0;
      let resized = 0;
      let pixels = 0;
      let size = '';
      for (let i = 0; i < frames; i++) {
        mv.renderAt(chunk, 12.5, tick);
        tick += 2;
        const s = mv.stats();
        const px = mv.pixels();
        if (i === 1) {
          pixels = s.width * s.height;
          size = `${s.width}x${s.height}`;
        }
        if (s.width === width && s.height === height && prev) {
          const d = lab.metrics.bandDiff(prev, px, s.width, s.height, 0, s.height);
          if (d > maxDiff) maxDiff = d;
        } else {
          // A frame where the canvas size changes cannot be compared with the one before it.
          resized++;
        }
        width = s.width;
        height = s.height;
        prev = px;
      }
      report.push({ tier: t, asked, maxDiff, resized, pixels, size });
    }
    return { links: lab.links() - linksBefore, report };
  }, { cycle: [...CYCLE], frames: FRAMES_PER_TIER, chunk: 5 });
  for (const t of r.report) console.log(`TIER ${JSON.stringify(t)}`);
  console.log(`TIER links ${r.links}`);
  // The cycle starts at tier 4, whose cap is above 1080p, so its buffer is the full-size one.
  const full = r.report[0]!.pixels;
  for (const t of r.report) {
    const cap = fakeProfile(t.tier as Tier).maxPixels;
    expect(t.pixels, `tier ${t.tier}: ${t.size} must fit its maxPixels ${cap}`).toBeLessThanOrEqual(cap);
    if (t.tier > 0) {
      const below = fakeProfile((t.tier - 1) as Tier).maxPixels;
      if (full > below) expect(t.pixels, `tier ${t.tier}: ${t.size} must be larger than tier ${t.tier - 1} allows (${below}), or the tier never applied`).toBeGreaterThan(below);
    }
  }
  expect(r.links).toBe(0);
  for (const t of r.report) {
    expect(t.asked).toBe(t.tier);
    expect(t.maxDiff, `tier ${t.tier}`).toBeLessThanOrEqual(MAX_DIFF);
  }
});
