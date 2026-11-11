// Pixel identity at distance, section 11.3. The world repeats every 1024 chunks under ?harness, so two frames a multiple
// of 1024 apart must match if no absolute coordinate reaches the GPU. Runs on the shell and on the app. "Match" is DI-58's
// same-state bound for the project: on gpu at most 64 bytes differ and none by more than 1 level, and a byte over 1 level
// fails at once; on software 0 bytes. The absCoord control differs by over 100,000 bytes with a max of about 200, so it
// still fails at once.
//
// DI-67: every same-state compare here runs at MSAA 0, post on or off. Through D3D11, blended draws resolved at MSAA 2 or
// 4 differ between identical renders by up to 173 B, past DI-58's bound, while MSAA 0 and Vulkan read 0 (T05's repair).
// That is a resolve effect, not a world or precision fault. MSAA keeps its coverage in the cost, look and tier rows, and
// identity-vulkan.spec.ts prints a post-on MSAA 2 run under --use-angle=vulkan, ungated.
//
// R3 (V2-T09): lab.compareAt and lab.sequence refill before every reference frame, a frame two chunks ahead and back,
// because T05's props keep a shard DEMO collected hidden until a ring refills, and the far frame's jump refills them.
import { expect, test } from '../support/pw';
import { openHarness, sameStateTolerance, target } from './support/open';

test.describe.configure({ mode: 'default' });
test.setTimeout(240_000);

const KS = [977, 15259, 976562500, 15258789063] as const;
const NEAR = { chunk: 5, local: 12.5, tick: 28800 };
/** T03 saw a direct-path frame differ from itself for about 2 s after a load, and 0 of 20 loads dirty after 1 s. */
const SETTLE_EXACT_MS = 1000;

function farOf(k: number): { chunk: number; local: number; tick: number } {
  return { chunk: 5 + 1024 * k, local: NEAR.local, tick: NEAR.tick };
}

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'gpu', 'identity needs the real GPU: the post-on flake and its absence are both properties of it');
});

test('identity exact: post off, MSAA off, one try (A8, B3)', async ({ page }, info) => {
  await openHarness(page, info);
  const tol = sameStateTolerance(info.project.name);
  const r = await page.evaluate(({ keys, near, tol, settleMs }) => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    mv.manual(true);
    mv.setPost('off');
    mv.setMsaa(0);
    // Settled before the reference frame: one try stays one try, and changes no limit.
    lab.settle(near, settleMs);
    const results = keys.map((k) => ({ k, r: lab.compareAt(near, { chunk: 5 + 1024 * k, local: near.local, tick: near.tick }, { attempts: 1, tolerance: tol }) }));
    return results.map((e) => ({ k: e.k, ...e.r }));
  }, { keys: [...KS], near: NEAR, tol, settleMs: SETTLE_EXACT_MS });
  console.log(`IDENTITY tolerance ${JSON.stringify(tol)} (DI-58, project ${info.project.name})`);
  for (const e of r) console.log(`IDENTITY exact k=${e.k} ${JSON.stringify(e)}`);
  for (const e of r) {
    expect(e.pass, `k=${e.k}`).toBe(true);
    expect(e.attempts, `k=${e.k}`).toBe(1);
    expect(e.crossBytes, `k=${e.k}: DI-58`).toBeLessThanOrEqual(tol.bytes);
    expect(e.crossMax, `k=${e.k}: DI-58, a byte over 1 level fails`).toBeLessThanOrEqual(tol.max);
    expect(e.selfBytes, `k=${e.k}: DI-58`).toBeLessThanOrEqual(tol.bytes);
    expect(e.selfMax, `k=${e.k}: DI-58`).toBeLessThanOrEqual(tol.max);
    expect(e.meanLuma, `k=${e.k}: a blank frame would match itself`).toBeGreaterThan(1);
  }
});

test('identity liveness: a different state differs by over 1000 bytes (A8, B3)', async ({ page }, info) => {
  await openHarness(page, info);
  // T00's proof floor is periodic in local alone, so the shell moves local. The app moves one chunk, as section 11.3 asks.
  const moved = target() === 'app' ? { chunk: 6, local: NEAR.local, tick: NEAR.tick } : { chunk: 5, local: 13.5, tick: NEAR.tick };
  const r = await page.evaluate(({ near, other }) => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    mv.manual(true);
    mv.setPost('off');
    mv.setMsaa(0);
    mv.renderAt(near.chunk, near.local, near.tick);
    const a = mv.pixels();
    mv.renderAt(other.chunk, other.local, other.tick);
    return lab.metrics.byteDiff(a, mv.pixels());
  }, { near: NEAR, other: moved });
  console.log(`IDENTITY liveness ${JSON.stringify(r)}`);
  expect(r.bytes).toBeGreaterThan(1000);
});

