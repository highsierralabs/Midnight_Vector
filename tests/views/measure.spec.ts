// T13 M4 / A12: the first-person cameras measured with the chase camera's own instruments. Far-terrain sparkle is T11's
// S1far, props hidden, at cruise; the fog bound is T09's edge paint. The chase limit gates only the chase rows here,
// which repeat T11's; the first-person rows are printed and written out, and plans/T13-views.md says what is done
// with them. The sim's ship position is written directly, which only a measurement may do, to reach the lane's walls
// and its lowest and highest flight.
import { writeFileSync } from 'node:fs';
import { BIOME_NAMES, CAMERA_FOV_MAX, CHUNK_LEN, PALETTE_NAMES, PLAY_HALF_X, PLAY_Y_MAX, PLAY_Y_MIN } from '../../src/contracts/index';
import { goto, openHarness as openArt } from '../art/support/capture';
import { buildCombos } from '../art/support/combos';
import { runSequence, type SeqArgs } from '../art/support/temporalPage';
import { BANDS, CRUISE_DU, LIMITS, SPARKLE_THRESH, TICKS_PER_FRAME } from '../art/support/thresholds';
import { armedOnly, openHarness as openForever } from '../forever/support/open';
import { expect, test } from '../support/pw';

test.beforeEach(({}, info) => { test.skip(info.project.name !== 'gpu', 'needs the real GPU'); });

const CAMS = ['chase', 'cockpit', 'nose'] as const;
const NO_PROPS: SeqArgs['layers'] = [['sky', true], ['terrain', true], ['props', false], ['fx', true]];

function args(chunk: number, local: number, tick: number): SeqArgs {
  return {
    chunk, local, tick, frames: 48, du: CRUISE_DU, dticks: TICKS_PER_FRAME, post: 'full', layers: NO_PROPS, feel: null,
    sparkleBands: [[...BANDS.farFloor], [...BANDS.midFloor]], diffBands: [], thresh: SPARKLE_THRESH, heat: false, heatGain: 8,
    slitRows: [], slitCols: [], blocks: false, curvesEvery: 0, stripBox: null, stripAt: 0, stripCount: 0, keepFramesAt: [],
  };
}

interface Row { seed: number; biome: string; palette: string; cam: string; y: number; far: number; mid: number }

for (const seed of [1985, 155]) {
  test(`A12: far-terrain sparkle in the three cameras, seed ${seed}`, async ({ page }, info) => {
    test.setTimeout(900_000);
    const combos = buildCombos(seed);
    const open = await openArt(page, info, { seed, tier: 3, period: 0 });
    const heights = [open.shipY, PLAY_Y_MIN, PLAY_Y_MAX];
    const rows: Row[] = [];
    for (let b = 0; b < 6; b++) {
      const pair = combos.pairs.filter((p) => p.biome === b).sort((x, y) => x.z0 - y.z0)[0]!;
      const s = pair.tile;
      for (let m = 0; m < CAMS.length; m++) {
        for (const y of heights) {
          await goto(page, s);
          await page.evaluate(({ m, y }) => {
            const e = window.__mvE2e!;
            e.host.overrideCam?.(m as 0 | 1 | 2);
            const st = e.sim as { y: number; prevY: number };
            st.y = y;
            st.prevY = y;
          }, { m, y });
          const r = await page.evaluate(runSequence, args(s.chunk, s.local, s.tick));
          rows.push({ seed, biome: BIOME_NAMES[b]!, palette: PALETTE_NAMES[pair.palette]!, cam: CAMS[m]!, y: +y.toFixed(2), far: r.sparkle[0]! * 100, mid: r.sparkle[1]! * 100 });
        }
      }
    }
    await page.evaluate(() => { window.__mvE2e!.host.overrideCam?.(null); });

    // T11's limit is a share of the band's pixels; everything here is printed and compared in percent.
    const limit = LIMITS.S1far.value * 100;
    const worst = (cam: string, poseOnly: boolean): Row => rows
      .filter((r) => r.cam === cam && (!poseOnly || r.y === +open.shipY.toFixed(2)))
      .reduce((a, r) => (r.far > a.far ? r : a));
    for (const r of rows) console.log(`S1far seed ${r.seed} ${r.biome} ${r.cam} y ${r.y}: far ${r.far.toFixed(3)}% mid ${r.mid.toFixed(3)}%`);
    for (const cam of CAMS) {
      const p = worst(cam, true), w = worst(cam, false);
      console.log(`A12 seed ${seed} ${cam}: worst far at the fixed pose ${p.far.toFixed(3)}% (${p.biome}); worst at any height ${w.far.toFixed(3)}% (${w.biome}, y ${w.y}); chase limit ${limit.toFixed(1)}%`);
    }
    writeFileSync(info.outputPath(`sparkle-seed${seed}.json`), JSON.stringify({ seed, limit, shipY: open.shipY, rows }, null, 1));
    // The chase rows at the fixed pose are T11's own gate, repeated, so a broken instrument shows here. T11 gates at its
    // calibration seed, 1985. At the shipped seed, 155, chase itself reads 7.8%, which DI-118 recorded and accepted, so
    // that seed's rows are all printed and none is gated.
    if (seed === 1985) {
      expect(worst('chase', true).far, 'chase S1far at the fixed pose, as tests/art/motion.spec.ts gates it').toBeLessThanOrEqual(limit);
    }
    expect(open.consoleErrors).toEqual([]);
  });
}

