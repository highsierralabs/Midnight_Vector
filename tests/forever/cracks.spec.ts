// No terrain cracks, section 11.3: magenta clear, flat shader, zero pitch and roll, any sky pixel under terrain in a
// column. Armed: it needs real terrain. `bare` rather than `full` on the post-on path: the vignette darkens magenta corners
// below the sky predicate, and MSAA blends a thin crack toward non-magenta (T03).
import { CAMERA_PITCH } from '../../src/contracts/index';
import { expect, saveShot, test } from '../support/pw';
import { armedOnly, openHarness } from './support/open';

const POSITIONS = [
  { name: 'world 0', chunk: 0 },
  { name: 'world 1e9', chunk: 15625000 },
  { name: 'world 1e15', chunk: 15625000000000 },
];
const FRAMES = 900;
const CONTROL_FRAMES = 300;
const STEP_U = 2.5;
const BEND = { a: 8e-5, c: -1.2e-5 };
const SILHOUETTE_STD = 2;
const TICK = 28800;

test.setTimeout(900_000);

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'gpu', 'needs the 1080p viewport and the real GPU');
});

test('no cracks: 900 frames, three distances, two paths, flat and full bend (B5)', async ({ page }, info) => {
  armedOnly();
  await openHarness(page, info);
  console.log(`CRACKS pitch cancelled by ${-CAMERA_PITCH}`);
  for (const p of POSITIONS) {
    for (const post of ['off', 'bare'] as const) {
      for (const bend of [{ a: 0, c: 0 }, BEND]) {
        const r = await page.evaluate(({ chunk, post, bend, frames, step, tick }) => {
          const mv = window.__mv!;
          const lab = window.__mvLab!;
          mv.manual(true);
          mv.setPost(post);
          mv.setMsaa(0);
          mv.forceBend(bend.a, bend.c);
          mv.setCrackMode(true);
          const sweep = lab.crackSweep({ chunk, local: 0, tick }, frames, step);
          mv.setCrackMode(false);
          return sweep;
        }, { chunk: p.chunk, post, bend, frames: FRAMES, step: STEP_U, tick: TICK });
        console.log(`CRACKS ${p.name} ${post} bend ${bend.a}: ${JSON.stringify(r)}`);
        expect(r.bad, `${p.name}, ${post}, bend ${bend.a}, worst frame ${r.worstFrame}`).toBe(0);
        expect(r.silhouetteStd, `${p.name}: a flat atlas at distance would read near 0`).toBeGreaterThanOrEqual(SILHOUETTE_STD);
      }
    }
  }
});

test('no cracks at tier 1, stride 2, at 1e15 and full bend (B5)', async ({ page }, info) => {
  armedOnly();
  await openHarness(page, info, { tier: 1 });
  for (const post of ['off', 'bare'] as const) {
    const r = await page.evaluate(({ chunk, post, bend, frames, step, tick }) => {
      const mv = window.__mv!;
      const lab = window.__mvLab!;
      mv.manual(true);
      mv.setPost(post);
      mv.setMsaa(0);
      mv.forceBend(bend.a, bend.c);
      mv.setCrackMode(true);
      const sweep = lab.crackSweep({ chunk, local: 0, tick }, frames, step);
      mv.setCrackMode(false);
      return sweep;
    }, { chunk: 15625000000000, post, bend: BEND, frames: CONTROL_FRAMES, step: STEP_U, tick: TICK });
    console.log(`CRACKS tier 1 ${post}: ${JSON.stringify(r)}`);
    expect(r.bad, `tier 1, ${post}, worst frame ${r.worstFrame}`).toBe(0);
    // As at tier 3: if terrain did not render, every column would be sky, crackCount 0, and the sweep would pass on nothing.
    expect(r.silhouetteStd, `tier 1, ${post}: a missing or flat terrain reads near 0`).toBeGreaterThanOrEqual(SILHOUETTE_STD);
  }
});

test('crack control: holes grown by 4 cells fail at every position, and reset to clean (B6)', async ({ page }, info) => {
  armedOnly();
  await openHarness(page, info);
  for (const p of POSITIONS) {
    const r = await page.evaluate(({ chunk, frames, step, tick }) => {
      const mv = window.__mv!;
      const lab = window.__mvLab!;
      mv.manual(true);
      mv.setPost('off');
      mv.setMsaa(0);
      mv.forceBend(0, 0);
      mv.setCrackMode(true);
      mv.setCrackControl(true);
      const control = lab.crackSweep({ chunk, local: 0, tick }, frames, step);
      mv.setCrackControl(false);
      // The last frame in control-off is clean: nothing the control did outlives it.
      const reset = lab.crackSweep({ chunk, local: 0, tick }, 2, step);
      mv.setCrackMode(false);
      return { control, reset };
    }, { chunk: p.chunk, frames: CONTROL_FRAMES, step: STEP_U, tick: TICK });
    console.log(`CRACKS control ${p.name}: ${JSON.stringify(r)}`);
    expect(r.control.bad, `${p.name}: a control that reads 0 means the detector is blind`).toBeGreaterThan(0);
    expect(r.reset.bad, `${p.name}`).toBe(0);
  }
  // One frame to look at: a control frame, on the presented canvas.
  await page.evaluate(({ chunk, tick }) => {
    const mv = window.__mv!;
    mv.manual(true);
    mv.setPost('off');
    mv.setCrackMode(true);
    mv.setCrackControl(true);
    mv.renderAt(chunk, 0, tick);
  }, { chunk: POSITIONS[0]!.chunk, tick: TICK });
  await saveShot(page, info, 'crack-control');
});
