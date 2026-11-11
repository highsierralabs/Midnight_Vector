// D-003 (seam, T09 and T06 under DI-72): the veil control on the app with T06's post. T09's B11 needs veil(L) to pass
// near-white, chroma and haze lift and fail blackP10 (> 25). At DI-72's L = .05 the app reads chroma 62.3 and blackP10
// exactly 25, so the control passes the gate it exists to fail. This regression runs B11's veil test exactly at the L
// T09's spec uses, read from its source, so it turns green when the ruled strength lands, and prints a strength sweep.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Biome, PaletteId } from '../../../src/contracts/index';
import { expect, test } from '../../support/pw';
import { openHarness } from '../../forever/support/open';

const KEY = { chunk: 5, local: 12.5, tick: 28800 };
const ZONE = { palette: PaletteId.SUNSET_DRIVE, biome: Biome.BOULEVARD, hero: 0 } as const;
const SRC = readFileSync(resolve('tests/forever/washout.spec.ts'), 'utf8');
const num = (name: string): number => Number(new RegExp(`const ${name} = ([\\d.]+);`).exec(SRC)?.[1]);
const VEIL_L = num('VEIL_L');
const NEAR_WHITE = num('NEAR_WHITE');
const CHROMA = num('CHROMA');
const HAZE = num('HAZE');
const BLACK_P10 = num('BLACK_P10');

test('D-003: the veil control at T09s strength passes near-white, chroma and haze, and fails blackP10 on the app', async ({ page }, info) => {
  test.skip(info.project.name !== 'gpu', 'needs the 1080p viewport and the real GPU');
  test.setTimeout(180_000);
  for (const v of [VEIL_L, NEAR_WHITE, CHROMA, HAZE, BLACK_P10]) expect(Number.isFinite(v)).toBe(true);
  await openHarness(page, info, { tier: 3 });
  const r = await page.evaluate(({ key, zone, strengths }) => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    mv.manual(true);
    mv.forceZone(zone.palette, zone.biome, zone.hero);
    mv.setPost('full');
    mv.setMsaa(2);
    const clean = lab.washoutAt(key);
    const sweep: Record<string, unknown> = {};
    for (const l of strengths) {
      lab.controls.veil(l);
      sweep[String(l)] = lab.washoutAt(key);
      lab.controls.veil(0);
    }
    // The pose: renderAt takes camX and camY from the sim, so B11's frame depends on where DEMO was at manual(true).
    // DEMO is deterministic from boot, so fixed ticks are fixed poses.
    const poses: { tick: number; blackP10: number; chroma: number }[] = [];
    for (let t = 600; t <= 4200; t += 300) {
      lab.stepToTick(t);
      lab.controls.veil(strengths[0]!);
      const m = lab.washoutAt(key);
      lab.controls.veil(0);
      poses.push({ tick: t, blackP10: m.blackP10, chroma: Number(m.meanChroma.toFixed(2)) });
    }
    return { clean, sweep, poses };
  }, { key: KEY, zone: ZONE, strengths: [...new Set([VEIL_L, 0.05, 0.06, 0.07, 0.08, 0.1])] });
  console.log(`D-003 limits: nearWhite < ${NEAR_WHITE}, chroma > ${CHROMA}, haze < ${HAZE}, blackP10 > ${BLACK_P10}; T09's VEIL_L ${VEIL_L}`);
  console.log(`D-003 clean ${JSON.stringify(r.clean)}`);
  for (const [l, m] of Object.entries(r.sweep)) console.log(`D-003 veil(${l}) ${JSON.stringify(m)}`);
  console.log(`D-003 veil(${VEIL_L}) by pose ${JSON.stringify(r.poses)}`);
  const at = r.sweep[String(VEIL_L)] as { nearWhitePct: number; meanChroma: number; hazeLift: number; blackP10: number };
  expect(at.nearWhitePct).toBeLessThan(NEAR_WHITE);
  expect(at.meanChroma).toBeGreaterThan(CHROMA);
  expect(at.hazeLift).toBeLessThan(HAZE);
  expect(at.blackP10).toBeGreaterThan(BLACK_P10);
  // A negative control must fail its gate at every pose B11 can open at, or B11 passes or fails by load timing.
  for (const p of r.poses) expect(p.blackP10, `blackP10 at sim tick ${p.tick}`).toBeGreaterThan(BLACK_P10);
});