test.describe('edge paint in first person', () => {
  test.use({ viewport: { width: 2520, height: 1080 } });

  test('A12: at 21:9, FOV 68 and full bend, with the ship at each lane wall, every painted boundary pixel is fully fogged', async ({ page }, info) => {
    test.setTimeout(600_000);
    armedOnly();
    await openForever(page, info, { tier: 4 });
    const POSITIONS = 12;
    const cases: { cam: number; x: number; y: number }[] = [];
    for (const cam of [0, 1, 2]) for (const x of [-PLAY_HALF_X, 0, PLAY_HALF_X]) for (const y of [PLAY_Y_MIN, PLAY_Y_MAX]) cases.push({ cam, x, y });
    const out = await page.evaluate(({ cases, fov, positions, len }) => {
      const mv = window.__mv!;
      const lab = window.__mvLab!;
      const e = window.__mvE2e!;
      mv.manual(true);
      mv.setPost('off');
      mv.setMsaa(0);
      mv.setEdgePaint(true);
      mv.forceBend(8e-5, 0);
      // The widest field feel can ask for, given as feel and not as the harness's own FOV override, so the app's caps apply
      // as they do in play: section 6.4's, and first person's own (src/app/follow.ts).
      mv.forceFeel({ fovDeg: fov });
      const st = e.sim as { x: number; prevX: number; y: number; prevY: number };
      const res: { cam: number; x: number; y: number; ok: number; bad: number; worstOk: number; camX: number; ahead: number }[] = [];
      for (const c of cases) {
        e.host.overrideCam?.(c.cam as 0 | 1 | 2);
        st.x = c.x; st.prevX = c.x; st.y = c.y; st.prevY = c.y;
        let ok = 0, bad = 0, worstOk = Number.POSITIVE_INFINITY;
        for (let i = 0; i < positions; i++) {
          const n = lab.edgePaintAt({ chunk: 5, local: (i * len) / positions, tick: 28800 });
          ok += n.ok;
          bad += n.bad;
          if (n.ok < worstOk) worstOk = n.ok;
        }
        const cam = e.cam();
        res.push({ ...c, ok, bad, worstOk, camX: cam.camX, ahead: cam.ahead });
      }
      e.host.overrideCam?.(null);
      mv.forceFeel(null);
      mv.setEdgePaint(false);
      const s = mv.stats();
      return { res, width: s.width, height: s.height };
    }, { cases, fov: CAMERA_FOV_MAX, positions: POSITIONS, len: CHUNK_LEN });
    expect([out.width, out.height]).toEqual([2520, 1080]);
    for (const r of out.res) {
      console.log(`EDGE ${CAMS[r.cam]} ship x ${r.x} y ${r.y} (camera x ${r.camX.toFixed(1)}, ahead ${r.ahead}): ok ${r.ok}, bad ${r.bad}, fewest ok in a frame ${r.worstOk}`);
    }
    // First person puts the camera on the ship, so the wall rows really are at camera x +-40.
    for (const r of out.res) if (r.cam !== 0) expect(Math.abs(r.camX - r.x)).toBeLessThan(1e-9);
    for (const r of out.res) {
      expect(r.bad, `${CAMS[r.cam]} at x ${r.x}, y ${r.y}: a painted boundary pixel without full fog`).toBe(0);
      expect(r.worstOk, `${CAMS[r.cam]} at x ${r.x}, y ${r.y}: too few painted pixels to mean anything`).toBeGreaterThanOrEqual(1000);
    }
  });
});