test('identity post on: full, MSAA 0, best of 5 with a self-compare (A10, B4, DI-67)', async ({ page }, info) => {
  await openHarness(page, info);
  const tol = sameStateTolerance(info.project.name);
  const r = await page.evaluate(({ keys, near, tol }) => {
    const mv = window.__mv!;
    const lab = window.__mvLab!;
    mv.manual(true);
    mv.setPost('full');
    // DI-67: MSAA 0, so a D3D11 resolve difference cannot fail or mask the compare. Attempts and self-compare stay.
    mv.setMsaa(0);
    lab.settle(near);
    return keys.map((k) => ({ k, ...lab.compareAt(near, { chunk: 5 + 1024 * k, local: near.local, tick: near.tick }, { tolerance: tol }) }));
  }, { keys: [...KS], near: NEAR, tol });
  for (const e of r) console.log(`IDENTITY post-on k=${e.k} attempts=${e.attempts} ${JSON.stringify(e)}`);
  for (const e of r) {
    expect(e.pass, `k=${e.k}`).toBe(true);
    expect(e.attempts, `k=${e.k}`).toBeLessThanOrEqual(5);
    // B4, the art-stack row: max diff at most 1 even in the attempts that did not pass.
    expect(e.worstCrossMax, `k=${e.k}: max diff over every attempt`).toBeLessThanOrEqual(1);
    expect(e.meanLuma, `k=${e.k}`).toBeGreaterThan(1);
  }
});

test('identity sequence: 120 frames at both distances, post on, MSAA 0 (A11, B4, DI-67)', async ({ page }, info) => {
  await openHarness(page, info);
  const tol = sameStateTolerance(info.project.name);
  for (const k of [15259, 15258789063]) {
    const r = await page.evaluate(({ near, far, tol }) => {
      const mv = window.__mv!;
      const lab = window.__mvLab!;
      mv.manual(true);
      mv.setPost('full');
      mv.setMsaa(0);
      return lab.sequence(near, far, 120, 1.33, 2, { tolerance: tol });
    }, { near: NEAR, far: farOf(k), tol });
    console.log(`IDENTITY sequence k=${k} ${JSON.stringify(r)}`);
    expect(r.store, 'the 995 MB store did not allocate. Rerun at a 960x540 viewport').toBe('ok');
    expect(r.pass, `k=${k} worst frame ${r.worstFrame}: ${r.worstBytes} bytes, max ${r.worstMax}`).toBe(true);
    expect(r.attempts).toBeLessThanOrEqual(3);
    expect(r.worstMax, `k=${k}: DI-58`).toBeLessThanOrEqual(tol.max);
  }
});

test.describe('negative control', () => {
  test('identity control: an absolute float32 coordinate fails at once, for the right reason (A9, B4)', async ({ page }, info) => {
    await openHarness(page, info);
    const tol = sameStateTolerance(info.project.name);
    const r = await page.evaluate(({ near, far, tol }) => {
      const mv = window.__mv!;
      const lab = window.__mvLab!;
      mv.manual(true);
      lab.controls.absCoord(true);
      mv.setPost('off');
      mv.setMsaa(0);
      const exact = lab.compareAt(near, far, { attempts: 1, tolerance: tol });
      mv.setPost('full');
      // The post-on gate's own settings (DI-67), so the control fails the gate as it now runs.
      mv.setMsaa(0);
      lab.settle(near, 500);
      const postOn = lab.compareAt(near, far, { tolerance: tol });
      lab.controls.absCoord(false);
      lab.settle(near, 500);
      const after = lab.compareAt(near, far, { tolerance: tol });
      return { exact, postOn, after, audit: lab.audit() };
    }, { near: NEAR, far: farOf(15259), tol });
    console.log(`IDENTITY control ${JSON.stringify(r)}`);
    expect(r.exact.pass).toBe(false);
    expect(r.exact.crossBytes).toBeGreaterThanOrEqual(100_000);
    // The right reason: the frame matches itself, under the same bound the gate uses.
    expect(r.exact.selfBytes).toBeLessThanOrEqual(tol.bytes);
    expect(r.exact.selfMax).toBeLessThanOrEqual(tol.max);
    expect(r.exact.attempts).toBe(1);
    expect(r.postOn.pass).toBe(false);
    expect(r.postOn.crossBytes).toBeGreaterThanOrEqual(100_000);
    expect(r.postOn.selfBytes).toBeLessThanOrEqual(tol.bytes);
    expect(r.postOn.selfMax).toBeLessThanOrEqual(tol.max);
    expect(r.postOn.attempts).toBe(1);
    expect(r.after.pass, 'the control left the scene clean').toBe(true);
  });

  test('identity control: the same mistake is invisible at world 0, so only distance exposes it (A9)', async ({ page }, info) => {
    await openHarness(page, info);
    const tol = sameStateTolerance(info.project.name);
    const r = await page.evaluate(({ near, tol }) => {
      const mv = window.__mv!;
      const lab = window.__mvLab!;
      mv.manual(true);
      lab.controls.absCoord(true);
      mv.setPost('off');
      mv.setMsaa(0);
      const nearby = lab.compareAt(near, { ...near, chunk: near.chunk + 1024 }, { attempts: 1, tolerance: tol });
      lab.controls.absCoord(false);
      return nearby;
    }, { near: NEAR, tol });
    console.log(`IDENTITY control near ${JSON.stringify(r)}`);
    // Only 65,856 u apart, where float32 is still exact to under an eighth of a unit.
    expect(r.pass).toBe(true);
  });
});
